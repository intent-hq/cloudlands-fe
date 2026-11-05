// Offline export only. This helper never captures a screen, opens a microphone, or recognizes speech.
import Foundation
import AVFoundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers

struct Range: Decodable { let startMs: Double; let endMs: Double }
struct Layer: Decodable { let path: String; let startMs: Double; let endMs: Double }
struct Frame: Decodable { let path: String; let atMs: Double }
struct Job: Decodable {
  let source: String
  let output: String
  let ranges: [Range]
  let muted: Bool
  let layers: [Layer]
  let frames: [Frame]
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
  guard !job.ranges.isEmpty, job.ranges.count <= 10000, job.layers.count <= 10000, job.frames.count <= 10000 else { throw failure("invalid-job") }
  let source = URL(fileURLWithPath: job.source), output = URL(fileURLWithPath: job.output)
  guard source.standardizedFileURL != output.standardizedFileURL, !FileManager.default.fileExists(atPath: output.path) else { throw failure("output-exists") }
  let asset = AVURLAsset(url: source)
  let duration = try await asset.load(.duration).seconds * 1000
  guard duration.isFinite, duration > 0, let originalVideo = try await asset.loadTracks(withMediaType: .video).first else { throw failure("missing-video") }
  var previous = -Double.infinity
  for range in job.ranges {
    guard range.startMs.isFinite, range.endMs.isFinite, range.startMs >= 0, range.endMs > range.startMs, range.endMs <= duration + 1, range.startMs >= previous else { throw failure("invalid-range") }
    previous = range.endMs
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
  for range in job.ranges {
    let span = CMTimeRange(start: time(range.startMs), end: time(min(duration, range.endMs)))
    timeline.append((cursor.seconds * 1000, range.startMs, span.duration.seconds * 1000))
    try video.insertTimeRange(span, of: originalVideo, at: cursor)
    if let originalAudio, let audio, let audioRange {
      let intersection = CMTimeRangeGetIntersection(span, audioRange)
      if intersection.duration.seconds > 0 {
        try audio.insertTimeRange(intersection, of: originalAudio, at: cursor + intersection.start - span.start)
      }
    }
    cursor = cursor + span.duration
  }
  let layers = try job.layers.map { layer -> (CIImage, Double, Double) in
    guard layer.startMs.isFinite, layer.endMs.isFinite, layer.startMs >= 0, layer.endMs > layer.startMs, layer.endMs <= duration + 1,
      let image = CIImage(contentsOf: URL(fileURLWithPath: layer.path)) else { throw failure("invalid-overlay") }
    return (image, layer.startMs, layer.endMs)
  }
  guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else { throw failure("export-unavailable") }
  exporter.outputURL = output; exporter.outputFileType = .mp4
  if !layers.isEmpty {
    // Overlay coordinates are already rasterized in source-frame pixels by the canonical renderer.
    exporter.videoComposition = AVVideoComposition(asset: composition) { request in
      let outputMs = request.compositionTime.seconds * 1000
      let span = timeline.first { outputMs >= $0.start && outputMs < $0.start + $0.length }
      let sourceMs = span.map { $0.source + outputMs - $0.start } ?? -1
      var frame = request.sourceImage
      for (image, from, to) in layers where sourceMs >= from && sourceMs < to { frame = image.composited(over: frame) }
      request.finish(with: frame.cropped(to: request.sourceImage.extent), context: nil)
    }
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
    guard frame.atMs.isFinite, frame.atMs >= 0, frame.atMs < duration,
      target.standardizedFileURL != source.standardizedFileURL,
      target.standardizedFileURL != output.standardizedFileURL,
      !FileManager.default.fileExists(atPath: target.path) else { throw failure("invalid-frame") }
    let captured = try generator.copyCGImage(at: time(frame.atMs), actualTime: nil)
    var image = CIImage(cgImage: captured)
    for (overlay, from, to) in layers where frame.atMs >= from && frame.atMs < to { image = overlay.composited(over: image) }
    guard let pixels = context.createCGImage(image, from: CIImage(cgImage: captured).extent),
      let destination = CGImageDestinationCreateWithURL(target as CFURL, UTType.png.identifier as CFString, 1, nil) else { throw failure("frame-failed") }
    createdFrames.append(target)
    CGImageDestinationAddImage(destination, pixels, nil)
    guard CGImageDestinationFinalize(destination) else { throw failure("frame-failed") }
  }
  success = true
  emit(["event":"complete","path":output.path,"durationMs":cursor.seconds * 1000,"muted":job.muted,"framePaths":job.frames.map(\.path)])
}
Task {
  do { try await main(); exit(0) }
  catch { emit(["event":"error","code":"export-failed","detail":error.localizedDescription]); exit(1) }
}
RunLoop.main.run()
