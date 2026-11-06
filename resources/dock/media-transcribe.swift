// Offline, previously authorized Speech recognition. No microphone or consent prompts.
import AVFoundation
import Foundation
import Speech

var processingStage = "input"
struct Job: Decodable { let source: String; let audio: String; let locale: String?; let durationMs: Double; let mode: String?; let sourceId: String?; let sourceRevision: Int? }
func emit(_ value: [String: Any]) {
  if let data = try? JSONSerialization.data(withJSONObject: value) {
    FileHandle.standardOutput.write(data); FileHandle.standardOutput.write(Data([10]))
  }
}
func fail(_ text: String) -> NSError { NSError(domain: "media-transcript", code: 1, userInfo: [NSLocalizedDescriptionKey: text]) }
func recognize(_ job: Job) async throws -> SFTranscription {
  guard SFSpeechRecognizer.authorizationStatus() == .authorized else { throw fail("speech-not-authorized") }
  let recognizer = job.locale.flatMap { SFSpeechRecognizer(locale: Locale(identifier: $0)) } ?? SFSpeechRecognizer()
  guard let recognizer, recognizer.isAvailable, recognizer.supportsOnDeviceRecognition else { throw fail("on-device-unavailable") }
  recognizer.queue = OperationQueue()
  let request = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: job.audio))
  request.requiresOnDeviceRecognition = true
  request.shouldReportPartialResults = false
  return try await withCheckedThrowingContinuation { continuation in
    let lock = NSLock()
    var settled = false
    var task: SFSpeechRecognitionTask?
    func settle(_ result: Result<SFTranscription, Error>) {
      lock.lock(); guard !settled else { lock.unlock(); return }; settled = true; lock.unlock()
      continuation.resume(with: result)
    }
    task = recognizer.recognitionTask(with: request) { result, error in
      if let result, result.isFinal { settle(.success(result.bestTranscription)) }
      else if let error { settle(.failure(error)) }
    }
    DispatchQueue.global().asyncAfter(deadline: .now() + 180) {
      lock.lock(); let expired = !settled; lock.unlock()
      if expired { task?.cancel(); settle(.failure(fail("recognition-timeout"))) }
    }
  }
}
// Decode PCM in source-media time and write real silence in gaps between mic runs.
// Recognition timestamps then share the video's clock, including an initially muted mic.
func prepare(_ job: Job) async throws -> [Double] {
  let asset = AVURLAsset(url: URL(fileURLWithPath: job.source))
  let tracks = try await asset.loadTracks(withMediaType: .audio)
  guard job.durationMs.isFinite, job.durationMs > 0, job.durationMs <= 120_001 else { throw fail("audio-duration-unsupported") }
  guard !tracks.isEmpty else { throw fail("no-audio-track") }
  let reader = try AVAssetReader(asset: asset)
  let settings: [String: Any] = [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 48_000,
    AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 32, AVLinearPCMIsFloatKey: true,
    AVLinearPCMIsNonInterleaved: false]
  let output = AVAssetReaderAudioMixOutput(audioTracks: tracks, audioSettings: settings)
  guard reader.canAdd(output), let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48_000, channels: 1, interleaved: false) else { throw fail("audio-format") }
  reader.add(output)
  let file = try AVAudioFile(forWriting: URL(fileURLWithPath: job.audio), settings: format.settings)
  guard reader.startReading() else { throw reader.error ?? fail("audio-reader") }
  var peaks = [Double](repeating: 0, count: Int(ceil(job.durationMs / 50)))
  var written: Int64 = 0
  let maximum = Int64((job.durationMs * 48).rounded())
  func silence(until target: Int64) throws {
    while written < target {
      let count = AVAudioFrameCount(min(48_000, target - written))
      guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: count), let channel = buffer.floatChannelData?[0] else { throw fail("audio-buffer") }
      buffer.frameLength = count
      channel.initialize(repeating: 0, count: Int(count))
      try file.write(from: buffer); written += Int64(count)
    }
  }
  while let sample = output.copyNextSampleBuffer() {
    let seconds = CMSampleBufferGetPresentationTimeStamp(sample).seconds
    guard seconds.isFinite, seconds >= 0, let block = CMSampleBufferGetDataBuffer(sample) else { throw fail("audio-timing") }
    let position = min(maximum, Int64((seconds * 48_000).rounded()))
    try silence(until: position)
    let samples = CMSampleBufferGetNumSamples(sample)
    let skip = max(0, Int(written - position))
    let count = min(samples - skip, Int(maximum - written))
    if count <= 0 { continue }
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)), let channel = buffer.floatChannelData?[0] else { throw fail("audio-buffer") }
    buffer.frameLength = AVAudioFrameCount(count)
    let status = CMBlockBufferCopyDataBytes(block, atOffset: skip * MemoryLayout<Float>.size,
      dataLength: count * MemoryLayout<Float>.size, destination: channel)
    guard status == kCMBlockBufferNoErr else { throw fail("audio-buffer-copy") }
    for index in 0..<count {
      let bucket = Int((written + Int64(index)) / 2400)
      let amplitude = Double(abs(channel[index]))
      guard amplitude.isFinite else { throw fail("audio-sample") }
      if bucket < peaks.count { peaks[bucket] = max(peaks[bucket], min(1, amplitude)) }
    }
    try file.write(from: buffer); written += Int64(count)
  }
  guard reader.status == .completed else { throw reader.error ?? fail("audio-reader-failed") }
  try silence(until: maximum)
  return peaks
}
func main() async throws {
  let data = FileHandle.standardInput.readDataToEndOfFile()
  guard data.count < 64 * 1024 else { throw fail("invalid-job") }
  let job = try JSONDecoder().decode(Job.self, from: data)
  if job.mode == "audio-probe" {
    let asset = AVURLAsset(url: URL(fileURLWithPath: job.source))
    let tracks = try await asset.loadTracks(withMediaType: .audio)
    guard tracks.count <= 128 else { throw fail("audio-format") }
    var populated = 0
    for track in tracks {
      let segments = try await track.load(.segments)
      if segments.contains(where: { !$0.isEmpty && $0.timeMapping.target.duration.seconds.isFinite && $0.timeMapping.target.duration.seconds > 0 }) { populated += 1 }
    }
    emit(["event": "complete", "audioProbe": ["sourceId": job.sourceId ?? "", "sourceRevision": job.sourceRevision ?? 0,
      "trackCount": tracks.count, "populatedTrackCount": populated]])
    return
  }
  // Never create a file before confirming existing consent and an on-device model.
  guard job.mode == "waveform" || SFSpeechRecognizer.authorizationStatus() == .authorized else { throw fail("speech-not-authorized") }
  processingStage = "decode"
  let peaks = try await prepare(job)
  if job.mode == "waveform" {
    emit(["event": "complete", "waveform": ["sourceId": job.sourceId ?? "", "sourceRevision": job.sourceRevision ?? 0,
      "durationMs": job.durationMs, "intervalMs": 50, "peaks": peaks]])
    return
  }
  emit(["event": "progress", "fraction": 0.2])
  processingStage = "recognition"
  let transcription = try await recognize(job)
  let text = transcription.formattedString as NSString
  var units: [[String: Any]] = [], cursor = 0
  func gap(to end: Int) {
    if end > cursor {
      units.append(["id": "gap-\(cursor)", "text": text.substring(with: NSRange(location: cursor, length: end - cursor)),
        "startMs": NSNull(), "endMs": NSNull(), "alignment": "untimed"])
    }
  }
  for (index, segment) in transcription.segments.enumerated() {
    let range = segment.substringRange
    guard range.location >= cursor, NSMaxRange(range) <= text.length,
      segment.timestamp.isFinite, segment.duration.isFinite, segment.timestamp >= 0, segment.duration >= 0 else { throw fail("recognition-alignment") }
    gap(to: range.location)
    let content = text.substring(with: range)
    units.append(["id": "unit-\(index)", "text": content,
      "startMs": segment.timestamp * 1000, "endMs": (segment.timestamp + segment.duration) * 1000,
      "alignment": content.split(whereSeparator: { $0.isWhitespace }).count <= 1 ? "word" : "segment"])
    cursor = NSMaxRange(range)
  }
  gap(to: text.length)
  emit(["event": "complete", "transcript": ["status": text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "no-speech" : "ready",
    "revision": 1, "words": units]])
}
if CommandLine.arguments.contains("--capability") {
  emit(["event": "capability", "features": ["audio-probe"]])
  exit(0)
}
Task {
  do { try await main(); exit(0) }
  catch {
    let native = error as NSError
    let known = Set(["speech-not-authorized", "on-device-unavailable", "recognition-timeout", "no-audio-track",
      "audio-duration-unsupported", "audio-format", "audio-reader", "audio-buffer", "audio-buffer-copy",
      "audio-timing", "audio-reader-failed", "audio-sample", "recognition-alignment", "invalid-job"])
    let code = native.domain == "media-transcript" && known.contains(native.localizedDescription)
      ? native.localizedDescription : processingStage == "decode" ? "audio-decode-failed" : "recognition-failed"
    // Only bounded machine metadata; never recognition text or arbitrary error descriptions.
    emit(["event": "error", "code": code, "nativeDomain": String(native.domain.prefix(128)), "nativeCode": native.code])
    exit(1)
  }
}
RunLoop.main.run()
