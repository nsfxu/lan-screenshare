// The test pattern for `npm run perf -- --latency`: a window over the whole shared
// screen (the first screen, the one the streamer captures) with game-like motion
// and a time code (src/shared/timeCode.ts) that the viewers read back.
// Started by scripts/perf/perf.spec.ts, which injects the time code and starts it.
const { app, BrowserWindow, desktopCapturer, screen } = require('electron')
const path = require('node:path')

// The pattern's quiet tone (--audio) starts without a click.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

app.whenReady().then(async () => {
  // The display behind "Screen 1" in the source list: what the streamer shares by default.
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
  const first = sources.find((s) => s.id.startsWith('screen:0:'))
  const display = screen.getAllDisplays().find((d) => String(d.id) === first?.display_id) ?? screen.getPrimaryDisplay()
  // A plain full-screen window, not a frameless always-on-top one: Windows shows those directly
  // ("independent flip"), and the screen capture then only gets a few frames a second.
  const win = new BrowserWindow({
    ...display.bounds,
    fullscreen: true,
    autoHideMenuBar: true,
    title: 'ScreenShare latency pattern',
    backgroundColor: '#102030',
    webPreferences: { backgroundThrottling: false }
  })
  void win.loadFile(path.join(__dirname, 'pattern.html'))
})
