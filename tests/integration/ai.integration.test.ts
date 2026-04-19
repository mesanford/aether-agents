import { test, describe, before, mock } from "node:test";
import assert from "node:assert";
import { createMockDb, createTestApp, seedTestUser } from "../setup/testApp.ts";
import { injectRequest } from "../setup/injectRequest.ts";
import { workflow } from "../../src/server/ai/graph.ts";
import { AIMessage } from "@langchain/core/messages";

describe("AI API Integration Tests", () => {
  let db: any;
  let app: any;
  let testData: any;

  // Mock aiClient
  const mockAiClient = {
    models: {
      generateContent: mock.fn(async () => ({
        text: JSON.stringify({
          companyDescription: "Aether Agents is a premium multi-agent platform.",
          targetAudience: "Enterprise teams and AI developers.",
          playbookContent: "Focus on ROI, efficiency, and agentic workflows."
        })
      }))
    }
  };

  before(async () => {
    db = createMockDb();
    app = createTestApp(db, mockAiClient);
    testData = await seedTestUser(db);

    // Mock global fetch
    const originalFetch = global.fetch;
    global.fetch = mock.fn(async (url: any) => {
      if (typeof url === "string" && url.includes("example.com")) {
        return {
          ok: true,
          text: async () => "<html><body><h1>Example</h1><p>Example content</p></body></html>"
        } as any;
      }
      return originalFetch(url);
    }) as any;
  });

  test("POST /api/workspaces/:id/chat - Agent Chat", async () => {
    // Mock workflow.stream
    const mockStream = async function* () {
      yield {
        messages: [
          new AIMessage({ content: "Hello from Aether Agents! How can I help you today?" })
        ]
      };
    };

    mock.method(workflow, "stream", mockStream);

    const res = await injectRequest(app, "POST", `/api/workspaces/${testData.workspaceId}/chat`, {
      token: testData.token,
      body: {
        message: "Hello",
        threadId: "test-thread"
      }
    });

    assert.strictEqual(res.status, 200);
    // Since it's a stream, injectRequest will wait for the stream to end and return the full body.
    // Our aiRoutes sends JSON chunks for streaming, so we need to be careful with JSON.parse.
    // However, injectRequest does:
    // try { body = JSON.parse(text); } catch { body = text; }
    // If it's multiple JSON objects separated by newlines, JSON.parse will fail and body will be text.
    
    assert.ok(res.text.includes("Hello from Aether Agents!"), "Should contain agent response");
  });

  test("POST /api/scrape-onboarding-insights - Direct LLM Chat", async () => {
    const res = await injectRequest(app, "POST", `/api/scrape-onboarding-insights`, {
      token: testData.token,
      body: {
        url: "https://example.com"
      }
    });

    assert.strictEqual(res.status, 200);
    const body = res.body as any;
    assert.ok(body.companyDescription);
    assert.ok(body.targetAudience);
    assert.ok(body.playbookContent);
    assert.strictEqual(mockAiClient.models.generateContent.mock.calls.length, 1);
  });

  test("POST /api/scrape-onboarding-insights - Robustness against Markdown Wrapped JSON", async () => {
    // Override the mock for this specific test
    mockAiClient.models.generateContent = mock.fn(async () => ({
      text: "Sure! Here is the data in JSON format:\n\n```json\n{\n  \"companyDescription\": \"Dirty response description.\",\n  \"targetAudience\": \"Dirty audience.\",\n  \"playbookContent\": \"Dirty playbook.\"\n}\n```\nHope this helps!"
    })) as any;

    const res = await injectRequest(app, "POST", `/api/scrape-onboarding-insights`, {
      token: testData.token,
      body: {
        url: "https://example.com"
      }
    });

    assert.strictEqual(res.status, 200);
    const body = res.body as any;
    assert.strictEqual(body.companyDescription, "Dirty response description.");
    assert.strictEqual(body.targetAudience, "Dirty audience.");
    assert.strictEqual(body.playbookContent, "Dirty playbook.");
  });
});
