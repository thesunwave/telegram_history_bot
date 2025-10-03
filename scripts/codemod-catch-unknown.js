#!/usr/bin/env node
/*
  Codemod: Convert unsafe catch(error) and catch(error: any) to catch(error: unknown)
  - Scans src/ and tests/ recursively
  - Skips node_modules, dist, build
  - Only changes when necessary
*/
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const TARGET_DIRS = [path.join(ROOT, 'src'), path.join(ROOT, 'tests')];
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'build', '.git']);
const FILE_EXTENSIONS = new Set(['.ts', '.js', '.tsx', '.jsx']);

/**
 * Walk directory recursively and collect target files
 */
function* walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      const ext = path.extname(full);
      if (FILE_EXTENSIONS.has(ext)) {
        yield full;
      }
    }
  }
}

function transform(content) {
  // First: catch(error: any) -> catch(error: unknown)
  const r1 = /catch\s*\(\s*error\s*:\s*any\s*\)/g;
  // Second: catch(error) -> catch(error: unknown) (only untyped)
  const r2 = /catch\s*\(\s*error\s*\)/g;
  let updated = content.replace(r1, 'catch (error: unknown)');
  // Ensure we don't replace already typed catch clauses
  updated = updated.replace(r2, 'catch (error: unknown)');
  return updated;
}

let processed = 0;
let changed = 0;
let changedFiles = [];

for (const base of TARGET_DIRS) {
  if (!fs.existsSync(base)) continue;
  for (const file of walk(base)) {
    try {
      const original = fs.readFileSync(file, 'utf8');
      const updated = transform(original);
      processed++;
      if (updated !== original) {
        fs.writeFileSync(file, updated, 'utf8');
        changed++;
        changedFiles.push(file);
      }
    } catch (e) {
      // Ignore read/write errors for this codemod but report to console
      console.error('Codemod failed for', file, e && e.message ? e.message : e);
    }
  }
}

console.log(JSON.stringify({ processed, changed, changedFilesCount: changedFiles.length }, null, 2));