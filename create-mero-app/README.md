# create-mero-app

Scaffold a Calimero KV Store demo app with an interactive template selector, by cloning a starter repo and copying its files (Git artifacts excluded).

## Prerequisites
- Node.js >= 18
- git installed and available in PATH
- pnpm (recommended)

## Usage

Using npx (recommended):
```bash
npx create-mero-app@latest example-app
```

You will be prompted to select a backend template (default: Rust):

```text
Select backend template
❯ Rust (kv-store)
  JavaScript (kv-store-js)
```

To skip the prompt, pass `--template`:

```bash
npx create-mero-app@latest example-app --template rust
npx create-mero-app@latest example-app --template javascript
```

From a local checkout:
```bash
pnpm --filter create-mero-app build
node create-mero-app/dist/cli.mjs example-app
```

This will:
- Clone the selected template repo to a temp directory:
  - Rust: `https://github.com/calimero-network/kv-store`
  - JavaScript: `https://github.com/calimero-network/kv-store-js`
- Copy contents into `my-kv-store` (excluding `.git`, `.github`, `.gitignore`, `.gitattributes`, `.gitmodules`, `node_modules`)
- Set the generated `package.json` name to `my-kv-store` if present

## Next steps
```bash
cd my-kv-store
pnpm install
cd logic && chmod +x ./build.sh && ./build.sh
cd ../app && pnpm build && pnpm dev
```
Open the app and connect to your running node. For more details, see the template repository docs:
- Rust: https://github.com/calimero-network/kv-store
- JavaScript: https://github.com/calimero-network/kv-store-js

## License
This tool clones an external repository; refer to that repository's license for app code. The CLI itself is licensed under the same license as this repository.
