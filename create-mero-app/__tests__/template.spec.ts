import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TEMPLATE, sparseCloneToTemp } from '../src/template.js';

/** A repo whose default branch has moved past the commit a release pins. */
describe('sparseCloneToTemp', () => {
  let root: string;
  let repoUrl: string;
  let pinned: string;
  const clones: string[] = [];

  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'template-spec-'));
    const repo = path.join(root, 'apps');
    await fs.mkdir(path.join(repo, 'apps/kv-store'), { recursive: true });
    git(repo, 'init', '-q', '-b', 'main');
    const commit = async (content: string) => {
      await fs.writeFile(path.join(repo, 'apps/kv-store/marker'), content);
      git(repo, 'add', '.');
      git(
        repo,
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@t',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-qm',
        content,
      );
      return git(repo, 'rev-parse', 'HEAD');
    };
    pinned = await commit('pinned');
    await commit('moved');
    repoUrl = `file://${repo}`;
  });

  afterAll(async () => {
    for (const clone of clones)
      await fs.rm(path.dirname(clone), { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  });

  it('checks out the pinned commit, not the default branch', async () => {
    const checkout = await sparseCloneToTemp(repoUrl, 'apps/kv-store', pinned);
    clones.push(checkout);
    expect(
      await fs.readFile(path.join(checkout, 'apps/kv-store/marker'), 'utf8'),
    ).toBe('pinned');
    expect(git(checkout, 'rev-parse', 'HEAD')).toBe(pinned);
  });

  it('fails when the pinned commit is not in the repo', async () => {
    await expect(
      sparseCloneToTemp(repoUrl, 'apps/kv-store', 'f'.repeat(40)),
    ).rejects.toThrow();
  });

  it('pins the published template to a full commit id', () => {
    expect(TEMPLATE.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});
