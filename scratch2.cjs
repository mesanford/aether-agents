const fs = require('fs');
const glob = require('glob');

const testFiles = glob.sync('tests/**/*.ts');
for (const f of testFiles) {
    if (!fs.existsSync(f)) continue;
    let code = fs.readFileSync(f, 'utf8');
    
    // Fix seedWorkspace(workspaceId)
    code = code.replace(/seedWorkspace\(workspaceId\)\s*\{/g, 'async seedWorkspace(workspaceId) {');
    
    // Fix imports
    code = code.replace(/import Database from "better-sqlite3";/g, 'import { PostgresShim } from "../../src/server/db.ts";');
    
    // Fix new Database
    code = code.replace(/new Database\(dbPath\)/g, 'new PostgresShim()');
    
    // Fix types
    code = code.replace(/Database\.Database/g, 'PostgresShim');
    
    // Fix dbBootstrap db issues
    if (f.includes('dbBootstrap.unit.test.ts')) {
        code = fs.readFileSync(f, 'utf8'); // reload un-hacked
        code = code.replace(/import Database from "better-sqlite3";/g, 'import { PostgresShim } from "../../src/server/db.ts";');
        code = code.replace(/\/\/ const db = new Database/g, 'const db = new PostgresShim()');
        code = code.replace(/\/\/ const \{ seedWorkspace/g, 'const { seedWorkspace');
        code = code.replace(/const db = new Database\(":memory:"\);/g, 'const db = new PostgresShim() as any;');
        code = code.replace(/db\.close\(\);/g, 'db.pool?.end();');
        code = code.replace(/seedWorkspace\(workspaceInsert\.lastInsertRowid\)/g, 'await seedWorkspace(workspaceInsert.lastInsertRowid)');
    }

    fs.writeFileSync(f, code);
}

const scriptFiles = glob.sync('scripts/**/*.ts');
for (const f of scriptFiles) {
    if (!fs.existsSync(f)) continue;
    let code = fs.readFileSync(f, 'utf8');
    code = code.replace(/import Database from ('|")better-sqlite3('|");/g, 'import db from "../src/server/db.ts";');
    code = code.replace(/const db = new Database\([^)]+\);/g, '');
    fs.writeFileSync(f, code);
}

const serverFile = 'server.ts';
let code = fs.readFileSync(serverFile, 'utf8');
code = code.replace(/db as any/g, 'db');
code = code.replace(/import Database from ('|")better-sqlite3('|");/g, '');
fs.writeFileSync(serverFile, code);

