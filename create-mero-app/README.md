# create-mero-app

Scaffold a Calimero KV Store demo app by cloning `calimero-network/kv-store` and copying its files (Git artifacts excluded).

## Prerequisites
- Node.js >= 18
- git installed and available in PATH
- pnpm (recommended)

## Usage

Using npx (recommended):
```bash
npx create-mero-app@latest example-app
```

From a local checkout:
```bash
pnpm --filter create-mero-app build
node create-mero-app/dist/cli.mjs example-app
```

This will:
- Clone `https://github.com/calimero-network/kv-store` to a temp directory
- Copy contents into `my-kv-store` (excluding `.git`, `.github`, `.gitignore`, `.gitattributes`, `.gitmodules`, `node_modules`)
- Set the generated `package.json` name to `my-kv-store` if present

## Next steps
```bash
cd my-kv-store
pnpm install
cd logic && chmod +x ./build.sh && ./build.sh
cd ../app && pnpm build && pnpm dev
```
Open the app and connect to your running node. For more details, see the original repository docs: https://github.com/calimero-network/kv-store

## License
This tool clones an external repository; refer to that repository's license for app code. The CLI itself is licensed under the same license as this repository.
