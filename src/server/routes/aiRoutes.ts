import express from "express";
import { GoogleGenAI } from "@google/genai";
import { HumanMessage } from "@langchain/core/messages";
import type { AuthenticatedRequest, ConnectedServices, LiveContext } from "../types.ts";
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
    const guidelineBlock = instructions
      ? `Instructions:\n${instructions}`
      : "Instructions: none configured";
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

    return [description, ...personalityLines, capabilityLine, guidelineBlock]
      .filter((line) => line.length > 0)
      .join("\n");
  };

  const getWorkspaceAgentProfiles = async (workspaceId: string) => {
    if (!db) {
      return {} as Record<string, string>;
    }

    try {
      const rows = await db.prepare(`
        SELECT id, description, capabilities, instructions, personality
        FROM agents
        WHERE workspace_id = ?
      `).all(workspaceId) as Array<{
        id: string;
        description?: string | null;
        capabilities?: string | null;
        instructions?: string | null;
        personality?: string | null;
      }>;

      return rows.reduce<Record<string, string>>((acc, row) => {
        acc[row.id] = buildAgentProfilePromptContext(row);
        return acc;
      }, {});
    } catch (error) {
      console.error("Failed to load workspace agent profiles:", error);
      return {};
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
      const { threadId, message, liveContext, connectedServices } = req.body as {
        threadId?: string;
        message?: string;
        liveContext?: LiveContext;
        connectedServices?: ConnectedServices;
      };

      if (!threadId || !message) {
         return res.status(400).json({ error: 'Missing parameters threadId or message' });
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
      const liveDataSection = buildLiveDataSection(liveContext);
      const agentProfiles = getWorkspaceAgentProfiles(req.params.id);

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

      // Invoke the Langgraph agency workflow
      const finalState = await workflow.invoke({
        messages: [new HumanMessage(message)],
        task: message,
        sender: 'user',
        dataAccessSection,
        liveDataSection,
        agentProfiles,
        tenantId: req.params.id,
        clientId: req.userId ? req.userId.toString() : 'unknown'
      }, { ...config, recursionLimit: 50 });

      const memoryState = await workflow.getState(config);
      const isPaused = memoryState.next && memoryState.next.includes('approval_node');

      const msgs = finalState.messages as any[];
      const lastMessage = msgs && msgs.length > 0 ? msgs[msgs.length - 1] : null;
      const directAgentId = extractDirectAgentId(message);
      const isKnownAgent = (id: unknown): id is string =>
        typeof id === "string" && (agentIds.includes(id) || id in agentProfiles);
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
          safeResponse = lastMessage.content.map((c: any) => c.text || JSON.stringify(c)).join('\\n');
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
      console.error('Delegation Error:', error);
      return res.status(500).json({ error: 'Failed to delegating to agency neural network.' });
    }
  });

  // 2. Chat History Hydration Endpoint
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

      const messages = memoryState.values.messages
        .filter((msg: any) => msg.getType() !== 'tool' && msg.content && typeof msg.content === 'string' && msg.content.trim().length > 0)
        .map((msg: any) => {
          const isAI = msg.getType() === 'ai';
          let rawContent = msg.content;
          
          if (msg.getType() === 'human' && rawContent.startsWith('[Direct message to')) {
             rawContent = rawContent.replace(/\[Direct message to [^\]]+\]\s*/, '');
          }

          return {
            role: msg.getType() === 'human' ? 'user' : 'agent',
            sender: isAI ? (msg.name || inferredAgentId || 'System') : 'user',
            content: rawContent
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
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const parsedJSON = JSON.parse(aiResponse.text || "{}");
      return res.json(parsedJSON);
    } catch (err: any) {
      console.error("Scrape Error:", err);
      return res.status(500).json({ error: err.message || "Failed to intelligently scrape." });
    }
  });

  // 4. Test Image Gen
  app.get("/api/test-image-gen", async (req, res) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateImages({
        model: 'imagen-3.0-generate-002',
        prompt: 'test prompt',
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/jpeg',
        }
      });
      res.json({ success: true, base64: response.generatedImages?.[0]?.image?.imageBytes?.substring(0, 100) });
    } catch (err: any) {
      res.json({ success: false, err: err.message, stack: err.stack });
    }
  });
}
