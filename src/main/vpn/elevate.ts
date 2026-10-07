import { execFile, spawn } from 'node:child_process'

/** Single-quotes a value for /bin/sh. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** The text of an AppleScript string literal. */
export function appleScriptString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Single-quotes a value for PowerShell. */
export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** A command line for Windows' CreateProcess: each argument in double quotes. */
export function windowsArgumentString(args: string[]): string {
  return args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ')
}

export interface Elevated {
  /** Resolves if the program ends (Linux, where we hold on to it); never on macOS and Windows. */
  exited: Promise<number | null>
}

const DENIED = 'Administrator permission was not given, so the VPN could not be created'

/**
 * Starts `exe` with administrator rights, asking for the user's permission with the
 * system's own dialog: the authorization prompt on macOS, UAC on Windows, polkit's
 * pkexec on Linux. The program keeps running after this returns. Callers must have
 * checked the program first (verifyHelper): this runs whatever it is given.
 */
export function startElevated(platform: NodeJS.Platform, exe: string, args: string[]): Promise<Elevated> {
  const never = new Promise<number | null>(() => undefined)

  if (platform === 'darwin') {
    const command = `${shQuote(exe)} ${args.map(shQuote).join(' ')} >/dev/null 2>&1 &`
    return run('/usr/bin/osascript', ['-e', `do shell script ${appleScriptString(command)} with administrator privileges`]).then(
      () => ({ exited: never }),
      (err: Error) => Promise.reject(/-128|User canceled/i.test(err.message) ? new Error(DENIED) : err)
    )
  }

  if (platform === 'win32') {
    const script =
      `Start-Process -FilePath ${psQuote(exe)} -ArgumentList ${psQuote(windowsArgumentString(args))} ` +
      '-Verb RunAs -WindowStyle Hidden -ErrorAction Stop'
    return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]).then(
      () => ({ exited: never }),
      (err: Error) => Promise.reject(/cancel/i.test(err.message) ? new Error(DENIED) : err)
    )
  }

  return new Promise((resolve, reject) => {
    const child = spawn('pkexec', [exe, ...args], { stdio: 'ignore' })
    const exited = new Promise<number | null>((done) => child.once('exit', (code) => done(code)))
    child.once('error', (err) =>
      reject((err as NodeJS.ErrnoException).code === 'ENOENT' ? new Error('pkexec (polkit) is needed to ask for the administrator password') : err)
    )
    child.once('spawn', () =>
      resolve({ exited: exited.then((code) => (code === 126 || code === 127 ? Promise.reject(new Error(DENIED)) : code)) })
    )
  })
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 180_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message))
      else resolve(stdout)
    })
  })
}
