// Dock composer screen recorder (macOS 12.3+, public ScreenCaptureKit + AVFoundation only).
//
//   intent-dock-recorder still --display <CGDirectDisplayID> [--exclude-window <id>]... [--max-edge 4096]
//     → one JSON line {ok:true, base64 (PNG), width, height, displayScale, capturedAt, hash}
//       or {ok:false, code: unsupported|permission|unavailable|failed, detail}; always exit 0.
//       `unsupported` (macOS < 14, no SCScreenshotManager) is the only code a caller may
//       answer with a different capture path; permission/failed must surface as-is.
//
// Exclusions are strict everywhere: if any requested CGWindowID is not among the
// shareable windows, the still/recording fails with detail "exclusion-missing"
// instead of capturing the dock or its controls.
//   intent-dock-recorder capability
//     → one JSON line describing support and permission state; never prompts.
//   intent-dock-recorder record --output <file.mp4> --display <CGDirectDisplayID>
//       [--max-ms 120000] [--max-bytes <n>] [--size-stop-percent 90] [--fps 30]
//       [--max-edge 4096] [--video-bitrate 7000000] [--audio-bitrate 96000]
//       [--exclude-window <CGWindowID>]... [--mic] [--mic-capable]
//
// Quality: H.264 average bitrate scales with pixels × fps (0.05 bit/pixel, at least
// 3 Mb/s, capped by `--video-bitrate`, default 7 Mb/s ≈ 105 MB per 120 s) plus AAC mono
// `--audio-bitrate` (96 kb/s). `--max-bytes` (the app's playback cap) finishes the clip
// early ("size-limit") at `--size-stop-percent` of it, so an unplayable file is never
// produced. Source pixel dimensions are kept up to 4096 on the long edge
// (H.264 High level limit), scaled proportionally beyond.
//     stdin  (JSON lines): {"cmd":"mic","on":bool} | {"cmd":"marks","marks":[…]}
//                          | {"cmd":"exclude","windowIds":[…]} | {"cmd":"stop"} | {"cmd":"cancel"}
//     stdout (JSON lines): started · mic · exclude · finished · cancelled · error
//
// System audio is never captured. The microphone device is opened only between
// {"cmd":"mic","on":true} and {"cmd":"mic","on":false} (or `--mic` at start), and
// only when microphone access is already authorized; the helper never requests it.
// stdin EOF or SIGTERM cancels: the partial file is deleted.

import AVFoundation
import CoreGraphics
import CoreImage
import CoreMedia
import CoreText
import Foundation
import ImageIO
import ScreenCaptureKit

let captureApi = "sck-stream+avcapture-mic/1"
func videoBitrate(width: Int, height: Int, fps: Int, cap: Int) -> Int {
  min(cap, max(min(3_000_000, cap), Int(Double(width * height * fps) * 0.05)))
}
let outputLock = NSLock()

func emit(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object, options: []) else { return }
  outputLock.lock()
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0A]))
  outputLock.unlock()
}

func osVersionString() -> String {
  let v = ProcessInfo.processInfo.operatingSystemVersion
  return "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)"
}

func micPermission() -> String {
  switch AVCaptureDevice.authorizationStatus(for: .audio) {
  case .authorized: return "authorized"
  case .denied: return "denied"
  case .restricted: return "restricted"
  case .notDetermined: return "not-determined"
  @unknown default: return "unknown"
  }
}

// MARK: - Marks

struct RecordingMark {
  enum Shape {
    case rect(CGRect)
    case path([CGPoint])
    case arrow(CGPoint, CGPoint)
  }
  let n: Int
  let tool: String
  let shape: Shape

  var bounds: CGRect {
    switch shape {
    case .rect(let r): return r
    case .path(let points): return boundingBox(points)
    case .arrow(let a, let b): return boundingBox([a, b])
    }
  }
}

func boundingBox(_ points: [CGPoint]) -> CGRect {
  guard let first = points.first else { return .zero }
  var minX = first.x, minY = first.y, maxX = first.x, maxY = first.y
  for p in points {
    minX = min(minX, p.x); minY = min(minY, p.y); maxX = max(maxX, p.x); maxY = max(maxY, p.y)
  }
  return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
}

func number(_ value: Any?) -> CGFloat? {
  guard let n = value as? NSNumber else { return nil }
  let d = n.doubleValue
  return d.isFinite ? CGFloat(d) : nil
}

func point(_ value: Any?, sx: CGFloat, sy: CGFloat) -> CGPoint? {
  guard let o = value as? [String: Any], let x = number(o["x"]), let y = number(o["y"]) else {
    return nil
  }
  return CGPoint(x: x * sx, y: y * sy)
}

/// Parses renderer marks (image-pixel geometry of their capture) into frame pixels.
func parseMarks(_ raw: [Any], frame: CGSize) -> [RecordingMark] {
  var marks: [RecordingMark] = []
  for item in raw.prefix(99) {
    guard let o = item as? [String: Any],
      let nRaw = number(o["n"]), nRaw >= 1, nRaw < 1000,
      let tool = o["tool"] as? String,
      let iw = number(o["imageWidth"]), iw > 0,
      let ih = number(o["imageHeight"]), ih > 0,
      let g = o["geometry"] as? [String: Any], let kind = g["kind"] as? String
    else { continue }
    let sx = frame.width / iw, sy = frame.height / ih
    var shape: RecordingMark.Shape?
    switch kind {
    case "rect":
      if let x = number(g["x"]), let y = number(g["y"]), let w = number(g["w"]),
        let h = number(g["h"]), w >= 0, h >= 0
      {
        shape = .rect(CGRect(x: x * sx, y: y * sy, width: w * sx, height: h * sy))
      }
    case "path":
      let points = ((g["points"] as? [Any]) ?? []).prefix(256).compactMap {
        point($0, sx: sx, sy: sy)
      }
      if !points.isEmpty { shape = .path(points) }
    case "arrow":
      if let a = point(g["from"], sx: sx, sy: sy), let b = point(g["to"], sx: sx, sy: sy) {
        shape = .arrow(a, b)
      }
    default: break
    }
    if let shape { marks.append(RecordingMark(n: Int(nRaw), tool: tool, shape: shape)) }
  }
  return marks
}

/// Draws outlines, strokes and numbered badges (spec: #DDEC61 marks, #080808 numbers,
/// 18 pt badge at the top-right of each mark) into a transparent frame-sized overlay.
func renderOverlay(_ marks: [RecordingMark], size: CGSize, pointScale: CGFloat) -> CIImage? {
  let width = Int(size.width), height = Int(size.height)
  guard !marks.isEmpty, width > 0, height > 0,
    let space = CGColorSpace(name: CGColorSpace.sRGB),
    let ctx = CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
      space: space, bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
        | CGBitmapInfo.byteOrder32Little.rawValue)
  else { return nil }
  ctx.translateBy(x: 0, y: size.height)
  ctx.scaleBy(x: 1, y: -1)
  let accent = CGColor(srgbRed: 0xDD / 255, green: 0xEC / 255, blue: 0x61 / 255, alpha: 1)
  let ink = CGColor(srgbRed: 0x08 / 255, green: 0x08 / 255, blue: 0x08 / 255, alpha: 1)
  ctx.setStrokeColor(accent)
  ctx.setLineCap(.round)
  ctx.setLineJoin(.round)

  for mark in marks {
    switch mark.shape {
    case .rect(let r):
      ctx.setLineWidth(2 * pointScale)
      ctx.stroke(r)
    case .path(let points):
      ctx.setLineWidth(2.5 * pointScale)
      ctx.beginPath()
      ctx.addLines(between: points)
      ctx.strokePath()
    case .arrow(let a, let b):
      ctx.setLineWidth(2 * pointScale)
      ctx.beginPath()
      ctx.move(to: a)
      ctx.addLine(to: b)
      let angle = atan2(b.y - a.y, b.x - a.x)
      let head = 10 * pointScale
      for spread in [CGFloat.pi * 0.8, -CGFloat.pi * 0.8] {
        ctx.move(to: b)
        ctx.addLine(
          to: CGPoint(x: b.x + head * cos(angle + spread), y: b.y + head * sin(angle + spread)))
      }
      ctx.strokePath()
    }
  }

  let diameter = 18 * pointScale
  let font = CTFontCreateUIFontForLanguage(.emphasizedSystem, 11 * pointScale, nil)
  for mark in marks {
    let b = mark.bounds
    let center = CGPoint(
      x: min(max(b.maxX, diameter / 2), size.width - diameter / 2),
      y: min(max(b.minY, diameter / 2), size.height - diameter / 2))
    ctx.setFillColor(accent)
    ctx.fillEllipse(
      in: CGRect(
        x: center.x - diameter / 2, y: center.y - diameter / 2, width: diameter, height: diameter))
    guard let font else { continue }
    let attributes: [NSAttributedString.Key: Any] = [
      NSAttributedString.Key(kCTFontAttributeName as String): font,
      NSAttributedString.Key(kCTForegroundColorAttributeName as String): ink,
    ]
    let line = CTLineCreateWithAttributedString(
      NSAttributedString(string: String(mark.n), attributes: attributes))
    let textBounds = CTLineGetBoundsWithOptions(line, .useOpticalBounds)
    ctx.saveGState()
    // CoreText draws y-up; undo the flip locally around the badge.
    ctx.translateBy(x: center.x, y: center.y)
    ctx.scaleBy(x: 1, y: -1)
    ctx.textPosition = CGPoint(
      x: -textBounds.width / 2 - textBounds.minX, y: -textBounds.height / 2 - textBounds.minY)
    CTLineDraw(line, ctx)
    ctx.restoreGState()
  }
  guard let image = ctx.makeImage() else { return nil }
  return CIImage(cgImage: image)
}

// MARK: - Recorder

struct ExclusionMissing: Error {}

struct Options {
  var output = ""
  var displayId: CGDirectDisplayID = 0
  var maxMs = 120_000
  var fps = 30
  var maxEdge = 4096
  var maxBytes = 0
  var sizeStopPercent = 90
  var videoBitrateCap = 7_000_000
  var audioBitrate = 96_000
  var excludeWindows: [CGWindowID] = []
  var micAtStart = false
  var micCapable = false
}

@available(macOS 12.3, *)
final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate,
  AVCaptureAudioDataOutputSampleBufferDelegate
{
  enum State { case starting, recording, finishing, done }

  let options: Options
  let queue = DispatchQueue(label: "dev.intent.dock-recorder")
  let micQueue = DispatchQueue(label: "dev.intent.dock-recorder.mic")
  let ciContext = CIContext()
  var state = State.starting
  var stream: SCStream?
  var display: SCDisplay?
  var writer: AVAssetWriter?
  var videoInput: AVAssetWriterInput?
  var adaptor: AVAssetWriterInputPixelBufferAdaptor?
  var audioInput: AVAssetWriterInput?
  var frameSize = CGSize.zero
  var pointScale: CGFloat = 1
  var startTime: CMTime?
  var lastTime: CMTime?
  var overlay: CIImage?
  var pendingMarks: [Any] = []
  var micSession: AVCaptureSession?
  var micOn = false
  var micAtStart: Bool
  var hasMicAudio = false
  var limitTimer: DispatchSourceTimer?
  var sizeTimer: DispatchSourceTimer?
  var startWatchdog: DispatchSourceTimer?

  init(options: Options) {
    self.options = options
    self.micAtStart = options.micAtStart
  }

  var outputURL: URL { URL(fileURLWithPath: options.output) }

  func hostNow() -> CMTime { CMClockGetTime(CMClockGetHostTimeClock()) }

  func fail(_ code: String, _ detail: String) {
    queue.async {
      guard self.state != .done else { return }
      self.state = .done
      self.teardown()
      self.writer?.cancelWriting()
      try? FileManager.default.removeItem(at: self.outputURL)
      emit(["event": "error", "code": code, "detail": detail])
      exit(1)
    }
  }

  func start() {
    guard CGPreflightScreenCaptureAccess() else {
      return fail("permission", "screen-recording")
    }
    SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: false) {
      content, error in
      self.queue.async {
        guard let content else {
          return self.fail(
            "permission", error.map { "\($0.localizedDescription)" } ?? "shareable-content")
        }
        guard let display = content.displays.first(where: { $0.displayID == self.options.displayId })
        else { return self.fail("unavailable", "display") }
        self.display = display
        do {
          try self.configure(display: display, content: content)
        } catch is ExclusionMissing {
          return self.fail("failed", "exclusion-missing")
        } catch {
          return self.fail("failed", "configure: \(error.localizedDescription)")
        }
      }
    }
  }

  func configure(display: SCDisplay, content: SCShareableContent) throws {
    let mode = CGDisplayCopyDisplayMode(display.displayID)
    let pixelWidth = CGFloat(mode?.pixelWidth ?? display.width)
    let pixelHeight = CGFloat(mode?.pixelHeight ?? display.height)
    let fit = min(1, CGFloat(options.maxEdge) / max(pixelWidth, pixelHeight))
    let width = max(2, Int((pixelWidth * fit / 2).rounded()) * 2)
    let height = max(2, Int((pixelHeight * fit / 2).rounded()) * 2)
    frameSize = CGSize(width: width, height: height)
    pointScale = CGFloat(width) / CGFloat(max(1, display.width))
    let refresh = mode?.refreshRate ?? 0
    let fps = max(1, min(options.fps, 30, refresh > 0 ? Int(refresh.rounded()) : 30))

    let config = SCStreamConfiguration()
    config.width = width
    config.height = height
    config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
    config.pixelFormat = kCVPixelFormatType_32BGRA
    config.showsCursor = true
    config.queueDepth = 6
    if #available(macOS 13.0, *) { config.capturesAudio = false }

    try? FileManager.default.removeItem(at: outputURL)
    let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
    let video = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: videoBitrate(
            width: width, height: height, fps: fps, cap: options.videoBitrateCap),
          AVVideoMaxKeyFrameIntervalKey: fps * 2,
          AVVideoExpectedSourceFrameRateKey: fps,
          AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        ],
      ])
    video.expectsMediaDataInRealTime = true
    guard writer.canAdd(video) else { throw NSError(domain: "recorder", code: 1) }
    writer.add(video)
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: video,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
        kCVPixelBufferIOSurfacePropertiesKey as String: [:],
      ])
    if options.micCapable {
      let audio = AVAssetWriterInput(
        mediaType: .audio,
        outputSettings: [
          AVFormatIDKey: kAudioFormatMPEG4AAC,
          AVSampleRateKey: 48_000,
          AVNumberOfChannelsKey: 1,
          AVEncoderBitRateKey: options.audioBitrate,
        ])
      audio.expectsMediaDataInRealTime = true
      if writer.canAdd(audio) {
        writer.add(audio)
        audioInput = audio
      }
    }
    self.writer = writer
    self.videoInput = video
    self.adaptor = adaptor

    let excluded = windows(options.excludeWindows, in: content)
    guard Set(excluded.map(\.windowID)) == Set(options.excludeWindows) else {
      throw ExclusionMissing()
    }
    let filter = SCContentFilter(display: display, excludingWindows: excluded)
    let stream = SCStream(filter: filter, configuration: config, delegate: self)
    try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
    self.stream = stream
    let watchdog = DispatchSource.makeTimerSource(queue: queue)
    watchdog.schedule(deadline: .now() + 10)
    watchdog.setEventHandler { [weak self] in
      if self?.state == .starting { self?.fail("failed", "no-first-frame") }
    }
    watchdog.resume()
    startWatchdog = watchdog
    stream.startCapture { error in
      guard let error else { return }
      let code = (error as NSError).code == SCStreamError.userDeclined.rawValue
        ? "permission" : "failed"
      self.fail(code, "start: \(error.localizedDescription)")
    }
  }

  func windows(_ ids: [CGWindowID], in content: SCShareableContent) -> [SCWindow] {
    let wanted = Set(ids)
    return content.windows.filter { wanted.contains($0.windowID) }
  }

  // MARK: Video

  func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, state == .starting || state == .recording,
      CMSampleBufferIsValid(sample), let pixels = CMSampleBufferGetImageBuffer(sample),
      let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false)
        as? [[SCStreamFrameInfo: Any]],
      let rawStatus = attachments.first?[.status] as? Int,
      SCFrameStatus(rawValue: rawStatus) == .complete,
      let writer, let videoInput, let adaptor
    else { return }
    let time = CMSampleBufferGetPresentationTimeStamp(sample)
    if state == .starting {
      guard writer.startWriting() else {
        return fail("failed", "writer: \(writer.error?.localizedDescription ?? "unknown")")
      }
      writer.startSession(atSourceTime: time)
      startTime = time
      state = .recording
      startWatchdog?.cancel()
      scheduleLimit()
      emit(["event": "started", "captureApi": captureApi, "width": Int(frameSize.width),
            "height": Int(frameSize.height)])
      if micAtStart { setMic(true) }
      if !pendingMarks.isEmpty { setMarks(pendingMarks) }
    }
    guard let startTime, time >= startTime else { return }
    if CMTimeGetSeconds(time - startTime) * 1000 >= Double(options.maxMs) {
      return finish("limit")
    }
    guard videoInput.isReadyForMoreMediaData else { return }
    let sourceSize = CGSize(
      width: CVPixelBufferGetWidth(pixels), height: CVPixelBufferGetHeight(pixels))
    if overlay == nil && sourceSize == frameSize {
      if adaptor.append(pixels, withPresentationTime: time) { lastTime = time }
      return
    }
    guard let pool = adaptor.pixelBufferPool else { return }
    var output: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &output)
    guard let output else { return }
    var image = CIImage(cvPixelBuffer: pixels)
    if sourceSize != frameSize {
      image = image.transformed(
        by: CGAffineTransform(
          scaleX: frameSize.width / sourceSize.width, y: frameSize.height / sourceSize.height))
    }
    if let overlay { image = overlay.composited(over: image) }
    ciContext.render(image, to: output)
    if adaptor.append(output, withPresentationTime: time) { lastTime = time }
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    queue.async {
      switch self.state {
      case .recording: self.finish("interrupted")
      case .starting: self.fail("failed", "stream: \(error.localizedDescription)")
      default: break
      }
    }
  }

  func scheduleLimit() {
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + .milliseconds(options.maxMs))
    timer.setEventHandler { [weak self] in self?.finish("limit") }
    timer.resume()
    limitTimer = timer
    guard options.maxBytes > 0 else { return }
    // Stop early, truthfully, rather than produce a clip placement must reject.
    let sizer = DispatchSource.makeTimerSource(queue: queue)
    sizer.schedule(deadline: .now() + 1, repeating: 1)
    sizer.setEventHandler { [weak self] in
      guard let self, self.state == .recording else { return }
      let bytes = (try? FileManager.default.attributesOfItem(atPath: self.options.output)[.size]
        as? NSNumber)?.intValue ?? 0
      if bytes >= self.options.maxBytes / 100 * self.options.sizeStopPercent {
        self.finish("size-limit")
      }
    }
    sizer.resume()
    sizeTimer = sizer
  }

  // MARK: Marks and exclusion

  func setMarks(_ raw: [Any]) {
    pendingMarks = raw
    guard state == .recording else { return }
    overlay = renderOverlay(parseMarks(raw, frame: frameSize), size: frameSize, pointScale: pointScale)
  }

  func setExcluded(_ ids: [CGWindowID]) {
    guard let stream, let display else {
      return emit(["event": "exclude", "ok": false, "detail": "not-started"])
    }
    SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: false) {
      content, error in
      guard let content else {
        return emit(["event": "exclude", "ok": false, "detail": error?.localizedDescription ?? ""])
      }
      let found = self.windows(ids, in: content)
      let missing = Set(ids).subtracting(found.map(\.windowID)).map { Int($0) }
      // Still exclude everything that exists (never fewer than requested-and-present),
      // but report the request as failed so the caller can stop the clip.
      stream.updateContentFilter(SCContentFilter(display: display, excludingWindows: found)) {
        error in
        emit([
          "event": "exclude", "ok": error == nil && missing.isEmpty, "missing": missing,
          "detail": !missing.isEmpty ? "exclusion-missing" : error?.localizedDescription ?? "",
        ])
      }
    }
  }

  // MARK: Microphone

  func setMic(_ on: Bool) {
    if state == .starting {
      micAtStart = on  // applied when the first frame starts the clip
      return
    }
    guard state == .recording else {
      return emit(["event": "mic", "active": false, "reason": "not-recording"])
    }
    if !on {
      micOn = false
      let session = micSession
      micSession = nil
      micQueue.async {
        session?.stopRunning()
        emit(["event": "mic", "active": false])
      }
      return
    }
    if micOn { return emit(["event": "mic", "active": true]) }
    guard audioInput != nil else {
      return emit(["event": "mic", "active": false, "reason": "unsupported"])
    }
    guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
      return emit(["event": "mic", "active": false, "reason": "permission"])
    }
    guard let device = AVCaptureDevice.default(for: .audio),
      let input = try? AVCaptureDeviceInput(device: device)
    else { return emit(["event": "mic", "active": false, "reason": "unavailable"]) }
    let session = AVCaptureSession()
    let output = AVCaptureAudioDataOutput()
    output.audioSettings = [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: 48_000,
      AVNumberOfChannelsKey: 1,
      AVLinearPCMBitDepthKey: 32,
      AVLinearPCMIsFloatKey: true,
      AVLinearPCMIsNonInterleaved: false,
    ]
    output.setSampleBufferDelegate(self, queue: queue)
    guard session.canAddInput(input), session.canAddOutput(output) else {
      return emit(["event": "mic", "active": false, "reason": "unavailable"])
    }
    session.addInput(input)
    session.addOutput(output)
    micSession = session
    micOn = true
    micQueue.async {
      session.startRunning()
      self.queue.async {
        guard self.micSession === session else { return }
        emit(["event": "mic", "active": session.isRunning])
        if !session.isRunning { self.micOn = false; self.micSession = nil }
      }
    }
  }

  func captureOutput(
    _ output: AVCaptureOutput, didOutput sample: CMSampleBuffer, from connection: AVCaptureConnection
  ) {
    guard state == .recording, micOn, let audioInput, let startTime, let session = micSession,
      audioInput.isReadyForMoreMediaData
    else { return }
    var buffer = sample
    var time = CMSampleBufferGetPresentationTimeStamp(sample)
    if let clock = session.synchronizationClock {
      let host = CMSyncConvertTime(time, from: clock, to: CMClockGetHostTimeClock())
      if host != time {
        var timing = CMSampleTimingInfo(
          duration: CMSampleBufferGetDuration(sample), presentationTimeStamp: host,
          decodeTimeStamp: .invalid)
        var retimed: CMSampleBuffer?
        CMSampleBufferCreateCopyWithNewTiming(
          allocator: nil, sampleBuffer: sample, sampleTimingEntryCount: 1,
          sampleTimingArray: &timing, sampleBufferOut: &retimed)
        guard let retimed else { return }
        buffer = retimed
        time = host
      }
    }
    guard time >= startTime else { return }
    if audioInput.append(buffer) { hasMicAudio = true }
  }

  // MARK: Lifecycle

  func teardown() {
    limitTimer?.cancel()
    sizeTimer?.cancel()
    startWatchdog?.cancel()
    micOn = false
    if let session = micSession {
      micSession = nil
      micQueue.async { session.stopRunning() }
    }
    stream?.stopCapture(completionHandler: nil)
  }

  func finish(_ reason: String) {
    guard state == .recording, let writer, let startTime else {
      if state == .starting { cancel() }
      return
    }
    state = .finishing
    let now = hostNow()
    let maxEnd = startTime + CMTime(value: CMTimeValue(options.maxMs), timescale: 1000)
    let end = max(lastTime ?? startTime, min(now, maxEnd))
    teardown()
    videoInput?.markAsFinished()
    audioInput?.markAsFinished()
    writer.endSession(atSourceTime: end)
    let hadMic = hasMicAudio
    writer.finishWriting {
      self.queue.async {
        self.state = .done
        guard writer.status == .completed else {
          try? FileManager.default.removeItem(at: self.outputURL)
          emit([
            "event": "error", "code": "failed",
            "detail": "finish: \(writer.error?.localizedDescription ?? "unknown")",
          ])
          exit(1)
        }
        let bytes =
          (try? FileManager.default.attributesOfItem(atPath: self.options.output)[.size]
            as? NSNumber)?.intValue ?? 0
        emit([
          "event": "finished", "reason": reason, "path": self.options.output, "bytes": bytes,
          "durationMs": Int((CMTimeGetSeconds(end - startTime) * 1000).rounded()),
          "hasMicAudio": hadMic, "mimeType": "video/mp4", "captureApi": captureApi,
        ])
        exit(0)
      }
    }
  }

  func cancel() {
    guard state == .starting || state == .recording else { return }
    state = .done
    teardown()
    writer?.cancelWriting()
    try? FileManager.default.removeItem(at: outputURL)
    emit(["event": "cancelled"])
    exit(0)
  }

  func handle(_ command: [String: Any]) {
    switch command["cmd"] as? String {
    case "stop": state == .starting ? cancel() : finish("stopped")
    case "cancel": cancel()
    case "mic": setMic(command["on"] as? Bool == true)
    case "marks": setMarks((command["marks"] as? [Any]) ?? [])
    case "exclude":
      setExcluded(((command["windowIds"] as? [Any]) ?? []).prefix(64).compactMap {
        ($0 as? NSNumber).map { CGWindowID($0.uint32Value) }
      })
    default: emit(["event": "error-command", "detail": "unknown"])
    }
  }
}

// MARK: - Still capture

/// 16×16 difference hash (17×16 grayscale, adjacent comparison) as 64 hex chars.
func differenceHash(_ image: CGImage) -> String? {
  let width = 17, height = 16
  var pixels = [UInt8](repeating: 0, count: width * height)
  guard let ctx = CGContext(
      data: &pixels, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width,
      space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
  else { return nil }
  ctx.interpolationQuality = .medium
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  var bits = [UInt8](repeating: 0, count: 32)
  for y in 0..<height {
    for x in 0..<16 where pixels[y * width + x] > pixels[y * width + x + 1] {
      let index = y * 16 + x
      bits[index / 8] |= UInt8(0x80 >> (index % 8))
    }
  }
  return bits.map { String(format: "%02x", $0) }.joined()
}

func stillFailure(_ code: String, _ detail: String) -> Never {
  emit(["ok": false, "code": code, "detail": detail])
  exit(0)
}

@available(macOS 14.0, *)
func captureStill(_ options: Options) {
  guard CGPreflightScreenCaptureAccess() else { stillFailure("permission", "screen-recording") }
  SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: false) {
    content, error in
    guard let content else {
      stillFailure("permission", error?.localizedDescription ?? "shareable-content")
    }
    guard let display = content.displays.first(where: { $0.displayID == options.displayId })
    else { stillFailure("unavailable", "display") }
    let wanted = Set(options.excludeWindows)
    let excluded = content.windows.filter { wanted.contains($0.windowID) }
    guard Set(excluded.map(\.windowID)) == wanted else {
      stillFailure("failed", "exclusion-missing")
    }
    let filter = SCContentFilter(display: display, excludingWindows: excluded)
    let mode = CGDisplayCopyDisplayMode(display.displayID)
    let pixelWidth = CGFloat(mode?.pixelWidth ?? display.width)
    let pixelHeight = CGFloat(mode?.pixelHeight ?? display.height)
    let fit = min(1, CGFloat(options.maxEdge) / max(pixelWidth, pixelHeight))
    let config = SCStreamConfiguration()
    config.width = max(1, Int((pixelWidth * fit).rounded()))
    config.height = max(1, Int((pixelHeight * fit).rounded()))
    config.showsCursor = false
    config.capturesAudio = false
    let capturedAt = ISO8601DateFormatter().string(from: Date())
    SCScreenshotManager.captureImage(contentFilter: filter, configuration: config) {
      image, error in
      guard let image else {
        let declined = (error as NSError?)?.code == SCStreamError.userDeclined.rawValue
        stillFailure(declined ? "permission" : "failed", error?.localizedDescription ?? "capture")
      }
      let data = NSMutableData()
      guard let destination = CGImageDestinationCreateWithData(
          data as CFMutableData, "public.png" as CFString, 1, nil)
      else { stillFailure("failed", "png") }
      CGImageDestinationAddImage(destination, image, nil)
      guard CGImageDestinationFinalize(destination) else { stillFailure("failed", "png") }
      var result: [String: Any] = [
        "ok": true, "base64": (data as Data).base64EncodedString(), "mimeType": "image/png",
        "width": image.width, "height": image.height,
        "displayScale": Double(image.width) / Double(max(1, display.width)),
        "capturedAt": capturedAt, "captureApi": "sck-screenshot/1",
      ]
      if let hash = differenceHash(image) { result["hash"] = hash }
      emit(result)
      exit(0)
    }
  }
}

// MARK: - Entry

func parseOptions(_ args: ArraySlice<String>, needsOutput: Bool = true) -> Options? {
  var o = Options()
  var it = args.makeIterator()
  while let flag = it.next() {
    switch flag {
    case "--output": o.output = it.next() ?? ""
    case "--display": o.displayId = CGDirectDisplayID(it.next() ?? "") ?? 0
    case "--max-ms": o.maxMs = min(120_000, max(1000, Int(it.next() ?? "") ?? 120_000))
    case "--fps": o.fps = min(30, max(1, Int(it.next() ?? "") ?? 30))
    case "--max-edge": o.maxEdge = min(4096, max(320, Int(it.next() ?? "") ?? 4096))
    case "--max-bytes": o.maxBytes = max(0, Int(it.next() ?? "") ?? 0)
    case "--size-stop-percent": o.sizeStopPercent = min(99, max(50, Int(it.next() ?? "") ?? 90))
    case "--video-bitrate":
      o.videoBitrateCap = min(12_000_000, max(500_000, Int(it.next() ?? "") ?? 7_000_000))
    case "--audio-bitrate": o.audioBitrate = min(192_000, max(32_000, Int(it.next() ?? "") ?? 96_000))
    case "--exclude-window":
      if let id = CGWindowID(it.next() ?? "") { o.excludeWindows.append(id) }
    case "--mic": o.micAtStart = true
    case "--mic-capable": o.micCapable = true
    default: return nil
    }
  }
  return (!needsOutput || o.output.hasSuffix(".mp4")) && o.displayId != 0 ? o : nil
}

let arguments = CommandLine.arguments
switch arguments.dropFirst().first {
case "still":
  guard #available(macOS 14.0, *) else { stillFailure("unsupported", "os-version") }
  guard let options = parseOptions(arguments.dropFirst(2), needsOutput: false) else {
    stillFailure("failed", "usage")
  }
  captureStill(options)
  dispatchMain()
case "capability":
  guard #available(macOS 12.3, *) else {
    emit(["supported": false, "reason": "os-version", "osVersion": osVersionString()])
    exit(0)
  }
  emit([
    "supported": true, "micSupported": true, "captureApi": captureApi,
    "stillSupported": { if #available(macOS 14.0, *) { return true } else { return false } }(),
    "osVersion": osVersionString(), "screenPermission": CGPreflightScreenCaptureAccess(),
    "micPermission": micPermission(),
  ])
  exit(0)
case "record":
  guard #available(macOS 12.3, *) else {
    emit(["event": "error", "code": "unavailable", "detail": "os-version"])
    exit(1)
  }
  guard let options = parseOptions(arguments.dropFirst(2)) else {
    emit(["event": "error", "code": "failed", "detail": "usage"])
    exit(2)
  }
  let recorder = Recorder(options: options)
  signal(SIGTERM, SIG_IGN)
  signal(SIGPIPE, SIG_IGN)
  let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: recorder.queue)
  term.setEventHandler { recorder.cancel() }
  term.resume()
  Thread.detachNewThread {
    while let line = readLine(strippingNewline: true) {
      guard let data = line.data(using: .utf8), data.count <= 1_048_576,
        let command = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
      else { continue }
      recorder.queue.async { recorder.handle(command) }
    }
    // Parent went away: never leave a live capture or a partial file behind.
    recorder.queue.async { recorder.cancel() }
  }
  recorder.start()
  dispatchMain()
default:
  FileHandle.standardError.write("usage: intent-dock-recorder capability | record --output <mp4> --display <id> …\n".data(using: .utf8)!)
  exit(2)
}
