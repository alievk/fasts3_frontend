import { cpSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'dist/player');
const destDir = resolve(root, 'public/player/dist');

try {
  statSync(srcDir);
} catch {
  console.error('Build artifacts missing: run `npm run build` first.');
  process.exitCode = 1;
  process.exit();
}

mkdirSync(destDir, { recursive: true });
cpSync(srcDir, destDir, { recursive: true });

console.log(`Synced ${srcDir} -> ${destDir}`);
