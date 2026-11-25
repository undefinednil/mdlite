import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = process.cwd()
const target = process.env.CARGO_TARGET_DIR
  ? path.resolve(process.env.CARGO_TARGET_DIR)
  : path.join(root, 'src-tauri', 'target')

const bundle =
  process.platform === 'win32' ? 'nsis' : process.platform === 'darwin' ? 'app' : 'deb'
const binary =
  process.platform === 'darwin'
    ? path.join(target, 'release', 'bundle', 'macos', 'mdlite.app', 'Contents', 'MacOS', 'mdlite')
    : process.platform === 'win32'
      ? path.join(target, 'release', 'mdlite.exe')
      : path.join(target, 'release', 'mdlite')

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options })
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))))
  })

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function build() {
  if (process.env.MDLITE_E2E_SKIP_BUILD === '1' && fs.existsSync(binary)) {
    console.log('e2e: using the existing packaged build')
    return
  }
  console.log(`e2e: building the packaged app (${bundle})`)
  await run('npx', ['tauri', 'build', '--bundles', bundle], {
    env: { ...process.env, VITE_MDLITE_SELFTEST: '1' },
  })
}

async function main() {
  await build()
  if (!fs.existsSync(binary)) throw new Error(`packaged app not found: ${binary}`)

  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'mdlite-e2e-vault-'))
  const config = path.join(os.tmpdir(), `mdlite-e2e-${process.pid}.json`)
  fs.writeFileSync(path.join(vault, 'note.md'), '# e2e note\n')
  const page = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif}</style></head><body><h1>HTML preview</h1>${Array.from({ length: 80 }, (_, index) => `<p>line ${index}</p>`).join('')}<script>document.body.dataset.ready="yes"</script></body></html>`
  fs.writeFileSync(path.join(vault, 'page.html'), page)
  fs.copyFileSync(path.join(root, 'src', 'assets', 'logo.png'), path.join(vault, 'image.png'))

  const log = path.join(os.tmpdir(), `mdlite-e2e-${process.pid}.log`)
  const out = fs.openSync(log, 'w')
  const child = spawn(binary, {
    env: { ...process.env, MDLITE_CONFIG: config, MDLITE_ROOT: vault },
    stdio: ['ignore', out, out],
  })

  // A background webview throttles timers, and the self-test would never finish.
  if (process.platform === 'darwin') {
    await wait(1500)
    await run('osascript', [
      '-e',
      `tell application "System Events" to set frontmost of (first process whose unix id is ${child.pid}) to true`,
    ]).catch(() => undefined)
  }

  const report = path.join(vault, 'temp', '__selftest.json')
  let finished = false
  for (let index = 0; index < 300; index += 1) {
    if (fs.existsSync(report)) {
      const text = fs.readFileSync(report, 'utf8')
      if (text.includes('"finished"')) {
        finished = true
        break
      }
    }
    await wait(1000)
  }

  if (!finished) {
    child.kill('SIGTERM')
    throw new Error(`self-test report did not finish; see ${log}`)
  }

  const data = JSON.parse(fs.readFileSync(report, 'utf8'))
  const checks = Array.isArray(data.shortcuts) ? data.shortcuts : []
  let failed = 0
  for (const check of checks) {
    if (check.pass) {
      console.log(`PASS ${check.id} - ${check.detail}`)
    } else {
      failed += 1
      console.log(`FAIL ${check.id} - ${check.detail}`)
    }
  }

  child.kill('SIGTERM')
  fs.closeSync(out)
  fs.rmSync(vault, { recursive: true, force: true })
  fs.rmSync(config, { force: true })

  if (!checks.length) throw new Error('the self-test report has no shortcut checks')
  if (failed) throw new Error(`${failed} shortcut check(s) failed`)
  console.log(`e2e: ${checks.length}/${checks.length} shortcut checks passed`)
}

main().catch((error) => {
  console.error(`e2e: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
