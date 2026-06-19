const { spawn } = require('child_process')
const http = require('http')

const URLS = [
  'http://localhost:5173',
  'http://localhost:5174/health',
]
const TIMEOUT = 60000
const INTERVAL = 500

function check(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => resolve(res.statusCode < 500)).on('error', () => resolve(false))
  })
}

async function waitAll() {
  const start = Date.now()
  while (Date.now() - start < TIMEOUT) {
    const results = await Promise.all(URLS.map(check))
    if (results.every(Boolean)) return true
    await new Promise((r) => setTimeout(r, INTERVAL))
  }
  return false
}

waitAll().then((ok) => {
  if (!ok) { console.error('Timeout esperando servicios'); process.exit(1) }
  const electron = spawn('npx', ['electron', '.'], { stdio: 'inherit', shell: true })
  electron.on('exit', (code) => process.exit(code ?? 0))
})
