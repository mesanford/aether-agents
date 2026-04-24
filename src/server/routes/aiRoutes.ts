import express from "express";
import { GoogleGenAI } from "@google/genai";
import { HumanMessage } from "@langchain/core/messages";
import type { AuthenticatedRequest, ConnectedServices, LiveContext, Attachment } from "../types.ts";
import { workflow } from "../ai/graph.ts";
import { agentIds } from "../ai/agents.ts";
import { checkAndIncrementDailyAIRequestLimit, DailyLimitExceededError } from "../ai/rateLimiterUtility.ts";
import type { PostgresShim } from "../db.ts";

type DatabaseLike = PostgresShim;

type RegisterAiRoutesArgs = {
  app: express.Application;
  db?: DatabaseLike;
  aiClient: GoogleGenAI | null;
  requireAuth: express.RequestHandler;
  requireWorkspaceAccess: express.RequestHandler;
  aiRateLimiter: express.RequestHandler;
  isNonEmptyString: (value: unknown) => value is string;
  buildDataAccessSection: (connectedServices?: ConnectedServices) => string;
  buildLiveDataSection: (liveContext?: LiveContext) => string;
};

export function registerAiRoutes({
  app,
  db,
  aiClient,
  requireAuth,
  requireWorkspaceAccess,
  aiRateLimiter,
  buildDataAccessSection,
  buildLiveDataSection,
}: RegisterAiRoutesArgs) {
  const buildAgentProfilePromptContext = (agent: {
    description?: string | null;
    capabilities?: string | null;
    instructions?: string | null;
    personality?: string | null;
  }) => {
    const description = typeof agent.description === "string" ? agent.description.trim() : "";
    const capabilities = (() => {
      try {
        const parsed = JSON.parse(agent.capabilities || "[]");
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string" && item.trim().length > 0) : [];
      } catch {
        return [];
      }
    })();
    const instructions = typeof agent.instructions === "string" ? agent.instructions.trim() : "";
    
    const personality = (() => {
      const fallback = {
        tone: "direct",
        communicationStyle: "balanced",
        assertiveness: "medium",
        humor: "none",
        verbosity: "medium",
        signaturePhrase: "",
        doNots: [] as string[],
      };
      try {
        const parsed = JSON.parse(agent.personality || "{}") as Record<string, unknown>;
        const doNots = Array.isArray(parsed?.doNots)
          ? parsed.doNots.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 5)
          : [];
        return {
          tone: typeof parsed?.tone === "string" ? parsed.tone : fallback.tone,
          communicationStyle: typeof parsed?.communicationStyle === "string" ? parsed.communicationStyle : fallback.communicationStyle,
          assertiveness: typeof parsed?.assertiveness === "string" ? parsed.assertiveness : fallback.assertiveness,
          humor: typeof parsed?.humor === "string" ? parsed.humor : fallback.humor,
          verbosity: typeof parsed?.verbosity === "string" ? parsed.verbosity : fallback.verbosity,
          signaturePhrase: typeof parsed?.signaturePhrase === "string" ? parsed.signaturePhrase.trim() : "",
          doNots,
        };
      } catch {
        return fallback;
      }
    })();

    const capabilityLine = capabilities.length > 0
      ? `Capabilities: ${capabilities.join(", ")}`
      : "Capabilities: none configured";
    // NOTE: instructions are intentionally excluded here — they are injected
    // separately as MANDATORY WORKSPACE INSTRUCTIONS in the agent prompt so
    // the LLM treats them as binding rules, not soft background context.
    const personalityLines = [
      "Personality:",
      `- Tone: ${personality.tone}`,
      `- Style: ${personality.communicationStyle}`,
      `- Assertiveness: ${personality.assertiveness}`,
      `- Humor: ${personality.humor}`,
      `- Verbosity: ${personality.verbosity}`,
      personality.signaturePhrase ? `- Signature: ${personality.signaturePhrase}` : "",
      personality.doNots.length > 0 ? `- Avoid: ${personality.doNots.join("; ")}` : "",
    ].filter((line) => line.length > 0);

    return [description, ...personalityLines, capabilityLine]
      .filter((line) => line.length > 0)
      .join("\n");
  };

  const getWorkspaceAgentProfiles = async (workspaceId: string) => {
    if (!db) {
      return {} as Record<string, string>;
    }

    try {
      const rows = await db.prepare(`
        SELECT id, name, description, capabilities, instructions, personality
        FROM agents
        WHERE workspace_id = ?
      `).all(workspaceId) as Array<{
        id: string;
        name?: string | null;
        description?: string | null;
        capabilities?: string | null;
        instructions?: string | null;
        personality?: string | null;
      }>;

      const profiles = rows.reduce<Record<string, string>>((acc, row) => {
        acc[row.id] = buildAgentProfilePromptContext(row);
        return acc;
      }, {});

      const names = rows.reduce<Record<string, string>>((acc, row) => {
        if (row.name) acc[row.id] = row.name;
        return acc;
      }, {});

      // Extract raw instructions separately so they can be injected as mandatory
      // directives in the agent prompt rather than as soft background context.
      const instructions = rows.reduce<Record<string, string>>((acc, row) => {
        const raw = typeof row.instructions === 'string' ? row.instructions.trim() : '';
        if (raw) acc[row.id] = raw;
        return acc;
      }, {});

      return { profiles, names, instructions };
    } catch (error) {
      console.error("Failed to load workspace agent profiles:", error);
      return { profiles: {}, names: {}, instructions: {} };
    }
  };

  const extractDirectAgentId = (message?: string) => {
    if (typeof message !== "string") return null;
    const match = message.match(/^\[Direct message to ([^\]]+)\]/);
    if (!match || !match[1]) return null;
    return match[1].split(':')[0];
  };

  // 1. Core Chat Delegation Endpoint
  app.post("/api/workspaces/:id/chat", requireAuth, requireWorkspaceAccess, aiRateLimiter, async (req: AuthenticatedRequest, res) => {
    try {
      const { threadId, message, liveContext, connectedServices, attachments } = req.body as {
        threadId?: string;
        message?: string;
        liveContext?: LiveContext;
        connectedServices?: ConnectedServices;
        attachments?: Attachment[];
      };

      if (!threadId || !message) {
         return res.status(400).json({ error: 'Missing parameters threadId or message' });
      }

      // Build message content for LangGraph/LangChain.
      // Plain text → string (LangGraph serializes this cleanly).
      // With image attachments → LangChain multimodal array using { type, ... } format.
      // NOTE: raw Gemini SDK { inlineData } / { text } objects (without `type`) cause
      //       "Unknown content" errors in LangGraph's message state serializer.
      let humanMessageContent: string | any[] = message;

      if (attachments && attachments.length > 0) {
        const parts: any[] = [{ type: 'text', text: message }];

        for (const att of attachments) {
          if (att.type === 'image') {
            if (att.url.startsWith('data:')) {
              // LangChain image_url with data URI
              parts.push({ type: 'image_url', image_url: { url: att.url } });
            } else if (att.url.startsWith('http')) {
              try {
                const imgRes = await fetch(att.url);
                const buf = await imgRes.arrayBuffer();
                const base64 = Buffer.from(buf).toString('base64');
                const mimeType = imgRes.headers.get('content-type') || 'image/png';
                parts.push({ type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } });
              } catch (e) {
                console.warn(`[AI ROUTE] Failed to fetch attachment URL for AI processing: ${att.url}`);
              }
            }
          } else {
            // Non-image files: append as text note
            parts[0].text += `\n\n[User attached file: ${att.name}]`;
          }
        }

        humanMessageContent = parts;
      }

      // Build injection sections for root project APIs
      let dataAccessSection = buildDataAccessSection(connectedServices);
      
      try {
        if (db) {
          const workspaceInfo = await db.prepare("SELECT description, target_audience FROM workspaces WHERE id = ?").get(req.params.id) as any;
          if (workspaceInfo && (workspaceInfo.description || workspaceInfo.target_audience)) {
            dataAccessSection += `\n\n[COMPANY KNOWLEDGE]\nCompany Description: ${workspaceInfo.description || 'N/A'}\nTarget Audience: ${workspaceInfo.target_audience || 'N/A'}\nCRITICAL: You are an internal agency employee working for this team. ALL of your logic, ideas, drafts and actions MUST strictly align with the core company description and adapt natively to the target audience defined above! NEVER contradict these core principles.\n\n`;
          }

          const docs = await db.prepare("SELECT title, content FROM knowledge_documents WHERE workspace_id = ? ORDER BY updated_at DESC").all(req.params.id) as any[];
          if (docs && docs.length > 0) {
            dataAccessSection += `<company_knowledge_base>\n`;
            docs.forEach(doc => {
              dataAccessSection += `\n### DOCUMENT: ${doc.title} ###\n${doc.content}\n`;
            });
            dataAccessSection += `\n</company_knowledge_base>\n`;
            dataAccessSection += `\nCRITICAL: Use the <company_knowledge_base> provided above as your primary, irrefutable source of truth regarding internal operations, rules, stylistic guidelines, or overarching business playbooks! Do NOT hallucinate rules when they are explicitly provided above.\n`;
          }
        }
      } catch (err) {
        console.error("Failed to load workspace knowledge", err);
      }

      // Inject long-term memories so agents always have them without needing to query
      try {
        if (db) {
          const memories = await db.prepare(`
            SELECT learning, category, subject, confidence_score
            FROM stan_memory_ledger
            WHERE workspace_id = ?
            ORDER BY confidence_score DESC, updated_at DESC
            LIMIT 25
          `).all(req.params.id) as any[];

          if (memories.length > 0) {
            dataAccessSection += `\n\n<long_term_memory>\n`;
            dataAccessSection += `The following facts and preferences have been learned about this user and their business across previous conversations. Treat them as established context — do not ask the user to repeat them:\n\n`;
            const grouped: Record<string, string[]> = {};
            for (const m of memories) {
              const key = m.category || 'general';
              if (!grouped[key]) grouped[key] = [];
              grouped[key].push(`- ${m.learning}`);
            }
            for (const [cat, items] of Object.entries(grouped)) {
              dataAccessSection += `[${cat.toUpperCase()}]\n${items.join('\n')}\n\n`;
            }
            dataAccessSection += `</long_term_memory>\n`;
          }
        }
      } catch (err) {
        console.error("Failed to load long-term memories", err);
      }

      const liveDataSection = buildLiveDataSection(liveContext);
      const { profiles: agentProfiles, names: agentNames, instructions: agentInstructions } = await getWorkspaceAgentProfiles(req.params.id);

      const parsedWorkspaceId = Number.parseInt(req.params.id, 10) || 1;
      const config = { configurable: { thread_id: threadId, workspace_id: parsedWorkspaceId, workspaceId: parsedWorkspaceId } };
      
      try {
        if (db) {
          await checkAndIncrementDailyAIRequestLimit(db, req.params.id);
        }
      } catch (limitErr) {
        if (limitErr instanceof DailyLimitExceededError) {
          return res.json({ 
            success: true, 
            response: "(System) Daily AI limit reached. Autonomous operations halted for today. Please upgrade your workspace limit or wait until tomorrow.",
            sender: "System"
          });
        }
        throw limitErr;
      }

      console.log(`[AI ROUTE] Invoking workflow for message: "${message.substring(0, 50)}..." | threadId: ${threadId}`);
      
      const humanMessage = new HumanMessage({ content: humanMessageContent });
      // @ts-ignore - for timestamp
      humanMessage.additional_kwargs = { timestamp: Date.now() };

      const finalState = await workflow.invoke({
        messages: [humanMessage],
        task: message,
        sender: 'user',
        dataAccessSection,
        liveDataSection,
        agentProfiles,
        agentNames,
        agentInstructions,
        tenantId: req.params.id,
        clientId: req.userId ? req.userId.toString() : 'unknown'
      }, { ...config, recursionLimit: 100 });

      console.log(`[AI ROUTE] Workflow completed. currentAssignee: ${finalState.currentAssignee} | Sender: ${finalState.sender}`);

      const memoryState = await workflow.getState(config);
      const isPaused = memoryState.next && memoryState.next.includes('approval_node');

      const msgs = finalState.messages as any[];
      const lastMessage = msgs && msgs.length > 0 ? msgs[msgs.length - 1] : null;
      const directAgentId = extractDirectAgentId(message);
      const isKnownAgent = (id: unknown): id is string =>
        typeof id === "string" && (agentIds.includes(id) || id in (agentProfiles as Record<string, string>));
      const resolveSender = () => {
        console.log('[RESOLVE SENDER] lastMessage.name:', lastMessage?.name, '| sender:', finalState.sender, '| currentAssignee:', finalState.currentAssignee, '| msg types:', msgs.map((m: any) => `${m?.getType?.()}/${m?.name}`).join(', '));
        if (isKnownAgent(lastMessage?.name)) return lastMessage.name;

        const reverseNamed = [...msgs].reverse().find((msg: any) => isKnownAgent(msg?.name));
        if (reverseNamed?.name) return reverseNamed.name;

        if (isKnownAgent(finalState.sender)) return finalState.sender;
        if (isKnownAgent(directAgentId)) return directAgentId;
        if (isKnownAgent(finalState.currentAssignee)) return finalState.currentAssignee;

        return "System";
      };

      if (isPaused) {
        return res.json({ 
          success: true,
          requiresApproval: true,
          response: "(System) Agent " + finalState.currentAssignee + " has proposed a sensitive action and is awaiting your explicit approval."
        });
      }

      let safeResponse = "Action successfully delegated.";
      if (lastMessage?.content) {
        if (typeof lastMessage.content === 'string') {
          safeResponse = lastMessage.content;
        } else if (Array.isArray(lastMessage.content)) {
          safeResponse = lastMessage.content.map((c: any) => c.text || JSON.stringify(c)).join('\n');
        } else {
          safeResponse = JSON.stringify(lastMessage.content);
        }
      }

      return res.json({ 
        success: true, 
        response: safeResponse,
        sender: resolveSender()
      });

    } catch (error: any) {
      console.error('Delegation Error:', error?.message || error, '\nStack:', error?.stack || '(no stack)');
      return res.status(500).json({ error: "Failed to delegate to AI specialist.", details: error?.message || String(error) });
    }
  });

  // 2. Chat Approve Endpoint — resumes a graph thread frozen at interruptBefore approval_node
  app.post("/api/workspaces/:id/chat/approve", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    const { threadId } = req.body as { threadId?: string };
    if (!threadId) return res.status(400).json({ error: 'Missing threadId' });

    const parsedWorkspaceId = Number.parseInt(req.params.id, 10) || 1;
    const config = { configurable: { thread_id: threadId, workspace_id: parsedWorkspaceId, workspaceId: parsedWorkspaceId } };

    try {
      const memoryState = await workflow.getState(config);
      if (!memoryState?.next?.includes('approval_node')) {
        return res.status(400).json({ error: 'Thread is not awaiting approval' });
      }

      if (db) {
        await checkAndIncrementDailyAIRequestLimit(db, req.params.id);
      }

      // Resume: re-invoke with null (no new message) so LangGraph continues from the interrupt point
      const finalState = await workflow.invoke(null as any, { ...config, recursionLimit: 100 });

      const msgs = finalState.messages as any[];
      const lastMessage = msgs?.length ? msgs[msgs.length - 1] : null;
      let safeResponse = "Action completed.";
      if (lastMessage?.content) {
        if (typeof lastMessage.content === 'string') {
          safeResponse = lastMessage.content;
        } else if (Array.isArray(lastMessage.content)) {
          safeResponse = lastMessage.content.map((c: any) => c.text || JSON.stringify(c)).join('\n');
        }
      }

      const isKnownAgent = (id: unknown): id is string =>
        typeof id === "string" && (agentIds.includes(id) || id.split(':')[0] in {});
      const sender = isKnownAgent(lastMessage?.name) ? lastMessage.name
        : isKnownAgent(finalState.sender) ? finalState.sender
        : isKnownAgent(finalState.currentAssignee) ? finalState.currentAssignee
        : 'System';

      return res.json({ success: true, response: safeResponse, sender });
    } catch (err: any) {
      console.error('[APPROVE ROUTE] Error resuming workflow:', err?.message, err?.stack);
      return res.status(500).json({ error: 'Failed to resume workflow', details: err?.message });
    }
  });

  // 3. Chat Reject Endpoint — discards the frozen thread's pending tool call and notifies the agent
  app.post("/api/workspaces/:id/chat/reject", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    const { threadId, reason } = req.body as { threadId?: string; reason?: string };
    if (!threadId) return res.status(400).json({ error: 'Missing threadId' });

    const parsedWorkspaceId = Number.parseInt(req.params.id, 10) || 1;
    const config = { configurable: { thread_id: threadId, workspace_id: parsedWorkspaceId, workspaceId: parsedWorkspaceId } };

    try {
      const memoryState = await workflow.getState(config);
      if (!memoryState?.next?.includes('approval_node')) {
        return res.status(400).json({ error: 'Thread is not awaiting approval' });
      }

      // Inject a human rejection message and resume so the agent can acknowledge and redraft
      const rejectionText = reason?.trim()
        ? `[REJECTED] I have rejected your proposed action.\n\nReason: ${reason.trim()}\n\nPlease acknowledge and offer an alternative.`
        : '[REJECTED] I have rejected your proposed action. Please acknowledge and offer an alternative.';

      await workflow.updateState(config, { messages: [new HumanMessage(rejectionText)] }, 'social-media-manager' as any);

      const finalState = await workflow.invoke(null as any, { ...config, recursionLimit: 100 });

      const msgs = finalState.messages as any[];
      const lastMessage = msgs?.length ? msgs[msgs.length - 1] : null;
      let safeResponse = "Action rejected.";
      if (lastMessage?.content) {
        if (typeof lastMessage.content === 'string') safeResponse = lastMessage.content;
        else if (Array.isArray(lastMessage.content)) safeResponse = lastMessage.content.map((c: any) => c.text || JSON.stringify(c)).join('\n');
      }

      const sender = (lastMessage?.name && agentIds.includes(lastMessage.name as string)) ? lastMessage.name
        : (typeof finalState.sender === 'string' && agentIds.includes(finalState.sender)) ? finalState.sender
        : 'System';

      return res.json({ success: true, response: safeResponse, sender });
    } catch (err: any) {
      console.error('[REJECT ROUTE] Error rejecting workflow:', err?.message, err?.stack);
      return res.status(500).json({ error: 'Failed to reject workflow', details: err?.message });
    }
  });

  // 4. Chat History Hydration Endpoint
  app.get("/api/workspaces/:id/chat/history", requireAuth, requireWorkspaceAccess, async (req: AuthenticatedRequest, res) => {
    try {
      const threadId = req.query.threadId as string;
      if (!threadId) {
        return res.status(400).json({ error: 'Missing threadId' });
      }

      const memoryState = await workflow.getState({ configurable: { thread_id: threadId } });
      if (!memoryState || !memoryState.values || !memoryState.values.messages) {
        return res.json({ messages: [] });
      }

      // Extract agentId from threadId fallback
      const parts = threadId.split('_');
      const inferredAgentId = parts.length >= 3 ? parts.slice(2).join('_') : '';

      const extractTextContent = (content: any): string => {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
          return content.map((part: any) => (typeof part === 'string' ? part : part.text || '')).filter(Boolean).join('\n');
        }
        return '';
      };

      const messages = memoryState.values.messages
        .filter((msg: any) => {
          if (msg.getType() === 'tool') return false;
          const text = extractTextContent(msg.content);
          return text.trim().length > 0;
        })
        .map((msg: any) => {
          const isAI = msg.getType() === 'ai';
          let rawContent = extractTextContent(msg.content);

          if (msg.getType() === 'human' && rawContent.startsWith('[Direct message to')) {
             rawContent = rawContent.replace(/\[Direct message to [^\]]+\]\s*/, '');
          }

          return {
            role: msg.getType() === 'human' ? 'user' : 'agent',
            sender: isAI ? (msg.name || inferredAgentId || 'System') : 'user',
            content: rawContent,
            timestamp: msg.additional_kwargs?.timestamp || Date.now()
          };
        });

      return res.json({ messages });
    } catch (err) {
      console.error('History API Error:', err);
      return res.status(500).json({ error: 'Internal Server Error fetching thread' });
    }
  });

  // 3. Smart Onboarding Website Scrape Endpoint
  app.post("/api/scrape-onboarding-insights", requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: "Missing URL param." });
      
      let finalUrl = url.trim();
      if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        finalUrl = 'https://' + finalUrl;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      let html = "";
      try {
        const fetchRes = await fetch(finalUrl, { signal: controller.signal });
        clearTimeout(timeout);
        html = await fetchRes.text();
      } catch(e) {
        throw new Error("Unable to reach that website. Ensure the URL is public and valid.");
      }

      const cleanText = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<[^>]*>?/gm, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 20000); // Token cap safety

      if (!aiClient) return res.status(500).json({ error: "Gemini API uninitialized" });

      const prompt = `You are an expert onboarding assistant. Analyze this website's home page text: 
      \n\n${cleanText}\n\n
      Return a JSON object with EXACTLY these three keys describing the business strictly based on their website text:
      {
        "companyDescription": "2-3 short sentences describing what the company does",
        "targetAudience": "1 short sentence identifying their primary prospective customers",
        "playbookContent": "A high-level set of operating principles or 'Tone of Voice' guidelines we should adopt based on the website's copy (e.g. professional, sarcastic, focus on ROI) in a short paragraph format."
      }`;

      const aiResponse = await aiClient.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const cleanJsonResponse = (text: string) => {
        let cleaned = text.trim();
        // Remove markdown code blocks if present
        const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        if (match) {
          cleaned = match[1];
        } else {
          // Fallback: try to find the first { and last }
          const start = cleaned.indexOf('{');
          const end = cleaned.lastIndexOf('}');
          if (start !== -1 && end !== -1 && end > start) {
            cleaned = cleaned.substring(start, end + 1);
          }
        }
        return cleaned.trim();
      };

      const rawText = aiResponse.text || "{}";
      const cleanedText = cleanJsonResponse(rawText);
      const parsedJSON = JSON.parse(cleanedText);
      return res.json(parsedJSON);
    } catch (err: any) {
      console.error("Scrape Error:", err);
      return res.status(500).json({ error: err.message || "Failed to intelligently scrape." });
    }
  });

  // 4. Test Image Gen
  app.get("/api/test-image-gen", async (req, res) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: [{ role: 'user', parts: [{ text: 'Generate a test image of a futuristic city.' }] }],
      });
      const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      res.json({ 
        success: !!imagePart, 
        hasImage: !!imagePart,
        mimeType: imagePart?.inlineData?.mimeType,
        base64Prefix: imagePart?.inlineData?.data?.substring(0, 50) 
      });
    } catch (err: any) {
      res.json({ success: false, err: err.message, stack: err.stack });
    }
  });
}
