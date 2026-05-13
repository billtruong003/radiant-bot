#!/usr/bin/env node
/**
 * Post-build helper: copy non-TS asset files (JSON config) from `src/`
 * into `dist/src/` so import.meta.url-based loaders find them at
 * runtime.
 *
 * Why this exists: `tsc` only emits `.ts → .js`. Config JSON files
 * referenced via `new URL('./foo.json', import.meta.url)` resolve
 * relative to the compiled JS location, so the JSON must be co-located
 * in `dist/` too. `tsc` doesn't copy them.
 *
 * Cross-platform (Node, no shell `cp`) so works on Windows + Linux.
 */

const fs = require('node:fs');
const path = require('node:path');

const SRC_ROOT = path.resolve(__dirname, '..', 'src');
const DIST_ROOT = path.resolve(__dirname, '..', 'dist', 'src');
const EXTENSIONS = ['.json'];

function walk(dir, callback) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, callback);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (EXTENSIONS.includes(ext)) callback(full);
    }
  }
}

let copied = 0;
walk(SRC_ROOT, (srcPath) => {
  const relative = path.relative(SRC_ROOT, srcPath);
  const destPath = path.join(DIST_ROOT, relative);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  copied++;
});

console.log(`copy-assets: copied ${copied} non-TS file(s) from src/ → dist/src/`);
