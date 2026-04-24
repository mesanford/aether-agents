import db from './src/server/db.ts';

async function inspect() {
  try {
    console.log('--- Tasks ---');
    const tasks = await db.prepare('SELECT id, title, status, execution_type, artifact_payload, agent_id FROM tasks').all();
    console.table(tasks);

    console.log('\n--- Leads ---');
    // Stan mentioned logging 12 communications in CRM.
    // Let's see if there's a communications or leads table.
    const leads = await db.prepare('SELECT * FROM leads LIMIT 20').all();
    console.table(leads);
  } catch (e) {
    console.error('Error during inspection:', e);
  }
}

inspect();
