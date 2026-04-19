import test from "node:test";
import assert from "node:assert/strict";
import {
  getAllowedAgentUpdate,
  getAllowedMessageCreate,
  getAllowedTaskCreate,
  getAllowedTaskStatusUpdate,
  isNonEmptyString,
} from "../../src/server/validators.ts";

test("isNonEmptyString validates trimmed non-empty strings", () => {
  assert.equal(isNonEmptyString("hello"), true);
  assert.equal(isNonEmptyString("   hello   "), true);
  assert.equal(isNonEmptyString("   "), false);
  assert.equal(isNonEmptyString(42), false);
  assert.equal(isNonEmptyString(undefined), false);
});

test("getAllowedTaskCreate validates and normalizes payload", () => {
  const missing = getAllowedTaskCreate({ description: "x" });
  assert.equal(missing.error, "Task title is required");

  const valid = getAllowedTaskCreate({
    title: "  Task  ",
    assigneeId: "agent-1",
    description: 42,
    dueDate: 55,
    repeat: false,
  });

  assert.equal(valid.error, undefined);
  assert.deepEqual(valid.value, {
    title: "Task",
    assigneeId: "agent-1",
    description: "",
    dueDate: "",
    repeat: "",
  });
});

test("getAllowedTaskStatusUpdate only allows supported statuses", () => {
  const invalid = getAllowedTaskStatusUpdate({ status: "blocked" });
  assert.equal(invalid.error, "Invalid task status");

  const valid = getAllowedTaskStatusUpdate({ status: "running" });
  assert.equal(valid.error, undefined);
  assert.equal(valid.status, "running");
});

test("getAllowedMessageCreate enforces required fields and types", () => {
  const invalid = getAllowedMessageCreate({
    agentId: "a",
    senderId: "u",
    senderName: "Name",
    content: "Hello",
    type: "invalid",
  });
  assert.equal(invalid.error, "Invalid message type");

  const valid = getAllowedMessageCreate({
    agentId: "a",
    senderId: "u",
    senderName: "Name",
    senderAvatar: 123,
    content: "Hello",
    type: "agent",
    imageUrl: 44,
    timestamp: "not-number",
  });

  assert.equal(valid.error, undefined);
  assert.equal(valid.value?.senderAvatar, "");
  assert.equal(valid.value?.imageUrl, null);
  assert.equal(typeof valid.value?.timestamp, "number");
});

test("getAllowedAgentUpdate filters unsupported updates and validates status", () => {
  const invalid = getAllowedAgentUpdate({ status: "unknown" });
  assert.equal(invalid.error, "Invalid agent status");

  const invalidCapabilities = getAllowedAgentUpdate({ capabilities: ["SEO", "   "] });
  assert.equal(invalidCapabilities.error, "Invalid capabilities payload");

  const invalidPersonality = getAllowedAgentUpdate({
    personality: {
      tone: "friendly",
      communicationStyle: "balanced",
      assertiveness: "medium",
      humor: "none",
      verbosity: "medium",
      signaturePhrase: "x",
      doNots: [],
    },
  });
  assert.equal(invalidPersonality.error, "Invalid personality payload");

  const valid = getAllowedAgentUpdate({
    status: "idle",
    description: "updated",
    ignored_legacy_guidelines: [{ title: "x" }],
    capabilities: [" SEO ", "Analytics"],
    personality: {
      tone: "direct",
      communicationStyle: "concise",
      assertiveness: "high",
      humor: "light",
      verbosity: "short",
      signaturePhrase: "Let's ship this.",
      doNots: [" Do not ramble ", "Do not hedge"],
    },
    ignored: true,
  });

  assert.equal(valid.error, undefined);
  assert.deepEqual(valid.updates, {
    status: "idle",
    description: "updated",

    capabilities: ["SEO", "Analytics"],
    personality: {
      tone: "direct",
      communicationStyle: "concise",
      assertiveness: "high",
      humor: "light",
      verbosity: "short",
      signaturePhrase: "Let's ship this.",
      doNots: ["Do not ramble", "Do not hedge"],
    },
  });
});
