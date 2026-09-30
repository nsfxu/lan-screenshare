// Compiles the Windows helpers in native/<name>/Program.cs to
// native/bin/<name>.exe with the C# compiler that ships with .NET Framework 4
// on every Windows 10/11 machine:
//   - win-audio-capture: WASAPI loopback (surround devices, all audio except Discord)
//   - win-cursor-watch:  reports when a game hides the mouse cursor
// No-op on other platforms and for binaries that are already up to date.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

if (process.platform !== 'win32') process.exit(0)

const root = path.join(__dirname, '..')
const outDir = path.join(root, 'native', 'bin')
const helpers = ['win-audio-capture', 'win-cursor-watch']

const windir = process.env.WINDIR || 'C:\Windows'
const csc = ['Framework64', 'Framework']
  .map((fw) => path.join(windir, 'Microsoft.NET', fw, 'v4.0.30319', 'csc.exe'))
  .find((p) => fs.existsSync(p))

for (const name of helpers) {
  const source = path.join(root, 'native', name, 'Program.cs')
  const output = path.join(outDir, `${name}.exe`)
  if (fs.existsSync(output) && fs.statSync(output).mtimeMs >= fs.statSync(source).mtimeMs) continue
  if (!csc) {
    console.warn(`[native] csc.exe not found; ${name} will be unavailable`)
    continue
  }
  fs.mkdirSync(outDir, { recursive: true })
  moveAsideIfRunning(output)
  execFileSync(csc, ['/nologo', '/target:exe', '/optimize+', '/platform:anycpu', `/out:${output}`, source], {
    stdio: 'inherit'
  })
  console.log(`[native] built ${path.relative(root, output)}`)
}

/**
 * A running helper (another instance of the app) locks its .exe, but Windows
 * lets it be renamed: move it aside so the new build can be written. Old
 * copies are deleted once they are no longer running.
 */
function moveAsideIfRunning(file) {
  for (const old of fs.readdirSync(path.dirname(file)).filter((n) => n.endsWith('.old'))) {
    try {
      fs.unlinkSync(path.join(path.dirname(file), old))
    } catch {
      // still running
    }
  }
  if (!fs.existsSync(file)) return
  try {
    fs.unlinkSync(file)
  } catch {
    fs.renameSync(file, `${file}.${Date.now()}.old`)
  }
}
