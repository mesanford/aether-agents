import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'agency.db');
const db = new Database(dbPath);

console.log('--- Tasks ---');
const tasks = db.prepare('SELECT * FROM tasks').all();
console.table(tasks);

console.log('\n--- Leads ---');
try {
    const leads = db.prepare('SELECT * FROM leads').all();
    console.table(leads);
} catch (e) {
    console.log('Leads table might not exist or error:', e.message);
}

console.log('\n--- Knowledge Documents ---');
const docs = db.prepare('SELECT * FROM knowledge_documents').all();
console.table(docs);

db.close();
