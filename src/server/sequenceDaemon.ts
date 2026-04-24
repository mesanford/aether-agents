import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { db } from "./db.ts";
import { workflow } from "./ai/graph.ts";
import { checkAndIncrementDailyAIRequestLimit, DailyLimitExceededError } from "./ai/rateLimiterUtility.ts";

/**
 * The Sequence Daemon is a proactive system process that periodically checks for 
 * pending lead sequences and executes the next step autonomously.
 */
export function startSequenceDaemon(db: any) {
  // Check every minute
  setInterval(async () => {
    try {
      // Fetch sequences that are 'Active', due for outreach, and NOT managed by Zernio
      // (Zernio-synced sequences are delivered server-side by Zernio; the daemon handles local-only ones)
      const pendingEnrollments = await db.prepare(`
        SELECT se.id, se.sequence_id, se.lead_id, se.current_step_idx, se.status,
               s.title, s.steps,
               l.name as lead_name, l.email as lead_email, l.company as lead_company, l.notes as lead_notes,
               s.workspace_id
        FROM sequence_enrollments se
        JOIN sales_sequences s ON se.sequence_id = s.id
        JOIN leads l ON se.lead_id = l.id
        WHERE se.status = 'Active'
          AND s.status = 'Active'
          AND s.zernio_sequence_id IS NULL
          AND (se.next_execution_datetime IS NULL OR se.next_execution_datetime <= NOW())
      `).all() as any[];

      if (!pendingEnrollments || pendingEnrollments.length === 0) {
        return;
      }

      console.log(`[DAEMON] Found ${pendingEnrollments.length} pending lead sequence(s) to process.`);

      for (const enrollment of pendingEnrollments) {
        try {
          const steps = JSON.parse(enrollment.steps || "[]");
          if (enrollment.current_step_idx >= steps.length) {
            await db.prepare("UPDATE sequence_enrollments SET status = 'Completed' WHERE id = ?").run(enrollment.id);
            continue;
          }

          const currentStep = steps[enrollment.current_step_idx];
          
          // Fetch recent lead events and Stan's memory ledger
          const history = await db.prepare("SELECT event_type, content, agent_feedback FROM sequence_events WHERE sequence_id = ? AND lead_id = ? ORDER BY created_at ASC").all(enrollment.sequence_id, enrollment.lead_id) as any[];
          const ledger = await db.prepare("SELECT learning FROM stan_memory_ledger WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 5").all(enrollment.workspace_id) as any[];

          const ledgerContext = ledger.map((l: any) => l.learning).join('. ');
          let historyContext = history.map((h: any) => `[${h.event_type}]: ${h.agent_feedback || h.content}`).join('\n');
          
          // Truncate history to avoid context window explosion (keep last ~4000 chars)
          if (historyContext.length > 4000) {
            historyContext = '...[Truncated for brevity]...\n' + historyContext.slice(-4000);
          }

          // Compile the prompt for Stan
          const runPrompt = `
[Direct message to sales-associate]
ATTENTION STAN (Autonomous Sequence Engine): 
You have been awakened by the Cron Daemon to execute step ${enrollment.current_step_idx + 1} of the "${enrollment.title}" sequence.

Current Date/Time: ${new Date().toLocaleString()}

Target Lead:
Name: ${enrollment.lead_name}
Email: ${enrollment.lead_email}
Company: ${enrollment.lead_company}
Notes: ${enrollment.lead_notes}

Step Instruction:
Order: ${currentStep.order || enrollment.current_step_idx + 1}
Message: ${currentStep.message?.text || currentStep.prompt || 'Execute outreach naturally'}
Delay (minutes from previous step): ${currentStep.delayMinutes || 'N/A'}

Your Internal Operational Memory (Lessons Learned):
${ledgerContext || 'No previous macroscopic lessons recorded yet.'}

History of interactions with THIS lead:
${historyContext || 'No prior interactions.'}

Your Mission:
1. Examine the Lead details and the History. If the Lead has already replied positively or requested to stop, DO NOT send further outreach. Formally articulate that the sequence should be halted.
2. If it is safe to proceed, use your tools (like \`draft_email\`) to meticulously follow the "Step Instruction" rules. Adjust your tone using your Macroscopic Lessons Learned.
3. Once completed, clearly declare that the step was executed successfully so the Daemon can advance the cursor.
`;

          const profiles = await db.prepare("SELECT id, name, role, instructions, personality, capabilities, description FROM agents WHERE workspace_id = ?").all(enrollment.workspace_id) as any[];
          const agentProfiles: Record<string, string> = profiles.reduce((acc, a) => {
            acc[a.id] = `Role: ${a.role}\nDescription: ${a.description}\nPersonality: ${a.personality}\nInstructions: ${a.instructions}\nCapabilities: ${a.capabilities}`;
            return acc;
          }, {} as Record<string, string>);
          const agentNames: Record<string, string> = profiles.reduce((acc, a) => {
            if (a.name) acc[a.id] = a.name;
            return acc;
          }, {} as Record<string, string>);

          try {
            await checkAndIncrementDailyAIRequestLimit(db, enrollment.workspace_id);
          } catch (limitErr) {
            if (limitErr instanceof DailyLimitExceededError) {
              console.warn(`[DAEMON] Runaway AI limit hit for workspace ${enrollment.workspace_id}. Pausing sequence ${enrollment.id}.`);
              await db.prepare("UPDATE sequence_enrollments SET status = 'Paused' WHERE id = ?").run(enrollment.id);

              await db.prepare("INSERT INTO sequence_events (workspace_id, lead_id, sequence_id, event_type, content, agent_feedback) VALUES (?, ?, ?, ?, ?, ?)").run(
                enrollment.workspace_id, enrollment.lead_id, enrollment.sequence_id, 'Error', 'Execution paused', 'Daily AI Request Limit Exceeded. Sequence paused permanently until manually resumed.'
              );
              continue;
            }
            throw limitErr;
          }

          // Secure Headless LangGraph Invocation
          const finalState = await workflow.invoke({
            messages: [new HumanMessage(runPrompt)],
            task: runPrompt,
            sender: 'system_daemon',
            dataAccessSection: '',
            liveDataSection: '',
            agentProfiles,
            agentNames,
            tenantId: enrollment.workspace_id.toString(),
            clientId: 'system_cron_daemon'
          }, { configurable: { thread_id: `sequence_${enrollment.id}_run` }, recursionLimit: 25 });

          // Extract response string to save into events table
          const msgs = finalState.messages as any[];
          const agentReply = msgs[msgs.length - 1]?.content || 'Executed without comment.';

          const isHalted = agentReply.toLowerCase().includes('halted') || agentReply.toLowerCase().includes('stopped');

          await db.prepare("INSERT INTO sequence_events (workspace_id, lead_id, sequence_id, event_type, content, agent_feedback) VALUES (?, ?, ?, ?, ?, ?)").run(
            enrollment.workspace_id, enrollment.lead_id, enrollment.sequence_id, 'Action Executed', runPrompt, agentReply
          );

          if (isHalted) {
             console.log(`[DAEMON] Agent requested halt for sequence ${enrollment.id}.`);
             await db.prepare("UPDATE sequence_enrollments SET status = 'Paused', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(enrollment.id);
          } else {
             const nextStepIdx = enrollment.current_step_idx + 1;
             if (nextStepIdx >= steps.length) {
               // Final step just executed — mark complete immediately
               await db.prepare(
                 "UPDATE sequence_enrollments SET status = 'Completed', current_step_idx = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
               ).run(nextStepIdx, enrollment.id);
               console.log(`[DAEMON] Sequence ${enrollment.id} completed all steps.`);
             } else {
               // Respect the next step's delayMinutes so we don't fire all steps back-to-back
               const delayMinutes = steps[nextStepIdx]?.delayMinutes ?? 0;
               const nextExecution = new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
               await db.prepare(
                 "UPDATE sequence_enrollments SET current_step_idx = ?, next_execution_datetime = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"
               ).run(nextStepIdx, nextExecution, enrollment.id);
               console.log(`[DAEMON] Processed step ${enrollment.current_step_idx + 1} for sequence ${enrollment.id}. Next step in ${delayMinutes} min.`);
             }
          }

        } catch (err: any) {
          console.error(`[DAEMON] Failed to process enrollment ${enrollment.id}:`, err);
        }
      }
    } catch (err: any) {
      console.error("[DAEMON] Critical error in sequence daemon loop:", err);
    }
  }, 60000); 
}
