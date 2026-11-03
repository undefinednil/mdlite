# Development

## Prerequisites

- Node.js `^20.19.0` or `>=22.12.0`.
- Rust 1.77 or newer with `rustup`.
- macOS: Xcode command line tools.
- Windows: Visual Studio Build Tools with the C++ workload, and WebView2 (preinstalled on Windows 10 and 11).

Use npm. The repository has a `package-lock.json` and the scripts assume npm. The declared library versions are in [Tech stack](tech-stack.md). Repo code conventions and the full definition of done are in [AGENTS.md](../AGENTS.md).

## Run the app

```bash
npm install
npm run dev
```

`npm run dev` starts Vite on port 5173 and opens the Tauri window against it. Edits to the React code reload in place. Rust changes rebuild and restart the app.

Build the front end only:

```bash
npm run build
```

Build a release bundle:

```bash
npm run bundle
```

On macOS the result is `src-tauri/target/release/bundle/macos/mdlite.app`. On Windows it is an NSIS installer.

## Build for Windows

Windows builds must run on Windows; Tauri does not cross-compile.

1. Install the [Visual Studio Build Tools](https://visualstudio.microsoft.com/vs/features/cplusplus/) with the "Desktop development with C++" workload. This provides the linker and resource compiler Rust needs; you do not write any C or C++.
2. Install Rust from [rustup.rs](https://rustup.rs) with the MSVC toolchain, and Node.js `^20.19.0` or `>=22.12.0`.
3. Run `npm ci`, then `npm run bundle` or `npm run bundle:win`.

The installer lands in `src-tauri/target/release/bundle/nsis/mdlite_0.1.0_x64-setup.exe`. WebView2 is preinstalled on Windows 10 and 11. The CI workflow builds the same installer on `windows-latest`, so a tag produces a Windows installer without a Windows machine.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Tauri development window with hot reload |
| `npm run build` | Production build of the front end into `dist/` (no type check) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Runs the TypeScript test files listed in `package.json`: paths, scroll, shortcuts, vimrc, vim, keyboard and editorKeys |
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
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

`npm run build` does not typecheck. Run both.

`npm test` runs a fixed file list from `package.json`:

- `paths.test.ts` covers path helpers and remapping.
- `scroll.test.ts` covers smooth-scroller accumulation and clamping.
- `shortcuts.test.ts` covers the shortcut catalogue, binding parser and matcher.
- `vimrc.test.ts` covers vimrc parsing.
- `vim.test.ts` covers Vim clipboard registers.
- `keyboard.test.ts` covers the app-level shortcut guard.
- `editorKeys.test.ts` covers editor key handling with `jsdom`.

A new `src/lib/*.test.ts` does not run until you add it to the `test` script. `tsx` runs the TypeScript test files.

Rust tests live in `#[cfg(test)] mod tests` inside the module they cover and use a fresh temp directory per test. They cover the path jail, tree walking, file conflicts, file operations, trash naming and listings, uploads, config repair and the search fallback. Add one for a new path rule, file operation or config rule.

React screens are checked by typecheck, the production bundle and the packaged self-test.

A Windows-target type check is optional:

```bash
rustup target add x86_64-pc-windows-msvc
cargo check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
```

This catches target-specific code errors but does not produce an installer. Build the real Windows bundle on Windows; see [Build for Windows](#build-for-windows). If the check needs a resource compiler, install LLVM (`brew install llvm` on macOS).

## Self-test

The self-test runs inside a packaged build and writes a JSON report. It is useful after changing the Tauri commands, the asset protocol, the dialogs or the initial screen.

1. Build with the flag:

   ```bash
   VITE_MDLITE_SELFTEST=1 npx tauri build --bundles app
   ```

2. Create a throwaway vault with at least one text file and one image. The image makes the `assetImage` check load a real file; without one it reports `no images in root`. Never point the test at a real vault.

   ```bash
   mkdir -p /tmp/mdlite-selftest-vault
   printf '# self-test\n' > /tmp/mdlite-selftest-vault/note.md
   cp /path/to/any.png /tmp/mdlite-selftest-vault/image.png
   ```

3. Run the packaged app with the throwaway config and root:

   ```bash
   MDLITE_CONFIG=/tmp/mdlite-selftest.json \
   MDLITE_ROOT=/tmp/mdlite-selftest-vault \
   ./src-tauri/target/release/bundle/macos/mdlite.app/Contents/MacOS/mdlite
   ```

4. Read `/tmp/mdlite-selftest-vault/temp/__selftest.json`. `runSelfTest` calls `info`, `tree`, then `read` and `rawUrl` only when the tree has a file, `grep`, `assetImage`, `settings`, `vimrc`, `write`, `dialogs`, and a `ui` block with tree rows, folder rows and the brand text.

5. Quit the app, delete the temporary vault and rebuild without the flag:

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

If macOS keeps showing an old Dock icon, see [Troubleshooting: old icon](troubleshooting.md#the-dock-or-app-window-still-shows-the-old-icon).

## Release

- The bundle is ad-hoc signed (`bundle.macOS.signingIdentity` is `-`). It runs locally without a prompt because nothing marks it as downloaded. Copying it to another Mac requires right-click, Open once, or a Developer ID signature and notarization.
- `bundle:dmg` drives Finder through AppleScript, so it needs a signed-in desktop session.
- The Windows installer is built on Windows; see [Build for Windows](#build-for-windows).

## CI

`.github/workflows/desktop.yml` runs on a `v*` tag or manual dispatch.

- The `windows` job runs on `windows-latest`: `npm ci`, `npm run typecheck`, `npm test`, `cargo test --manifest-path src-tauri/Cargo.toml`, then `npm run bundle:win`. It uploads the NSIS output and any MSI output.
- The `macos` job runs on `macos-latest` with the same test steps, then `npm run bundle:mac`. It uploads the `.app`.

There is no lint step; typecheck and tests are the gate.

## Environment variables

| Variable | Effect |
|---|---|
| `MDLITE_CONFIG` | Path to the config file instead of `~/.config/mdlite/mdlite.json`; also skips the legacy import |
| `MDLITE_ROOT` | Root folder used to seed the config when it does not exist |
| `VITE_MDLITE_SELFTEST` | Build-time flag; `1` enables the self-test import |

## Code map

See [Architecture: front-end layout](architecture.md#front-end-layout) and [Architecture: Rust layout](architecture.md#rust-layout) for the file lists. Two rules:

- Put every disk operation behind a Tauri command and expose it through `src/api.ts`. Do not call `invoke` from components.
- Keep paths inside `safe_join`. A new file operation takes a root-relative path, not an absolute path.

Generated output lives in `dist/`, `src-tauri/target/` and `src-tauri/gen/`; all three are git-ignored.
