/**
 * If dependencies were never installed (or node_modules was deleted), `next`
 * is missing from PATH and `npm run dev` fails with "command not found" (127).
 * This script runs `npm install` only when `next` is absent.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const nextPkg = path.join(root, 'node_modules', 'next', 'package.json');

if (fs.existsSync(nextPkg)) {
  process.exit(0);
}

console.log('Dependencies missing — running npm install…');
execSync('npm install', { cwd: root, stdio: 'inherit' });
