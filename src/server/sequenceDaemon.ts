import cron from 'node-cron';
import Database from "better-sqlite3";
import { workflow } from './ai/graph.ts';
import { HumanMessage } from '@langchain/core/messages';
import { checkAndIncrementDailyAIRequestLimit, DailyLimitExceededError } from './ai/rateLimiterUtility.ts';


// Background Job that runs every 15 minutes
export function startSequenceDaemon(db: Database.Database) {
  console.log('[DAEMON] Sales Sequence Engine initialized. Running on */15 schedule.');
  
  cron.schedule('*/15 * * * *', async () => {
    console.log('[DAEMON] Waking up to process sequence enrollments...');
    
    try {
      const now = new Date().toISOString();
      const pendingEnrollments = db.prepare(`
        SELECT e.*, s.steps, s.title, l.name as lead_name, l.email as lead_email, l.company as lead_company, l.notes as lead_notes 
        FROM sequence_enrollments e
        JOIN sales_sequences s ON e.sequence_id = s.id
        JOIN leads l ON e.lead_id = l.id
        WHERE e.status = 'Active' 
        AND (e.next_execution_datetime <= ? OR e.next_execution_datetime IS NULL)
      `).all(now) as any[];

      if (!pendingEnrollments || pendingEnrollments.length === 0) {
        return;
      }

      console.log(`[DAEMON] Found ${pendingEnrollments.length} pending lead sequence(s) to process.`);

      for (const enrollment of pendingEnrollments) {
        const steps = JSON.parse(enrollment.steps);
        if (enrollment.current_step_idx >= steps.length) {
          db.prepare("UPDATE sequence_enrollments SET status = 'Completed' WHERE id = ?").run(enrollment.id);
          continue;
        }

        const currentStep = steps[enrollment.current_step_idx];
        
        // Fetch recent lead events and Stan's memory ledger
        const history = db.prepare("SELECT event_type, content, agent_feedback FROM sequence_events WHERE sequence_id = ? AND lead_id = ? ORDER BY created_at ASC").all(enrollment.sequence_id, enrollment.lead_id) as any[];
        const ledger = db.prepare("SELECT learning FROM stan_memory_ledger WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 5").all(enrollment.workspace_id) as any[];

        const ledgerContext = ledger.map(l => l.learning).join('. ');
        const historyContext = history.map(h => `[${h.event_type}]: ${h.agent_feedback || h.content}`).join('\n');

        // Compile the prompt for Stan
        const runPrompt = `
[Direct message to sales-associate]
ATTENTION STAN (Autonomous Sequence Engine): 
You have been awakened by the Cron Daemon to execute step ${enrollment.current_step_idx + 1} of the "${enrollment.title}" sequence.

Target Lead:
Name: ${enrollment.lead_name}
Email: ${enrollment.lead_email}
Company: ${enrollment.lead_company}
Notes: ${enrollment.lead_notes}

Step Instruction from Sequence Visualizer Builder:
Type: ${currentStep.type}
Prompt/Rules: ${currentStep.prompt || currentStep.subject || 'Execute outreach naturally'}

Your Internal Operational Memory (Lessons Learned):
${ledgerContext || 'No previous macroscopic lessons recorded yet.'}

History of interactions with THIS lead:
${historyContext || 'No prior interactions.'}

Your Mission:
1. Examine the Lead details and the History. If the Lead has already replied positively or requested to stop, DO NOT send further outreach. Formally articulate that the sequence should be halted.
2. If it is safe to proceed, use your tools (like \`gmail_send\`) to meticulously follow the "Step Instruction" rules. Adjust your tone using your Macroscopic Lessons Learned.
3. Once completed, clearly declare that the step was executed successfully so the Daemon can advance the cursor.
`;

        try {
          const profiles = db.prepare("SELECT id, name, role, guidelines, personality, capabilities, description FROM agents WHERE workspace_id = ?").all(enrollment.workspace_id) as any[];
          const agentProfiles = profiles.reduce((acc, a) => {
            acc[a.id] = `Role: ${a.role}\nDescription: ${a.description}\nPersonality: ${a.personality}\nGuidelines: ${a.guidelines}\nCapabilities: ${a.capabilities}`;
            return acc;
          }, {} as Record<string, string>);
          
          try {
            checkAndIncrementDailyAIRequestLimit(db, enrollment.workspace_id);
          } catch (limitErr) {
            if (limitErr instanceof DailyLimitExceededError) {
              console.warn(`[DAEMON] Runaway AI limit hit for workspace ${enrollment.workspace_id}. Pausing sequence ${enrollment.id}.`);
              db.prepare("UPDATE sequence_enrollments SET status = 'Paused' WHERE id = ?").run(enrollment.id);
              
              db.prepare("INSERT INTO sequence_events (workspace_id, lead_id, sequence_id, event_type, content, agent_feedback) VALUES (?, ?, ?, ?, ?, ?)").run(
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
            tenantId: enrollment.workspace_id.toString(),
            clientId: 'system_cron_daemon'
          }, { configurable: { thread_id: `sequence_${enrollment.id}_run` }, recursionLimit: 25 });

          // Extract response string to save into events table
          const msgs = finalState.messages as any[];
          const agentReply = msgs[msgs.length - 1]?.content || 'Executed without comment.';

          const isHalted = agentReply.toLowerCase().includes('halted') || agentReply.toLowerCase().includes('stopped');
          
          db.prepare("INSERT INTO sequence_events (workspace_id, lead_id, sequence_id, event_type, content, agent_feedback) VALUES (?, ?, ?, ?, ?, ?)").run(
            enrollment.workspace_id, enrollment.lead_id, enrollment.sequence_id, 'Action Executed', runPrompt, agentReply
          );

          if (isHalted) {
            db.prepare("UPDATE sequence_enrollments SET status = 'Paused' WHERE id = ?").run(enrollment.id);
          } else {
            // Advance cursor to next step and set the delay for next_execution_datetime (Default 1 day for now)
            const nextDate = new Date();
            nextDate.setDate(nextDate.getDate() + 1);
            
            db.prepare("UPDATE sequence_enrollments SET current_step_idx = current_step_idx + 1, next_execution_datetime = ? WHERE id = ?").run(
              nextDate.toISOString(), enrollment.id
            );
          }

        } catch (execError) {
          console.error(`[DAEMON] Failed to execute run for sequence ${enrollment.id}: `, execError);
          db.prepare("UPDATE sequence_enrollments SET status = 'Error' WHERE id = ?").run(enrollment.id);
        }
      }

    } catch (err) {
      console.error('[DAEMON] Top level error during cron evaluation:', err);
    }
  });
}
