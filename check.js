// this file exist for the custom checker, if it is removed in your pr, it will automatically be closed.
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

let failed = false;
let warnings = 0;

function pass(msg)  { console.log(`✅ ${msg}`); }
function warn(msg)  { console.warn(`⚠️  ${msg}`); warnings++; }
function fail(msg)  { console.error(`❌ ${msg}`); failed = true; }
function info(msg)  { console.log(`ℹ️  ${msg}`); }
function header(msg){ console.log(`\n── ${msg} ──`); }

// ── 1. Hardcoded owner IDs ─────────────────────────────────────────────────
header('Owner ID checks');

const ownerPattern = /const OWNERS\s*=\s*\[([^\]]*)\]/g;
const jsFiles = [];

function collectJS(dir) {
    for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) collectJS(full);
        else if (f.endsWith('.js')) jsFiles.push(full);
    }
}
collectJS('.');

for (const file of jsFiles) {
    const src = fs.readFileSync(file, 'utf8');
    let match;
    ownerPattern.lastIndex = 0;
    while ((match = ownerPattern.exec(src)) !== null) {
        const ids = match[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
        if (ids.length === 0) {
            fail(`${file}: OWNERS array is empty — eval and owner commands are unprotected`);
        } else {
            pass(`${file}: OWNERS has ${ids.length} ID(s)`);
        }
    }
}

// ── 2. Eval command owner check ────────────────────────────────────────────
header('Eval command protection');

const evalFile = path.join('commands', 'eval.js');
if (!fs.existsSync(evalFile)) {
    warn('commands/eval.js not found — skipping');
} else {
    const evalSrc = fs.readFileSync(evalFile, 'utf8');
    if (!evalSrc.includes('OWNERS.includes')) {
        fail('commands/eval.js: owner check (OWNERS.includes) is missing — eval is unprotected');
    } else {
        pass('commands/eval.js: owner check is present');
    }
}

// ── 3. Sensitive values in JS files ───────────────────────────────────────
header('Sensitive value exposure');

const sensitivePatterns = [
    { pattern: /TOKEN\s*=\s*['"][A-Za-z0-9._-]{20,}['"]/,  label: 'hardcoded TOKEN' },
    { pattern: /CLIENT_SECRET\s*=\s*['"][A-Za-z0-9._-]{10,}['"]/, label: 'hardcoded CLIENT_SECRET' },
    { pattern: /DASHBOARD_TOKEN\s*=\s*['"][^'"]{6,}['"]/,   label: 'hardcoded DASHBOARD_TOKEN' },
];

for (const file of jsFiles) {
    const src = fs.readFileSync(file, 'utf8');
    for (const { pattern, label } of sensitivePatterns) {
        if (pattern.test(src)) {
            fail(`${file}: possible ${label} detected — use environment variables instead`);
        }
    }
}
if (!failed) pass('No hardcoded sensitive values found in JS files');

// ── 4. .env.example completeness ──────────────────────────────────────────
header('.env.example completeness');

const requiredEnvKeys = [
    'TOKEN',
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'DASHBOARD_TOKEN',
    'SESSION_SECRET',
];

if (!fs.existsSync('.env.example')) {
    fail('.env.example is missing');
} else {
    const example = fs.readFileSync('.env.example', 'utf8');
    for (const key of requiredEnvKeys) {
        if (!example.includes(key)) {
            fail(`.env.example is missing required key: ${key}`);
        } else {
            pass(`.env.example contains ${key}`);
        }
    }
}

// ── 5. guild-configs.json not tracked by git ──────────────────────────────
header('guild-configs.json git tracking');

if (!fs.existsSync('.gitignore')) {
    warn('.gitignore not found');
} else {
    const gitignore = fs.readFileSync('.gitignore', 'utf8');
    if (!gitignore.includes('guild-configs.json')) {
        fail('guild-configs.json is not in .gitignore — user data may be committed');
    } else {
        pass('guild-configs.json is listed in .gitignore');
    }
}

if (!fs.existsSync('.gitignore') || !fs.readFileSync('.gitignore','utf8').includes('.env')) {
    fail('.env is not in .gitignore — secrets may be committed');
} else {
    pass('.env is listed in .gitignore');
}

// ── 6. Duplicate command names ─────────────────────────────────────────────
header('Duplicate command names');

const commandNames = [];
const commandDir = path.join('commands');

if (fs.existsSync(commandDir)) {
    for (const file of fs.readdirSync(commandDir).filter(f => f.endsWith('.js'))) {
        const src = fs.readFileSync(path.join(commandDir, file), 'utf8');
        const match = src.match(/\.setName\(['"]([^'"]+)['"]\)/);
        if (match) {
            const name = match[1];
            if (commandNames.includes(name)) {
                fail(`Duplicate command name "${name}" found in commands/${file}`);
            } else {
                commandNames.push(name);
            }
        }
    }
    pass(`${commandNames.length} unique command names found`);
}

// ── 7. Missing execute export ──────────────────────────────────────────────
header('Command export integrity');

if (fs.existsSync(commandDir)) {
    for (const file of fs.readdirSync(commandDir).filter(f => f.endsWith('.js'))) {
        const src = fs.readFileSync(path.join(commandDir, file), 'utf8');
        const hasData    = src.includes('data');
        const hasExecute = src.includes('execute');
        if (!hasData || !hasExecute) {
            fail(`commands/${file}: missing ${!hasData ? '\'data\'' : '\'execute\''} export — command will not load`);
        } else {
            pass(`commands/${file}: exports look correct`);
        }
    }
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(40));
if (failed) {#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

let failed = false;
let warnings = 0;

function pass(msg)  { console.log(`✅ ${msg}`); }
function warn(msg)  { console.warn(`⚠️  ${msg}`); warnings++; }
function fail(msg)  { console.error(`❌ ${msg}`); failed = true; }
function info(msg)  { console.log(`ℹ️  ${msg}`); }
function header(msg){ console.log(`\n── ${msg} ──`); }

// ── 1. Hardcoded owner IDs ─────────────────────────────────────────────────
header('Owner ID checks');

const ownerPattern = /const OWNERS\s*=\s*\[([^\]]*)\]/g;
const jsFiles = [];

function collectJS(dir) {
    for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) collectJS(full);
        else if (f.endsWith('.js')) jsFiles.push(full);
    }
}
collectJS('.');

for (const file of jsFiles) {
    const src = fs.readFileSync(file, 'utf8');
    let match;
    ownerPattern.lastIndex = 0;
    while ((match = ownerPattern.exec(src)) !== null) {
        const ids = match[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
        if (ids.length === 0) {
            fail(`${file}: OWNERS array is empty — eval and owner commands are unprotected`);
        } else {
            pass(`${file}: OWNERS has ${ids.length} ID(s)`);
        }
    }
}

// ── 2. Eval command owner check ────────────────────────────────────────────
header('Eval command protection');

const evalFile = path.join('commands', 'eval.js');
if (!fs.existsSync(evalFile)) {
    warn('commands/eval.js not found — skipping');
} else {
    const evalSrc = fs.readFileSync(evalFile, 'utf8');
    if (!evalSrc.includes('OWNERS.includes')) {
        fail('commands/eval.js: owner check (OWNERS.includes) is missing — eval is unprotected');
    } else {
        pass('commands/eval.js: owner check is present');
    }
}

// ── 3. Sensitive values in JS files ───────────────────────────────────────
header('Sensitive value exposure');

const sensitivePatterns = [
    { pattern: /TOKEN\s*=\s*['"][A-Za-z0-9._-]{20,}['"]/,  label: 'hardcoded TOKEN' },
    { pattern: /CLIENT_SECRET\s*=\s*['"][A-Za-z0-9._-]{10,}['"]/, label: 'hardcoded CLIENT_SECRET' },
    { pattern: /DASHBOARD_TOKEN\s*=\s*['"][^'"]{6,}['"]/,   label: 'hardcoded DASHBOARD_TOKEN' },
];

for (const file of jsFiles) {
    const src = fs.readFileSync(file, 'utf8');
    for (const { pattern, label } of sensitivePatterns) {
        if (pattern.test(src)) {
            fail(`${file}: possible ${label} detected — use environment variables instead`);
        }
    }
}
if (!failed) pass('No hardcoded sensitive values found in JS files');

// ── 4. .env.example completeness ──────────────────────────────────────────
header('.env.example completeness');

const requiredEnvKeys = [
    'TOKEN',
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'DASHBOARD_TOKEN',
    'SESSION_SECRET',
];

if (!fs.existsSync('.env.example')) {
    fail('.env.example is missing');
} else {
    const example = fs.readFileSync('.env.example', 'utf8');
    for (const key of requiredEnvKeys) {
        if (!example.includes(key)) {
            fail(`.env.example is missing required key: ${key}`);
        } else {
            pass(`.env.example contains ${key}`);
        }
    }
}

// ── 5. guild-configs.json not tracked by git ──────────────────────────────
header('guild-configs.json git tracking');

if (!fs.existsSync('.gitignore')) {
    warn('.gitignore not found');
} else {
    const gitignore = fs.readFileSync('.gitignore', 'utf8');
    if (!gitignore.includes('guild-configs.json')) {
        fail('guild-configs.json is not in .gitignore — user data may be committed');
    } else {
        pass('guild-configs.json is listed in .gitignore');
    }
}

if (!fs.existsSync('.gitignore') || !fs.readFileSync('.gitignore','utf8').includes('.env')) {
    fail('.env is not in .gitignore — secrets may be committed');
} else {
    pass('.env is listed in .gitignore');
}

// ── 6. Duplicate command names ─────────────────────────────────────────────
header('Duplicate command names');

const commandNames = [];
const commandDir = path.join('commands');

if (fs.existsSync(commandDir)) {
    for (const file of fs.readdirSync(commandDir).filter(f => f.endsWith('.js'))) {
        const src = fs.readFileSync(path.join(commandDir, file), 'utf8');
        const match = src.match(/\.setName\(['"]([^'"]+)['"]\)/);
        if (match) {
            const name = match[1];
            if (commandNames.includes(name)) {
                fail(`Duplicate command name "${name}" found in commands/${file}`);
            } else {
                commandNames.push(name);
            }
        }
    }
    pass(`${commandNames.length} unique command names found`);
}

// ── 7. Missing execute export ──────────────────────────────────────────────
header('Command export integrity');

if (fs.existsSync(commandDir)) {
    for (const file of fs.readdirSync(commandDir).filter(f => f.endsWith('.js'))) {
        const src = fs.readFileSync(path.join(commandDir, file), 'utf8');
        const hasData    = src.includes('data');
        const hasExecute = src.includes('execute');
        if (!hasData || !hasExecute) {
            fail(`commands/${file}: missing ${!hasData ? '\'data\'' : '\'execute\''} export — command will not load`);
        } else {
            pass(`commands/${file}: exports look correct`);
        }
    }
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(40));
if (failed) {
    console.error(`\n❌ Checker failed — fix the errors above before merging.\n`);
    process.exit(1);
} else if (warnings > 0) {
    console.warn(`\n⚠️  Passed with ${warnings} warning(s).\n`);
} else {
    console.log(`\n✅ All checks passed.\n`);
}
    console.error(`\n❌ Checker failed — fix the errors above before merging.\n`);
    process.exit(1);
} else if (warnings > 0) {
    console.warn(`\n⚠️  Passed with ${warnings} warning(s).\n`);
} else {
    console.log(`\n✅ All checks passed.\n`);
}
