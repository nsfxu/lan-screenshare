// Compiles native/win-audio-capture (WASAPI loopback helper) with the C#
// compiler that ships with .NET Framework 4 on every Windows 10/11 machine.
// No-op on other platforms and when the binary is already up to date.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

if (process.platform !== 'win32') process.exit(0)

const root = path.join(__dirname, '..')
const source = path.join(root, 'native', 'win-audio-capture', 'Program.cs')
const outDir = path.join(root, 'native', 'bin')
const output = path.join(outDir, 'win-audio-capture.exe')

const windir = process.env.WINDIR || 'C:\\Windows'
const csc = ['Framework64', 'Framework']
  .map((fw) => path.join(windir, 'Microsoft.NET', fw, 'v4.0.30319', 'csc.exe'))
  .find((p) => fs.existsSync(p))

if (fs.existsSync(output) && fs.statSync(output).mtimeMs >= fs.statSync(source).mtimeMs) process.exit(0)
if (!csc) {
  console.warn('[win-audio] csc.exe not found; surround-device audio fallback will be unavailable')
  process.exit(0)
}

fs.mkdirSync(outDir, { recursive: true })
execFileSync(csc, ['/nologo', '/target:exe', '/optimize+', '/platform:anycpu', `/out:${output}`, source], {
  stdio: 'inherit'
})
console.log(`[win-audio] built ${path.relative(root, output)}`)
