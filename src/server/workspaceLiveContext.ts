import { OAuth2Client } from "google-auth-library";
import type { LiveContext, ConnectedServices } from "./types.ts";

type DatabaseLike = {
  prepare: (sql: string) => { get: (...args: unknown[]) => any; run: (...args: unknown[]) => unknown };
};

type WorkspaceLiveContextResult = {
  liveContext: LiveContext;
  connectedServices: ConnectedServices;
};

/**
 * Fetches live Gmail, Calendar, and Drive data for the owner of the given
 * workspace using their stored OAuth tokens. Called by the task engine so
 * scheduled agents have the same real-world context as chat agents.
 *
 * Returns empty objects without throwing if tokens are absent, expired, or
 * any individual service call fails.
 */
export async function fetchWorkspaceLiveContext(
  db: DatabaseLike,
  workspaceId: number,
  googleClientId: string,
  googleClientSecret: string,
): Promise<WorkspaceLiveContextResult> {
  const workspace = db.prepare("SELECT owner_id FROM workspaces WHERE id = ?").get(workspaceId) as any;
  if (!workspace) return { liveContext: {}, connectedServices: {} };

  const tokenRow = db
    .prepare("SELECT * FROM google_tokens WHERE user_id = ?")
    .get(workspace.owner_id) as any;
  if (!tokenRow) return { liveContext: {}, connectedServices: {} };

  const scopes: string[] = (tokenRow.scopes || "").split(" ").filter(Boolean);
  const hasGmail = scopes.some((s) => s.includes("gmail"));
  const hasCalendar = scopes.some((s) => s.includes("calendar"));
  const hasDrive = scopes.some((s) => s.includes("drive") || s.includes("docs") || s.includes("presentations"));

  if (!hasGmail && !hasCalendar && !hasDrive) {
    return { liveContext: {}, connectedServices: {} };
  }

  const client = new OAuth2Client(googleClientId, googleClientSecret);
  client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
    expiry_date: tokenRow.expiry_date,
  });

  if (tokenRow.expiry_date && Date.now() > tokenRow.expiry_date - 60000) {
    try {
      const { credentials } = await client.refreshAccessToken();
      db.prepare("UPDATE google_tokens SET access_token = ?, expiry_date = ? WHERE user_id = ?").run(
        credentials.access_token,
        credentials.expiry_date,
        workspace.owner_id,
      );
      client.setCredentials(credentials);
    } catch {
      return { liveContext: {}, connectedServices: {} };
    }
  }

  const { google } = await import("googleapis");

  const liveContext: LiveContext = {};
  const connectedServices: ConnectedServices = {
    gmail: hasGmail,
    calendar: hasCalendar,
    drive: hasDrive,
  };

  if (hasGmail) {
    try {
      const gmail = google.gmail({ version: "v1", auth: client });
      const listRes = await gmail.users.messages.list({
        userId: "me",
        maxResults: 5,
        labelIds: ["INBOX"],
      });

      liveContext.emails = await Promise.all(
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
            from: get("From"),
            subject: get("Subject"),
            date: get("Date"),
            snippet: msg.data.snippet || "",
          };
        }),
      );
    } catch (err: any) {
      console.warn(`[Task Engine] Gmail context fetch failed for workspace ${workspaceId}: ${err.message}`);
    }
  }

  if (hasCalendar) {
    try {
      const calendar = google.calendar({ version: "v3", auth: client });
      const eventsRes = await calendar.events.list({
        calendarId: "primary",
        timeMin: new Date().toISOString(),
        timeMax: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        maxResults: 10,
        singleEvents: true,
        orderBy: "startTime",
      });

      liveContext.events = (eventsRes.data.items || []).map((e) => ({
        summary: e.summary || "(no title)",
        start: e.start?.dateTime || e.start?.date || "",
        end: e.end?.dateTime || e.end?.date || "",
        location: e.location ?? undefined,
        attendees: (e.attendees || []).map((a) => a.email || "").filter(Boolean),
      }));
    } catch (err: any) {
      console.warn(`[Task Engine] Calendar context fetch failed for workspace ${workspaceId}: ${err.message}`);
    }
  }

  if (hasDrive) {
    try {
      const drive = google.drive({ version: "v3", auth: client });
      const filesRes = await drive.files.list({
        pageSize: 10,
        q: "trashed=false",
        orderBy: "modifiedTime desc",
        fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
      });

      liveContext.files = (filesRes.data.files || []).map((f) => ({
        name: f.name || "",
        type: f.mimeType?.includes("document")
          ? "doc"
          : f.mimeType?.includes("spreadsheet")
            ? "sheet"
            : f.mimeType?.includes("presentation")
              ? "slides"
              : f.mimeType?.includes("folder")
                ? "folder"
                : "file",
        modifiedTime: f.modifiedTime || "",
        webViewLink: f.webViewLink || "",
      }));
    } catch (err: any) {
      console.warn(`[Task Engine] Drive context fetch failed for workspace ${workspaceId}: ${err.message}`);
    }
  }

  return { liveContext, connectedServices };
}
