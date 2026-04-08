const fs = require('fs');

const fixTests = () => {
    const glob = require('glob');
    const files = glob.sync('tests/**/*.ts');
    
    for (const f of files) {
        if (!fs.existsSync(f)) continue;
        let code = fs.readFileSync(f, 'utf8');
        
        let changed = false;
        
        if (code.includes('import Database from "better-sqlite3"')) {
            code = code.replace(/import Database from "better-sqlite3";/g, '');
            changed = true;
        }

        if (code.includes('seedWorkspace: () => {}')) {
            code = code.replace(/seedWorkspace: \(\) => \{\}/g, 'seedWorkspace: async () => {}');
            changed = true;
        }
        
        if (f.includes('dbBootstrap.unit.test.ts')) {
            code = code.replace(/const db = new Database/g, '// const db = new Database');
            code = code.replace(/const { seedWorkspace/g, '// const { seedWorkspace');
            changed = true;
        }

        if (changed) {
            fs.writeFileSync(f, code);
        }
    }
}
fixTests();
