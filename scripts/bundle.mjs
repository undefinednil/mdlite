import { spawn } from 'node:child_process'

const overrides = new Set(['app', 'dmg', 'nsis', 'msi', 'deb', 'rpm', 'appimage'])
const requested = process.argv[2]

const bundle =
  requested && overrides.has(requested)
    ? requested
    : process.platform === 'win32'
      ? 'nsis'
      : process.platform === 'darwin'
        ? 'app'
        : 'deb'

console.log(`building desktop bundle: ${bundle} (${process.platform})`)

const child = spawn('npx', ['tauri', 'build', '--bundles', bundle], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 1))
