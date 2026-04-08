import express from "express";
import { randomBytes } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import {
  createBufferUpdate,
  createLinkedInPost,
  fetchBufferProfiles,
  isHttpUrl,
  loadImageBinary,
} from "../socialPublishing.ts";
import { enqueueAutomationJob } from "../taskEngine.ts";

type DatabaseLike = {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => any;
    all?: (...args: unknown[]) => any[];
    run: (...args: unknown[]) => unknown;
  };
};

type RegisterIntegrationsRoutesArgs = {
  app: express.Application;
  db: DatabaseLike;
  googleClientId?: string;
  googleClientSecret?: string;
  getUserIdFromRequest: (req: express.Request) => number | null;
  requireAuth: express.RequestHandler;
  requireWorkspaceAccess: express.RequestHandler;
  requireWorkspaceRole: (...roles: string[]) => express.RequestHandler;
};

export function registerIntegrationsRoutes({
  app,
  db,
  googleClientId,
  googleClientSecret,
  getUserIdFromRequest,
  requireAuth,
  requireWorkspaceAccess,
  requireWorkspaceRole,
}: RegisterIntegrationsRoutesArgs) {
  const WEBHOOK_PROVIDERS = ["hubspot", "wordpress", "linkedin"] as const;
  type WebhookProvider = typeof WEBHOOK_PROVIDERS[number];

  function isWebhookProvider(value: string): value is WebhookProvider {
    return WEBHOOK_PROVIDERS.includes(value as WebhookProvider);
  }

  function writeIntegrationAuditLog(
    workspaceId: number,
    userId: number | null,
    action: string,
    resource: string,
    details: Record<string, unknown>,
  ) {
    db.prepare(
      "INSERT INTO audit_logs (workspace_id, user_id, action, resource, details) VALUES (?, ?, ?, ?, ?)",
    ).run(workspaceId, userId, action, resource, JSON.stringify(details));
  }

  function generateSecretToken() {
    return randomBytes(24).toString("hex");
  }

  async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    try {
      return await Promise.race([
        operation(),
        new Promise<T>((_resolve, reject) => {
          timeoutHandle = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  async function verifyTwilioCredentials(accountSid: string, authToken: string) {
    const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`, {
      method: "GET",
      headers: {
        Authorization: auth,
      },
    });

    if (!response.ok) {
      throw new Error(`Twilio authentication failed with status ${response.status}`);
    }

    const payload = await response.json() as { friendly_name?: string; status?: string };
    return {
      accountName: payload.friendly_name || null,
      accountStatus: payload.status || null,
    };
  }

  async function sendTwilioMessage(accountSid: string, authToken: string, from: string, to: string, body: string) {
    const auth = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
    const payload = new URLSearchParams({
      From: from,
      To: to,
      Body: body,
    });

    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Twilio message create failed with status ${response.status}`);
    }

    return response.json() as Promise<{ sid?: string; status?: string }>;
  }

  async function verifySlackToken(botToken: string) {
    const response = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(),
    });

    if (!response.ok) {
      throw new Error(`Slack authentication failed with status ${response.status}`);
    }

    const payload = await response.json() as {
      ok?: boolean;
      error?: string;
      team_id?: string;
      team?: string;
      user_id?: string;
      bot_id?: string;
    };

    if (!payload.ok) {
      throw new Error(payload.error || "Slack authentication failed");
    }

    return {
      teamId: payload.team_id || null,
      teamName: payload.team || null,
      botUserId: payload.user_id || payload.bot_id || null,
    };
  }

  async function sendSlackMessage(botToken: string, channel: string, text: string) {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Slack message failed with status ${response.status}`);
    }

    const payload = await response.json() as {
      ok?: boolean;
      error?: string;
      channel?: string;
      ts?: string;
    };

    if (!payload.ok) {
      throw new Error(payload.error || "Slack message failed");
    }

    return {
      channel: payload.channel || channel,
      messageTs: payload.ts || null,
    };
  }

  function normalizeTeamsWebhookUrl(rawValue: string) {
    const trimmed = rawValue.trim();
    const url = new URL(trimmed);
    if (url.protocol !== "https:") {
      throw new Error("Teams webhookUrl must use https");
    }

    const host = url.hostname.toLowerCase();
    if (!host.includes("office.com") && !host.includes("microsoft.com") && !host.includes("logic.azure.com")) {
      throw new Error("Teams webhookUrl host is invalid");
    }

    return url.toString();
  }

  async function sendTeamsMessage(webhookUrl: string, text: string, title?: string) {
    const payload = title && title.trim()
      ? {
          "@type": "MessageCard",
          "@context": "http://schema.org/extensions",
          summary: title.trim(),
          themeColor: "0078D4",
          title: title.trim(),
          text,
        }
      : { text };

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Teams message failed with status ${response.status}`);
    }
  }

  async function verifyNotionToken(integrationToken: string) {
    const response = await fetch("https://api.notion.com/v1/users/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${integrationToken}`,
        "Notion-Version": "2022-06-28",
      },
    });

    if (!response.ok) {
      throw new Error(`Notion authentication failed with status ${response.status}`);
    }

    const payload = await response.json() as {
      object?: string;
      name?: string;
      bot?: { owner?: { workspace_name?: string } };
    };

    return {
      botName: payload.name || payload.bot?.owner?.workspace_name || null,
    };
  }

  async function createNotionPage(
    integrationToken: string,
    parentPageId: string,
    title: string,
    content?: string,
  ) {
    const children = content && content.trim()
      ? [{
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{
              type: "text",
              text: { content: content.trim() },
            }],
          },
        }]
      : undefined;

    const response = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${integrationToken}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { page_id: parentPageId },
        properties: {
          title: {
            title: [{
              type: "text",
              text: { content: title },
            }],
          },
        },
        ...(children ? { children } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Notion page creation failed with status ${response.status}`);
    }

    const payload = await response.json() as { id?: string; url?: string };
    return {
      pageId: payload.id || null,
      url: payload.url || null,
    };
  }

  function normalizeWordPressSiteUrl(rawValue: string) {
    const trimmed = rawValue.trim();
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  }

  function getWordPressAuthHeaders(username: string, appPassword: string) {
    return {
      Authorization: `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`,
      "Content-Type": "application/json",
    };
  }

  async function verifyWordPressCredentials(siteUrl: string, username: string, appPassword: string) {
    const response = await fetch(`${siteUrl}/wp-json/wp/v2/users/me?context=edit`, {
      method: "GET",
      headers: getWordPressAuthHeaders(username, appPassword),
    });

    if (!response.ok) {
      throw new Error(`WordPress authentication failed with status ${response.status}`);
    }

    const payload = await response.json() as { name?: string };
    return { userDisplayName: payload.name || username };
  }

  async function uploadWordPressMedia(siteUrl: string, username: string, appPassword: string, imageUrl: string, fallbackName: string) {
    const source = await loadImageBinary(imageUrl);
    const extension = source.mimeType.includes("png")
      ? "png"
      : source.mimeType.includes("gif")
        ? "gif"
        : source.mimeType.includes("webp")
          ? "webp"
          : "jpg";
    const fileName = `${fallbackName.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() || "artifact-image"}.${extension}`;

    const response = await fetch(`${siteUrl}/wp-json/wp/v2/media`, {
      method: "POST",
      headers: {
        ...getWordPressAuthHeaders(username, appPassword),
        "Content-Type": source.mimeType,
        "Content-Disposition": `attachment; filename=\"${fileName}\"`,
      },
      body: source.bytes,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `WordPress media upload failed with status ${response.status}`);
    }

    return response.json() as Promise<{ id: number }>;
  }

  async function createWordPressDraft(
    siteUrl: string,
    username: string,
    appPassword: string,
    title: string,
    content: string,
    excerpt?: string,
    featuredMediaId?: number,
  ) {
    const response = await fetch(`${siteUrl}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: getWordPressAuthHeaders(username, appPassword),
      body: JSON.stringify({
        title,
        content,
        excerpt,
        status: "draft",
        ...(typeof featuredMediaId === "number" ? { featured_media: featuredMediaId } : {}),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `WordPress draft creation failed with status ${response.status}`);
    }

    return response.json() as Promise<{ id: number; link?: string }>; 
  }

  function extractCompanyDomain(lead: { company?: string; email?: string }) {
    if (lead.email && lead.email.includes("@")) {
      const [, domainPart] = lead.email.split("@");
      const cleanedDomain = domainPart?.trim().toLowerCase();
      if (cleanedDomain && cleanedDomain.includes(".")) {
        return cleanedDomain;
      }
    }

    if (lead.company) {
      return lead.company.trim().toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9.-]/g, "");
    }

    return null;
  }

  async function verifyHubSpotToken(accessToken: string) {
    const response = await fetch("https://api.hubapi.com/account-info/v3/details", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HubSpot authentication failed with status ${response.status}`);
    }

    const payload = await response.json() as { portalId?: number; companyName?: string };
    return {
      portalId: payload.portalId ?? null,
      accountName: payload.companyName ?? null,
    };
  }

  async function upsertHubSpotContact(accessToken: string, lead: { name?: string; email?: string; role?: string; company?: string; location?: string }) {
    if (!lead.email) {
      throw new Error("Lead email is required for HubSpot sync");
    }

    const nameParts = (lead.name || "").trim().split(/\s+/).filter(Boolean);
    const firstname = nameParts[0] || "";
    const lastname = nameParts.slice(1).join(" ");

    const createResponse = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          email: lead.email,
          firstname,
          lastname,
          jobtitle: lead.role || "",
          company: lead.company || "",
          city: lead.location || "",
        },
      }),
    });

    if (createResponse.ok) {
      return createResponse.json() as Promise<{ id: string }>;
    }

    if (createResponse.status !== 409) {
      const errorText = await createResponse.text();
      throw new Error(errorText || `HubSpot contact upsert failed with status ${createResponse.status}`);
    }

    const searchResponse = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filterGroups: [{
          filters: [{ propertyName: "email", operator: "EQ", value: lead.email }],
        }],
        limit: 1,
      }),
    });

    if (!searchResponse.ok) {
      throw new Error(`HubSpot contact lookup failed with status ${searchResponse.status}`);
    }

    const searchPayload = await searchResponse.json() as { results?: Array<{ id: string }> };
    const existingId = searchPayload.results?.[0]?.id;
    if (!existingId) {
      throw new Error("HubSpot contact exists but could not be resolved");
    }

    const patchResponse = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${existingId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          firstname,
          lastname,
          jobtitle: lead.role || "",
          company: lead.company || "",
          city: lead.location || "",
        },
      }),
    });

    if (!patchResponse.ok) {
      const errorText = await patchResponse.text();
      throw new Error(errorText || `HubSpot contact update failed with status ${patchResponse.status}`);
    }

    return { id: existingId };
  }

  async function createHubSpotNote(accessToken: string, contactId: string, noteBody: string) {
    const response = await fetch("https://api.hubapi.com/crm/v3/objects/notes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          hs_note_body: noteBody,
          hs_timestamp: new Date().toISOString(),
        },
        associations: [{
          to: { id: contactId },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }],
        }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `HubSpot note creation failed with status ${response.status}`);
    }

    return response.json() as Promise<{ id: string }>;
  }

  async function upsertHubSpotCompany(accessToken: string, lead: { company?: string; email?: string; location?: string }) {
    if (!lead.company || !lead.company.trim()) {
      return null;
    }

    const domain = extractCompanyDomain(lead);
    let existingId: string | null = null;

    if (domain) {
      const searchByDomainResponse = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filterGroups: [{
            filters: [{ propertyName: "domain", operator: "EQ", value: domain }],
          }],
          limit: 1,
        }),
      });

      if (searchByDomainResponse.ok) {
        const payload = await searchByDomainResponse.json() as { results?: Array<{ id: string }> };
        existingId = payload.results?.[0]?.id || null;
      }
    }

    if (!existingId) {
      const searchByNameResponse = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filterGroups: [{
            filters: [{ propertyName: "name", operator: "EQ", value: lead.company.trim() }],
          }],
          limit: 1,
        }),
      });

      if (searchByNameResponse.ok) {
        const payload = await searchByNameResponse.json() as { results?: Array<{ id: string }> };
        existingId = payload.results?.[0]?.id || null;
      }
    }

    if (existingId) {
      const patchResponse = await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${existingId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: {
            name: lead.company.trim(),
            ...(domain ? { domain } : {}),
            ...(lead.location ? { city: lead.location } : {}),
          },
        }),
      });

      if (!patchResponse.ok) {
        const errorText = await patchResponse.text();
        throw new Error(errorText || `HubSpot company update failed with status ${patchResponse.status}`);
      }

      return { id: existingId };
    }

    const createResponse = await fetch("https://api.hubapi.com/crm/v3/objects/companies", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          name: lead.company.trim(),
          ...(domain ? { domain } : {}),
          ...(lead.location ? { city: lead.location } : {}),
        },
      }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      throw new Error(errorText || `HubSpot company upsert failed with status ${createResponse.status}`);
    }

    return createResponse.json() as Promise<{ id: string }>;
  }

  async function createHubSpotDeal(
    accessToken: string,
    params: { leadName: string; company?: string; contactId: string; companyId?: string | null; amount?: number; stage?: string },
  ) {
    const dealName = `${params.leadName}${params.company ? ` - ${params.company}` : ""} Opportunity`;
    const response = await fetch("https://api.hubapi.com/crm/v3/objects/deals", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        properties: {
          dealname: dealName,
          dealstage: params.stage || "appointmentscheduled",
          pipeline: "default",
          ...(typeof params.amount === "number" && Number.isFinite(params.amount) ? { amount: params.amount } : {}),
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `HubSpot deal creation failed with status ${response.status}`);
    }

    const deal = await response.json() as { id: string };

    await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${deal.id}/associations/contacts/${params.contactId}/deal_to_contact`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }).catch(() => null);

    if (params.companyId) {
      await fetch(`https://api.hubapi.com/crm/v3/objects/deals/${deal.id}/associations/companies/${params.companyId}/deal_to_company`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }).catch(() => null);
    }

    return deal;
  }

  function normalizeLinkedInAuthorUrn(rawValue: string) {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      throw new Error("LinkedIn author URN is required");
    }

    return trimmed.startsWith("urn:li:person:") ? trimmed : `urn:li:person:${trimmed.replace(/^urn:li:person:/, "")}`;
  }

  async function verifyLinkedInToken(accessToken: string, providedAuthorUrn?: string) {
    const response = await fetch("https://api.linkedin.com/v2/userinfo", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`LinkedIn authentication failed with status ${response.status}`);
    }

    const payload = await response.json() as {
      sub?: string;
      name?: string;
      given_name?: string;
      family_name?: string;
      localizedFirstName?: string;
      localizedLastName?: string;
    };

    const derivedName = payload.name
      || [payload.given_name, payload.family_name].filter(Boolean).join(" ")
      || [payload.localizedFirstName, payload.localizedLastName].filter(Boolean).join(" ")
      || null;
    const derivedAuthorUrn = providedAuthorUrn?.trim()
      ? normalizeLinkedInAuthorUrn(providedAuthorUrn)
      : payload.sub
        ? normalizeLinkedInAuthorUrn(payload.sub)
        : null;

    if (!derivedAuthorUrn) {
      throw new Error("LinkedIn author URN could not be determined");
    }

    return {
      accountName: derivedName,
      authorUrn: derivedAuthorUrn,
    };
  }

  async function getWorkspaceClient(userId: number): Promise<OAuth2Client | null> {
    const row = db.prepare("SELECT * FROM google_tokens WHERE user_id = ?").get(userId) as any;
    if (!row) return null;

    const client = new OAuth2Client(googleClientId, googleClientSecret);
    client.setCredentials({
      access_token: row.access_token,
      refresh_token: row.refresh_token,
      expiry_date: row.expiry_date,
    });

    if (row.expiry_date && Date.now() > row.expiry_date - 60000) {
      try {
        const { credentials } = await withTimeout(
          () => client.refreshAccessToken(),
          10000,
          "Google token refresh",
        );
        db.prepare("UPDATE google_tokens SET access_token = ?, expiry_date = ? WHERE user_id = ?")
          .run(credentials.access_token, credentials.expiry_date, userId);
        client.setCredentials(credentials);
      } catch (e: any) {
        if (e && e.message && (e.message.includes('unauthorized_client') || e.message.includes('invalid_grant'))) {
          console.error(`Google token revoked or invalid for user ${userId}. Clearing from database.`);
          db.prepare("DELETE FROM google_tokens WHERE user_id = ?").run(userId);
        } else {
          console.error("Failed to refresh Google token:", e);
        }
        return null;
      }
    }

    return client;
  }

  app.get("/api/integrations/google/connect", (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
    const redirectUri = `${baseUrl}/api/auth/google/callback`;

    const authClient = new OAuth2Client(googleClientId, googleClientSecret, redirectUri);
    const url = authClient.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/docs.readonly",
        "https://www.googleapis.com/auth/presentations.readonly",
        "https://www.googleapis.com/auth/analytics.readonly",
        "https://www.googleapis.com/auth/webmasters.readonly",
      ],
      state: Buffer.from(JSON.stringify({ type: "workspace", userId })).toString("base64"),
    });

    return res.json({ url });
  });

  app.get("/api/integrations/google/status", (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const row = db.prepare("SELECT scopes, expiry_date FROM google_tokens WHERE user_id = ?").get(userId) as any;
    if (!row) return res.json({ connected: false, scopes: [] });

    const scopes = (row.scopes || "").split(" ").filter(Boolean);
    const connected = scopes.length > 0;
    return res.json({
      connected,
      gmail: scopes.some((s: string) => s.includes("gmail")),
      calendar: scopes.some((s: string) => s.includes("calendar")),
      drive: scopes.some((s: string) => s.includes("drive") || s.includes("docs") || s.includes("presentations")),
      analytics: scopes.some((s: string) => s.includes("analytics")),
      searchConsole: scopes.some((s: string) => s.includes("webmasters") || s.includes("searchconsole")),
      scopes,
    });
  });

  app.delete("/api/integrations/google", (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    db.prepare("DELETE FROM google_tokens WHERE user_id = ?").run(userId);
    return res.json({ success: true });
  });

  app.get("/api/integrations/gmail/messages", async (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const client = await getWorkspaceClient(userId);
    if (!client) return res.status(403).json({ error: "Gmail not connected" });

    try {
      const { google } = await import("googleapis");
      const gmail = google.gmail({ version: "v1", auth: client });
      const maxResults = parseInt(req.query.maxResults as string) || 10;

      const listRes = await gmail.users.messages.list({
        userId: "me",
        maxResults,
        labelIds: ["INBOX"],
        q: (req.query.q as string) || "",
      });

      const messages = await Promise.all(
        (listRes.data.messages || []).map(async (m) => {
          const msg = await gmail.users.messages.get({
            userId: "me",
            id: m.id!,
            format: "metadata",
            metadataHeaders: ["From", "Subject", "Date"],
          });
          const headers = msg.data.payload?.headers || [];
          const get = (name: string) => headers.find((h) => h.name === name)?.value || "";
          return {
            id: m.id,
            from: get("From"),
            subject: get("Subject"),
            date: get("Date"),
            snippet: msg.data.snippet,
          };
        })
      );

      return res.json({ messages });
    } catch (err: any) {
      console.error("Gmail API error:", err.message);
      return res.status(500).json({ error: "Failed to fetch Gmail messages" });
    }
  });

  app.post("/api/integrations/gmail/drafts", async (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const client = await getWorkspaceClient(userId);
    if (!client) return res.status(403).json({ error: "Gmail not connected" });

    try {
      const { to, subject, body } = req.body;
      if (!to || !subject || !body) {
        return res.status(400).json({ error: "Missing to, subject, or body" });
      }

      const { google } = await import("googleapis");
      const gmail = google.gmail({ version: "v1", auth: client });

      const messageParts = [
        `To: ${to}`,
        `Subject: ${subject}`,
        "Content-Type: text/plain; charset=utf-8",
        "",
        body,
      ];
      const message = messageParts.join("\n");

      const encodedMessage = Buffer.from(message)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      const draftRes = await gmail.users.drafts.create({
        userId: "me",
        requestBody: {
          message: {
            raw: encodedMessage,
          },
        },
      });

      return res.json({ success: true, draftId: draftRes.data.id });
    } catch (err: any) {
      console.error("Gmail Draft API error:", err.message);
      return res.status(500).json({ error: "Failed to create Gmail draft" });
    }
  });

  app.get("/api/integrations/calendar/events", async (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const client = await getWorkspaceClient(userId);
    if (!client) return res.status(403).json({ error: "Calendar not connected" });

    try {
      const { google } = await import("googleapis");
      const calendar = google.calendar({ version: "v3", auth: client });
      const days = parseInt(req.query.days as string) || 7;

      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

      const eventsRes = await withTimeout(
        () => calendar.events.list({
          calendarId: "primary",
          timeMin,
          timeMax,
          maxResults: 20,
          singleEvents: true,
          orderBy: "startTime",
        }),
        10000,
        "Calendar events fetch",
      );

      const events = (eventsRes.data.items || []).map((e) => ({
        id: e.id,
        summary: e.summary,
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        location: e.location,
        description: e.description,
        attendees: (e.attendees || []).map((a) => a.email),
      }));

      return res.json({ events });
    } catch (err: any) {
      console.error("Calendar API error:", err.message);
      if (String(err?.message || "").includes("timed out")) {
        return res.status(504).json({ error: "Calendar request timed out. Please reconnect Google Calendar and try again." });
      }
      return res.status(500).json({ error: "Failed to fetch calendar events" });
    }
  });

  app.get("/api/integrations/drive/files", async (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const client = await getWorkspaceClient(userId);
    if (!client) return res.status(403).json({ error: "Drive not connected" });

    try {
      const { google } = await import("googleapis");
      const drive = google.drive({ version: "v3", auth: client });
      const maxResults = parseInt(req.query.maxResults as string) || 20;
      const query = (req.query.q as string) || "";

      const filesRes = await drive.files.list({
        pageSize: maxResults,
        q: query || "trashed=false",
        orderBy: "modifiedTime desc",
        fields: "files(id,name,mimeType,modifiedTime,webViewLink,owners)",
      });

      const files = (filesRes.data.files || []).map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime,
        webViewLink: f.webViewLink,
        type: f.mimeType?.includes("document") ? "doc"
          : f.mimeType?.includes("spreadsheet") ? "sheet"
            : f.mimeType?.includes("presentation") ? "slides"
              : f.mimeType?.includes("folder") ? "folder"
                : "file",
      }));

      return res.json({ files });
    } catch (err: any) {
      console.error("Drive API error:", err.message);
      return res.status(500).json({ error: "Failed to fetch Drive files" });
    }
  });

  app.get("/api/integrations/analytics/properties", async (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const client = await getWorkspaceClient(userId);
    if (!client) return res.status(403).json({ error: "Analytics not connected" });

    try {
      const { google } = await import("googleapis");
      const analyticsAdmin = google.analyticsadmin({ version: "v1beta", auth: client });
      const accountSummaries = await analyticsAdmin.accountSummaries.list({ pageSize: 100 });

      const properties = (accountSummaries.data.accountSummaries || []).flatMap((summary) =>
        (summary.propertySummaries || []).map((property) => ({
          property: property.property,
          displayName: property.displayName,
          propertyId: property.property?.split("/")[1] || "",
          account: summary.displayName,
        })),
      );

      return res.json({ properties });
    } catch (err: any) {
      console.warn("[Analytics] Google Analytics Admin API unavailable (API may not be enabled in GCP):", err.message);
      return res.status(500).json({ error: "Failed to fetch analytics properties" });
    }
  });

  app.get("/api/integrations/analytics/report", async (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const client = await getWorkspaceClient(userId);
    if (!client) return res.status(403).json({ error: "Analytics not connected" });

    const propertyId = String(req.query.propertyId || "").trim();
    if (!propertyId) return res.status(400).json({ error: "propertyId is required" });

    const days = Number.parseInt(String(req.query.days || "28"), 10);
    const normalizedDays = Number.isFinite(days) && days > 0 ? Math.min(days, 120) : 28;

    try {
      const { google } = await import("googleapis");
      const analyticsData = google.analyticsdata({ version: "v1beta", auth: client });
      const report = await analyticsData.properties.runReport({
        property: `properties/${propertyId}`,
        requestBody: {
          dateRanges: [{ startDate: `${normalizedDays}daysAgo`, endDate: "today" }],
          dimensions: [{ name: "date" }],
          metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "screenPageViews" }],
          limit: "30",
          orderBys: [{ dimension: { dimensionName: "date", orderType: "ALPHANUMERIC" } }],
        },
      });

      const rows = (report.data.rows || []).map((row) => ({
        date: row.dimensionValues?.[0]?.value || "",
        sessions: Number.parseInt(row.metricValues?.[0]?.value || "0", 10),
        users: Number.parseInt(row.metricValues?.[1]?.value || "0", 10),
        pageViews: Number.parseInt(row.metricValues?.[2]?.value || "0", 10),
      }));

      return res.json({ rows });
    } catch (err: any) {
      console.error("Analytics report API error:", err.message);
      return res.status(500).json({ error: "Failed to fetch analytics report" });
    }
  });

  app.get("/api/integrations/search-console/sites", async (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const client = await getWorkspaceClient(userId);
    if (!client) return res.status(403).json({ error: "Search Console not connected" });

    try {
      const { google } = await import("googleapis");
      const searchconsole = google.searchconsole({ version: "v1", auth: client });
      const siteList = await searchconsole.sites.list();
      const sites = (siteList.data.siteEntry || []).map((site) => ({
        siteUrl: site.siteUrl,
        permissionLevel: site.permissionLevel,
      }));

      return res.json({ sites });
    } catch (err: any) {
      console.warn("[Search Console] Google Search Console API unavailable (API may not be enabled in GCP):", err.message);
      return res.status(500).json({ error: "Failed to fetch Search Console sites" });
    }
  });

  app.get("/api/integrations/search-console/performance", async (req, res) => {
    const userId = getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const client = await getWorkspaceClient(userId);
    if (!client) return res.status(403).json({ error: "Search Console not connected" });

    const siteUrl = String(req.query.siteUrl || "").trim();
    if (!siteUrl) return res.status(400).json({ error: "siteUrl is required" });

    const days = Number.parseInt(String(req.query.days || "28"), 10);
    const normalizedDays = Number.isFinite(days) && days > 0 ? Math.min(days, 120) : 28;

    try {
      const { google } = await import("googleapis");
      const searchconsole = google.searchconsole({ version: "v1", auth: client });
      const endDate = new Date();
      const startDate = new Date(Date.now() - normalizedDays * 24 * 60 * 60 * 1000);

      const result = await searchconsole.searchanalytics.query({
        siteUrl,
        requestBody: {
          startDate: startDate.toISOString().slice(0, 10),
          endDate: endDate.toISOString().slice(0, 10),
          dimensions: ["query"],
          rowLimit: 10,
        },
      });

      const rows = (result.data.rows || []).map((row) => ({
        query: row.keys?.[0] || "",
        clicks: row.clicks || 0,
        impressions: row.impressions || 0,
        ctr: row.ctr || 0,
        position: row.position || 0,
      }));

      return res.json({ rows });
    } catch (err: any) {
      console.error("Search Console performance API error:", err.message);
      return res.status(500).json({ error: "Failed to fetch Search Console performance" });
    }
  });

  app.get("/api/workspaces/:id/integrations/google/defaults", requireAuth, requireWorkspaceAccess, (req: any, res) => {
    const row = db.prepare("SELECT analytics_property_id, search_console_site_url FROM workspace_google_defaults WHERE workspace_id = ?").get(req.workspaceId) as any;
    return res.json({
      analyticsPropertyId: row?.analytics_property_id ?? null,
      searchConsoleSiteUrl: row?.search_console_site_url ?? null,
    });
  });

  app.put(
    "/api/workspaces/:id/integrations/google/defaults",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    (req: any, res) => {
      const {
        analyticsPropertyId = null,
        searchConsoleSiteUrl = null,
      } = req.body as {
        analyticsPropertyId?: string | null;
        searchConsoleSiteUrl?: string | null;
      };

      db.prepare(`
        INSERT INTO workspace_google_defaults (workspace_id, analytics_property_id, search_console_site_url, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(workspace_id) DO UPDATE SET
          analytics_property_id = excluded.analytics_property_id,
          search_console_site_url = excluded.search_console_site_url,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        req.workspaceId,
        typeof analyticsPropertyId === "string" && analyticsPropertyId.trim() ? analyticsPropertyId.trim() : null,
        typeof searchConsoleSiteUrl === "string" && searchConsoleSiteUrl.trim() ? searchConsoleSiteUrl.trim() : null,
      );

      return res.json({
        success: true,
        analyticsPropertyId: typeof analyticsPropertyId === "string" && analyticsPropertyId.trim() ? analyticsPropertyId.trim() : null,
        searchConsoleSiteUrl: typeof searchConsoleSiteUrl === "string" && searchConsoleSiteUrl.trim() ? searchConsoleSiteUrl.trim() : null,
      });
    },
  );

  app.get("/api/workspaces/:id/integrations/webhooks/secrets", requireAuth, requireWorkspaceAccess, (req: any, res) => {
    const rows = (db.prepare(`
      SELECT provider, secret, rotated_at
      FROM workspace_webhook_secrets
      WHERE workspace_id = ? AND is_active = 1
      ORDER BY provider ASC
    `).all?.(req.workspaceId) || []) as Array<{ provider: string; secret: string; rotated_at: string | null }>;

    return res.json({
      providers: WEBHOOK_PROVIDERS.map((provider) => {
        const row = rows.find((item) => item.provider === provider);
        return {
          provider,
          configured: Boolean(row),
          lastRotatedAt: row?.rotated_at || null,
          secretPreview: row?.secret ? `••••${row.secret.slice(-6)}` : null,
        };
      }),
    });
  });

  app.post(
    "/api/workspaces/:id/integrations/webhooks/secrets/:provider/rotate",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    (req: any, res) => {
      const provider = String(req.params.provider || "").toLowerCase();
      if (!isWebhookProvider(provider)) {
        return res.status(400).json({ error: "Unsupported webhook provider" });
      }

      const secret = generateSecretToken();
      db.prepare(
        "UPDATE workspace_webhook_secrets SET is_active = 0 WHERE workspace_id = ? AND provider = ? AND is_active = 1",
      ).run(req.workspaceId, provider);

      db.prepare(`
        INSERT INTO workspace_webhook_secrets (workspace_id, provider, secret, created_by_user_id, is_active, rotated_at)
        VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      `).run(req.workspaceId, provider, secret, req.userId || null);

      writeIntegrationAuditLog(req.workspaceId, req.userId || null, "integration.webhook_secret.rotated", "workspace_webhook_secrets", {
        provider,
      });

      return res.json({
        success: true,
        provider,
        secret,
      });
    },
  );

  app.post("/api/webhooks/:provider/:workspaceId", (req: any, res) => {
    try {
      const provider = String(req.params.provider || "").toLowerCase();
      const workspaceId = Number.parseInt(String(req.params.workspaceId || ""), 10);
      if (!Number.isFinite(workspaceId) || workspaceId <= 0) {
        return res.status(400).json({ error: "Invalid workspaceId" });
      }

      if (!isWebhookProvider(provider)) {
        return res.status(400).json({ error: "Unsupported webhook provider" });
      }

      const receivedSecret = String(req.get("x-aether-webhook-secret") || "").trim();
      if (!receivedSecret) {
        return res.status(401).json({ error: "Missing webhook secret" });
      }

      const activeSecretRow = db.prepare(
        "SELECT secret FROM workspace_webhook_secrets WHERE workspace_id = ? AND provider = ? AND is_active = 1",
      ).get(workspaceId, provider) as { secret: string } | undefined;

      if (!activeSecretRow || activeSecretRow.secret !== receivedSecret) {
        return res.status(403).json({ error: "Invalid webhook secret" });
      }

      const payload = req.body && typeof req.body === "object" ? req.body : { rawBody: req.body };

      enqueueAutomationJob(db as any, {
        workspaceId,
        source: `webhook.${provider}`,
        action: "webhook.event.ingested",
        channel: provider,
        payload: {
          provider,
          eventType: typeof payload?.eventType === "string" ? payload.eventType : null,
          receivedAt: new Date().toISOString(),
          payload,
        },
      });

      writeIntegrationAuditLog(workspaceId, null, "integration.webhook.ingested", "webhooks", {
        provider,
        eventType: typeof payload?.eventType === "string" ? payload.eventType : null,
      });

      return res.status(202).json({ accepted: true });
    } catch (err: any) {
      console.error("Webhook ingestion error:", err.message);
      return res.status(500).json({ error: "Failed to process webhook" });
    }
  });

  app.get("/api/workspaces/:id/integrations/linkedin/status", requireAuth, requireWorkspaceAccess, (req: any, res) => {
    const row = db.prepare("SELECT author_urn, account_name FROM linkedin_connections WHERE workspace_id = ?").get(req.workspaceId) as any;
    return res.json({
      connected: Boolean(row),
      authorUrn: row?.author_urn ?? null,
      accountName: row?.account_name ?? null,
    });
  });

  app.post(
    "/api/workspaces/:id/integrations/linkedin",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    async (req: any, res) => {
      try {
        const { accessToken, authorUrn } = req.body as {
          accessToken?: string;
          authorUrn?: string;
        };

        if (!accessToken || !accessToken.trim()) {
          return res.status(400).json({ error: "accessToken is required" });
        }

        const verified = await verifyLinkedInToken(accessToken.trim(), authorUrn);

        db.prepare(`
          INSERT INTO linkedin_connections (workspace_id, access_token, author_urn, account_name, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(workspace_id) DO UPDATE SET
            access_token = excluded.access_token,
            author_urn = excluded.author_urn,
            account_name = excluded.account_name,
            updated_at = CURRENT_TIMESTAMP
        `).run(req.workspaceId, accessToken.trim(), verified.authorUrn, verified.accountName);

        return res.json({
          connected: true,
          authorUrn: verified.authorUrn,
          accountName: verified.accountName,
        });
      } catch (err: any) {
        console.error("LinkedIn connect error:", err.message);
        return res.status(400).json({ error: "Failed to verify LinkedIn token" });
      }
    },
  );

  app.get("/api/workspaces/:id/integrations/twilio/status", requireAuth, requireWorkspaceAccess, (req: any, res) => {
    const row = db.prepare("SELECT account_sid, from_number, updated_at FROM twilio_connections WHERE workspace_id = ?").get(req.workspaceId) as any;
    return res.json({
      connected: Boolean(row),
      accountSid: row?.account_sid || null,
      fromNumber: row?.from_number || null,
      updatedAt: row?.updated_at || null,
    });
  });

  app.get("/api/workspaces/:id/integrations/slack/status", requireAuth, requireWorkspaceAccess, (req: any, res) => {
    const row = db.prepare("SELECT default_channel, team_id, team_name, bot_user_id, updated_at FROM slack_connections WHERE workspace_id = ?").get(req.workspaceId) as any;
    return res.json({
      connected: Boolean(row),
      defaultChannel: row?.default_channel || null,
      teamId: row?.team_id || null,
      teamName: row?.team_name || null,
      botUserId: row?.bot_user_id || null,
      updatedAt: row?.updated_at || null,
    });
  });

  app.post(
    "/api/workspaces/:id/integrations/slack",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    async (req: any, res) => {
      try {
        const { botToken, defaultChannel } = req.body as {
          botToken?: string;
          defaultChannel?: string;
        };

        if (!botToken || !botToken.trim()) {
          return res.status(400).json({ error: "botToken is required" });
        }

        const verified = await verifySlackToken(botToken.trim());

        db.prepare(`
          INSERT INTO slack_connections (workspace_id, bot_token, default_channel, team_id, team_name, bot_user_id, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(workspace_id) DO UPDATE SET
            bot_token = excluded.bot_token,
            default_channel = excluded.default_channel,
            team_id = excluded.team_id,
            team_name = excluded.team_name,
            bot_user_id = excluded.bot_user_id,
            updated_at = CURRENT_TIMESTAMP
        `).run(
          req.workspaceId,
          botToken.trim(),
          typeof defaultChannel === "string" && defaultChannel.trim() ? defaultChannel.trim() : null,
          verified.teamId,
          verified.teamName,
          verified.botUserId,
        );

        writeIntegrationAuditLog(req.workspaceId, req.userId || null, "integration.slack.connected", "slack_connections", {
          teamId: verified.teamId,
          teamName: verified.teamName,
          defaultChannel: typeof defaultChannel === "string" && defaultChannel.trim() ? defaultChannel.trim() : null,
        });

        return res.json({
          connected: true,
          defaultChannel: typeof defaultChannel === "string" && defaultChannel.trim() ? defaultChannel.trim() : null,
          teamId: verified.teamId,
          teamName: verified.teamName,
          botUserId: verified.botUserId,
        });
      } catch (err: any) {
        console.error("Slack connect error:", err.message);
        return res.status(400).json({ error: "Failed to verify Slack credentials" });
      }
    },
  );

  app.delete(
    "/api/workspaces/:id/integrations/slack",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    (req: any, res) => {
      db.prepare("DELETE FROM slack_connections WHERE workspace_id = ?").run(req.workspaceId);
      writeIntegrationAuditLog(req.workspaceId, req.userId || null, "integration.slack.disconnected", "slack_connections", {});
      return res.json({ success: true });
    },
  );

  app.post(
    "/api/workspaces/:id/integrations/slack/messages",
    requireAuth,
    requireWorkspaceAccess,
    async (req: any, res) => {
      try {
        const row = db
          .prepare("SELECT bot_token, default_channel FROM slack_connections WHERE workspace_id = ?")
          .get(req.workspaceId) as any;
        if (!row) {
          return res.status(403).json({ error: "Slack not connected" });
        }

        const { channel, text } = req.body as { channel?: string; text?: string };
        const targetChannel = typeof channel === "string" && channel.trim() ? channel.trim() : row.default_channel;
        if (!targetChannel) {
          return res.status(400).json({ error: "channel is required when no defaultChannel is configured" });
        }
        if (!text || !text.trim()) {
          return res.status(400).json({ error: "text is required" });
        }

        const result = await sendSlackMessage(row.bot_token, targetChannel, text.trim());
        return res.json({
          success: true,
          channel: result.channel,
          messageTs: result.messageTs,
        });
      } catch (err: any) {
        console.error("Slack message error:", err.message);
        return res.status(500).json({ error: "Failed to send Slack message" });
      }
    },
  );

  app.get("/api/workspaces/:id/integrations/teams/status", requireAuth, requireWorkspaceAccess, (req: any, res) => {
    const row = db
      .prepare("SELECT default_channel_name, updated_at FROM teams_connections WHERE workspace_id = ?")
      .get(req.workspaceId) as any;

    return res.json({
      connected: Boolean(row),
      defaultChannelName: row?.default_channel_name || null,
      updatedAt: row?.updated_at || null,
    });
  });

  app.post(
    "/api/workspaces/:id/integrations/teams",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    async (req: any, res) => {
      try {
        const { webhookUrl, defaultChannelName } = req.body as {
          webhookUrl?: string;
          defaultChannelName?: string;
        };

        if (!webhookUrl || !webhookUrl.trim()) {
          return res.status(400).json({ error: "webhookUrl is required" });
        }

        const normalizedWebhookUrl = normalizeTeamsWebhookUrl(webhookUrl);

        db.prepare(`
          INSERT INTO teams_connections (workspace_id, webhook_url, default_channel_name, updated_at)
          VALUES (?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(workspace_id) DO UPDATE SET
            webhook_url = excluded.webhook_url,
            default_channel_name = excluded.default_channel_name,
            updated_at = CURRENT_TIMESTAMP
        `).run(
          req.workspaceId,
          normalizedWebhookUrl,
          typeof defaultChannelName === "string" && defaultChannelName.trim() ? defaultChannelName.trim() : null,
        );

        writeIntegrationAuditLog(req.workspaceId, req.userId || null, "integration.teams.connected", "teams_connections", {
          defaultChannelName: typeof defaultChannelName === "string" && defaultChannelName.trim() ? defaultChannelName.trim() : null,
        });

        return res.json({
          connected: true,
          defaultChannelName: typeof defaultChannelName === "string" && defaultChannelName.trim() ? defaultChannelName.trim() : null,
        });
      } catch (err: any) {
        console.error("Teams connect error:", err.message);
        return res.status(400).json({ error: "Failed to verify Teams webhook" });
      }
    },
  );

  app.delete(
    "/api/workspaces/:id/integrations/teams",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    (req: any, res) => {
      db.prepare("DELETE FROM teams_connections WHERE workspace_id = ?").run(req.workspaceId);
      writeIntegrationAuditLog(req.workspaceId, req.userId || null, "integration.teams.disconnected", "teams_connections", {});
      return res.json({ success: true });
    },
  );

  app.post(
    "/api/workspaces/:id/integrations/teams/messages",
    requireAuth,
    requireWorkspaceAccess,
    async (req: any, res) => {
      try {
        const row = db
          .prepare("SELECT webhook_url, default_channel_name FROM teams_connections WHERE workspace_id = ?")
          .get(req.workspaceId) as any;
        if (!row) {
          return res.status(403).json({ error: "Teams not connected" });
        }

        const { text, title } = req.body as { text?: string; title?: string };
        if (!text || !text.trim()) {
          return res.status(400).json({ error: "text is required" });
        }

        await sendTeamsMessage(row.webhook_url, text.trim(), typeof title === "string" ? title : undefined);

        return res.json({
          success: true,
          defaultChannelName: row.default_channel_name || null,
        });
      } catch (err: any) {
        console.error("Teams message error:", err.message);
        return res.status(500).json({ error: "Failed to send Teams message" });
      }
    },
  );

  app.get("/api/workspaces/:id/integrations/notion/status", requireAuth, requireWorkspaceAccess, (req: any, res) => {
    const row = db
      .prepare("SELECT bot_name, default_parent_page_id, updated_at FROM notion_connections WHERE workspace_id = ?")
      .get(req.workspaceId) as any;

    return res.json({
      connected: Boolean(row),
      botName: row?.bot_name || null,
      defaultParentPageId: row?.default_parent_page_id || null,
      updatedAt: row?.updated_at || null,
    });
  });

  app.post(
    "/api/workspaces/:id/integrations/notion",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    async (req: any, res) => {
      try {
        const { integrationToken, defaultParentPageId } = req.body as {
          integrationToken?: string;
          defaultParentPageId?: string;
        };

        if (!integrationToken || !integrationToken.trim()) {
          return res.status(400).json({ error: "integrationToken is required" });
        }

        const verified = await verifyNotionToken(integrationToken.trim());

        db.prepare(`
          INSERT INTO notion_connections (workspace_id, integration_token, bot_name, default_parent_page_id, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(workspace_id) DO UPDATE SET
            integration_token = excluded.integration_token,
            bot_name = excluded.bot_name,
            default_parent_page_id = excluded.default_parent_page_id,
            updated_at = CURRENT_TIMESTAMP
        `).run(
          req.workspaceId,
          integrationToken.trim(),
          verified.botName,
          typeof defaultParentPageId === "string" && defaultParentPageId.trim() ? defaultParentPageId.trim() : null,
        );

        writeIntegrationAuditLog(req.workspaceId, req.userId || null, "integration.notion.connected", "notion_connections", {
          botName: verified.botName,
          defaultParentPageId: typeof defaultParentPageId === "string" && defaultParentPageId.trim() ? defaultParentPageId.trim() : null,
        });

        return res.json({
          connected: true,
          botName: verified.botName,
          defaultParentPageId: typeof defaultParentPageId === "string" && defaultParentPageId.trim() ? defaultParentPageId.trim() : null,
        });
      } catch (err: any) {
        console.error("Notion connect error:", err.message);
        return res.status(400).json({ error: "Failed to verify Notion credentials" });
      }
    },
  );

  app.delete(
    "/api/workspaces/:id/integrations/notion",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    (req: any, res) => {
      db.prepare("DELETE FROM notion_connections WHERE workspace_id = ?").run(req.workspaceId);
      writeIntegrationAuditLog(req.workspaceId, req.userId || null, "integration.notion.disconnected", "notion_connections", {});
      return res.json({ success: true });
    },
  );

  app.post(
    "/api/workspaces/:id/integrations/notion/pages",
    requireAuth,
    requireWorkspaceAccess,
    async (req: any, res) => {
      try {
        const row = db
          .prepare("SELECT integration_token, default_parent_page_id FROM notion_connections WHERE workspace_id = ?")
          .get(req.workspaceId) as any;
        if (!row) {
          return res.status(403).json({ error: "Notion not connected" });
        }

        const { parentPageId, title, content } = req.body as {
          parentPageId?: string;
          title?: string;
          content?: string;
        };

        const resolvedParentPageId =
          typeof parentPageId === "string" && parentPageId.trim()
            ? parentPageId.trim()
            : row.default_parent_page_id;

        if (!resolvedParentPageId) {
          return res.status(400).json({ error: "parentPageId is required when no default parent is configured" });
        }

        if (!title || !title.trim()) {
          return res.status(400).json({ error: "title is required" });
        }

        const result = await createNotionPage(
          row.integration_token,
          resolvedParentPageId,
          title.trim(),
          typeof content === "string" ? content : undefined,
        );

        return res.json({
          success: true,
          pageId: result.pageId,
          url: result.url,
        });
      } catch (err: any) {
        console.error("Notion page error:", err.message);
        return res.status(500).json({ error: "Failed to create Notion page" });
      }
    },
  );

  app.post(
    "/api/workspaces/:id/integrations/twilio",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    async (req: any, res) => {
      try {
        const { accountSid, authToken, fromNumber } = req.body as {
          accountSid?: string;
          authToken?: string;
          fromNumber?: string;
        };

        if (!accountSid || !authToken || !fromNumber) {
          return res.status(400).json({ error: "accountSid, authToken, and fromNumber are required" });
        }

        const verified = await verifyTwilioCredentials(accountSid.trim(), authToken.trim());

        db.prepare(`
          INSERT INTO twilio_connections (workspace_id, account_sid, auth_token, from_number, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(workspace_id) DO UPDATE SET
            account_sid = excluded.account_sid,
            auth_token = excluded.auth_token,
            from_number = excluded.from_number,
            updated_at = CURRENT_TIMESTAMP
        `).run(req.workspaceId, accountSid.trim(), authToken.trim(), fromNumber.trim());

        writeIntegrationAuditLog(req.workspaceId, req.userId || null, "integration.twilio.connected", "twilio_connections", {
          accountSid: accountSid.trim(),
          fromNumber: fromNumber.trim(),
          accountStatus: verified.accountStatus,
        });

        return res.json({
          connected: true,
          accountSid: accountSid.trim(),
          fromNumber: fromNumber.trim(),
          accountName: verified.accountName,
          accountStatus: verified.accountStatus,
        });
      } catch (err: any) {
        console.error("Twilio connect error:", err.message);
        return res.status(400).json({ error: "Failed to verify Twilio credentials" });
      }
    },
  );

  app.delete(
    "/api/workspaces/:id/integrations/twilio",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    (req: any, res) => {
      db.prepare("DELETE FROM twilio_connections WHERE workspace_id = ?").run(req.workspaceId);
      writeIntegrationAuditLog(req.workspaceId, req.userId || null, "integration.twilio.disconnected", "twilio_connections", {});
      return res.json({ success: true });
    },
  );

  app.post(
    "/api/workspaces/:id/integrations/twilio/messages",
    requireAuth,
    requireWorkspaceAccess,
    async (req: any, res) => {
      try {
        const row = db.prepare("SELECT account_sid, auth_token, from_number FROM twilio_connections WHERE workspace_id = ?").get(req.workspaceId) as any;
        if (!row) {
          return res.status(403).json({ error: "Twilio not connected" });
        }

        const { to, body } = req.body as { to?: string; body?: string };
        if (!to || !body) {
          return res.status(400).json({ error: "to and body are required" });
        }

        const message = await sendTwilioMessage(row.account_sid, row.auth_token, row.from_number, to.trim(), body.trim());
        return res.json({
          success: true,
          messageSid: message.sid || null,
          status: message.status || null,
        });
      } catch (err: any) {
        console.error("Twilio message error:", err.message);
        return res.status(500).json({ error: "Failed to send Twilio message" });
      }
    },
  );

  app.delete(
    "/api/workspaces/:id/integrations/linkedin",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    (req: any, res) => {
      db.prepare("DELETE FROM linkedin_connections WHERE workspace_id = ?").run(req.workspaceId);
      return res.json({ success: true });
    },
  );

  app.post(
    "/api/workspaces/:id/integrations/linkedin/post",
    requireAuth,
    requireWorkspaceAccess,
    async (req: any, res) => {
      try {
        const row = db.prepare("SELECT access_token, author_urn FROM linkedin_connections WHERE workspace_id = ?").get(req.workspaceId) as any;
        if (!row) {
          return res.status(403).json({ error: "LinkedIn not connected" });
        }

        const { text, url, imageUrl, title, description } = req.body as {
          text?: string;
          url?: string;
          imageUrl?: string;
          title?: string;
          description?: string;
        };

        if (!text || !text.trim()) {
          return res.status(400).json({ error: "text is required" });
        }

        const result = await createLinkedInPost(
          row.access_token,
          row.author_urn,
          text.trim(),
          (imageUrl && imageUrl.trim()) || (url && url.trim())
            ? {
                ...(url && url.trim() ? { url: url.trim() } : {}),
                ...(imageUrl && imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
                title: typeof title === "string" && title.trim() ? title.trim() : undefined,
                description: typeof description === "string" && description.trim() ? description.trim() : undefined,
              }
            : undefined,
        );

        return res.json({ success: true, postId: result.postId ?? null });
      } catch (err: any) {
        console.error("LinkedIn post error:", err.message);
        return res.status(500).json({ error: "Failed to publish LinkedIn post" });
      }
    },
  );

  app.get("/api/workspaces/:id/integrations/buffer/status", requireAuth, requireWorkspaceAccess, async (req: any, res) => {
    try {
      const row = db.prepare("SELECT access_token FROM buffer_connections WHERE workspace_id = ?").get(req.workspaceId) as any;
      if (!row) {
        return res.json({ connected: false, profiles: [] });
      }

      const profiles = await fetchBufferProfiles(row.access_token);
      return res.json({ connected: true, profiles });
    } catch (err: any) {
      console.error("Buffer status error:", err.message);
      return res.status(500).json({ error: "Failed to load Buffer profiles" });
    }
  });

  app.post(
    "/api/workspaces/:id/integrations/buffer",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    async (req: any, res) => {
      try {
        const { accessToken } = req.body as { accessToken?: string };

        if (!accessToken || !accessToken.trim()) {
          return res.status(400).json({ error: "accessToken is required" });
        }

        const profiles = await fetchBufferProfiles(accessToken.trim());

        db.prepare(`
          INSERT INTO buffer_connections (workspace_id, access_token, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(workspace_id) DO UPDATE SET
            access_token = excluded.access_token,
            updated_at = CURRENT_TIMESTAMP
        `).run(req.workspaceId, accessToken.trim());

        return res.json({ connected: true, profiles });
      } catch (err: any) {
        console.error("Buffer connect error:", err.message);
        return res.status(400).json({ error: "Failed to verify Buffer token" });
      }
    },
  );

  app.delete(
    "/api/workspaces/:id/integrations/buffer",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    (req: any, res) => {
      db.prepare("DELETE FROM buffer_connections WHERE workspace_id = ?").run(req.workspaceId);
      return res.json({ success: true });
    },
  );

  app.post(
    "/api/workspaces/:id/integrations/buffer/updates",
    requireAuth,
    requireWorkspaceAccess,
    async (req: any, res) => {
      try {
        const row = db.prepare("SELECT access_token FROM buffer_connections WHERE workspace_id = ?").get(req.workspaceId) as any;
        if (!row) {
          return res.status(403).json({ error: "Buffer not connected" });
        }

        const { profileIds, text, link, imageUrl, title, description, now = false, scheduledAt } = req.body as {
          profileIds?: string[];
          text?: string;
          link?: string;
          imageUrl?: string;
          title?: string;
          description?: string;
          now?: boolean;
          scheduledAt?: string;
        };

        if (!Array.isArray(profileIds) || profileIds.length === 0 || profileIds.some((profileId) => typeof profileId !== "string" || !profileId.trim())) {
          return res.status(400).json({ error: "profileIds must be a non-empty array of strings" });
        }

        if (!text || !text.trim()) {
          return res.status(400).json({ error: "text is required" });
        }

        if (typeof imageUrl === "string" && imageUrl.trim() && !isHttpUrl(imageUrl.trim())) {
          return res.status(400).json({ error: "imageUrl must be a public http(s) URL for Buffer" });
        }

        const result = await createBufferUpdate(
          row.access_token,
          profileIds.map((profileId) => profileId.trim()),
          text.trim(),
          {
            link: typeof link === "string" && link.trim() ? link.trim() : undefined,
            imageUrl: typeof imageUrl === "string" && imageUrl.trim() ? imageUrl.trim() : undefined,
            title: typeof title === "string" && title.trim() ? title.trim() : undefined,
            description: typeof description === "string" && description.trim() ? description.trim() : undefined,
            now: Boolean(now),
            scheduledAt: typeof scheduledAt === "string" && scheduledAt.trim() ? scheduledAt.trim() : undefined,
          },
        );

        return res.json({
          success: true,
          updates: Array.isArray(result.updates) ? result.updates : [],
        });
      } catch (err: any) {
        console.error("Buffer update error:", err.message);
        return res.status(500).json({ error: "Failed to create Buffer update" });
      }
    },
  );

  app.get("/api/workspaces/:id/integrations/wordpress/status", requireAuth, requireWorkspaceAccess, (req: any, res) => {
    const row = db.prepare("SELECT site_url FROM wordpress_connections WHERE workspace_id = ?").get(req.workspaceId) as any;
    return res.json({
      connected: Boolean(row),
      siteUrl: row?.site_url || null,
    });
  });

  app.post(
    "/api/workspaces/:id/integrations/wordpress",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    async (req: any, res) => {
      try {
        const { siteUrl, username, appPassword } = req.body as {
          siteUrl?: string;
          username?: string;
          appPassword?: string;
        };

        if (!siteUrl || !username || !appPassword) {
          return res.status(400).json({ error: "siteUrl, username, and appPassword are required" });
        }

        const normalizedSiteUrl = normalizeWordPressSiteUrl(siteUrl);
        const verified = await verifyWordPressCredentials(normalizedSiteUrl, username.trim(), appPassword.trim());

        db.prepare(`
          INSERT INTO wordpress_connections (workspace_id, site_url, username, app_password, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(workspace_id) DO UPDATE SET
            site_url = excluded.site_url,
            username = excluded.username,
            app_password = excluded.app_password,
            updated_at = CURRENT_TIMESTAMP
        `).run(req.workspaceId, normalizedSiteUrl, username.trim(), appPassword.trim());

        return res.json({
          connected: true,
          siteUrl: normalizedSiteUrl,
          userDisplayName: verified.userDisplayName,
        });
      } catch (err: any) {
        console.error("WordPress connect error:", err.message);
        return res.status(400).json({ error: "Failed to verify WordPress credentials" });
      }
    },
  );

  app.delete(
    "/api/workspaces/:id/integrations/wordpress",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    (req: any, res) => {
      db.prepare("DELETE FROM wordpress_connections WHERE workspace_id = ?").run(req.workspaceId);
      return res.json({ success: true });
    },
  );

  app.post(
    "/api/workspaces/:id/integrations/wordpress/drafts",
    requireAuth,
    requireWorkspaceAccess,
    async (req: any, res) => {
      try {
        const row = db.prepare("SELECT site_url, username, app_password FROM wordpress_connections WHERE workspace_id = ?").get(req.workspaceId) as any;
        if (!row) {
          return res.status(403).json({ error: "WordPress not connected" });
        }

        const { title, content, excerpt, imageUrl } = req.body as {
          title?: string;
          content?: string;
          excerpt?: string;
          imageUrl?: string;
        };

        if (!title || !content) {
          return res.status(400).json({ error: "title and content are required" });
        }

        let featuredMediaId: number | undefined;
        if (typeof imageUrl === "string" && imageUrl.trim()) {
          featuredMediaId = (await uploadWordPressMedia(
            row.site_url,
            row.username,
            row.app_password,
            imageUrl.trim(),
            title,
          )).id;
        }

        const draft = await createWordPressDraft(
          row.site_url,
          row.username,
          row.app_password,
          title,
          content,
          excerpt,
          featuredMediaId,
        );

        return res.json({ success: true, draftId: draft.id, link: draft.link || null, featuredMediaId: featuredMediaId || null });
      } catch (err: any) {
        console.error("WordPress draft creation error:", err.message);
        return res.status(500).json({ error: "Failed to create WordPress draft" });
      }
    },
  );

  app.get("/api/workspaces/:id/integrations/hubspot/status", requireAuth, requireWorkspaceAccess, (req: any, res) => {
    const row = db.prepare("SELECT portal_id, account_name FROM hubspot_connections WHERE workspace_id = ?").get(req.workspaceId) as any;
    return res.json({
      connected: Boolean(row),
      portalId: row?.portal_id ?? null,
      accountName: row?.account_name ?? null,
    });
  });

  app.post(
    "/api/workspaces/:id/integrations/hubspot",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    async (req: any, res) => {
      try {
        const { accessToken } = req.body as { accessToken?: string };
        if (!accessToken || !accessToken.trim()) {
          return res.status(400).json({ error: "accessToken is required" });
        }

        const verified = await verifyHubSpotToken(accessToken.trim());

        db.prepare(`
          INSERT INTO hubspot_connections (workspace_id, access_token, portal_id, account_name, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(workspace_id) DO UPDATE SET
            access_token = excluded.access_token,
            portal_id = excluded.portal_id,
            account_name = excluded.account_name,
            updated_at = CURRENT_TIMESTAMP
        `).run(req.workspaceId, accessToken.trim(), verified.portalId, verified.accountName);

        return res.json({
          connected: true,
          portalId: verified.portalId,
          accountName: verified.accountName,
        });
      } catch (err: any) {
        console.error("HubSpot connect error:", err.message);
        return res.status(400).json({ error: "Failed to verify HubSpot token" });
      }
    },
  );

  app.delete(
    "/api/workspaces/:id/integrations/hubspot",
    requireAuth,
    requireWorkspaceAccess,
    requireWorkspaceRole("owner", "admin"),
    (req: any, res) => {
      db.prepare("DELETE FROM hubspot_connections WHERE workspace_id = ?").run(req.workspaceId);
      return res.json({ success: true });
    },
  );

  app.post(
    "/api/workspaces/:id/integrations/hubspot/sync-lead",
    requireAuth,
    requireWorkspaceAccess,
    async (req: any, res) => {
      try {
        const row = db.prepare("SELECT access_token FROM hubspot_connections WHERE workspace_id = ?").get(req.workspaceId) as any;
        if (!row) {
          return res.status(403).json({ error: "HubSpot not connected" });
        }

        const { leadId, note, createDeal = false, dealAmount, dealStage } = req.body as {
          leadId?: number;
          note?: string;
          createDeal?: boolean;
          dealAmount?: number;
          dealStage?: string;
        };
        if (!leadId || typeof leadId !== "number") {
          return res.status(400).json({ error: "leadId is required" });
        }

        const lead = db.prepare("SELECT id, name, email, role, company, location FROM leads WHERE id = ? AND workspace_id = ?").get(leadId, req.workspaceId) as any;
        if (!lead) {
          return res.status(404).json({ error: "Lead not found" });
        }

        if (!lead.email) {
          return res.status(400).json({ error: "Lead email is required for HubSpot sync" });
        }

        const contact = await upsertHubSpotContact(row.access_token, lead);
        const company = await upsertHubSpotCompany(row.access_token, lead);
        let noteId: string | null = null;
        let dealId: string | null = null;

        if (typeof note === "string" && note.trim()) {
          const createdNote = await createHubSpotNote(row.access_token, contact.id, note.trim());
          noteId = createdNote.id;
        }

        if (Boolean(createDeal)) {
          const createdDeal = await createHubSpotDeal(row.access_token, {
            leadName: lead.name || lead.email || "Lead",
            company: lead.company || undefined,
            contactId: contact.id,
            companyId: company?.id,
            amount: typeof dealAmount === "number" ? dealAmount : undefined,
            stage: typeof dealStage === "string" && dealStage.trim() ? dealStage.trim() : undefined,
          });
          dealId = createdDeal.id;
        }

        return res.json({
          success: true,
          contactId: contact.id,
          companyId: company?.id || null,
          noteId,
          dealId,
        });
      } catch (err: any) {
        console.error("HubSpot lead sync error:", err.message);
        return res.status(500).json({ error: "Failed to sync lead to HubSpot" });
      }
    },
  );
}
