import type { PostgresShim } from "../db.ts";

export class DailyLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DailyLimitExceededError";
  }
}

/**
 * Ensures that the workspace has not exceeded its daily limit for AI operations.
 * If they have, throws a DailyLimitExceededError.
 * 
 * If the current day string (YYYY-MM-DD) differs from daily_ai_requests_date,
 * the counter resets to 0. Otherwise it increments by 1.
 */
export async function checkAndIncrementDailyAIRequestLimit(db: PostgresShim, workspaceId: number | string): Promise<void> {
  const selectQuery = db.prepare(`
    SELECT max_daily_ai_requests, daily_ai_requests_count, daily_ai_requests_date 
    FROM workspace_automation_settings 
    WHERE workspace_id = ?
  `);
  
  const record = (await selectQuery.get(workspaceId)) as any;
  
  if (!record) {
    console.warn(`[CIRCUIT BREAKER] Automation setting row missing for workspace ${workspaceId}. Bypassing limit.`);
    return;
  }
  
  const todayString = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const maxLimit = typeof record.max_daily_ai_requests === 'number' ? record.max_daily_ai_requests : 300;
  
  let currentCount = typeof record.daily_ai_requests_count === 'number' ? record.daily_ai_requests_count : 0;
  let currentDate = typeof record.daily_ai_requests_date === 'string' ? record.daily_ai_requests_date : '';
  
  if (currentDate !== todayString) {
    currentCount = 0;
    currentDate = todayString;
  }
  
  if (currentCount >= maxLimit) {
    console.log(`[CIRCUIT BREAKER] Workspace ${workspaceId} exceeded limit ${maxLimit}.`);
    throw new DailyLimitExceededError(`Workspace ${workspaceId} has exceeded the daily limit of ${maxLimit} autonomous AI invocations.`);
  }
  
  const updateQuery = db.prepare(`
    UPDATE workspace_automation_settings 
    SET daily_ai_requests_count = ?, daily_ai_requests_date = ?
    WHERE workspace_id = ?
  `);
  
  await updateQuery.run(currentCount + 1, currentDate, workspaceId);
}
