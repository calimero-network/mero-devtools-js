import { describe, it, expect } from 'vitest';
import {
  detachCargoManifest,
  extractTables,
  parseCatalog,
  parseLockedVersions,
  parseTomlTable,
  planExtendsRewrite,
  resolveCatalogSpecifiers,
} from '../src/monorepo.js';

/**
 * These cover the step that turns a monorepo app into a standalone project.
 * The failure they exist to catch is a silent one: a scaffold that looks
 * successful and only fails later, at the user's first `pnpm install` or
 * `cargo build`.
 */

describe('parseCatalog', () => {
  const YAML = `# leading comment
packages:
  - "apps/*/app"

catalog:
  # Calimero
  "@calimero-network/mero-js": ^13.2.5
  react: ^19.2.8

  # build
  typescript: ~5.8.3

onlyBuiltDependencies:
  - esbuild
`;

  it('reads quoted and bare keys, skipping comments and blank lines', () => {
    const catalog = parseCatalog(YAML);
    expect(catalog.get('@calimero-network/mero-js')).toBe('^13.2.5');
    expect(catalog.get('react')).toBe('^19.2.8');
    expect(catalog.get('typescript')).toBe('~5.8.3');
  });

  it('stops at the next top-level key', () => {
    // `- esbuild` belongs to onlyBuiltDependencies; leaking past the block end
    // would put junk entries in the catalog.
    expect(parseCatalog(YAML).has('- esbuild')).toBe(false);
    expect(parseCatalog(YAML).size).toBe(3);
  });

  it('returns empty when there is no catalog', () => {
    expect(parseCatalog('packages:\n  - "app"\n').size).toBe(0);
  });
});

describe('parseTomlTable', () => {
  const TOML = `[workspace]
resolver = "2"

[workspace.package]
edition    = "2021"
license    = "MIT OR Apache-2.0"
# a comment between entries
repository = "https://github.com/calimero-network/apps"

[workspace.dependencies]
calimero-sdk = { git = "https://github.com/calimero-network/core.git", tag = "0.11.0-rc.32" }
thiserror = "1.0.56"
`;

  it('reads only the requested table', () => {
    const pkg = parseTomlTable(TOML, 'workspace.package');
    expect(pkg.get('edition')).toBe('"2021"');
    expect(pkg.get('license')).toBe('"MIT OR Apache-2.0"');
    expect(pkg.has('resolver')).toBe(false);
    expect(pkg.has('thiserror')).toBe(false);
  });

  it('keeps an inline table as literal source text', () => {
    const deps = parseTomlTable(TOML, 'workspace.dependencies');
    expect(deps.get('calimero-sdk')).toBe(
      '{ git = "https://github.com/calimero-network/core.git", tag = "0.11.0-rc.32" }',
    );
  });

  it('does not treat a # inside a string as a comment', () => {
    const deps = parseTomlTable(
      '[workspace.package]\nrepository = "https://example.com/#anchor"\n',
      'workspace.package',
    );
    expect(deps.get('repository')).toBe('"https://example.com/#anchor"');
  });
});

describe('resolveCatalogSpecifiers', () => {
  it('replaces catalog: with the catalog version across dep fields', () => {
    const pkg = {
      dependencies: { react: 'catalog:', bs58: '^6.0.0' },
      devDependencies: { vite: 'catalog:' },
    };
    const { resolved, missing } = resolveCatalogSpecifiers(
      pkg,
      new Map([
        ['react', '^19.2.8'],
        ['vite', '^6.4.3'],
      ]),
    );

    expect(resolved).toBe(2);
    expect(missing).toEqual([]);
    expect(pkg.dependencies.react).toBe('^19.2.8');
    expect(pkg.devDependencies.vite).toBe('^6.4.3');
    // An explicit version is left exactly as the template wrote it.
    expect(pkg.dependencies.bs58).toBe('^6.0.0');
  });

  it('reports a dependency the catalog does not define', () => {
    const pkg = { dependencies: { mystery: 'catalog:' } };
    const { missing } = resolveCatalogSpecifiers(pkg, new Map());
    expect(missing).toEqual(['mystery']);
  });

  it('reports named catalogs rather than writing a broken specifier', () => {
    const pkg = { dependencies: { react: 'catalog:react19' } };
    const { missing } = resolveCatalogSpecifiers(
      pkg,
      new Map([['react', '^19.2.8']]),
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain('named catalog');
    expect(pkg.dependencies.react).toBe('catalog:react19');
  });
});

describe('detachCargoManifest', () => {
  const WORKSPACE_PACKAGE = new Map([
    ['edition', '"2021"'],
    ['license', '"MIT OR Apache-2.0"'],
  ]);
  const WORKSPACE_DEPS = new Map([
    [
      'calimero-storage',
      '{ git = "https://github.com/calimero-network/core.git", tag = "0.11.0-rc.32" }',
    ],
    ['thiserror', '"1.0.56"'],
  ]);

  it('resolves the key.workspace = true shorthand, keeping alignment', () => {
    const { text, unresolved } = detachCargoManifest(
      '[package]\nedition.workspace      = true\n',
      WORKSPACE_PACKAGE,
      WORKSPACE_DEPS,
    );
    expect(text).toContain('edition = "2021"');
    expect(unresolved).toEqual([]);
  });

  it('merges local features into an inherited inline table', () => {
    // The case that matters: dropping `features` here would silently disable
    // the mock host the contract's own tests are built on.
    const { text } = detachCargoManifest(
      '[dev-dependencies]\ncalimero-storage = { workspace = true, features = ["testing"] }\n',
      WORKSPACE_PACKAGE,
      WORKSPACE_DEPS,
    );
    expect(text).toContain(
      'calimero-storage = { git = "https://github.com/calimero-network/core.git", tag = "0.11.0-rc.32", features = ["testing"] }',
    );
  });

  it('promotes a plain version to a table when features are attached', () => {
    const { text } = detachCargoManifest(
      '[dependencies]\nthiserror = { workspace = true, features = ["std"] }\n',
      WORKSPACE_PACKAGE,
      WORKSPACE_DEPS,
    );
    expect(text).toContain(
      'thiserror = { version = "1.0.56", features = ["std"] }',
    );
  });

  it('resolves [package] and dependency tables from their own sources', () => {
    // `license` exists only in workspace.package: looking it up in the
    // dependency table would report it unresolved and leave the crate broken.
    const { text, unresolved } = detachCargoManifest(
      '[package]\nlicense.workspace = true\n\n[dependencies]\nthiserror.workspace = true\n',
      WORKSPACE_PACKAGE,
      WORKSPACE_DEPS,
    );
    expect(text).toContain('license = "MIT OR Apache-2.0"');
    expect(text).toContain('thiserror = "1.0.56"');
    expect(unresolved).toEqual([]);
  });

  it('reports what the workspace does not define instead of guessing', () => {
    const { unresolved } = detachCargoManifest(
      '[dependencies]\nmystery.workspace = true\n',
      WORKSPACE_PACKAGE,
      WORKSPACE_DEPS,
    );
    expect(unresolved).toEqual(['mystery']);
  });

  it('adds a [workspace] table so the crate is its own root', () => {
    const { text } = detachCargoManifest(
      '[package]\nname = "kv-store"\n',
      WORKSPACE_PACKAGE,
      WORKSPACE_DEPS,
    );
    expect(text).toMatch(/^\[workspace\]$/m);
  });

  it('does not add a second [workspace] table', () => {
    const { text } = detachCargoManifest(
      '[workspace]\n\n[package]\nname = "kv-store"\n',
      WORKSPACE_PACKAGE,
      WORKSPACE_DEPS,
    );
    expect(text.match(/^\[workspace\]$/gm)).toHaveLength(1);
  });

  it('leaves comments and unrelated lines untouched', () => {
    const source =
      '# a comment that carries the reasoning\n[package]\nname = "kv-store"\nversion = "0.0.1"\n';
    const { text } = detachCargoManifest(
      source,
      WORKSPACE_PACKAGE,
      WORKSPACE_DEPS,
    );
    expect(text).toContain('# a comment that carries the reasoning');
    expect(text).toContain('version = "0.0.1"');
  });
});

describe('planExtendsRewrite', () => {
  const SUBDIR = 'apps/kv-store';

  it('hoists a base config the app reaches out of the repo root for', () => {
    // The real case: apps/kv-store/app/tsconfig.app.json -> repo root.
    expect(
      planExtendsRewrite(
        'app/tsconfig.app.json',
        '../../../tsconfig.base.json',
        SUBDIR,
      ),
    ).toEqual({
      hoistFrom: 'tsconfig.base.json',
      newExtends: '../tsconfig.base.json',
    });
  });

  it('gets the depth right from a nested directory', () => {
    expect(
      planExtendsRewrite(
        'app/e2e/tsconfig.json',
        '../../../../tsconfig.base.json',
        SUBDIR,
      ),
    ).toEqual({
      hoistFrom: 'tsconfig.base.json',
      newExtends: '../../tsconfig.base.json',
    });
  });

  it('leaves a reference that stays inside the app alone', () => {
    expect(
      planExtendsRewrite(
        'app/tsconfig.app.json',
        './tsconfig.base.json',
        SUBDIR,
      ),
    ).toBeNull();
  });

  it('leaves a package specifier alone', () => {
    expect(
      planExtendsRewrite(
        'app/tsconfig.json',
        '@tsconfig/node20/tsconfig.json',
        SUBDIR,
      ),
    ).toBeNull();
  });

  it('gives up on a path that escapes the repository', () => {
    expect(
      planExtendsRewrite(
        'app/tsconfig.json',
        '../../../../../elsewhere.json',
        SUBDIR,
      ),
    ).toBeNull();
  });

  it('handles a tsconfig at the project root', () => {
    expect(
      planExtendsRewrite('tsconfig.json', '../../tsconfig.base.json', SUBDIR),
    ).toEqual({
      hoistFrom: 'tsconfig.base.json',
      newExtends: './tsconfig.base.json',
    });
  });
});

describe('extractTables', () => {
  const ROOT = `[workspace]
resolver = "2"

[profile.app-release]
inherits = "release"
opt-level = "z"

# Selected by \`cargo mero build --profiling\`.
[profile.app-profiling]
inherits = "release"
debug = true

[workspace.dependencies]
thiserror = "1.0.56"
`;

  it('lifts matching tables as literal text', () => {
    const tables = extractTables(ROOT, (n) => n.startsWith('profile.'));
    expect(tables).toHaveLength(2);
    expect(tables[0]).toContain('[profile.app-release]');
    expect(tables[0]).toContain('opt-level = "z"');
    // Must stop at the next header, not swallow the rest of the file.
    expect(tables[1]).not.toContain('thiserror');
  });

  it('keeps the comment written above a table with it', () => {
    const tables = extractTables(ROOT, (n) => n === 'profile.app-profiling');
    expect(tables[0]).toContain('Selected by');
  });

  it('returns nothing when no table matches', () => {
    expect(extractTables(ROOT, (n) => n === 'nope')).toEqual([]);
  });
});

describe('detachCargoManifest + profiles', () => {
  const PROFILES = [
    '[profile.app-release]\ninherits = "release"\nopt-level = "z"',
    '[profile.app-profiling]\ninherits = "release"\ndebug = true',
  ];

  it('carries workspace profiles into the detached crate', () => {
    // `cargo mero build` refuses to run without [profile.app-release], and a
    // profile outside the workspace root is ignored — the crate is the root now.
    const { text } = detachCargoManifest(
      '[package]\nname = "kv-store"\n',
      new Map(),
      new Map(),
      PROFILES,
    );
    expect(text).toContain('[profile.app-release]');
    expect(text).toContain('[profile.app-profiling]');
    expect(text).toContain('opt-level = "z"');
  });

  it('does not duplicate a profile the crate already defines', () => {
    const { text } = detachCargoManifest(
      '[package]\nname = "kv-store"\n\n[profile.app-release]\nopt-level = 3\n',
      new Map(),
      new Map(),
      PROFILES,
    );
    // Anchored to a line start: the explanatory comment this adds mentions
    // [profile.app-release] in prose, which a bare substring count would
    // mistake for a second table.
    expect(text.match(/^\[profile\.app-release\]$/gm)).toHaveLength(1);
    expect(text).toContain('opt-level = 3');
    expect(text).toMatch(/^\[profile\.app-profiling\]$/m);
  });

  it('adds nothing when there are no workspace profiles', () => {
    const { text } = detachCargoManifest(
      '[package]\nname = "kv-store"\n',
      new Map(),
      new Map(),
      [],
    );
    expect(text).not.toContain('[profile.');
  });
});

describe('parseLockedVersions', () => {
  const LOCK = `lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      typescript:
        specifier: 'catalog:'
        version: 5.8.3

  apps/kv-store/app:
    dependencies:
      '@calimero-network/mero-react':
        specifier: 'catalog:'
        version: 6.0.4(react-dom@19.2.8(react@19.2.8))(react@19.2.8)
      react:
        specifier: 'catalog:'
        version: 19.2.8
    devDependencies:
      '@calimero-network/abi-codegen':
        specifier: 'catalog:'
        version: 1.2.2
      shared-thing:
        specifier: workspace:*
        version: link:../../../packages/shared

  apps/other/app:
    dependencies:
      react:
        specifier: 'catalog:'
        version: 18.0.0
`;

  it('reads the exact versions for the requested importer only', () => {
    const locked = parseLockedVersions(LOCK, 'apps/kv-store/app');
    expect(locked.get('react')).toBe('19.2.8');
    // The whole point: 1.2.2, not whatever ^1.2.2 floats to today.
    expect(locked.get('@calimero-network/abi-codegen')).toBe('1.2.2');
  });

  it('stops at the next importer', () => {
    // apps/other/app pins react 18; leaking into it would pin the wrong major.
    expect(parseLockedVersions(LOCK, 'apps/kv-store/app').get('react')).toBe(
      '19.2.8',
    );
  });

  it('strips peer-dependency suffixes', () => {
    expect(
      parseLockedVersions(LOCK, 'apps/kv-store/app').get(
        '@calimero-network/mero-react',
      ),
    ).toBe('6.0.4');
  });

  it('skips a workspace link, which cannot follow the app out', () => {
    expect(
      parseLockedVersions(LOCK, 'apps/kv-store/app').has('shared-thing'),
    ).toBe(false);
  });

  it('returns empty for an importer that is not there', () => {
    expect(parseLockedVersions(LOCK, 'apps/nope/app').size).toBe(0);
  });
});

describe('resolveCatalogSpecifiers with a lockfile', () => {
  it('prefers the locked version over the catalog range', () => {
    const pkg = {
      devDependencies: { '@calimero-network/abi-codegen': 'catalog:' },
    };
    resolveCatalogSpecifiers(
      pkg,
      new Map([['@calimero-network/abi-codegen', '^1.2.2']]),
      new Map([['@calimero-network/abi-codegen', '1.2.2']]),
    );
    // ^1.2.2 would float to 1.3.0, which generates a client the app code in
    // the template does not compile against.
    expect(pkg.devDependencies['@calimero-network/abi-codegen']).toBe('1.2.2');
  });

  it('falls back to the catalog range when the lockfile has no entry', () => {
    const pkg = { dependencies: { react: 'catalog:' } };
    resolveCatalogSpecifiers(pkg, new Map([['react', '^19.2.8']]), new Map());
    expect(pkg.dependencies.react).toBe('^19.2.8');
  });
});
