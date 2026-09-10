/**
 * Turning a monorepo app into a standalone project.
 *
 * The starter this CLI scaffolds from lives inside `calimero-network/apps`, and
 * an app in that repo is deliberately NOT self-contained: its frontend
 * dependencies are `catalog:` references and its crate inherits
 * `workspace = true` fields, both resolved from files at the repo root. That is
 * the whole point of the monorepo — one edit moves the fleet — but it means a
 * copied directory on its own can neither `pnpm install` nor `cargo build`.
 *
 * Everything here resolves those references against the checkout the files came
 * from, so the values always match the commit that was cloned. Nothing is
 * hardcoded: when `apps` bumps core or a frontend package, a freshly scaffolded
 * project picks the new version up with no change to this CLI.
 */

/** `name = value` pairs lifted out of one table of a TOML file. */
export type TomlTable = Map<string, string>;

/**
 * Read the default `catalog:` block out of a `pnpm-workspace.yaml`.
 *
 * Hand-parsed rather than pulled through a YAML dependency: the block is a flat
 * map of package name to version range, and the alternative is shipping a
 * parser to read six lines. Quoted keys (`"@calimero-network/mero-js"`) and
 * bare ones both occur, and comments and blank lines are interleaved.
 */
export function parseCatalog(yaml: string): Map<string, string> {
  const catalog = new Map<string, string>();
  const lines = yaml.split('\n');

  let inCatalog = false;
  for (const line of lines) {
    if (/^catalog:\s*(#.*)?$/.test(line)) {
      inCatalog = true;
      continue;
    }
    if (!inCatalog) continue;

    // The block ends at the next line that starts in column zero — another
    // top-level key, not a comment or a blank line inside the block.
    if (/^\S/.test(line)) break;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = /^(?:"([^"]+)"|'([^']+)'|([^:\s]+))\s*:\s*(.+?)\s*$/.exec(
      trimmed,
    );
    if (!match) continue;
    const name = match[1] ?? match[2] ?? match[3];
    const version = stripQuotes(match[4]);
    if (name) catalog.set(name, version);
  }

  return catalog;
}

/**
 * Read one top-level table out of a TOML file as raw `name = value` text.
 *
 * Values are kept as the literal source text so an inline table
 * (`{ git = "...", tag = "..." }`) survives untouched — re-serializing through
 * a TOML library would work too, but it would also strip the comments that
 * carry most of the reasoning in these manifests.
 */
export function parseTomlTable(toml: string, table: string): TomlTable {
  const entries: TomlTable = new Map();
  let current: string | null = null;

  for (const raw of toml.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const header = /^\[([^\]]+)\]\s*(#.*)?$/.exec(line);
    if (header) {
      current = header[1].trim();
      continue;
    }
    if (current !== table) continue;

    const match = /^([A-Za-z0-9_.-]+)\s*=\s*(.+?)\s*$/.exec(stripComment(line));
    if (match) entries.set(match[1], match[2].trim());
  }

  return entries;
}

/**
 * Read the versions pnpm actually resolved for one workspace package out of a
 * `pnpm-lock.yaml`.
 *
 * The catalog holds ranges, and a range is not what the monorepo builds and
 * tests against — the lockfile is. Scaffolding from the range alone means a
 * fresh project silently picks up anything newer that matches, which is not
 * hypothetical here: `@calimero-network/abi-codegen` is catalogued as `^1.2.2`,
 * and 1.3.0 dropped a constructor parameter from the client it generates. A
 * project built from the range regenerates a client the app code no longer
 * compiles against, while the monorepo stays green on its locked 1.2.2.
 *
 * Peer suffixes (`6.0.4(react@19.2.8)`) are stripped; a link or a non-registry
 * specifier is skipped, since neither means anything outside the workspace.
 *
 * @param importer path of the package within the workspace, e.g. `apps/kv-store/app`
 */
export function parseLockedVersions(
  lockfile: string,
  importer: string,
): Map<string, string> {
  const locked = new Map<string, string>();
  const lines = lockfile.split('\n');

  const importerHeader = new RegExp(
    `^(\\s*)${importer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*$`,
  );

  let indent: number | null = null;
  let pendingName: string | null = null;

  for (const line of lines) {
    if (indent === null) {
      const start = importerHeader.exec(line);
      if (start) indent = start[1].length;
      continue;
    }

    if (!line.trim()) continue;
    const lineIndent = line.length - line.trimStart().length;
    // Back out to the importer's own level: this block is over.
    if (lineIndent <= indent) break;

    const nameMatch = /^\s*(?:'([^']+)'|"([^"]+)"|([^\s:'"][^:]*)):\s*$/.exec(
      line,
    );
    if (nameMatch) {
      const name = nameMatch[1] ?? nameMatch[2] ?? nameMatch[3];
      // Section headers, not packages.
      pendingName = /^(dependencies|devDependencies|optionalDependencies|peerDependencies)$/.test(
        name,
      )
        ? null
        : name;
      continue;
    }

    const versionMatch = /^\s*version:\s*(.+?)\s*$/.exec(line);
    if (versionMatch && pendingName) {
      const raw = versionMatch[1].trim().replace(/^['"]|['"]$/g, '');
      // `link:`/`file:` resolve to a sibling in the workspace and cannot follow
      // the app out of it.
      if (!/^(link|file):/.test(raw)) {
        locked.set(pendingName, raw.replace(/\(.*\)$/, ''));
      }
      pendingName = null;
    }
  }

  return locked;
}

/**
 * Replace every `catalog:` specifier in a package.json with the version the
 * catalog gives it.
 *
 * A dependency the catalog does not cover is a hard error rather than a
 * passthrough: `catalog:` left in a standalone package.json fails at
 * `pnpm install` with a message that says nothing about where it came from.
 */
export function resolveCatalogSpecifiers(
  pkg: Record<string, unknown>,
  catalog: Map<string, string>,
  /**
   * Exact versions from the source lockfile. Preferred over the catalog range
   * so the scaffold reproduces the combination upstream actually builds.
   */
  locked: Map<string, string> = new Map(),
): { resolved: number; missing: string[] } {
  const DEP_FIELDS = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ];

  let resolved = 0;
  const missing: string[] = [];

  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps || typeof deps !== 'object') continue;

    for (const [name, spec] of Object.entries(deps as Record<string, string>)) {
      if (typeof spec !== 'string' || !spec.startsWith('catalog:')) continue;

      // `catalog:` is the default catalog; `catalog:name` selects a named one.
      const named = spec.slice('catalog:'.length).trim();
      if (named) {
        missing.push(`${name} (named catalog "${named}" is not supported)`);
        continue;
      }

      const exact = locked.get(name);
      const version = exact ?? catalog.get(name);
      if (!version) {
        missing.push(name);
        continue;
      }
      (deps as Record<string, string>)[name] = version;
      resolved += 1;
    }
  }

  return { resolved, missing };
}

/**
 * Rewrite a crate manifest that inherits from a workspace into one that stands
 * on its own.
 *
 * Two inheritance forms appear in these manifests and they need different
 * handling:
 *
 *   edition.workspace = true
 *   calimero-storage = { workspace = true, features = ["testing"] }
 *
 * The second has to MERGE: the workspace value is an inline table, and the
 * local keys (`features`) have to survive alongside it. Dropping them would
 * silently disable a feature the crate's own tests depend on.
 */
/**
 * Lift whole `[...]` tables out of a TOML file as literal source text, comments
 * and all, for tables whose name matches `predicate`.
 */
export function extractTables(
  toml: string,
  predicate: (name: string) => boolean,
): string[] {
  const tables: string[] = [];
  const lines = toml.split('\n');

  let buffer: string[] | null = null;
  // Comments immediately above a table header belong to it.
  let pending: string[] = [];

  const flush = () => {
    if (buffer) tables.push(buffer.join('\n').trimEnd());
    buffer = null;
  };

  for (const line of lines) {
    const header = /^\s*\[([^\]]+)\]\s*(#.*)?$/.exec(line);
    if (header) {
      flush();
      if (predicate(header[1].trim())) {
        buffer = [...pending, line];
      }
      pending = [];
      continue;
    }

    if (buffer) {
      buffer.push(line);
    } else if (/^\s*#/.test(line)) {
      pending.push(line);
    } else if (!line.trim()) {
      pending = [];
    }
  }
  flush();

  return tables;
}

export function detachCargoManifest(
  manifest: string,
  workspacePackage: TomlTable,
  workspaceDependencies: TomlTable,
  /**
   * `[profile.*]` tables from the workspace root.
   *
   * Cargo only honours a profile defined in the workspace root, and `cargo mero
   * build` refuses to run without `[profile.app-release]` — so once this crate
   * becomes its own root, the profiles have to come with it.
   */
  workspaceProfiles: string[] = [],
): { text: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const out: string[] = [];
  let section = '';

  const lookup = (key: string): string | undefined =>
    section === 'package'
      ? workspacePackage.get(key)
      : workspaceDependencies.get(key);

  for (const raw of manifest.split('\n')) {
    const header = /^\s*\[([^\]]+)\]/.exec(raw);
    if (header) section = header[1].trim();

    // Form 1: `key.workspace = true`
    const shorthand = /^(\s*)([A-Za-z0-9_-]+)\.workspace(\s*)=\s*true\s*$/.exec(
      raw,
    );
    if (shorthand) {
      const [, indent, key] = shorthand;
      const value = lookup(key);
      if (value === undefined) {
        unresolved.push(key);
        out.push(raw);
      } else {
        out.push(`${indent}${key} = ${value}`);
      }
      continue;
    }

    // Form 2: `key = { workspace = true, ...extras }`
    const inline =
      /^(\s*)([A-Za-z0-9_-]+)\s*=\s*\{\s*workspace\s*=\s*true\s*(?:,\s*(.*?))?\s*\}\s*$/.exec(
        raw,
      );
    if (inline) {
      const [, indent, key, extras] = inline;
      const value = lookup(key);
      if (value === undefined) {
        unresolved.push(key);
        out.push(raw);
      } else {
        out.push(`${indent}${key} = ${mergeInline(value, extras)}`);
      }
      continue;
    }

    out.push(raw);
  }

  let text = out.join('\n');

  // Carry over any profile the crate does not already define. Cargo ignores a
  // `[profile.*]` outside the workspace root and warns; the crate is the root
  // now, so this is where they have to live.
  const missingProfiles = workspaceProfiles.filter((table) => {
    const name = /^\s*\[([^\]]+)\]/m.exec(table)?.[1]?.trim();
    return (
      name &&
      !new RegExp(`^\\s*\\[${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'm').test(
        text,
      )
    );
  });

  if (missingProfiles.length) {
    text =
      text.trimEnd() +
      '\n\n' +
      '# Build profiles carried over from the workspace this crate came out of.\n' +
      '# Cargo only honours a profile defined in the workspace root, and\n' +
      '# `cargo mero build` refuses to run without `[profile.app-release]`.\n' +
      missingProfiles.join('\n\n') +
      '\n';
  }

  // Without its own `[workspace]` the extracted crate is not a workspace root,
  // so cargo walks up the filesystem looking for one and fails — or, worse,
  // finds an unrelated manifest above the scaffold directory and adopts it.
  if (!/^\s*\[workspace\]/m.test(text)) {
    text =
      text.trimEnd() +
      '\n\n' +
      '# This crate came out of a monorepo and is its own workspace root now.\n' +
      "# Without this table cargo searches parent directories for a workspace and\n" +
      '# fails, or silently adopts an unrelated one above the project directory.\n' +
      '[workspace]\n';
  }

  return { text, unresolved };
}

/**
 * Work out what to do with one `"extends"` that points outside the app.
 *
 * The app's tsconfigs extend a `tsconfig.base.json` at the monorepo root. Copy
 * the directory on its own and that path resolves to nothing — and TypeScript
 * does not stop there: a missing `extends` leaves it on its built-in defaults,
 * so `target` silently drops to ES3 and the build fails with a wall of errors
 * about private identifiers and top-level await that say nothing about the real
 * cause. The base config has to be hoisted into the project and the path fixed.
 *
 * Returns null when the reference stays inside the app (nothing to do) or
 * escapes the repository altogether (nothing that can be done).
 *
 * @param fileRelPath  tsconfig location relative to the project root, e.g. `app/tsconfig.app.json`
 * @param extendsValue the raw `"extends"` string
 * @param subdir       the app's directory within the repo, e.g. `apps/kv-store`
 */
export function planExtendsRewrite(
  fileRelPath: string,
  extendsValue: string,
  subdir: string,
): { hoistFrom: string; newExtends: string } | null {
  // Only relative paths can escape; a package specifier resolves through
  // node_modules and is the app's own dependency.
  if (!extendsValue.startsWith('.')) return null;

  const posix = (p: string) => p.split('\\').join('/');
  const dirOf = (p: string) => {
    const parts = posix(p).split('/');
    parts.pop();
    return parts.join('/');
  };
  const normalize = (p: string): string => {
    const out: string[] = [];
    for (const segment of p.split('/')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        if (out.length && out[out.length - 1] !== '..') out.pop();
        else out.push('..');
      } else out.push(segment);
    }
    return out.join('/');
  };

  const fileDir = dirOf(posix(fileRelPath));
  const originalDir = normalize(`${posix(subdir)}/${fileDir}`);
  const resolved = normalize(`${originalDir}/${posix(extendsValue)}`);

  // Escaped the repository root entirely — out of reach.
  if (resolved.startsWith('..')) return null;
  // Still inside the app directory, so it came along with the copy.
  if (resolved === posix(subdir) || resolved.startsWith(`${posix(subdir)}/`))
    return null;

  const basename = resolved.split('/').pop() as string;
  const depth = fileDir ? fileDir.split('/').length : 0;
  const prefix = depth ? '../'.repeat(depth) : './';

  return { hoistFrom: resolved, newExtends: `${prefix}${basename}` };
}

/** Fold a local `features = [...]` into an inherited inline table or version. */
function mergeInline(workspaceValue: string, extras?: string): string {
  const trimmedExtras = extras?.trim();
  if (!trimmedExtras) return workspaceValue;

  if (workspaceValue.startsWith('{') && workspaceValue.endsWith('}')) {
    const inner = workspaceValue.slice(1, -1).trim().replace(/,\s*$/, '');
    return `{ ${inner}, ${trimmedExtras} }`;
  }

  // A plain version string has to become a table before extras can attach.
  return `{ version = ${workspaceValue}, ${trimmedExtras} }`;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Drop a trailing `# comment`, but only when the `#` is outside a quoted
 * string — `repository = "https://example.com/#x"` must survive intact.
 */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#') {
      return line.slice(0, i).trim();
    }
  }
  return line.trim();
}
