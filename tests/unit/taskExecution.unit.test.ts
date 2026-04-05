import test from "node:test";
import assert from "node:assert/strict";
import { buildTaskExecutionResult, inferTaskExecutionType } from "../../src/server/taskExecution.ts";

test("inferTaskExecutionType classifies by task content and agent role", () => {
  assert.equal(
    inferTaskExecutionType({
      taskTitle: "Draft 3 blog posts",
      taskDescription: "Write outlines for the new content calendar",
      agentRole: "Blog Writer",
    }),
    "draft",
  );

  assert.equal(
    inferTaskExecutionType({
      taskTitle: "Lead outreach for March prospects",
      taskDescription: "Follow up with 10 new contacts",
      agentRole: "Sales Associate",
    }),
    "outreach",
  );

  assert.equal(
    inferTaskExecutionType({
      taskTitle: "Inbox and schedule triage",
      taskDescription: "Review the inbox and organize the calendar",
      agentRole: "Executive Assistant",
    }),
    "review",
  );
});

test("buildTaskExecutionResult returns role-specific output", () => {
  const result = buildTaskExecutionResult({
    taskTitle: "Follow up with new leads",
    taskDescription: "Prepare the next outreach wave",
    agentName: "Stan",
    agentRole: "Sales Associate",
    executionType: null,
  });

  assert.equal(result.executionType, "outreach");
  assert.match(result.outputSummary, /outreach plan/i);
  assert.match(result.messageContent, /lead notes/i);
});

test("buildTaskExecutionResult preserves an explicit artifact image URL from task context", () => {
  const result = buildTaskExecutionResult({
    taskTitle: "Queue spring launch post",
    taskDescription: "Use this creative in the publish artifact https://cdn.example.com/social/spring-launch.png",
    agentName: "Sonny",
    agentRole: "Social Media Manager",
    executionType: null,
  });

  assert.equal(result.artifact.imageUrl, "https://cdn.example.com/social/spring-launch.png");
});