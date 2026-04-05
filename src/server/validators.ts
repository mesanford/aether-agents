const VALID_TASK_STATUSES = new Set(["todo", "running", "done"]);
const VALID_MESSAGE_TYPES = new Set(["user", "agent", "system"]);
const VALID_AGENT_STATUSES = new Set(["idle", "thinking", "running", "offline"]);
const VALID_PERSONALITY_TONES = new Set(["warm", "direct", "analytical", "playful", "formal"]);
const VALID_PERSONALITY_STYLES = new Set(["concise", "balanced", "detailed"]);
const VALID_PERSONALITY_ASSERTIVENESS = new Set(["low", "medium", "high"]);
const VALID_PERSONALITY_HUMOR = new Set(["none", "light"]);
const VALID_PERSONALITY_VERBOSITY = new Set(["short", "medium", "long"]);

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function getAllowedAgentUpdate(body: any) {
  const updates: Record<string, unknown> = {};

  if (body.status !== undefined) {
    if (!isNonEmptyString(body.status) || !VALID_AGENT_STATUSES.has(body.status)) {
      return { error: "Invalid agent status" };
    }
    updates.status = body.status;
  }

  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      return { error: "Invalid agent description" };
    }
    updates.description = body.description;
  }

  if (body.guidelines !== undefined) {
    if (!Array.isArray(body.guidelines)) {
      return { error: "Invalid guidelines payload" };
    }
    updates.guidelines = body.guidelines;
  }

  if (body.capabilities !== undefined) {
    if (!Array.isArray(body.capabilities)) {
      return { error: "Invalid capabilities payload" };
    }

    const normalized = body.capabilities
      .map((value: unknown) => (typeof value === "string" ? value.trim() : ""))
      .filter((value: string) => value.length > 0);

    if (normalized.length !== body.capabilities.length) {
      return { error: "Invalid capabilities payload" };
    }

    if (normalized.length > 25 || normalized.some((value: string) => value.length > 80)) {
      return { error: "Invalid capabilities payload" };
    }

    updates.capabilities = normalized;
  }

  if (body.personality !== undefined) {
    const personality = body.personality;
    if (!personality || typeof personality !== "object" || Array.isArray(personality)) {
      return { error: "Invalid personality payload" };
    }

    const tone = typeof personality.tone === "string" ? personality.tone : "";
    const communicationStyle = typeof personality.communicationStyle === "string" ? personality.communicationStyle : "";
    const assertiveness = typeof personality.assertiveness === "string" ? personality.assertiveness : "";
    const humor = typeof personality.humor === "string" ? personality.humor : "";
    const verbosity = typeof personality.verbosity === "string" ? personality.verbosity : "";
    const signaturePhrase = typeof personality.signaturePhrase === "string" ? personality.signaturePhrase.trim() : "";
    const doNots = Array.isArray(personality.doNots)
      ? personality.doNots.map((value: unknown) => (typeof value === "string" ? value.trim() : "")).filter((value: string) => value.length > 0)
      : [];

    if (
      !VALID_PERSONALITY_TONES.has(tone)
      || !VALID_PERSONALITY_STYLES.has(communicationStyle)
      || !VALID_PERSONALITY_ASSERTIVENESS.has(assertiveness)
      || !VALID_PERSONALITY_HUMOR.has(humor)
      || !VALID_PERSONALITY_VERBOSITY.has(verbosity)
    ) {
      return { error: "Invalid personality payload" };
    }

    if (signaturePhrase.length > 120 || doNots.length > 5 || doNots.some((value: string) => value.length > 120)) {
      return { error: "Invalid personality payload" };
    }

    updates.personality = {
      tone,
      communicationStyle,
      assertiveness,
      humor,
      verbosity,
      signaturePhrase,
      doNots,
    };
  }

  return { updates };
}

export function getAllowedTaskCreate(body: any) {
  if (!isNonEmptyString(body.title)) {
    return { error: "Task title is required" };
  }
  if (!isNonEmptyString(body.assigneeId)) {
    return { error: "Task assigneeId is required" };
  }

  return {
    value: {
      title: body.title.trim(),
      description: typeof body.description === "string" ? body.description : "",
      assigneeId: body.assigneeId,
      dueDate: typeof body.dueDate === "string" ? body.dueDate : "",
      repeat: typeof body.repeat === "string" ? body.repeat : "",
    },
  };
}

export function getAllowedTaskStatusUpdate(body: any) {
  if (!isNonEmptyString(body.status) || !VALID_TASK_STATUSES.has(body.status)) {
    return { error: "Invalid task status" };
  }
  return { status: body.status };
}

export function getAllowedMessageCreate(body: any) {
  if (!isNonEmptyString(body.agentId)) return { error: "agentId is required" };
  if (!isNonEmptyString(body.senderId)) return { error: "senderId is required" };
  if (!isNonEmptyString(body.senderName)) return { error: "senderName is required" };
  if (!isNonEmptyString(body.content)) return { error: "content is required" };
  if (!isNonEmptyString(body.type) || !VALID_MESSAGE_TYPES.has(body.type)) {
    return { error: "Invalid message type" };
  }

  return {
    value: {
      agentId: body.agentId,
      senderId: body.senderId,
      senderName: body.senderName,
      senderAvatar: typeof body.senderAvatar === "string" ? body.senderAvatar : "",
      content: body.content,
      imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : null,
      timestamp: Number.isFinite(body.timestamp) ? Number(body.timestamp) : Date.now(),
      type: body.type,
    },
  };
}
