# Releasing `@calimero-network/abi-codegen`

This package has exactly one release mechanism: **semantic-release**, driven by
the `release` job in `.github/workflows/ci.yml` on pushes to `main`.

## How a release happens

1. Merge conventional-commit work to `main` (`fix:` → patch, `feat:` → minor).
2. CI runs `cd abi-codegen && npx semantic-release`, which:
   - derives the next version from commits since the last `abi-codegen-v*` tag
     (`tagFormat` in `.releaserc.json`),
   - bumps `package.json` (`npm version … --no-git-tag-version` via
     `@semantic-release/exec`),
   - publishes to npm — the `build`/`prepack` scripts copy
     `src/schema/wasm-abi-v1.schema.json` into `dist/schema/`, so the bundled
     schema (shipped data) is always part of the published tarball,
   - creates the `abi-codegen-v<version>` git tag and a GitHub release.

The bundled schema is data consumers depend on. Any schema change therefore
**requires a republish** — land it as a `fix:`/`feat:` commit and the release
job ships it automatically.

## Version baseline

npm `latest` reached `1.0.3` while git tags only reached `abi-codegen-v1.0.1`,
because `1.0.2`/`1.0.3` were published by hand instead of through
semantic-release. To realign, `package.json` is set to `1.0.3` and a baseline
tag `abi-codegen-v1.0.3` is created on the last released commit:

```sh
git tag -a abi-codegen-v1.0.3 -m "Baseline tag for npm 1.0.3" <release-commit>
git push origin abi-codegen-v1.0.3
```

With that tag present, the next semantic-release run computes `1.0.4` (or higher)
and never collides with the already-published `1.0.3`. Push the tag before the
first release after this change.

## Keeping the schema in sync with core

The bundled schema mirrors `core/crates/wasm-abi/wasm-abi.schema.json`. The
cross-repo guards (`__tests__/schema-drift.spec.ts`,
`__tests__/enum-completeness.spec.ts`, `__tests__/corpus.spec.ts`) run on every
PR and fail if it drifts. When core changes, re-vendor the snapshot and commit:

```sh
pnpm run sync:corpus   # node scripts/sync-corpus.mjs
```
