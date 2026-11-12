// Offline export only. This helper never captures a screen, opens a microphone, or recognizes speech.
import Foundation
import AVFoundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers

struct Range: Decodable { let startMs: Double; let endMs: Double }
struct Layer: Decodable { let path: String; let startMs: Double; let endMs: Double }
struct Frame: Decodable { let path: String; let atMs: Double }
struct Point: Decodable { let x: Double; let y: Double }
struct BlurStroke: Decodable { let radius: Double; let points: [Point] }
struct Rect: Decodable { let x: Double; let y: Double; let w: Double; let h: Double }
struct Job: Decodable {
  let outputVersion: Int?
  let source: String
  let output: String
  let ranges: [Range]
  let muted: Bool
  let layers: [Layer]
  let frames: [Frame]
  let expectedWidth: Double
  let expectedHeight: Double
  let expectedDurationMs: Double
  let crop: Rect?
  let blurRegions: [Rect]
  let blurStrokes: [BlurStroke]?
  let blurRadius: Double?
}
func emit(_ value: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: value) else { return }
  FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
}
func failure(_ message: String) -> NSError { NSError(domain: "capture-export", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
func time(_ ms: Double) -> CMTime { CMTime(seconds: ms / 1000, preferredTimescale: 60000) }
func main() async throws {
  let data = FileHandle.standardInput.readDataToEndOfFile()
  guard data.count <= 8 * 1024 * 1024 else { throw failure("job-too-large") }
  let job = try JSONDecoder().decode(Job.self, from: data)
  guard job.outputVersion == 2 else { throw failure("output-version-unavailable") }
  guard !job.ranges.isEmpty, job.ranges.count <= 10000, job.layers.count <= 10000, job.frames.count <= 10000 else { throw failure("invalid-job") }
  let source = URL(fileURLWithPath: job.source), output = URL(fileURLWithPath: job.output)
  guard source.standardizedFileURL != output.standardizedFileURL, !FileManager.default.fileExists(atPath: output.path) else { throw failure("output-exists") }
  let asset = AVURLAsset(url: source)
  let duration = try await asset.load(.duration).seconds * 1000
  guard duration.isFinite, duration > 0, let originalVideo = try await asset.loadTracks(withMediaType: .video).first else { throw failure("missing-video") }
  let size = try await originalVideo.load(.naturalSize)
  guard size.width == job.expectedWidth, size.height == job.expectedHeight,
    abs(duration - job.expectedDurationMs) <= 1000, job.blurRegions.count <= 1000 else { throw failure("source-changed") }
  let extent = CGRect(origin: .zero, size: size)
  for rect in job.blurRegions + (job.crop.map { [$0] } ?? []) {
    guard rect.x.isFinite, rect.y.isFinite, rect.w.isFinite, rect.h.isFinite,
      rect.x >= 0, rect.y >= 0, rect.w > 0, rect.h > 0,
      rect.x + rect.w <= Double(size.width), rect.y + rect.h <= Double(size.height) else { throw failure("invalid-geometry") }
  }
  let strokes = job.blurStrokes ?? []
  let blurRadius = job.blurRadius ?? 16
  guard strokes.count <= 1000, strokes.reduce(0, { $0 + $1.points.count }) <= 200000,
    blurRadius.isFinite, blurRadius > 0, blurRadius <= 128 else { throw failure("invalid-blur") }
  for stroke in strokes {
    guard stroke.radius.isFinite, stroke.radius > 0, stroke.radius <= 4096, !stroke.points.isEmpty, stroke.points.count <= 4096,
      stroke.points.allSatisfy({ $0.x.isFinite && $0.y.isFinite && $0.x >= 0 && $0.y >= 0 && $0.x <= Double(size.width) && $0.y <= Double(size.height) }) else { throw failure("invalid-brush") }
  }
  var blurMask: CIImage?
  if !job.blurRegions.isEmpty || !strokes.isEmpty {
    guard let mask = CGContext(data: nil, width: Int(size.width), height: Int(size.height), bitsPerComponent: 8, bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { throw failure("blur-mask-unavailable") }
    mask.setFillColor(gray: 0, alpha: 1); mask.fill(extent)
    mask.translateBy(x: 0, y: size.height); mask.scaleBy(x: 1, y: -1)
    mask.setFillColor(gray: 1, alpha: 1); mask.setStrokeColor(gray: 1, alpha: 1)
    mask.setLineCap(.round); mask.setLineJoin(.round)
    for rect in job.blurRegions { mask.fill(CGRect(x: rect.x, y: rect.y, width: rect.w, height: rect.h)) }
    for stroke in strokes {
      var points: [Point] = []
      for p in stroke.points { if points.last?.x != p.x || points.last?.y != p.y { points.append(p) } }
      if points.count == 1 {
        let p = points[0]; mask.fillEllipse(in: CGRect(x: p.x - stroke.radius, y: p.y - stroke.radius, width: stroke.radius * 2, height: stroke.radius * 2))
      } else {
        mask.beginPath(); mask.setLineWidth(stroke.radius * 2)
        mask.move(to: CGPoint(x: points[0].x, y: points[0].y))
        for p in points.dropFirst() { mask.addLine(to: CGPoint(x: p.x, y: p.y)) }
        mask.strokePath()
      }
    }
    guard let image = mask.makeImage() else { throw failure("blur-mask-unavailable") }
    blurMask = CIImage(cgImage: image)
  }
  func edited(_ sourceImage: CIImage, atMs: Double, layers: [(CIImage, Double, Double)]) -> CIImage {
    var image = sourceImage
    if let blurMask {
      let blurred = sourceImage.clampedToExtent().applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: blurRadius]).cropped(to: extent)
      image = blurred.applyingFilter("CIBlendWithMask", parameters: [kCIInputBackgroundImageKey: sourceImage, kCIInputMaskImageKey: blurMask])
    }
    for (overlay, from, to) in layers where atMs >= from && atMs < to { image = overlay.composited(over: image) }
    if let crop = job.crop {
      let rect = CGRect(x: crop.x, y: Double(size.height) - crop.y - crop.h, width: crop.w, height: crop.h)
      return image.cropped(to: rect).transformed(by: CGAffineTransform(translationX: -rect.minX, y: -rect.minY))
    }
    return image.cropped(to: extent)
  }
  // Recorder stop metadata uses its capture clock. Finalized media can end slightly
  // earlier, so validate edits against that declared source before bounding playable output.
  let videoRange = try await originalVideo.load(.timeRange)
  let playableStart = max(0, videoRange.start.seconds * 1000)
  let playableEnd = min(duration, videoRange.end.seconds * 1000)
  guard playableStart.isFinite, playableEnd.isFinite, playableEnd > playableStart,
    abs(playableEnd - job.expectedDurationMs) <= 1000 else { throw failure("source-changed") }
  var previous = -Double.infinity
  let ranges = try job.ranges.map { range -> Range in
    guard range.startMs.isFinite, range.endMs.isFinite, range.startMs >= 0, range.endMs > range.startMs, range.endMs <= job.expectedDurationMs + 1, range.startMs >= previous else { throw failure("invalid-range") }
    previous = range.endMs
    let start = max(playableStart, range.startMs), end = min(playableEnd, range.endMs)
    // Never silently discard a requested segment with no source video.
    guard end > start else { throw failure("invalid-range") }
    return Range(startMs: start, endMs: end)
  }
  var success = false
  var createdOutput = false
  var createdFrames: [URL] = []
  defer {
    if !success {
      if createdOutput { try? FileManager.default.removeItem(at: output) }
      for path in createdFrames { try? FileManager.default.removeItem(at: path) }
    }
  }
  let composition = AVMutableComposition()
  guard let video = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw failure("video-track") }
  video.preferredTransform = try await originalVideo.load(.preferredTransform)
  let originalAudio = job.muted ? nil : try await asset.loadTracks(withMediaType: .audio).first
  if !job.muted && originalAudio == nil { throw failure("missing-audio") }
  let audio = originalAudio == nil ? nil : composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
  if originalAudio != nil && audio == nil { throw failure("audio-track") }
  let audioRange = try await originalAudio?.load(.timeRange)
  var cursor = CMTime.zero
  var timeline: [(start: Double, source: Double, length: Double)] = []
  for range in ranges {
    let span = CMTimeRange(start: time(range.startMs), end: time(range.endMs))
    timeline.append((cursor.seconds * 1000, range.startMs, span.duration.seconds * 1000))
    try video.insertTimeRange(span, of: originalVideo, at: cursor)
    if let originalAudio, let audio, let audioRange {
      let intersection = CMTimeRangeGetIntersection(span, otherRange: audioRange)
      if intersection.duration.seconds > 0 {
        try audio.insertTimeRange(intersection, of: originalAudio, at: cursor + intersection.start - span.start)
      }
    }
    cursor = cursor + span.duration
  }
  let layers = try job.layers.map { layer -> (CIImage, Double, Double) in
    guard layer.startMs.isFinite, layer.endMs.isFinite, layer.startMs >= 0, layer.endMs > layer.startMs, layer.endMs <= job.expectedDurationMs + 1,
      let image = CIImage(contentsOf: URL(fileURLWithPath: layer.path)) else { throw failure("invalid-overlay") }
    let start = max(playableStart, layer.startMs), end = min(playableEnd, layer.endMs)
    guard end > start else { throw failure("invalid-overlay") }
    return (image, start, end)
  }
  guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else { throw failure("export-unavailable") }
  exporter.outputURL = output; exporter.outputFileType = .mp4
  if !layers.isEmpty || job.crop != nil || blurMask != nil {
    let filtered = AVVideoComposition(asset: composition) { request in
      let outputMs = request.compositionTime.seconds * 1000
      let span = timeline.first { outputMs >= $0.start && outputMs < $0.start + $0.length }
      let sourceMs = span.map { $0.source + outputMs - $0.start } ?? -1
      request.finish(with: edited(request.sourceImage, atMs: sourceMs, layers: layers), context: nil)
    }
    if let crop = job.crop, let mutable = filtered.mutableCopy() as? AVMutableVideoComposition {
      mutable.renderSize = CGSize(width: crop.w, height: crop.h)
      exporter.videoComposition = mutable
    } else { exporter.videoComposition = filtered }
  }
  emit(["event":"progress","fraction":0])
  let progress = Task {
    while !Task.isCancelled {
      emit(["event":"progress","fraction":exporter.progress])
      try? await Task.sleep(nanoseconds: 150_000_000)
    }
  }
  createdOutput = true
  await withCheckedContinuation { continuation in exporter.exportAsynchronously { continuation.resume() } }
  progress.cancel()
  guard exporter.status == .completed else {
    try? FileManager.default.removeItem(at: output)
    throw exporter.error ?? failure("export-failed")
  }
  // Frames use the same active included overlays as the video, never a baked legacy source.
  let generator = AVAssetImageGenerator(asset: asset)
  generator.appliesPreferredTrackTransform = true
  generator.requestedTimeToleranceBefore = .zero; generator.requestedTimeToleranceAfter = .zero
  let context = CIContext()
  for frame in job.frames {
    let target = URL(fileURLWithPath: frame.path)
    guard frame.atMs.isFinite, frame.atMs >= playableStart, frame.atMs < playableEnd,
      frame.atMs < job.expectedDurationMs,
      target.standardizedFileURL != source.standardizedFileURL,
      target.standardizedFileURL != output.standardizedFileURL,
      !FileManager.default.fileExists(atPath: target.path) else { throw failure("invalid-frame") }
    let captured = try generator.copyCGImage(at: time(frame.atMs), actualTime: nil)
    let image = edited(CIImage(cgImage: captured), atMs: frame.atMs, layers: layers)
    guard let pixels = context.createCGImage(image, from: image.extent),
      let destination = CGImageDestinationCreateWithURL(target as CFURL, UTType.png.identifier as CFString, 1, nil) else { throw failure("frame-failed") }
    createdFrames.append(target)
    CGImageDestinationAddImage(destination, pixels, nil)
    guard CGImageDestinationFinalize(destination) else { throw failure("frame-failed") }
  }
  success = true
  emit(["event":"complete","outputVersion":2,"path":output.path,"durationMs":cursor.seconds * 1000,"muted":job.muted,"framePaths":job.frames.map(\.path)])
}
if CommandLine.arguments.dropFirst().first == "--capability" {
  emit(["event":"capability","outputVersion":2,"features":["blur-strokes","legacy-rect-blur","canonical-overlay"]])
  exit(0)
}
Task {
  do { try await main(); exit(0) }
  catch {
    let native = error as NSError
    let known = Set(["job-too-large", "output-version-unavailable", "invalid-job", "output-exists",
      "missing-video", "source-changed", "invalid-geometry", "invalid-blur", "invalid-brush",
      "blur-mask-unavailable", "invalid-range", "video-track", "missing-audio", "audio-track",
      "invalid-overlay", "export-unavailable", "export-failed", "invalid-frame", "frame-failed"])
    let code = native.domain == "capture-export" && known.contains(native.localizedDescription)
      ? native.localizedDescription : "export-failed"
    let domains = Set(["capture-export", "AVFoundationErrorDomain", "NSOSStatusErrorDomain", "NSCocoaErrorDomain"])
    var event: [String: Any] = ["event": "error", "code": code, "nativeCode": native.code]
    if domains.contains(native.domain) { event["nativeDomain"] = native.domain }
    // No localized descriptions, file paths or media contents cross this boundary.
    emit(event)
    exit(1)
  }
}
RunLoop.main.run()
