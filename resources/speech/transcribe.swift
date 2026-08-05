// intent-speech-helper — macOS Speech.framework transcription CLI.
//
// Invoked by the Electron main process (voice-local.ipc.ts) to transcribe a
// recorded dictation locally via SFSpeechRecognizer instead of the daemon's
// cloud `voice.transcribe`. Compiled at package time by
// scripts/build-speech-helper.cjs (swiftc) into resources/speech-helper/.
//
// Usage: intent-speech-helper <audio-file> [--contextual-strings <json-array>] [--locale <bcp47>]
//        intent-speech-helper --request-authorization
//
// Prints a single JSON object to stdout:
//   success: {"text": "...", "durationMs": 1234}
//   failure: {"error": "<code>", "message": "..."} with exit code 1
//   authorization mode: {"status": "authorized" | "denied" | "restricted" | "notDetermined"}
// Error codes: authorization-denied | recognizer-unavailable | audio-unreadable
//              | recognition-failed | bad-arguments
import AVFoundation
import Foundation
import Speech

func emit(_ object: [String: Any], exitCode: Int32) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: object)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
    exit(exitCode)
}

func fail(_ code: String, _ message: String) -> Never {
    emit(["error": code, "message": message], exitCode: 1)
}

var arguments = Array(CommandLine.arguments.dropFirst())

// Authorization-only mode: trigger the speech-recognition permission request
// (TCC prompt when not yet determined) and report the resulting status
// without touching any audio.
if arguments == ["--request-authorization"] {
    let authorizationSemaphore = DispatchSemaphore(value: 0)
    var status = SFSpeechRecognizer.authorizationStatus()
    if status == .notDetermined {
        SFSpeechRecognizer.requestAuthorization { result in
            status = result
            authorizationSemaphore.signal()
        }
        authorizationSemaphore.wait()
    }
    let name: String
    switch status {
    case .authorized: name = "authorized"
    case .denied: name = "denied"
    case .restricted: name = "restricted"
    case .notDetermined: name = "notDetermined"
    @unknown default: name = "notDetermined"
    }
    emit(["status": name], exitCode: 0)
}

var contextualStrings: [String] = []
if let flagIndex = arguments.firstIndex(of: "--contextual-strings") {
    guard flagIndex + 1 < arguments.count,
        let data = arguments[flagIndex + 1].data(using: .utf8),
        let parsed = try? JSONSerialization.jsonObject(with: data) as? [String]
    else {
        fail("bad-arguments", "--contextual-strings expects a JSON string array")
    }
    contextualStrings = parsed
    arguments.removeSubrange(flagIndex...(flagIndex + 1))
}
var requestedLocale: String?
if let flagIndex = arguments.firstIndex(of: "--locale") {
    guard flagIndex + 1 < arguments.count,
        !arguments[flagIndex + 1].isEmpty
    else {
        fail("bad-arguments", "--locale expects a BCP-47 locale identifier")
    }
    requestedLocale = arguments[flagIndex + 1]
    arguments.removeSubrange(flagIndex...(flagIndex + 1))
}
guard arguments.count == 1 else {
    fail(
        "bad-arguments",
        "usage: intent-speech-helper <audio-file> [--contextual-strings <json-array>] [--locale <bcp47>]")
}
let audioURL = URL(fileURLWithPath: arguments[0])
guard FileManager.default.fileExists(atPath: audioURL.path) else {
    fail("audio-unreadable", "audio file not found: \(audioURL.path)")
}

// Authorization: the TCC prompt/attribution belongs to the responsible app
// (the Electron bundle spawning this helper).
let authSemaphore = DispatchSemaphore(value: 0)
var authStatus = SFSpeechRecognizer.authorizationStatus()
if authStatus == .notDetermined {
    SFSpeechRecognizer.requestAuthorization { status in
        authStatus = status
        authSemaphore.signal()
    }
    authSemaphore.wait()
}
guard authStatus == .authorized else {
    fail("authorization-denied", "speech recognition authorization status: \(authStatus.rawValue)")
}

// Recognizer locale: the requested locale (the `voice.language` setting) when
// macOS supports it, otherwise the system locale — never a hard failure just
// because one locale lacks a recognizer. `recognizer-unavailable` fires only
// when neither works.
func makeRecognizer() -> SFSpeechRecognizer? {
    if let identifier = requestedLocale {
        if let recognizer = SFSpeechRecognizer(locale: Locale(identifier: identifier)),
            recognizer.isAvailable
        {
            return recognizer
        }
        FileHandle.standardError.write(
            "locale \(identifier) unsupported; falling back to the system locale\n"
                .data(using: .utf8)!)
    }
    if let recognizer = SFSpeechRecognizer(), recognizer.isAvailable {
        return recognizer
    }
    return nil
}

guard let recognizer = makeRecognizer() else {
    fail("recognizer-unavailable", "no speech recognizer available for the requested or system locale")
}
// The recognizer delivers result handlers on `queue`, which DEFAULTS to the
// main queue — but this CLI blocks its main thread on a semaphore while
// waiting for recognition, so main-queue delivery would deadlock (the
// handler never runs and every recognition "times out"). Use a dedicated
// queue instead.
recognizer.queue = OperationQueue()

let durationMs: Int
do {
    let audioFile = try AVAudioFile(forReading: audioURL)
    let seconds = Double(audioFile.length) / audioFile.processingFormat.sampleRate
    durationMs = Int((seconds * 1000).rounded())
} catch {
    fail("audio-unreadable", "cannot read audio file: \(error.localizedDescription)")
}

enum AttemptOutcome {
    case transcript(String)
    case failure(String)
    case timedOut
}

/// One recognition attempt with its own watchdog. A hung task (macOS is
/// known to yield neither result nor error when on-device recognition is
/// required but the locale's model asset is broken/missing) is cancelled at
/// the timeout instead of blocking until the parent kills the helper.
func attemptRecognition(
    _ recognizer: SFSpeechRecognizer, requireOnDevice: Bool, timeout: TimeInterval
) -> AttemptOutcome {
    let request = SFSpeechURLRecognitionRequest(url: audioURL)
    request.shouldReportPartialResults = false
    if !contextualStrings.isEmpty {
        request.contextualStrings = contextualStrings
    }
    request.requiresOnDeviceRecognition = requireOnDevice
    let semaphore = DispatchSemaphore(value: 0)
    var transcript: String?
    var recognitionError: Error?
    let task = recognizer.recognitionTask(with: request) { result, error in
        if let error = error {
            recognitionError = error
            semaphore.signal()
            return
        }
        guard let result = result else { return }
        if result.isFinal {
            transcript = result.bestTranscription.formattedString
            semaphore.signal()
        }
    }
    if semaphore.wait(timeout: .now() + timeout) == .timedOut {
        task.cancel()
        return .timedOut
    }
    if let error = recognitionError {
        return .failure(error.localizedDescription)
    }
    return .transcript(transcript ?? "")
}

// Watchdogs proportional to the clip: recognition of a dictation clip is
// far faster than realtime, so a hang is detectable well before the old
// flat 120s ceiling (which the IPC caller experienced as a 2-minute stall).
let clipSeconds = Double(durationMs) / 1000
let onDeviceTimeout = min(30.0, max(10.0, clipSeconds * 2 + 5))
let serverTimeout = min(60.0, max(20.0, clipSeconds * 3 + 10))

// Prefer on-device recognition (audio stays on this Mac), but treat it as an
// attempt, not a requirement: when it hangs or errors, retry with Apple's
// server-based recognition rather than failing the dictation.
var attemptNotes: [String] = []
if recognizer.supportsOnDeviceRecognition {
    switch attemptRecognition(recognizer, requireOnDevice: true, timeout: onDeviceTimeout) {
    case .transcript(let text):
        emit(["text": text, "durationMs": durationMs], exitCode: 0)
    case .failure(let message):
        attemptNotes.append("on-device recognition failed: \(message)")
    case .timedOut:
        attemptNotes.append("on-device recognition timed out after \(Int(onDeviceTimeout))s")
    }
}
switch attemptRecognition(recognizer, requireOnDevice: false, timeout: serverTimeout) {
case .transcript(let text):
    emit(["text": text, "durationMs": durationMs], exitCode: 0)
case .failure(let message):
    fail(
        "recognition-failed",
        (attemptNotes + ["server-based recognition failed: \(message)"]).joined(separator: "; "))
case .timedOut:
    fail(
        "recognition-failed",
        (attemptNotes + ["server-based recognition timed out after \(Int(serverTimeout))s"])
            .joined(separator: "; "))
}
