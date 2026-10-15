import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';

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
export const TEMPLATE = {
  repoUrl: 'https://github.com/calimero-network/apps',
  /** Directory within the repo that becomes the project. */
  subdir: 'apps/kv-store',
  display: 'Rust (kv-store)',
  /** Scaffolded verbatim; bump it to a commit whose CI is green on `main`. */
  commit: '08e2fdc5dae0206236c574fd429d016313c0400d',
} as const;

function runGit(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (error, stdout, stderr) => {
      process.stderr.write(stderr);
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

/**
 * Check out just `subdir`, plus the repo-root files, at exactly `commit`.
 *
 * Cone-mode sparse checkout always materializes the files at the repository
 * root, which is what makes this work: `Cargo.toml` and `pnpm-workspace.yaml`
 * arrive alongside the app directory, and those are exactly the two files the
 * inherited references have to be resolved against.
 */
export async function sparseCloneToTemp(
  repoUrl: string,
  subdir: string,
  commit: string,
): Promise<string> {
  const tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), 'mero-create-'));
  const cloneDir = path.join(tmpBase, 'repo');

  await runGit(['init', '--quiet', cloneDir]);
  await runGit(['sparse-checkout', 'set', subdir], cloneDir);
  await runGit(
    ['fetch', '--quiet', '--depth', '1', '--filter=blob:none', repoUrl, commit],
    cloneDir,
  );
  await runGit(['checkout', '--quiet', '--detach', 'FETCH_HEAD'], cloneDir);

  const head = await runGit(['rev-parse', 'HEAD'], cloneDir);
  if (head !== commit) {
    throw new Error(`Template checkout is at ${head}, expected ${commit}.`);
  }
  return cloneDir;
}
