// mac-audio-capture: captures the Mac's system audio and writes it to stdout, so
// ScreenShare can send it with the shared screen. Chromium's own loopback capture
// does not work on macOS (the track ends as soon as it is created), so this helper
// plays the part that native/win-audio-capture plays on Windows, with the same
// stream format:
//
//   header: "SSA1" | u32 sample rate | u16 channels (always 2)   (little endian)
//   then:   interleaved float32 stereo frames, forever
//
// Two ways to capture, chosen by the arguments (all optional):
//
//   (none)                        everything the Mac plays, with ScreenCaptureKit (macOS 13+)
//   --exclude-bundle-prefix a,b   everything except the apps whose bundle id starts with one
//                                 of these (case-insensitive), e.g. com.hnc.Discord, with a
//                                 Core Audio process tap (macOS 14.2+). ScreenCaptureKit can't
//                                 do this: the sound of Chromium/Electron apps comes from their
//                                 helper processes, which it doesn't attribute to the app.
//   --fallback-pid N              while no such app is playing, leave out this process's app
//                                 instead (ScreenShare itself), so a share doesn't carry the
//                                 streams its own computer is playing.
//
// With a tap, the set of processes left out is re-checked every second, so it
// follows an app starting to play (Discord joining a call after the share began).
//
// Diagnostics go to stderr. The process exits when stdin closes (the app went away),
// when the capture stops by itself (exit code 2), or, before writing the header, when it
// can't start: the macOS version is too old for the mode asked for (exit code 3), or the
// permission is missing (exit code 5: Screen Recording, or System Audio Recording for a tap).
//
// Built by scripts/build-native.cjs with swiftc (Xcode command line tools),
// for both Apple Silicon and Intel.

import AVFoundation
import CoreAudio
import CoreMedia
import Foundation
import ScreenCaptureKit

let channels = 2

func log(_ message: String) {
  FileHandle.standardError.write(Data((message + "\n").utf8))
}

func write(_ data: Data) {
  FileHandle.standardOutput.write(data)
}

func header(sampleRate: Int) -> Data {
  var data = Data("SSA1".utf8)
  var rate = UInt32(sampleRate).littleEndian
  var count = UInt16(channels).littleEndian
  withUnsafeBytes(of: &rate) { data.append(contentsOf: $0) }
  withUnsafeBytes(of: &count) { data.append(contentsOf: $0) }
  return data
}

func argument(_ name: String) -> String? {
  let args = CommandLine.arguments
  guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
  return args[i + 1]
}

let excludedPrefixes = (argument("--exclude-bundle-prefix") ?? "")
  .split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty }
let fallbackPid = argument("--fallback-pid").flatMap { pid_t($0) }

enum CaptureError: Error {
  case noDisplay
  case tap(String, OSStatus)
}

/// Interleaved float32 stereo from whatever layout the system gave: planar or interleaved, mono or more.
func stereoFrames(from buffers: UnsafeMutableAudioBufferListPointer, planar: Bool, sourceChannels: Int, frames: Int)
  -> [Float]
{
  var out = [Float](repeating: 0, count: frames * channels)
  if buffers.count == 0 { return out }
  if planar {
    for c in 0..<min(channels, buffers.count) {
      guard let p = buffers[c].mData?.assumingMemoryBound(to: Float.self) else { continue }
      let available = min(frames, Int(buffers[c].mDataByteSize) / MemoryLayout<Float>.size)
      for i in 0..<available { out[i * channels + c] = p[i] }
    }
    if buffers.count == 1 {  // mono: both ears
      for i in 0..<frames { out[i * channels + 1] = out[i * channels] }
    }
  } else if let p = buffers[0].mData?.assumingMemoryBound(to: Float.self) {
    let source = max(sourceChannels, 1)
    let available = min(frames, Int(buffers[0].mDataByteSize) / (MemoryLayout<Float>.size * source))
    for i in 0..<available {
      for c in 0..<channels { out[i * channels + c] = p[i * source + min(c, source - 1)] }
    }
  }
  return out
}

// MARK: - Everything, with ScreenCaptureKit

@available(macOS 13.0, *)
final class ScreenKitCapture: NSObject, SCStreamOutput, SCStreamDelegate {
  static let sampleRate = 48_000
  private var stream: SCStream?
  private let queue = DispatchQueue(label: "mac-audio-capture")

  func start() async throws {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    guard let display = content.displays.first else { throw CaptureError.noDisplay }
    let filter = SCContentFilter(display: display, excludingWindows: [])
    let config = SCStreamConfiguration()
    config.capturesAudio = true
    config.sampleRate = ScreenKitCapture.sampleRate
    config.channelCount = channels
    // Only the sound is wanted, but a stream always has a picture: make it as cheap as it gets.
    config.width = 2
    config.height = 2
    config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
    config.showsCursor = false
    let stream = SCStream(filter: filter, configuration: config, delegate: self)
    // Without a screen output ScreenCaptureKit logs every dropped picture.
    try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
    try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
    try await stream.startCapture()
    self.stream = stream
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .audio, sampleBuffer.isValid, sampleBuffer.numSamples > 0 else { return }
    guard let format = CMSampleBufferGetFormatDescription(sampleBuffer),
      let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee
    else { return }

    var listSize = 0
    guard
      CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
        sampleBuffer, bufferListSizeNeededOut: &listSize, bufferListOut: nil, bufferListSize: 0,
        blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: nil) == noErr,
      listSize > 0
    else { return }
    let raw = UnsafeMutableRawPointer.allocate(byteCount: listSize, alignment: MemoryLayout<AudioBufferList>.alignment)
    defer { raw.deallocate() }
    let list = raw.bindMemory(to: AudioBufferList.self, capacity: 1)
    var block: CMBlockBuffer?
    let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      sampleBuffer, bufferListSizeNeededOut: nil, bufferListOut: list, bufferListSize: listSize,
      blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: &block)
    guard status == noErr else { return }

    let out = stereoFrames(
      from: UnsafeMutableAudioBufferListPointer(list),
      planar: (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0,
      sourceChannels: Int(asbd.mChannelsPerFrame),
      frames: Int(sampleBuffer.numSamples))
    out.withUnsafeBytes { write(Data($0)) }
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    log("capture stopped: \(error.localizedDescription)")
    exit(2)
  }
}

// MARK: - Everything except some apps, with a Core Audio process tap

func property<T>(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector, _ initial: T) -> T? {
  var address = AudioObjectPropertyAddress(
    mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size = UInt32(MemoryLayout<T>.size)
  var value = initial
  let status = withUnsafeMutablePointer(to: &value) { AudioObjectGetPropertyData(object, &address, 0, nil, &size, $0) }
  return status == noErr ? value : nil
}

/// Every process the audio system knows about (the ones that play or record sound), as audio object ids.
func audioProcesses() -> [(object: AudioObjectID, pid: pid_t, bundleId: String)] {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyProcessObjectList, mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size) == noErr
  else { return [] }
  var objects = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &objects) == noErr
  else { return [] }
  return objects.compactMap { object in
    guard let pid: pid_t = property(object, kAudioProcessPropertyPID, 0) else { return nil }
    let bundle: CFString? = property(object, kAudioProcessPropertyBundleID, nil as CFString?) ?? nil
    return (object, pid, (bundle as String?) ?? "")
  }
}

@available(macOS 14.2, *)
final class ProcessTapCapture {
  private var tapId = AudioObjectID(kAudioObjectUnknown)
  private var aggregateId = AudioObjectID(kAudioObjectUnknown)
  private var procId: AudioDeviceIOProcID?
  private var excluded: [AudioObjectID] = []
  private var sourceChannels = channels
  private var planar = false
  private(set) var sampleRate = 48_000
  private let queue = DispatchQueue(label: "mac-audio-capture-tap")

  /// The processes to leave out now: those of the excluded apps, or of this app while none of them plays.
  private func processesToExclude() -> [(object: AudioObjectID, bundleId: String)] {
    let all = audioProcesses()
    let matches = all.filter { p in
      let id = p.bundleId.lowercased()
      return excludedPrefixes.contains { id.hasPrefix($0) }
    }
    if !matches.isEmpty { return matches.map { ($0.object, $0.bundleId) } }
    // This app's own helpers have the app's bundle id plus a suffix ("com.screenshare.lan.helper").
    guard let fallbackPid = fallbackPid, let own = all.first(where: { $0.pid == fallbackPid }), !own.bundleId.isEmpty
    else { return [] }
    let prefix = own.bundleId.lowercased()
    return all.filter { $0.bundleId.lowercased().hasPrefix(prefix) }.map { ($0.object, $0.bundleId) }
  }

  func start() throws {
    try open(processesToExclude())
  }

  /// Build the tap, the private device that carries it, and start reading from it.
  private func open(_ processes: [(object: AudioObjectID, bundleId: String)]) throws {
    excluded = processes.map { $0.object }.sorted()
    log("leaving out: " + (processes.isEmpty ? "nothing playing" : processes.map { $0.bundleId }.joined(separator: ", ")))

    let description = CATapDescription(stereoGlobalTapButExcludeProcesses: excluded)
    description.name = "ScreenShare"
    description.isPrivate = true
    description.muteBehavior = .unmuted
    var status = AudioHardwareCreateProcessTap(description, &tapId)
    guard status == noErr else { throw CaptureError.tap("create the audio tap", status) }

    guard let output: AudioObjectID = property(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultSystemOutputDevice, 0),
      let outputUid: CFString = property(output, kAudioDevicePropertyDeviceUID, "" as CFString)
    else { throw CaptureError.tap("find the output device", -1) }
    let aggregate: [String: Any] = [
      kAudioAggregateDeviceNameKey: "ScreenShare audio tap",
      kAudioAggregateDeviceUIDKey: UUID().uuidString,
      kAudioAggregateDeviceMainSubDeviceKey: outputUid as String,
      kAudioAggregateDeviceIsPrivateKey: true,
      kAudioAggregateDeviceIsStackedKey: false,
      kAudioAggregateDeviceTapAutoStartKey: true,
      kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUid as String]],
      kAudioAggregateDeviceTapListKey: [
        [kAudioSubTapDriftCompensationKey: true, kAudioSubTapUIDKey: description.uuid.uuidString]
      ],
    ]
    status = AudioHardwareCreateAggregateDevice(aggregate as CFDictionary, &aggregateId)
    guard status == noErr else { throw CaptureError.tap("create the tap's device", status) }

    guard let format: AudioStreamBasicDescription = property(tapId, kAudioTapPropertyFormat, AudioStreamBasicDescription())
    else { throw CaptureError.tap("read the tap's format", -1) }
    sampleRate = Int(format.mSampleRate)
    sourceChannels = Int(format.mChannelsPerFrame)
    planar = (format.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0

    status = AudioDeviceCreateIOProcIDWithBlock(&procId, aggregateId, queue) { [self] _, input, _, _, _ in
      let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))
      guard buffers.count > 0 else { return }
      let bytesPerFrame = MemoryLayout<Float>.size * (planar ? 1 : max(sourceChannels, 1))
      let frames = Int(buffers[0].mDataByteSize) / bytesPerFrame
      if frames == 0 { return }
      stereoFrames(from: buffers, planar: planar, sourceChannels: sourceChannels, frames: frames)
        .withUnsafeBytes { write(Data($0)) }
    }
    guard status == noErr, procId != nil else { throw CaptureError.tap("start reading the tap", status) }
    status = AudioDeviceStart(aggregateId, procId)
    guard status == noErr else { throw CaptureError.tap("start the tap", status) }
  }

  private func close() {
    if let procId = procId {
      AudioDeviceStop(aggregateId, procId)
      AudioDeviceDestroyIOProcID(aggregateId, procId)
    }
    procId = nil
    if aggregateId != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(aggregateId) }
    aggregateId = AudioObjectID(kAudioObjectUnknown)
    if tapId != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapId) }
    tapId = AudioObjectID(kAudioObjectUnknown)
  }

  /// Follow the excluded apps starting to play or stopping: a tap's list is fixed, so rebuild it.
  func refreshExclusions() {
    let wanted = processesToExclude()
    if wanted.map({ $0.object }).sorted() == excluded { return }
    close()
    do {
      try open(wanted)
    } catch {
      log("can't update the apps left out: \(error)")
      exit(2)
    }
  }
}

// MARK: - Main

// The app closing its end of stdin is how it tells the helper to stop.
Thread.detachNewThread {
  while true {
    let data = FileHandle.standardInput.availableData
    if data.isEmpty { exit(0) }
  }
}

if !excludedPrefixes.isEmpty {
  guard #available(macOS 14.2, *) else {
    log("leaving apps out of the audio needs macOS 14.2 or newer")
    exit(3)
  }
  let tap = ProcessTapCapture()
  do {
    try tap.start()
  } catch {
    log("can't capture system audio: \(error) (is System Audio Recording allowed for ScreenShare?)")
    exit(5)
  }
  write(header(sampleRate: tap.sampleRate))
  log("capturing system audio with a tap at \(tap.sampleRate) Hz x\(channels)")
  Thread.detachNewThread {
    while true {
      Thread.sleep(forTimeInterval: 1)
      tap.refreshExclusions()
    }
  }
  dispatchMain()
}

guard #available(macOS 13.0, *) else {
  log("system audio capture needs macOS 13 or newer")
  exit(3)
}

let capture = ScreenKitCapture()
Task {
  do {
    try await capture.start()
    write(header(sampleRate: ScreenKitCapture.sampleRate))
    log("capturing system audio at \(ScreenKitCapture.sampleRate) Hz x\(channels)")
  } catch {
    log("can't capture system audio: \(error.localizedDescription) (is Screen Recording allowed for ScreenShare?)")
    exit(5)
  }
}
dispatchMain()
