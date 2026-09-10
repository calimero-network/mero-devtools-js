# create-mero-app

Scaffold a Calimero app from the KV Store reference app: a Rust/WASM contract
with a React frontend and a typed client generated from the contract's own ABI.

## Prerequisites

- Node.js >= 18
- git in PATH
- pnpm (recommended)
- For the contract: Rust, and [`cargo-mero`](https://github.com/calimero-network/core)

## Usage

```bash
npx create-mero-app@latest example-app
```

From a local checkout:

```bash
pnpm --filter create-mero-app build
node create-mero-app/dist/cli.mjs example-app
```

There is one template, `rust`, and it is the default — `--template rust` is
accepted but never necessary.

## Where the template comes from

`apps/kv-store` in
[calimero-network/apps](https://github.com/calimero-network/apps).

It is a directory inside a monorepo, not a repository of its own. The standalone
`calimero-network/kv-store` and `calimero-network/kv-store-js` repos this CLI
used to clone were archived when every app moved into that monorepo.

There is no `javascript` template any more: `kv-store-js` was archived with no
replacement. For a JavaScript contract, see the examples in
[calimero-sdk-js](https://github.com/calimero-network/calimero-sdk-js).

## What it does

1. Validates the project name as an npm package name, and refuses a non-empty
   existing directory.
2. Sparse-checks-out `apps/kv-store` into a temp directory. Cone mode also
   materializes the repo-root files, which step 4 needs.
3. Copies the app in, excluding `.git`, `.github`, `.gitignore`,
   `.gitattributes`, `.gitmodules`, and `node_modules`.
4. Detaches it from the monorepo (below).
5. Writes a project root — `package.json`, `pnpm-workspace.yaml`, and a README
   with the standalone commands.

### Detaching from the monorepo

An app in `apps` is deliberately not self-contained: shared versions live at the
repo root so that one edit moves the whole fleet. Copying the directory alone
would produce a project that can neither install nor build, so four kinds of
inherited reference are resolved against the checkout they came from:

| Inherited                              | Resolved from             | Becomes                            |
| -------------------------------------- | ------------------------- | ---------------------------------- |
| `"react": "catalog:"`                  | `pnpm-workspace.yaml`     | a concrete version                 |
| `edition.workspace = true`             | root `Cargo.toml`         | the concrete value                 |
| `calimero-sdk.workspace = true`        | root `Cargo.toml`         | the pinned git dependency          |
| `extends: ../../../tsconfig.base.json` | root `tsconfig.base.json` | the file, hoisted into the project |

Plus two things the app relied on the workspace root to provide: the
`[profile.app-release]` / `[profile.app-profiling]` tables (`cargo mero build`
refuses to run without the first, and cargo only honours a profile in the
workspace root), and a `[workspace]` table of the crate's own — without it cargo
searches parent directories and either fails or adopts an unrelated workspace
above your project.

Frontend versions are pinned to the exact ones in the source repo's lockfile,
not to the catalog's ranges, so a new project starts on the combination upstream
actually builds and tests. This is not theoretical: `@calimero-network/abi-codegen`
is catalogued as `^1.2.2`, and 1.3.0 dropped a parameter from the constructor it
generates — scaffolding from the range gave a project whose first `pnpm codegen`
produced a client its own app code no longer compiled against.

Nothing is hardcoded in this CLI. The values come from the commit that was
cloned, so a core bump or a frontend release in `apps` reaches newly scaffolded
projects on its own.

> **A scaffolded project does not track the template.** Versions are pinned at
> scaffold time and the project upgrades on its own schedule from then on. It is
> a starting point, not a live link to `apps`.

## Next steps

```bash
cd example-app
pnpm install
pnpm logic:build      # cargo mero build → logic/res/*.wasm + abi.json
pnpm codegen          # regenerate the typed client from that ABI
pnpm dev              # http://localhost:5173
```

`create-mero-app` does **not** run `git init`, and the scaffolded directory has
no `.git` — initialise version control yourself.

## License

The scaffolded app is copied from `calimero-network/apps`; refer to that
repository for its license. The CLI itself is licensed under the same license as
this repository.
