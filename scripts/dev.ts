import { spawn } from 'node:child_process'

const server = spawn('npx', ['tsx', 'watch', 'server/index.ts'], {
  stdio: 'inherit',
  env: { ...process.env, MDLITE_DEV: '1' },
})

const vite = spawn('npx', ['vite'], { stdio: 'inherit' })

const shutdown = () => {
  server.kill()
  vite.kill()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

await Promise.race([
  new Promise((resolve) => server.on('exit', resolve)),
  new Promise((resolve) => vite.on('exit', resolve)),
])
shutdown()
process.exit(0)
