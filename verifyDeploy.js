#!/usr/bin/env node
/**
 * Catch Render/Linux deploy failures before push.
 *
 * Why Windows hides these bugs:
 *  - NTFS is case-insensitive (dbtiming === dbTiming.js)
 *  - Monorepo layout: backend/database.js can require ../utils/... (project root)
 *  - Render/appointo deploys backend/ contents at repo root (flat layout)
 *
 * Run from backend/:  npm run verify:deploy
 */
const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = __dirname;
const DEPLOY_ROOT = BACKEND_ROOT;
const LOCAL_REQUIRE = /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;
const EXTENSIONS = ['.js', '.json', '.node'];

const errors = [];
const warnings = [];

function rel(file) {
    return path.relative(BACKEND_ROOT, file).split(path.sep).join('/');
}

function addError(code, message, file, detail) {
    errors.push({ code, message, file: rel(file), detail });
}

function addWarning(code, message, file, detail) {
    warnings.push({ code, message, file: rel(file), detail });
}

function walkJsFiles(dir, out = []) {
    for (const name of fs.readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        const full = path.join(dir, name);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) walkJsFiles(full, out);
        else if (name.endsWith('.js')) out.push(full);
    }
    return out;
}

/** Match exact on-disk casing (Linux behavior). */
function checkPathCase(fullPath) {
    if (!fs.existsSync(fullPath)) return { exists: false };

    const normalized = path.resolve(fullPath);
    const root = path.parse(normalized).root;
    const segments = normalized.slice(root.length).split(path.sep).filter(Boolean);
    let current = root;

    for (const segment of segments) {
        let entries;
        try {
            entries = fs.readdirSync(current);
        } catch {
            return { exists: false };
        }
        const match = entries.find((e) => e.toLowerCase() === segment.toLowerCase());
        if (!match) return { exists: false, missing: segment, parent: current };
        if (match !== segment) {
            return {
                exists: true,
                caseMismatch: true,
                expected: segment,
                actual: match,
                parent: current,
            };
        }
        current = path.join(current, match);
    }
    return { exists: true, caseMismatch: false };
}

function resolveLocalModule(fromFile, request) {
    const base = path.resolve(path.dirname(fromFile), request);
    const candidates = [
        base,
        ...EXTENSIONS.map((ext) => base + ext),
        path.join(base, 'index.js'),
        path.join(base, 'index.json'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

function escapesDeployRoot(resolvedPath) {
    const deploy = path.resolve(DEPLOY_ROOT);
    const target = path.resolve(resolvedPath);
    return !target.startsWith(deploy + path.sep) && target !== deploy;
}

function scanRequires() {
    const files = walkJsFiles(BACKEND_ROOT);

    for (const file of files) {
        if (path.basename(file) === 'verifyDeploy.js') continue;
        const source = fs.readFileSync(file, 'utf8');
        LOCAL_REQUIRE.lastIndex = 0;
        let match;
        while ((match = LOCAL_REQUIRE.exec(source)) !== null) {
            const request = match[1];
            const resolved = resolveLocalModule(file, request);

            if (!resolved) {
                addError(
                    'MISSING_MODULE',
                    `Cannot resolve "${request}" (Linux/Render will crash here)`,
                    file,
                    request
                );
                continue;
            }

            const caseCheck = checkPathCase(resolved);
            if (caseCheck.caseMismatch) {
                addError(
                    'CASE_MISMATCH',
                    `Require "${request}" casing does not match disk: use "${caseCheck.actual}" not "${caseCheck.expected}"`,
                    file,
                    path.join(caseCheck.parent, caseCheck.actual)
                );
            }

            if (escapesDeployRoot(resolved)) {
                addError(
                    'ESCAPES_DEPLOY_ROOT',
                    `Require "${request}" points outside backend/ — works in monorepo on Windows, fails on Render flat deploy`,
                    file,
                    rel(resolved)
                );
            }
        }
    }
}

function printReport() {
    console.log('\n=== Deploy verify (Render/Linux simulation) ===\n');
    console.log('Why local Windows + remote MySQL still miss these:');
    console.log('  1. Case: Windows finds dbTiming when you require("./utils/dbtiming")');
    console.log('  2. Paths: backend/database.js can reach ../utils/ (monorepo root); Render cannot');
    console.log('  3. Missing files: only appear when the deployed repo lacks a copied file\n');
    console.log(`Backend root (simulated Render root): ${BACKEND_ROOT}\n`);

    if (errors.length === 0 && warnings.length === 0) {
        console.log('OK — no deploy blockers found.\n');
        return 0;
    }

    if (errors.length) {
        console.log(`ERRORS (${errors.length}) — fix before pushing to Render:\n`);
        errors.forEach((e, i) => {
            console.log(`${i + 1}. [${e.code}] ${e.file}`);
            console.log(`   ${e.message}`);
            if (e.detail) console.log(`   -> ${e.detail}`);
        });
        console.log('');
    }

    if (warnings.length) {
        console.log(`WARNINGS (${warnings.length}):\n`);
        warnings.forEach((w, i) => {
            console.log(`${i + 1}. [${w.code}] ${w.file}`);
            console.log(`   ${w.message}`);
            if (w.detail) console.log(`   -> ${w.detail}`);
        });
        console.log('');
    }

    if (errors.length) {
        console.log('Run: npm run verify:deploy   (from backend/) before every Render push.\n');
        return 1;
    }
    return 0;
}

scanRequires();

process.env.DB_TYPE = process.env.DB_TYPE || 'inmemory';
try {
    delete require.cache[path.resolve(BACKEND_ROOT, 'database.js')];
    require(path.join(BACKEND_ROOT, 'database.js'));
} catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
        addError('BOOT_FAIL', err.message, path.join(BACKEND_ROOT, 'database.js'), err.message);
    } else {
        addWarning('BOOT_RUNTIME', `database.js runtime: ${err.message}`, 'database.js', err.code);
    }
}

process.exitCode = printReport();
