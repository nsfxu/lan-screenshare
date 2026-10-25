// Prints the normal app windows on every desktop (Space) as JSON, for the share
// picker: Chromium's own list (desktopCapturer) only has the current desktop's,
// but it captures a window on another one fine when given its id.
//
// [{"id": 13060, "pid": 812, "app": "Brave Browser", "title": "GitHub",
//   "width": 1470, "height": 923, "onScreen": false, "bundle": "/Applications/Brave Browser.app"}]
//
// "id" is the CGWindowID, the number in Chromium's "window:<id>:0". Titles are
// empty without the Screen Recording permission.
//
// `mac-window-list --icon <bundle path>` prints that app's icon instead, as a
// 64×64 PNG (Electron's app.getFileIcon gives the generic app icon for bundles).
import AppKit
import CoreGraphics
import Foundation

let args = CommandLine.arguments
if args.count == 3 && args[1] == "--icon" {
  let side = 64
  guard let rep = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8, samplesPerPixel: 4,
    hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
  else { exit(1) }
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  NSWorkspace.shared.icon(forFile: args[2]).draw(in: NSRect(x: 0, y: 0, width: side, height: side))
  NSGraphicsContext.restoreGraphicsState()
  guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
  FileHandle.standardOutput.write(png)
  exit(0)
}

struct Window: Encodable {
  let id: Int
  let pid: Int
  let app: String
  let title: String
  let width: Int
  let height: Int
  let onScreen: Bool
  let bundle: String?
}

let info = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
var bundles: [Int: String?] = [:]
var windows: [Window] = []
for w in info {
  // Layer 0 is normal app windows; menus, the Dock and overlays sit on other layers.
  guard (w[kCGWindowLayer as String] as? Int) == 0,
    let id = w[kCGWindowNumber as String] as? Int,
    let pid = w[kCGWindowOwnerPID as String] as? Int
  else { continue }
  if let alpha = w[kCGWindowAlpha as String] as? Double, alpha <= 0 { continue }
  let bounds = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
  if bundles[pid] == nil { bundles[pid] = NSRunningApplication(processIdentifier: pid_t(pid))?.bundleURL?.path }
  windows.append(Window(
    id: id,
    pid: pid,
    app: w[kCGWindowOwnerName as String] as? String ?? "",
    title: w[kCGWindowName as String] as? String ?? "",
    width: (bounds["Width"] as? NSNumber)?.intValue ?? 0,
    height: (bounds["Height"] as? NSNumber)?.intValue ?? 0,
    onScreen: w[kCGWindowIsOnscreen as String] as? Bool ?? false,
    bundle: bundles[pid] ?? nil
  ))
}
FileHandle.standardOutput.write(try JSONEncoder().encode(windows))
