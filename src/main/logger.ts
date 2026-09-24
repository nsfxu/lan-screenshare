import fs from 'node:fs'
import path from 'node:path'
import { format } from 'node:util'
import type { Logger } from './server'

const MAX_LOG_BYTES = 5 * 1024 * 1024

export interface FileLogger extends Logger {
  readonly dir: string
  readonly file: string
}

/**
 * Minimal rotating file logger. Logs live in the platform log directory:
 * %APPDATA%\ScreenShare\logs on Windows, ~/Library/Logs/ScreenShare on macOS.
 */
export function createFileLogger(dir: string, echo: boolean): FileLogger {
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'screenshare.log')
  try {
    if (fs.statSync(file).size > MAX_LOG_BYTES) fs.renameSync(file, path.join(dir, 'screenshare.old.log'))
  } catch {
    // no previous log
  }
  const stream = fs.createWriteStream(file, { flags: 'a' })
  stream.on('error', () => {})

  const write = (level: string, msg: string, args: unknown[]): void => {
    const line = `${new Date().toISOString()} [${level}] ${format(msg, ...args)}\n`
    stream.write(line)
    if (echo) process.stdout.write(line)
  }

  return {
    dir,
    file,
    debug: (msg, ...args) => write('debug', msg, args),
    info: (msg, ...args) => write('info', msg, args),
    warn: (msg, ...args) => write('warn', msg, args),
    error: (msg, ...args) => write('error', msg, args)
  }
}
