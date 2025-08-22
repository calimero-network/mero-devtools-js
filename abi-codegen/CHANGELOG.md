# 1.0.0 (2025-08-22)


### Bug Fixes

* configure semantic-release to avoid version command conflicts ([29578af](https://github.com/calimero-network/mero-devtools-js/commit/29578af3fde9978b7064eda9f7071a6f7dcfe7d9))
* remove @semantic-release/npm plugin entirely to avoid version commands ([0fd7901](https://github.com/calimero-network/mero-devtools-js/commit/0fd79017fff8f3d68396c9101adb9778cbd3ff5b))
* remove npm config command from CI to avoid workspace conflicts ([6b52a17](https://github.com/calimero-network/mero-devtools-js/commit/6b52a17bf120213668cc9798d764cfc4e41bc432))
* replace @semantic-release/npm with semantic-release-pnpm to fix workspace compatibility ([7297999](https://github.com/calimero-network/mero-devtools-js/commit/7297999420d15031111bec5896988842e6118219))
* update CI/CD workflow to use pnpm instead of npm ([ff4b68f](https://github.com/calimero-network/mero-devtools-js/commit/ff4b68f07626cf5c6914f9e91cf98f15be8859b7))
* update tests to match current code generation format ([392be7d](https://github.com/calimero-network/mero-devtools-js/commit/392be7db2da57bffd5abe403b433466a472b63b2))
* use --no-frozen-lockfile for CI/CD compatibility ([10865dc](https://github.com/calimero-network/mero-devtools-js/commit/10865dc6b37c33b3cbc73e318121d2f79acfa1b1))


### Features

* setup npm distribution with semantic releases ([37829b4](https://github.com/calimero-network/mero-devtools-js/commit/37829b42439dc12c53dfa3e97f91549eb18a1d6e))

# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [0.1.0](https://github.com/calimero-network/mero-devtools-js/compare/v0.0.0...v0.1.0) (2024-01-01)

### Features

* Initial release of WASM-ABI v1 parser and code generator
* CLI tool for generating TypeScript clients from ABI manifests
* Programmatic API for custom code generation
* Support for all WASM-ABI v1 data types
* Validation of ABI manifest files
