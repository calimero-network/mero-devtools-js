import { promises as fs } from 'node:fs';
import path from 'node:path';

const distEsm = path.resolve('dist/esm');
const distCjs = path.resolve('dist');

await fs.mkdir(distCjs, { recursive: true });

const srcPath = path.join(distEsm, 'index.js');
const destPath = path.join(distCjs, 'cli.mjs');

let content = await fs.readFile(srcPath, 'utf8');
content = content.replace(/^#!.*\n/, '');
content = `#!/usr/bin/env node\n` + content;

await fs.writeFile(destPath, content, 'utf8');
await fs.chmod(destPath, 0o755);

console.log('Built CLI to', destPath);

