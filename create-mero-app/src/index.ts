#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { green, red, cyan, dim } from 'kolorist';
import validate from 'validate-npm-package-name';

const program = new Command();

const EXCLUDED_NAMES = new Set<string>([
  '.git',
  '.github',
  '.gitignore',
  '.gitattributes',
  '.gitmodules',
  'node_modules'
]);

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(srcDir: string, destDir: string): Promise<void> {
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  await fs.mkdir(destDir, { recursive: true });
  for (const entry of entries) {
    if (EXCLUDED_NAMES.has(entry.name)) continue;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function writePackageName(targetDir: string, appName: string): Promise<void> {
  const pkgPath = path.join(targetDir, 'package.json');
  const exists = await pathExists(pkgPath);
  if (!exists) return;
  const raw = await fs.readFile(pkgPath, 'utf8');
  const json = JSON.parse(raw);
  json.name = appName;
  await fs.writeFile(pkgPath, JSON.stringify(json, null, 2) + '\n', 'utf8');
}

function runGit(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd }, (error) => {
      if (error) reject(error);
      else resolve();
    });
    child.stdout?.pipe(process.stdout);
    child.stderr?.pipe(process.stderr);
  });
}

async function cloneToTemp(repoUrl: string): Promise<string> {
  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'mero-create-'));
  const cloneDir = path.join(tmpBase, 'repo');
  await runGit(['clone', '--depth', '1', repoUrl, cloneDir]);
  return cloneDir;
}

async function main() {
  program
    .name('create-mero-app')
    .description('Scaffold a new Mero app by cloning kv-store and copying files (excluding git)')
    .argument('[project-name]', 'Name of the project directory')
    .action(async (projectName: string | undefined) => {
      const cwd = process.cwd();
      const targetDir = projectName ? path.resolve(cwd, projectName) : cwd;
      const appName = path.basename(targetDir);

      const validation = validate(appName);
      if (!validation.validForNewPackages) {
        console.error(red('Invalid project name: ' + appName));
        for (const err of validation.errors ?? []) console.error(red('  - ' + err));
        process.exit(1);
      }

      if (await pathExists(targetDir)) {
        const empty = (await fs.readdir(targetDir)).length === 0;
        if (!empty) {
          console.error(red(`Target directory ${targetDir} is not empty.`));
          process.exit(1);
        }
      } else {
        await fs.mkdir(targetDir, { recursive: true });
      }

      console.log(dim('Scaffolding project in ') + cyan(targetDir));

      const repoUrl = 'https://github.com/calimero-network/kv-store';
      const tempRepo = await cloneToTemp(repoUrl);
      try {
        const entries = await fs.readdir(tempRepo, { withFileTypes: true });
        for (const entry of entries) {
          const name = entry.name;
          if (EXCLUDED_NAMES.has(name)) continue;
          const srcPath = path.join(tempRepo, name);
          const destPath = path.join(targetDir, name);
          if (entry.isDirectory()) {
            await copyDir(srcPath, destPath);
          } else if (entry.isFile()) {
            await fs.copyFile(srcPath, destPath);
          }
        }
      } finally {
        await fs.rm(path.dirname(tempRepo), { recursive: true, force: true });
      }

      await writePackageName(targetDir, appName);

      console.log(green('Done.'));
      console.log();
      console.log(dim('Next steps:'));
      const rel = path.relative(cwd, targetDir);
      if (rel) console.log(`  cd ${rel}`);
      console.log('  pnpm install');
      console.log('  pnpm dev');
    });

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(red(String(err?.stack || err)));
  process.exit(1);
});


