import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SettingsStore } from '../src/main/settings'
import { formatDiagnostics, lastLines, redactSecrets, reportableSettings, type Diagnostics } from '../src/shared/diagnostics'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function settings() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenshare-diag-'))
  dirs.push(dir)
  return new SettingsStore(dir).update({ displayName: 'Giu', avatar: 'data:image/jpeg;base64,AAAA' })
}

function report(logTail = ''): Diagnostics {
  return {
    app: { version: '2.6.0', protocol: 4, electron: '44.4.5', chrome: '142.0', node: '22.1', packaged: true },
    os: { platform: 'darwin', version: '26.3', release: '25.3.0', arch: 'arm64', cpu: 'Apple M4', cores: 10, memoryGB: 16 },
    gpu: { devices: ['106b:0000 (active)'], features: { video_decode: 'enabled', video_encode: 'enabled' } },
    network: [{ name: 'en0', address: '192.168.1.20' }],
    settings: settings(),
    logTail,
    encoders: [{ mimeType: 'video/H264', hardware: true }, { mimeType: 'video/VP9', hardware: false }],
    decoders: []
  }
}

describe('diagnostics', () => {
  it('reports the settings without our client id or the picture itself', () => {
    const s = settings()
    const out = reportableSettings(s)
    expect(out).not.toHaveProperty('clientId')
    expect(out.avatar).toBe('set')
    expect(out.displayName).toBe('Giu')
    expect(reportableSettings({ ...s, avatar: null }).avatar).toBe('none')
  })

  it('hides anything in the log that looks like a secret', () => {
    expect(redactSecrets('joined with pin=123456 ok')).toBe('joined with pin=[hidden] ok')
    expect(redactSecrets('{"hostToken":"abc.def","name":"x"}')).toBe('{"hostToken":"[hidden]","name":"x"}')
    expect(redactSecrets('resumeToken: q1w2e3; next')).toBe('resumeToken: [hidden]; next')
    expect(redactSecrets('Password=hunter2')).toBe('Password=[hidden]')
    // Words that only contain the key aren't touched.
    expect(redactSecrets('spinning up, pinned tab, tokens: none')).toBe('spinning up, pinned tab, tokens: none')
  })

  it('keeps the last whole lines of the log', () => {
    expect(lastLines('a\nb\nc\nd\n', 2)).toBe('c\nd')
    expect(lastLines('tial line\nb\nc', 5, true)).toBe('b\nc')
    expect(lastLines('only\n', 5)).toBe('only') // read from the start: the first line is whole
  })

  it('formats a report with versions, codecs, network and the log, and no secrets', () => {
    const s = settings()
    const text = formatDiagnostics({ ...report('2026-10-18 [info] room pin=4321\n'), settings: s }, new Date('2026-10-18T12:00:00Z'))
    expect(text).toContain('App: 2.6.0, protocol 4')
    expect(text).toContain('OS: darwin 26.3 (25.3.0, arm64)')
    expect(text).toContain('Encoders: H264 (hardware), VP9')
    expect(text).toContain('Decoders: none found')
    expect(text).toContain('Network: 192.168.1.20 (en0)')
    expect(text).toContain('displayName: "Giu"')
    expect(text).toContain('pin=[hidden]')
    expect(text).not.toContain('4321')
    expect(text).not.toContain(s.clientId)
    expect(text).not.toContain('base64')
  })
})
