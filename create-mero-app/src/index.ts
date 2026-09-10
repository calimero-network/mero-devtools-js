#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { green, red, cyan, dim } from 'kolorist';
import validate from 'validate-npm-package-name';
import {
  detachCargoManifest,
  extractTables,
  parseCatalog,
  parseLockedVersions,
  parseTomlTable,
  planExtendsRewrite,
  resolveCatalogSpecifiers,
} from './monorepo.js';

const program = new Command();

/**
 * The starter is a directory inside `calimero-network/apps`, not a repo of its
 * own. The standalone `kv-store` and `kv-store-js` repos this CLI used to clone
 * were archived when every app moved into that monorepo; cloning them kept
 * working, which is exactly why the rot went unnoticed — a scaffolded project
 * silently tracked an abandoned tree.
 *
 * Two things follow, and between them they are most of this file:
 *
 *  1. Only one directory is wanted out of a large repo, so the checkout is
 *     sparse rather than a full clone.
 *  2. A monorepo app is not a standalone project — see `monorepo.ts`. Its
 *     `catalog:` and `workspace = true` references are resolved against the
 *     checkout on the way out.
 */
const TEMPLATE = {
  repoUrl: 'https://github.com/calimero-network/apps',
  /** Directory within the repo that becomes the project. */
  subdir: 'apps/kv-store',
  display: 'Rust (kv-store)',
} as const;

/** Templates that used to exist, kept only to explain themselves once. */
const RETIRED_TEMPLATES: Record<string, string> = {
  javascript:
    'the JavaScript starter (calimero-network/kv-store-js) was archived and has no ' +
    'replacement. For a JavaScript contract see the examples in ' +
    'https://github.com/calimero-network/calimero-sdk-js',
};

const EXCLUDED_NAMES = new Set<string>([
  '.git',
  '.github',
  '.gitignore',
  '.gitattributes',
  '.gitmodules',
  'node_modules',
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

/**
 * Check out just `subdir`, plus the repo-root files.
 *
 * Cone-mode sparse checkout always materializes the files at the repository
 * root, which is what makes this work: `Cargo.toml` and `pnpm-workspace.yaml`
 * arrive alongside the app directory, and those are exactly the two files the
 * inherited references have to be resolved against.
 */
async function sparseCloneToTemp(
  repoUrl: string,
  subdir: string,
): Promise<string> {
  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'mero-create-'));
  const cloneDir = path.join(tmpBase, 'repo');

  await runGit([
    'clone',
    '--depth',
    '1',
    '--filter=blob:none',
    '--sparse',
    repoUrl,
    cloneDir,
  ]);
  await runGit(['sparse-checkout', 'set', subdir], cloneDir);

  return cloneDir;
}

/**
 * Resolve the `catalog:` specifiers in the app's package.json against the
 * checkout's own catalog.
 */
async function detachFrontend(
  targetDir: string,
  checkout: string,
): Promise<void> {
  const pkgPath = path.join(targetDir, 'app', 'package.json');
  if (!(await pathExists(pkgPath))) return;

  const workspaceYaml = path.join(checkout, 'pnpm-workspace.yaml');
  if (!(await pathExists(workspaceYaml))) {
    throw new Error(
      `Expected ${workspaceYaml} in the checkout to resolve "catalog:" dependencies.`,
    );
  }

  const catalog = parseCatalog(await fs.readFile(workspaceYaml, 'utf8'));

  // Prefer what the source repo actually resolved over the catalog's range, so
  // the project starts on the combination upstream builds and tests. Absent a
  // lockfile the ranges still work; they are just no longer reproducible.
  const lockfile = path.join(checkout, 'pnpm-lock.yaml');
  const locked = (await pathExists(lockfile))
    ? parseLockedVersions(
        await fs.readFile(lockfile, 'utf8'),
        `${TEMPLATE.subdir}/app`,
      )
    : new Map<string, string>();

  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  const { resolved, missing } = resolveCatalogSpecifiers(pkg, catalog, locked);

  if (missing.length) {
    throw new Error(
      'These dependencies use "catalog:" but the workspace catalog does not ' +
        `define them: ${missing.join(', ')}. The template and this CLI are out of step.`,
    );
  }

  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(
    dim(
      `  resolved ${resolved} catalog dependencies` +
        (locked.size ? ' (pinned from the source lockfile)' : ''),
    ),
  );
}

/**
 * Resolve the crate's inherited `workspace = true` fields against the
 * checkout's root Cargo.toml.
 */
async function detachContract(
  targetDir: string,
  checkout: string,
): Promise<void> {
  const manifestPath = path.join(targetDir, 'logic', 'Cargo.toml');
  if (!(await pathExists(manifestPath))) return;

  const rootManifest = path.join(checkout, 'Cargo.toml');
  if (!(await pathExists(rootManifest))) {
    throw new Error(
      `Expected ${rootManifest} in the checkout to resolve inherited crate fields.`,
    );
  }

  const rootToml = await fs.readFile(rootManifest, 'utf8');
  const { text, unresolved } = detachCargoManifest(
    await fs.readFile(manifestPath, 'utf8'),
    parseTomlTable(rootToml, 'workspace.package'),
    parseTomlTable(rootToml, 'workspace.dependencies'),
    extractTables(rootToml, (name) => name.startsWith('profile.')),
  );

  if (unresolved.length) {
    throw new Error(
      'These crate fields inherit from the workspace but the workspace does ' +
        `not define them: ${unresolved.join(', ')}. The template and this CLI are out of step.`,
    );
  }

  await fs.writeFile(manifestPath, text, 'utf8');
  console.log(dim('  resolved inherited crate dependencies'));
}

/** Every tsconfig under `dir`, relative to it, skipping node_modules. */
async function findTsconfigs(dir: string, prefix = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (EXCLUDED_NAMES.has(entry.name)) continue;
    const rel = prefix ? path.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      found.push(...(await findTsconfigs(path.join(dir, entry.name), rel)));
    } else if (/^tsconfig(\..+)?\.json$/.test(entry.name)) {
      found.push(rel);
    }
  }
  return found;
}

/**
 * Hoist the shared tsconfig the app extends, and repoint the paths at it.
 *
 * This is the third inherited reference, and the one that fails least visibly:
 * a broken `extends` does not error, it drops TypeScript to its built-in
 * defaults, and the build dies on ES3 syntax errors that name none of this.
 */
async function detachTypescript(
  targetDir: string,
  checkout: string,
): Promise<void> {
  const hoisted = new Set<string>();

  for (const rel of await findTsconfigs(targetDir)) {
    const filePath = path.join(targetDir, rel);
    const raw = await fs.readFile(filePath, 'utf8');
    const match = /"extends"\s*:\s*"([^"]+)"/.exec(raw);
    if (!match) continue;

    const plan = planExtendsRewrite(rel, match[1], TEMPLATE.subdir);
    if (!plan) continue;

    const source = path.join(checkout, plan.hoistFrom);
    if (!(await pathExists(source))) {
      throw new Error(
        `${rel} extends ${match[1]}, which resolves to ${plan.hoistFrom} — ` +
          'not present in the checkout. The template layout has changed.',
      );
    }

    const basename = path.basename(plan.hoistFrom);
    if (!hoisted.has(basename)) {
      await fs.copyFile(source, path.join(targetDir, basename));
      hoisted.add(basename);
    }

    await fs.writeFile(
      filePath,
      raw.replace(match[0], `"extends": "${plan.newExtends}"`),
      'utf8',
    );
  }

  if (hoisted.size) {
    console.log(
      dim(`  hoisted ${[...hoisted].join(', ')} and repointed extends`),
    );
  }
}

/**
 * Write the project root the monorepo does not have.
 *
 * Inside `apps` the orchestration lives at the repo root and an app is driven
 * through workspace filters (`pnpm -F kv-store dev`). Extracted on its own the
 * app directory has no root at all, so one is generated: a pnpm workspace whose
 * only member is `app/`, which is what makes a single `pnpm install` at the top
 * install the frontend.
 */
async function writeProjectRoot(
  targetDir: string,
  appName: string,
  checkout: string,
): Promise<void> {
  const pkg = {
    name: appName,
    private: true,
    type: 'module',
    scripts: {
      dev: 'pnpm -C app dev',
      build: 'pnpm -C app build',
      test: 'pnpm -C app test',
      typecheck: 'pnpm -C app typecheck',
      codegen: 'pnpm -C app codegen',
      'logic:build': 'cd logic && cargo mero build',
      'logic:test': 'cd logic && cargo test',
    },
    engines: { node: '>=20' },
  };
  await fs.writeFile(
    path.join(targetDir, 'package.json'),
    JSON.stringify(pkg, null, 2) + '\n',
    'utf8',
  );

  // Carried over from the source workspace rather than hardcoded: pnpm renamed
  // this key between 10 and 11, and whichever spelling the monorepo builds with
  // is the one that matches the toolchain the template was tested against.
  const sourceYaml = await fs.readFile(
    path.join(checkout, 'pnpm-workspace.yaml'),
    'utf8',
  );
  const buildsKey = /^(onlyBuiltDependencies|allowBuilds):/m.exec(sourceYaml);
  const builds = buildsKey
    ? `\n# ${buildsKey[1]} is carried over from the source repo: vite's esbuild\n# binary needs its install script approved explicitly under pnpm 10+.\n${buildsKey[1]}:\n  - esbuild\n`
    : '';

  await fs.writeFile(
    path.join(targetDir, 'pnpm-workspace.yaml'),
    `# The frontend is the only pnpm package here; the contract is a cargo crate\n` +
      `# under logic/. A single \`pnpm install\` at this level installs app/.\npackages:\n  - "app"\n${builds}`,
    'utf8',
  );
}

/**
 * Replace the app's README with one describing the standalone project.
 *
 * The upstream README documents monorepo commands — `pnpm install` "once, at
 * the repo root", `pnpm -F kv-store dev`, `cargo mero build -p kv-store` — none
 * of which work here. Shipping it unchanged would hand every scaffolded project
 * a set of instructions that fail on the first command.
 */
async function writeProjectReadme(
  targetDir: string,
  appName: string,
): Promise<void> {
  const readme = `# ${appName}

Scaffolded with \`create-mero-app\` from the Calimero KV Store reference app.

\`\`\`
${appName}/
├── logic/    Rust → WASM. The contract, and where the app's behaviour lives.
└── app/      Vite + React + TypeScript, with a client generated from the ABI.
\`\`\`

## Run it

\`\`\`bash
pnpm install          # installs app/
pnpm logic:build      # cargo mero build → logic/res/*.wasm + abi.json
pnpm codegen          # regenerates app/src/generated from that ABI
pnpm dev              # http://localhost:5173
\`\`\`

Install the built wasm on a node, then use the app's **Choose a context** screen
to connect to it.

## Test it

\`\`\`bash
pnpm logic:test       # contract unit tests + 3-replica convergence, no node
pnpm test             # the generated client against the ABI
\`\`\`

## Where this came from

The template is \`apps/kv-store\` in
[calimero-network/apps](https://github.com/calimero-network/apps), extracted as
a standalone project: its \`catalog:\` frontend dependencies and inherited
\`workspace = true\` crate fields were resolved to concrete versions at scaffold
time, so this project is pinned to whatever the monorepo shipped that day and
upgrades on its own schedule.
`;
  await fs.writeFile(path.join(targetDir, 'README.md'), readme, 'utf8');
}

async function main() {
  program
    .name('create-mero-app')
    .description('Scaffold a new Mero app')
    .argument('[project-name]', 'Name of the project directory')
    .option('-t, --template <name>', 'Template to use (rust)')
    .action(
      async (
        projectName: string | undefined,
        options: { template?: string },
      ) => {
        const cwd = process.cwd();
        const targetDir = projectName ? path.resolve(cwd, projectName) : cwd;
        const appName = path.basename(targetDir);

        const validation = validate(appName);
        if (!validation.validForNewPackages) {
          console.error(red('Invalid project name: ' + appName));
          for (const err of validation.errors ?? [])
            console.error(red('  - ' + err));
          process.exit(1);
        }

        // One template, so `--template` only has to reject what it is not.
        if (options.template && options.template !== 'rust') {
          const retired = RETIRED_TEMPLATES[options.template];
          console.error(red(`Unknown template: ${options.template}`));
          if (retired) console.error(dim(retired));
          console.error(dim('Available templates: rust'));
          process.exit(1);
          return;
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

        console.log();
        console.log(dim('Scaffolding project in ') + cyan(targetDir));
        console.log(dim('Using template: ') + cyan(TEMPLATE.display));

        const checkout = await sparseCloneToTemp(
          TEMPLATE.repoUrl,
          TEMPLATE.subdir,
        );
        try {
          const source = path.join(checkout, TEMPLATE.subdir);
          if (!(await pathExists(source))) {
            throw new Error(
              `${TEMPLATE.subdir} is missing from ${TEMPLATE.repoUrl}. ` +
                'The template may have moved.',
            );
          }
          await copyDir(source, targetDir);

          console.log(dim('Detaching from the monorepo:'));
          await detachFrontend(targetDir, checkout);
          await detachContract(targetDir, checkout);
          await detachTypescript(targetDir, checkout);
          await writeProjectRoot(targetDir, appName, checkout);
          await writeProjectReadme(targetDir, appName);
        } finally {
          await fs.rm(path.dirname(checkout), {
            recursive: true,
            force: true,
          });
        }

        console.log(green('Done.'));
        console.log();
        console.log(dim('Next steps:'));
        const rel = path.relative(cwd, targetDir);
        if (rel) console.log(`  cd ${rel}`);
        console.log('  pnpm install');
        console.log('  pnpm logic:build   ' + dim('# needs cargo + cargo-mero'));
        console.log('  pnpm dev');
      },
    );

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(red(String(err?.stack || err)));
  process.exit(1);
});
