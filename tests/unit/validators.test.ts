/**
 * tests/unit/validators.test.ts
 * Pure unit tests for the validator functions in src/server/validators.ts.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  isNonEmptyString,
  getAllowedAgentUpdate,
  getAllowedTaskCreate,
  getAllowedTaskUpdate,
  getAllowedMessageCreate,
} from "../../src/server/validators.ts";

// ─── isNonEmptyString ──────────────────────────────────────────────────────

describe("isNonEmptyString", () => {
  test("returns true for non-empty strings", () => {
    assert.equal(isNonEmptyString("hello"), true);
    assert.equal(isNonEmptyString("  x  "), true);
  });

  test("returns false for blank strings", () => {
    assert.equal(isNonEmptyString(""), false);
    assert.equal(isNonEmptyString("   "), false);
  });

  test("returns false for non-string values", () => {
    assert.equal(isNonEmptyString(null), false);
    assert.equal(isNonEmptyString(undefined), false);
    assert.equal(isNonEmptyString(42), false);
    assert.equal(isNonEmptyString({}), false);
    assert.equal(isNonEmptyString([]), false);
    assert.equal(isNonEmptyString(false), false);
  });
});

// ─── getAllowedAgentUpdate ──────────────────────────────────────────────────

describe("getAllowedAgentUpdate", () => {
  test("accepts a valid status", () => {
    const result = getAllowedAgentUpdate({ status: "idle" });
    assert.ok(result.updates?.status === "idle");
  });

  test("rejects an invalid status", () => {
    const result = getAllowedAgentUpdate({ status: "superbusy" });
    assert.ok(result.error, "should have an error");
  });

  test("accepts all valid statuses", () => {
    for (const s of ["idle", "thinking", "running", "offline"]) {
      const r = getAllowedAgentUpdate({ status: s });
      assert.ok(!r.error, `status '${s}' should be valid`);
    }
  });

  test("accepts a valid name (≤ 50 chars)", () => {
    const result = getAllowedAgentUpdate({ name: "My Agent" });
    assert.equal(result.updates?.name, "My Agent");
  });

  test("rejects a name longer than 50 chars", () => {
    const result = getAllowedAgentUpdate({ name: "A".repeat(51) });
    assert.ok(result.error);
  });

  test("rejects an empty string name", () => {
    const result = getAllowedAgentUpdate({ name: "" });
    assert.ok(result.error);
  });

  test("accepts valid instructions as string", () => {
    const result = getAllowedAgentUpdate({ instructions: "Do stuff." });
    assert.ok(!result.error);
    assert.equal(result.updates?.instructions, "Do stuff.");
  });

  test("rejects instructions that are not a string", () => {
    const result = getAllowedAgentUpdate({ instructions: 42 });
    assert.ok(result.error);
  });

  test("accepts valid capabilities array", () => {
    const result = getAllowedAgentUpdate({ capabilities: ["write", "research"] });
    assert.ok(!result.error);
    assert.deepEqual(result.updates?.capabilities, ["write", "research"]);
  });

  test("rejects capabilities that are not an array", () => {
    const result = getAllowedAgentUpdate({ capabilities: "write" });
    assert.ok(result.error);
  });

  test("rejects capabilities array with non-string entries", () => {
    const result = getAllowedAgentUpdate({ capabilities: [42, "valid"] });
    assert.ok(result.error);
  });

  test("rejects capabilities array with > 25 entries", () => {
    const result = getAllowedAgentUpdate({ capabilities: Array(26).fill("skill") });
    assert.ok(result.error);
  });

  test("rejects capabilities with an entry > 80 chars", () => {
    const result = getAllowedAgentUpdate({ capabilities: ["a".repeat(81)] });
    assert.ok(result.error);
  });

  test("accepts a valid personality payload", () => {
    const result = getAllowedAgentUpdate({
      personality: {
        tone: "warm",
        communicationStyle: "concise",
        assertiveness: "medium",
        humor: "none",
        verbosity: "short",
        signaturePhrase: "Let's go!",
        doNots: ["Do not be rude"],
      },
    });
    assert.ok(!result.error);
  });

  test("rejects personality with invalid tone", () => {
    const result = getAllowedAgentUpdate({
      personality: {
        tone: "aggressive",
        communicationStyle: "concise",
        assertiveness: "medium",
        humor: "none",
        verbosity: "short",
      },
    });
    assert.ok(result.error);
  });

  test("rejects personality with signaturePhrase > 120 chars", () => {
    const result = getAllowedAgentUpdate({
      personality: {
        tone: "warm",
        communicationStyle: "concise",
        assertiveness: "medium",
        humor: "none",
        verbosity: "short",
        signaturePhrase: "x".repeat(121),
        doNots: [],
      },
    });
    assert.ok(result.error);
  });

  test("rejects personality with > 5 doNots", () => {
    const result = getAllowedAgentUpdate({
      personality: {
        tone: "warm",
        communicationStyle: "balanced",
        assertiveness: "low",
        humor: "none",
        verbosity: "medium",
        signaturePhrase: "",
        doNots: Array(6).fill("Don't do this"),
      },
    });
    assert.ok(result.error);
  });

  test("returns empty updates object when body is empty", () => {
    const result = getAllowedAgentUpdate({});
    assert.ok(!result.error);
    assert.deepEqual(result.updates, {});
  });
});

// ─── getAllowedTaskCreate ───────────────────────────────────────────────────

describe("getAllowedTaskCreate", () => {
  test("accepts a valid task body", () => {
    const result = getAllowedTaskCreate({
      title: "Write blog post",
      assigneeId: "agent-42",
      description: "Long form content",
      dueDate: "2025-06-01",
      repeat: "weekly",
    });
    assert.ok(!result.error);
    assert.equal(result.value?.title, "Write blog post");
    assert.equal(result.value?.assigneeId, "agent-42");
  });

  test("returns error when title is missing", () => {
    const result = getAllowedTaskCreate({ assigneeId: "a" });
    assert.ok(result.error);
  });

  test("returns error when title is blank", () => {
    const result = getAllowedTaskCreate({ title: "   ", assigneeId: "a" });
    assert.ok(result.error);
  });

  test("returns error when assigneeId is missing", () => {
    const result = getAllowedTaskCreate({ title: "Task" });
    assert.ok(result.error);
  });

  test("defaults description to empty string when omitted", () => {
    const result = getAllowedTaskCreate({ title: "T", assigneeId: "a" });
    assert.equal(result.value?.description, "");
  });

  test("defaults dueDate to empty string when omitted", () => {
    const result = getAllowedTaskCreate({ title: "T", assigneeId: "a" });
    assert.equal(result.value?.dueDate, "");
  });
});

// ─── getAllowedTaskUpdate ───────────────────────────────────────────────────

describe("getAllowedTaskUpdate", () => {
  test("accepts a valid status update", () => {
    const result = getAllowedTaskUpdate({ status: "done" });
    assert.ok(!result.error);
    assert.equal(result.updates?.status, "done");
  });

  test("rejects invalid task status", () => {
    const result = getAllowedTaskUpdate({ status: "completed" });
    assert.ok(result.error);
  });

  test("accepts all valid task statuses", () => {
    for (const s of ["todo", "running", "done"]) {
      const r = getAllowedTaskUpdate({ status: s });
      assert.ok(!r.error, `status '${s}' should be valid`);
    }
  });

  test("returns error when no valid fields are provided", () => {
    const result = getAllowedTaskUpdate({ nonExistentField: "value" });
    assert.ok(result.error);
  });

  test("rejects empty title", () => {
    const result = getAllowedTaskUpdate({ title: "" });
    assert.ok(result.error);
  });

  test("accepts a non-empty title update", () => {
    const result = getAllowedTaskUpdate({ title: "Updated title" });
    assert.ok(!result.error);
    assert.equal(result.updates?.title, "Updated title");
  });

  test("accepts dueDate update", () => {
    const result = getAllowedTaskUpdate({ dueDate: "2025-12-31" });
    assert.ok(!result.error);
    assert.equal(result.updates?.dueDate, "2025-12-31");
  });

  test("accepts description update", () => {
    const result = getAllowedTaskUpdate({ description: "Updated desc" });
    assert.ok(!result.error);
    assert.equal(result.updates?.description, "Updated desc");
  });
});

// ─── getAllowedMessageCreate ────────────────────────────────────────────────

describe("getAllowedMessageCreate", () => {
  const validBody = {
    agentId: "agent-1",
    senderId: "user-1",
    senderName: "Alice",
    content: "Hello!",
    type: "user",
    timestamp: 1000000,
  };

  test("accepts a valid message body", () => {
    const result = getAllowedMessageCreate(validBody);
    assert.ok(!result.error);
    assert.equal(result.value?.agentId, "agent-1");
    assert.equal(result.value?.type, "user");
  });

  test("accepts all valid message types", () => {
    for (const t of ["user", "agent", "system"]) {
      const r = getAllowedMessageCreate({ ...validBody, type: t });
      assert.ok(!r.error, `type '${t}' should be valid`);
    }
  });

  test("returns error for invalid message type", () => {
    const result = getAllowedMessageCreate({ ...validBody, type: "broadcast" });
    assert.ok(result.error);
  });

  test("returns error when agentId is missing", () => {
    const { agentId: _, ...rest } = validBody;
    const result = getAllowedMessageCreate(rest);
    assert.ok(result.error);
  });

  test("returns error when content is empty", () => {
    const result = getAllowedMessageCreate({ ...validBody, content: "" });
    assert.ok(result.error);
  });

  test("defaults senderAvatar to empty string when omitted", () => {
    const result = getAllowedMessageCreate(validBody);
    assert.equal(result.value?.senderAvatar, "");
  });

  test("defaults imageUrl to null when omitted", () => {
    const result = getAllowedMessageCreate(validBody);
    assert.equal(result.value?.imageUrl, null);
  });

  test("falls back to Date.now() when timestamp is missing", () => {
    const { timestamp: _, ...rest } = validBody;
    const before = Date.now();
    const result = getAllowedMessageCreate(rest);
    const after = Date.now();
    assert.ok(result.value?.timestamp !== undefined);
    assert.ok(
      (result.value!.timestamp as number) >= before &&
        (result.value!.timestamp as number) <= after,
      "timestamp should be close to now"
    );
  });
});
