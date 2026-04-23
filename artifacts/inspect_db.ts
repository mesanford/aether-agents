import { db } from '../src/server/db.ts';

async function inspect() {
    console.log('--- Tasks ---');
    const tasks = await db.prepare('SELECT * FROM tasks').all();
    console.table(tasks);

    console.log('\n--- Leads ---');
    try {
        const leads = await db.prepare('SELECT * FROM leads').all();
        console.table(leads);
    } catch (e: any) {
        console.log('Leads table might not exist or error:', e.message);
    }

    console.log('\n--- Knowledge Documents ---');
    try {
        const docs = await db.prepare('SELECT * FROM knowledge_documents').all();
        console.table(docs);
    } catch (e: any) {
        console.log('Knowledge table error:', e.message);
    }
}

inspect().catch(console.error);
