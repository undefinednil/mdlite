# Development

## Prerequisites

- Node.js `^20.19.0` or `>=22.12.0`.
- Rust 1.77 or newer with `rustup`.
- macOS: Xcode command line tools.
- Windows: Visual Studio Build Tools with the C++ workload, and WebView2 (preinstalled on Windows 10 and 11).

Use npm. The repository has a `package-lock.json` and the scripts assume npm.

## Run the app

```bash
npm install
npm run dev
```

`npm run dev` starts Vite on port 5173 and opens the Tauri window against it. Edits to the React code reload in place. Rust changes rebuild and restart the app.

Build a release bundle:

```bash
npm run bundle
```

On macOS the result is `src-tauri/target/release/bundle/macos/mdlite.app`. On Windows it is an NSIS installer.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Tauri development window with hot reload |
| `npm run build` | Production build of the front end into `dist/` (no type check) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run icons` | Rebuild the app icon, platform icon set and sidebar logo |
| `npm run bundle` | Release bundle for the current platform |
| `npm run bundle:mac` | macOS `.app` |
| `npm run bundle:dmg` | macOS `.dmg`; needs a signed-in desktop session |
| `npm run bundle:win` | Windows NSIS installer; run on Windows |
| `npm run bundle:win:msi` | Windows MSI; run on Windows |

`scripts/bundle.mjs` forwards the target to `tauri build --bundles`. With no argument it picks `app` on macOS, `nsis` on Windows and `deb` on Linux.

## Checks

Run these before calling a change done:

```bash
npm run typecheck
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

The Rust tests cover the path jail, tree walking, file conflicts, file operations, uploads and the search fallback. The front-end checks are TypeScript and the production bundle; there is no unit test runner for React.

A Windows-target type check is optional:

```bash
rustup target add x86_64-pc-windows-msvc
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
```

This catches target-specific code errors but does not produce an installer. Build the real Windows bundle on Windows. If the check needs a resource compiler, install LLVM (`brew install llvm` on macOS).

## Self-test

The self-test runs inside a packaged build and writes a JSON report. It is useful after changing the Tauri commands, the asset protocol, the dialogs or the initial screen.

1. Build with the flag:

   ```bash
   VITE_MDLITE_SELFTEST=1 npx tauri build --bundles app
   ```

2. Point it at a throwaway folder, not your real vault. The test writes `temp/__selftest.json` inside the root.

   ```bash
   mkdir -p /tmp/mdlite-selftest-vault
   MDLITE_CONFIG=/tmp/mdlite-selftest.json \
   MDLITE_ROOT=/tmp/mdlite-selftest-vault \
   ./src-tauri/target/release/bundle/macos/mdlite.app/Contents/MacOS/mdlite
   ```

3. Read `/tmp/mdlite-selftest-vault/temp/__selftest.json`. It should contain `info`, `tree`, `read`, `rawUrl`, `grep`, `assetImage`, `settings`, `vimrc`, `write`, `dialogs` and a `ui` block with tree rows and the brand text.

4. Quit the app, delete the temporary vault and rebuild without the flag:

   ```bash
   npm run bundle
   ```

The flag is read at build time. A normal `npm run bundle` does not include the self-test import.

## Icons

The source artwork is `src-tauri/icon_base.png`.

`npm run icons` does four things:

1. Trims the artwork and places it on a white rounded card, written to `src-tauri/app-icon.png`.
2. Writes a 128 px preview to `src-tauri/app-icon-128.png`.
3. Keys the white background out of the same artwork and writes a transparent `src/assets/logo.png` used in the sidebar.
4. Runs `npx tauri icon` to generate `src-tauri/icons/`, then deletes the platform files the bundle does not use.

The bundle config references only `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns` and `icon.ico`.

If macOS keeps showing an old Dock icon:

```bash
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f src-tauri/target/release/bundle/macos/mdlite.app
touch src-tauri/target/release/bundle/macos/mdlite.app
```

You may also need to remove the app from the Dock and add it again.

## Release

- The bundle is unsigned. It runs locally without a prompt because nothing marks it as downloaded. Copying it to another Mac requires right-click, Open, or a Developer ID signature and notarization.
- `bundle:dmg` drives Finder through AppleScript, so it needs a signed-in desktop session.
- `.github/workflows/desktop.yml` runs on a `v*` tag or by manual dispatch. It builds on `macos-latest` and `windows-latest` and uploads both bundles.

## Environment variables

| Variable | Effect |
|---|---|
| `MDLITE_CONFIG` | Path to the config file instead of `~/.config/mdlite/mdlite.json` |
| `MDLITE_ROOT` | Root folder used to seed the config when it does not exist |
| `VITE_MDLITE_SELFTEST` | Build-time flag; `1` enables the self-test import |

## Code map

See [Architecture](architecture.md#front-end-layout) for the front-end and Rust file lists. The two rules worth repeating:

- Put every disk operation behind a Tauri command and expose it through `src/api.ts`. Do not call `invoke` from components.
- Keep paths inside `safe_join`. Any new file operation should take a root-relative path, not an absolute path.

Generated output lives in `dist/`, `src-tauri/target/` and `src-tauri/gen/`; all three are git-ignored.
