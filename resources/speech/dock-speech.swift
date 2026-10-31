// intent-dock-speech — streaming dictation for the dock composer.
//
// A separate binary from the batch `intent-speech-helper` (transcribe.swift),
// whose ABI is unchanged. Compiled by scripts/build-dock-speech.cjs into
// resources/speech-helper/intent-dock-speech and driven by
// src/features/hud/main/dock-speech.ts.
//
// Modes:
//   intent-dock-speech --probe [--locale <bcp47>]
//     One JSON line describing the capability. Never prompts for permission
//     and never opens the microphone.
//   intent-dock-speech --serve
//     NDJSON over stdio. One session per process; the process exits after it
//     writes `ended`. Commands (stdin):
//       {"cmd":"start","sessionId":"…","locale"?:"…","contextualStrings"?:[…],
//        "silenceMs"?:8000,"maxMs"?:…,"micAudioPath"?:"/abs/file.caf"}
//       {"cmd":"mark","markId":"…"}  — stamps the click on the audio clock
//       {"cmd":"stop"}               — finalization barrier, then `ended`
//       {"cmd":"cancel"}             — drop pending results, then `ended`
//     Closing stdin cancels. Events (stdout): ready, state, level, transcript,
//     mark, error, ended (exactly once, always last).
//
// Engines: macOS 26+ uses SpeechAnalyzer + DictationTranscriber (volatile and
// finalized results with audio time ranges). Older systems, or locales the
// analyzer does not support, use SFSpeechRecognizer with an audio buffer
// request, rolling to a new utterance after a pause.
//
// Every elapsed value is milliseconds on the audio clock: input frames
// received since the first microphone buffer divided by the sample rate.
import AVFoundation
import CoreMedia
import Foundation
import Speech

// MARK: - Output

let outputLock = NSLock()

func send(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
    outputLock.lock()
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
    outputLock.unlock()
}

func log(_ message: String) {
    FileHandle.standardError.write("\(message)\n".data(using: .utf8)!)
}

func milliseconds(_ time: CMTime) -> Int? {
    guard time.isValid, time.isNumeric else { return nil }
    return Int((time.seconds * 1000).rounded())
}

// MARK: - Permissions

func speechStatusName(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "notDetermined"
    }
}

func microphoneStatusName(_ status: AVAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "notDetermined"
    }
}

func requestSpeechAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
    let status = SFSpeechRecognizer.authorizationStatus()
    guard status == .notDetermined else { return status }
    return await withCheckedContinuation { continuation in
        SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
    }
}

func requestMicrophoneAuthorization() async -> AVAuthorizationStatus {
    let status = AVCaptureDevice.authorizationStatus(for: .audio)
    guard status == .notDetermined else { return status }
    _ = await AVCaptureDevice.requestAccess(for: .audio)
    return AVCaptureDevice.authorizationStatus(for: .audio)
}

// MARK: - Engine selection

enum EngineChoice {
    case analyzer(Locale)
    case recognizer(SFSpeechRecognizer)
}

struct SpeechFailure: Error {
    let code: String
    let message: String
}

func requestedLocales(_ identifier: String?) -> [Locale] {
    var locales: [Locale] = []
    if let identifier, !identifier.isEmpty { locales.append(Locale(identifier: identifier)) }
    locales.append(Locale.current)
    return locales
}

@available(macOS 26.0, *)
func analyzerLocale(_ identifier: String?) async -> Locale? {
    for locale in requestedLocales(identifier) {
        if let supported = await DictationTranscriber.supportedLocale(equivalentTo: locale) {
            return supported
        }
    }
    return nil
}

@available(macOS 26.0, *)
func makeTranscriber(_ locale: Locale) -> DictationTranscriber {
    DictationTranscriber(
        locale: locale,
        contentHints: [],
        transcriptionOptions: [.punctuation],
        reportingOptions: [.volatileResults, .frequentFinalization],
        attributeOptions: [.audioTimeRange])
}

func recognizerFor(_ identifier: String?) -> SFSpeechRecognizer? {
    for locale in requestedLocales(identifier) {
        if let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable {
            return recognizer
        }
        if let language = locale.language.languageCode?.identifier {
            let match = SFSpeechRecognizer.supportedLocales()
                .filter { $0.language.languageCode?.identifier == language }
                .sorted { $0.identifier < $1.identifier }
                .first
            if let match, let recognizer = SFSpeechRecognizer(locale: match), recognizer.isAvailable {
                return recognizer
            }
        }
    }
    return nil
}

/// Picks the engine without downloading anything; `ensureAssets` decides
/// whether the analyzer can actually run.
func chooseEngine(_ identifier: String?) async -> EngineChoice? {
    if #available(macOS 26.0, *), let locale = await analyzerLocale(identifier)
    {
        let status = await AssetInventory.status(forModules: [makeTranscriber(locale)])
        if status != .unsupported { return .analyzer(locale) }
    }
    if let recognizer = recognizerFor(identifier) { return .recognizer(recognizer) }
    return nil
}

// MARK: - Probe

func probe(_ identifier: String?) async -> Never {
    let speech = SFSpeechRecognizer.authorizationStatus()
    let microphone = AVCaptureDevice.authorizationStatus(for: .audio)
    var result: [String: Any] = [
        "speech": speechStatusName(speech),
        "microphone": microphoneStatusName(microphone),
        "inputDevice": AVCaptureDevice.default(for: .audio) != nil,
    ]
    switch await chooseEngine(identifier) {
    case .analyzer(let locale)?:
        result["engine"] = "analyzer"
        result["locale"] = locale.identifier
        result["onDevice"] = true
        if #available(macOS 26.0, *) {
            let status = await AssetInventory.status(forModules: [makeTranscriber(locale)])
            result["assets"] = status == .installed ? "installed" : status == .downloading ? "downloading" : "supported"
        }
    case .recognizer(let recognizer)?:
        result["engine"] = "recognizer"
        result["locale"] = recognizer.locale.identifier
        result["onDevice"] = recognizer.supportsOnDeviceRecognition
    case nil:
        result["engine"] = NSNull()
    }
    send(result)
    exit(0)
}

// MARK: - Backends

struct TranscriptUpdate {
    let utterance: Int
    let revision: Int
    let isFinal: Bool
    let text: String
    let startMs: Int?
    let endMs: Int?
    let segments: [[String: Any]]
}

protocol SpeechBackend: AnyObject, Sendable {
    func append(_ buffer: AVAudioPCMBuffer, elapsedMs: Int, quietForMs: Int)
    /// Ends input and calls `completion` once every pending result is final.
    func finish(_ completion: @escaping () -> Void)
    func cancel()
}

/// Segments that concatenate back to `text`; untimed gaps carry null times.
func segmentDictionary(_ text: String, _ startMs: Int?, _ endMs: Int?) -> [String: Any] {
    ["text": text, "startMs": startMs as Any? ?? NSNull(), "endMs": endMs as Any? ?? NSNull()]
}

@available(macOS 26.0, *)
final class AnalyzerBackend: SpeechBackend, @unchecked Sendable {
    private let transcriber: DictationTranscriber
    private let analyzer: SpeechAnalyzer
    private let inputFormat: AVAudioFormat
    private let analyzerFormat: AVAudioFormat
    private let converter: AVAudioConverter?
    private let stream: AsyncStream<AnalyzerInput>
    private let continuation: AsyncStream<AnalyzerInput>.Continuation
    private var resultsTask: Task<Void, Never>?
    private var utterance = 0
    private var revision = 0
    private let onUpdate: (TranscriptUpdate) -> Void
    private let onFailure: (SpeechFailure) -> Void

    static func prepare(
        locale: Locale, inputFormat: AVAudioFormat, contextualStrings: [String],
        onPreparing: () -> Void
    ) async throws -> (DictationTranscriber, SpeechAnalyzer, AVAudioFormat) {
        let transcriber = makeTranscriber(locale)
        let status = await AssetInventory.status(forModules: [transcriber])
        if status != .installed {
            onPreparing()
            let reserved = await AssetInventory.reservedLocales
            if !reserved.contains(where: { $0.identifier == locale.identifier }),
                reserved.count < AssetInventory.maximumReservedLocales
            {
                _ = try? await AssetInventory.reserve(locale: locale)
            }
            do {
                if let request = try await AssetInventory.assetInstallationRequest(
                    supporting: [transcriber])
                {
                    try await request.downloadAndInstall()
                }
            } catch {
                throw SpeechFailure(
                    code: "assets-unavailable",
                    message: "speech model for \(locale.identifier) could not be installed: \(error.localizedDescription)")
            }
        }
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        guard
            let format = await SpeechAnalyzer.bestAvailableAudioFormat(
                compatibleWith: [transcriber], considering: inputFormat)
        else {
            throw SpeechFailure(code: "recognizer-unavailable", message: "no audio format for the analyzer")
        }
        try await analyzer.prepareToAnalyze(in: format)
        if !contextualStrings.isEmpty {
            let context = AnalysisContext()
            context.contextualStrings[.general] = contextualStrings
            try? await analyzer.setContext(context)
        }
        return (transcriber, analyzer, format)
    }

    init(
        transcriber: DictationTranscriber, analyzer: SpeechAnalyzer, inputFormat: AVAudioFormat,
        analyzerFormat: AVAudioFormat, onUpdate: @escaping (TranscriptUpdate) -> Void,
        onFailure: @escaping (SpeechFailure) -> Void
    ) async throws {
        self.transcriber = transcriber
        self.analyzer = analyzer
        self.inputFormat = inputFormat
        self.analyzerFormat = analyzerFormat
        self.converter =
            inputFormat == analyzerFormat ? nil : AVAudioConverter(from: inputFormat, to: analyzerFormat)
        self.onUpdate = onUpdate
        self.onFailure = onFailure
        (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
        let transcriber = self.transcriber
        resultsTask = Task { [weak self] in
            do {
                for try await result in transcriber.results {
                    self?.handle(result)
                }
            } catch is CancellationError {
            } catch {
                self?.onFailure(
                    SpeechFailure(code: "recognition-failed", message: error.localizedDescription))
            }
        }
        try await analyzer.start(inputSequence: stream)
    }

    private func handle(_ result: DictationTranscriber.Result) {
        var segments: [[String: Any]] = []
        let attributed = result.text
        for run in attributed.runs {
            let piece = String(attributed[run.range].characters)
            if piece.isEmpty { continue }
            let range = run[AttributeScopes.SpeechAttributes.TimeRangeAttribute.self]
            segments.append(
                segmentDictionary(
                    piece, range.flatMap { milliseconds($0.start) },
                    range.flatMap { milliseconds($0.end) }))
        }
        revision += 1
        let update = TranscriptUpdate(
            utterance: utterance, revision: revision, isFinal: result.isFinal,
            text: String(attributed.characters), startMs: milliseconds(result.range.start),
            endMs: milliseconds(result.range.end), segments: segments)
        if result.isFinal {
            utterance += 1
            revision = 0
        }
        onUpdate(update)
    }

    func append(_ buffer: AVAudioPCMBuffer, elapsedMs: Int, quietForMs: Int) {
        guard let converter else {
            continuation.yield(AnalyzerInput(buffer: buffer))
            return
        }
        let ratio = analyzerFormat.sampleRate / inputFormat.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 16
        guard let output = AVAudioPCMBuffer(pcmFormat: analyzerFormat, frameCapacity: capacity) else {
            return
        }
        var consumed = false
        var error: NSError?
        converter.convert(to: output, error: &error) { _, status in
            if consumed {
                status.pointee = .noDataNow
                return nil
            }
            consumed = true
            status.pointee = .haveData
            return buffer
        }
        if let error {
            log("audio conversion failed: \(error.localizedDescription)")
            return
        }
        if output.frameLength > 0 { continuation.yield(AnalyzerInput(buffer: output)) }
    }

    func finish(_ completion: @escaping () -> Void) {
        continuation.finish()
        let analyzer = self.analyzer
        let resultsTask = self.resultsTask
        Task {
            do {
                try await analyzer.finalizeAndFinishThroughEndOfInput()
            } catch {
                self.onFailure(
                    SpeechFailure(
                        code: "recognition-failed",
                        message: "finalization failed: \(error.localizedDescription)"))
                await analyzer.cancelAndFinishNow()
            }
            await resultsTask?.value
            completion()
        }
    }

    func cancel() {
        continuation.finish()
        resultsTask?.cancel()
        let analyzer = self.analyzer
        Task { await analyzer.cancelAndFinishNow() }
    }
}

/// SFSpeechRecognizer fallback. A request covers one utterance; the next
/// utterance starts after a pause so finalized text arrives per phrase rather
/// than only at the end, and long dictation stays under the per-request limit.
final class RecognizerBackend: SpeechBackend, @unchecked Sendable {
    private struct Utterance {
        let id: Int
        let request: SFSpeechAudioBufferRecognitionRequest
        var task: SFSpeechRecognitionTask?
        let offsetMs: Int
        var revision = 0
        var lastText = ""
        var final = false
    }

    private static let pauseRollMs = 1_200
    private static let maxUtteranceMs = 50_000

    private let recognizer: SFSpeechRecognizer
    private let contextualStrings: [String]
    private let onUpdate: (TranscriptUpdate) -> Void
    private let lock = NSLock()
    private var utterances: [Int: Utterance] = [:]
    private var currentId: Int?
    private var nextId = 0
    private var finishing: (() -> Void)?
    private var cancelled = false

    init(
        recognizer: SFSpeechRecognizer, contextualStrings: [String],
        onUpdate: @escaping (TranscriptUpdate) -> Void
    ) {
        self.recognizer = recognizer
        self.contextualStrings = contextualStrings
        self.onUpdate = onUpdate
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        recognizer.queue = queue
    }

    private func begin(at elapsedMs: Int) -> Int {
        let id = nextId
        nextId += 1
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.addsPunctuation = true
        request.taskHint = .dictation
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        if !contextualStrings.isEmpty { request.contextualStrings = contextualStrings }
        utterances[id] = Utterance(id: id, request: request, offsetMs: elapsedMs)
        let task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            self?.handle(id: id, result: result, error: error)
        }
        utterances[id]?.task = task
        currentId = id
        return id
    }

    private func handle(id: Int, result: SFSpeechRecognitionResult?, error: Error?) {
        lock.lock()
        guard !cancelled, var utterance = utterances[id], !utterance.final else {
            lock.unlock()
            return
        }
        var update: TranscriptUpdate?
        if let result {
            let transcription = result.bestTranscription
            let text = transcription.formattedString
            let ns = text as NSString
            var segments: [[String: Any]] = []
            var cursor = 0
            var startMs: Int?
            var endMs: Int?
            for segment in transcription.segments {
                let range = segment.substringRange
                if range.location > cursor {
                    segments.append(
                        segmentDictionary(
                            ns.substring(with: NSRange(location: cursor, length: range.location - cursor)),
                            nil, nil))
                }
                let begin = utterance.offsetMs + Int((segment.timestamp * 1000).rounded())
                let end = begin + Int((segment.duration * 1000).rounded())
                segments.append(segmentDictionary(ns.substring(with: range), begin, end))
                startMs = startMs ?? begin
                endMs = end
                cursor = range.location + range.length
            }
            if cursor < ns.length {
                segments.append(segmentDictionary(ns.substring(from: cursor), nil, nil))
            }
            utterance.revision += 1
            utterance.lastText = text
            utterance.final = result.isFinal
            update = TranscriptUpdate(
                utterance: id, revision: utterance.revision, isFinal: result.isFinal, text: text,
                startMs: startMs ?? utterance.offsetMs, endMs: endMs, segments: segments)
        } else if error != nil {
            // "No speech detected" and the request limit both end here; seal
            // whatever was last heard so an interim never lingers.
            if let error { log("recognition task \(id) ended: \(error.localizedDescription)") }
            utterance.revision += 1
            utterance.final = true
            update = TranscriptUpdate(
                utterance: id, revision: utterance.revision, isFinal: true, text: utterance.lastText,
                startMs: utterance.offsetMs, endMs: nil, segments: [])
        }
        utterances[id] = utterance
        if utterance.final, currentId == id { currentId = nil }
        let completion = drainedCompletion()
        lock.unlock()
        if let update { onUpdate(update) }
        completion?()
    }

    /// Caller holds `lock`.
    private func drainedCompletion() -> (() -> Void)? {
        guard let finishing, utterances.values.allSatisfy({ $0.final }) else { return nil }
        self.finishing = nil
        return finishing
    }

    func append(_ buffer: AVAudioPCMBuffer, elapsedMs: Int, quietForMs: Int) {
        lock.lock()
        defer { lock.unlock() }
        guard finishing == nil, !cancelled else { return }
        if let id = currentId, let utterance = utterances[id] {
            let heard = !utterance.lastText.isEmpty
            if (heard && quietForMs >= Self.pauseRollMs)
                || elapsedMs - utterance.offsetMs >= Self.maxUtteranceMs
            {
                utterance.request.endAudio()
                currentId = nil
            }
        }
        if currentId == nil {
            // During a pause, wait for voice before opening the next request.
            if quietForMs >= Self.pauseRollMs, !utterances.isEmpty { return }
            _ = begin(at: elapsedMs)
        }
        if let id = currentId { utterances[id]?.request.append(buffer) }
    }

    func finish(_ completion: @escaping () -> Void) {
        lock.lock()
        if let id = currentId { utterances[id]?.request.endAudio() }
        currentId = nil
        finishing = completion
        let ready = drainedCompletion()
        lock.unlock()
        ready?()
    }

    func cancel() {
        lock.lock()
        cancelled = true
        let tasks = utterances.values.compactMap { $0.task }
        lock.unlock()
        tasks.forEach { $0.cancel() }
    }
}

// MARK: - Session

struct StartOptions {
    let sessionId: String
    let locale: String?
    let contextualStrings: [String]
    let silenceMs: Int
    let maxMs: Int?
    let micAudioPath: String?
}

/// State is confined to `queue`, except audio-thread fields guarded by `lock`.
final class Session: @unchecked Sendable {
    private enum Phase { case idle, preparing, listening, finalizing, ended }

    /// Normalized input level that counts as voice for the silence timer.
    private static let voiceLevel: Float = 0.3
    private static let levelIntervalMs = 33
    private static let finalizeWatchdogSeconds = 8.0

    private let queue = DispatchQueue(label: "dock-speech.session")
    private let lock = NSLock()
    private var phase = Phase.idle
    private var options: StartOptions?
    private var engine: AVAudioEngine?
    private var backend: SpeechBackend?
    private var micFile: AVAudioFile?
    private var micAudioWritten = false
    private var configObserver: NSObjectProtocol?
    private var finalizationFailed = false

    // Audio-thread state (including the mic file), guarded by `lock`.
    private var sampleRate: Double = 0
    private var frames: Int64 = 0
    private var lastVoiceMs = 0
    private var levelPeak: Float = 0
    private var lastLevelMs = -1_000
    private var autoStopRequested = false
    private var suppressTranscripts = false

    private var elapsedMs: Int {
        sampleRate > 0 ? Int((Double(frames) / sampleRate * 1000).rounded()) : 0
    }

    func command(_ object: [String: Any]) {
        queue.async { self.dispatch(object) }
    }

    private func dispatch(_ object: [String: Any]) {
        switch object["cmd"] as? String {
        case "start": start(object)
        case "mark": mark(object["markId"] as? String)
        case "activity": activity()
        case "stop": stop(.stopped)
        case "cancel": cancel()
        default:
            send(["type": "error", "code": "bad-command", "message": "unknown command", "fatal": false])
        }
    }

    // MARK: start

    private func start(_ object: [String: Any]) {
        guard phase == .idle, let sessionId = object["sessionId"] as? String, !sessionId.isEmpty else {
            send([
                "type": "error", "code": "bad-command",
                "message": phase == .idle ? "start requires sessionId" : "session already started",
                "fatal": false,
            ])
            return
        }
        let silence = (object["silenceMs"] as? NSNumber)?.intValue ?? 8_000
        options = StartOptions(
            sessionId: sessionId,
            locale: object["locale"] as? String,
            contextualStrings: (object["contextualStrings"] as? [String]) ?? [],
            silenceMs: max(1_000, silence),
            maxMs: (object["maxMs"] as? NSNumber)?.intValue,
            micAudioPath: object["micAudioPath"] as? String)
        phase = .preparing
        send(["type": "state", "state": "preparing"])
        Task { await self.prepare() }
    }

    private func prepare() async {
        guard let options else { return }
        let speech = await requestSpeechAuthorization()
        if speech != .authorized {
            return fail(
                speech == .restricted ? "speech-permission-restricted" : "speech-permission-denied",
                "speech recognition authorization: \(speechStatusName(speech))")
        }
        let microphone = await requestMicrophoneAuthorization()
        if microphone != .authorized {
            return fail(
                microphone == .restricted ? "microphone-permission-restricted" : "microphone-permission-denied",
                "microphone authorization: \(microphoneStatusName(microphone))")
        }
        guard AVCaptureDevice.default(for: .audio) != nil else {
            return fail("no-input-device", "no audio input device")
        }
        guard let choice = await chooseEngine(options.locale) else {
            return fail(
                options.locale == nil ? "recognizer-unavailable" : "locale-unsupported",
                "no speech recognizer for \(options.locale ?? Locale.current.identifier)")
        }
        let engine = AVAudioEngine()
        let inputFormat = engine.inputNode.outputFormat(forBus: 0)
        guard inputFormat.sampleRate > 0, inputFormat.channelCount > 0 else {
            return fail("no-input-device", "audio input reports no channels")
        }
        if isEnded() { return }

        var backend: SpeechBackend?
        var engineName = "recognizer"
        var localeId = ""
        var onDevice = false
        if case .analyzer(let locale) = choice, #available(macOS 26.0, *) {
            do {
                let (transcriber, analyzer, format) = try await AnalyzerBackend.prepare(
                    locale: locale, inputFormat: inputFormat,
                    contextualStrings: options.contextualStrings,
                    onPreparing: { send(["type": "state", "state": "preparing", "assets": "installing"]) })
                backend = try await AnalyzerBackend(
                    transcriber: transcriber, analyzer: analyzer, inputFormat: inputFormat,
                    analyzerFormat: format,
                    onUpdate: { [weak self] in self?.transcript($0) },
                    onFailure: { [weak self] failure in self?.queue.async { self?.recognitionFailed(failure) } })
                engineName = "analyzer"
                localeId = locale.identifier
                onDevice = true
            } catch {
                let failure = error as? SpeechFailure
                log("analyzer unavailable (\(failure?.message ?? error.localizedDescription)); trying SFSpeechRecognizer")
                if recognizerFor(options.locale) == nil {
                    return fail(failure?.code ?? "recognizer-unavailable", failure?.message ?? error.localizedDescription)
                }
            }
        }
        if backend == nil {
            guard let recognizer = recognizerFor(options.locale) else {
                return fail("recognizer-unavailable", "no speech recognizer available")
            }
            backend = RecognizerBackend(
                recognizer: recognizer, contextualStrings: options.contextualStrings,
                onUpdate: { [weak self] in self?.transcript($0) })
            localeId = recognizer.locale.identifier
            onDevice = recognizer.supportsOnDeviceRecognition
        }
        queue.async {
            self.begin(engine: engine, format: inputFormat, backend: backend!, engineName: engineName,
                       locale: localeId, onDevice: onDevice)
        }
    }

    private func begin(
        engine: AVAudioEngine, format: AVAudioFormat, backend: SpeechBackend, engineName: String,
        locale: String, onDevice: Bool
    ) {
        guard phase == .preparing, let options else {
            backend.cancel()
            return
        }
        self.engine = engine
        self.backend = backend
        if let path = options.micAudioPath {
            do {
                let file = try AVAudioFile(
                    forWriting: URL(fileURLWithPath: path), settings: format.settings,
                    commonFormat: format.commonFormat, interleaved: format.isInterleaved)
                lock.lock()
                micFile = file
                lock.unlock()
            } catch {
                send([
                    "type": "error", "code": "audio-engine-failed",
                    "message": "cannot write mic audio: \(error.localizedDescription)", "fatal": false,
                ])
            }
        }
        lock.lock()
        sampleRate = format.sampleRate
        frames = 0
        lastVoiceMs = 0
        lock.unlock()
        engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.audio(buffer)
        }
        configObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
        ) { [weak self] _ in
            self?.queue.async {
                send(["type": "error", "code": "no-input-device", "message": "audio input changed", "fatal": false])
                self?.stop(.error)
            }
        }
        do {
            engine.prepare()
            try engine.start()
        } catch {
            backend.cancel()
            return fail("audio-engine-failed", error.localizedDescription)
        }
        phase = .listening
        send([
            "type": "ready", "sessionId": options.sessionId, "engine": engineName, "locale": locale,
            "onDevice": onDevice, "sampleRate": Int(format.sampleRate),
            "startedAtEpochMs": Int((Date().timeIntervalSince1970 * 1000).rounded()),
        ])
        send(["type": "state", "state": "listening"])
    }

    // MARK: audio thread

    private func audio(_ buffer: AVAudioPCMBuffer) {
        let level = Self.normalizedLevel(buffer)
        lock.lock()
        frames += Int64(buffer.frameLength)
        let now = elapsedMs
        if level >= Self.voiceLevel { lastVoiceMs = now }
        let quietFor = now - lastVoiceMs
        levelPeak = max(levelPeak, level)
        var emitLevel: Float?
        if now - lastLevelMs >= Self.levelIntervalMs {
            emitLevel = levelPeak
            levelPeak = 0
            lastLevelMs = now
        }
        var autoStop: EndReason?
        if !autoStopRequested, let options {
            if quietFor >= options.silenceMs {
                autoStop = .silence
            } else if let maxMs = options.maxMs, now >= maxMs {
                autoStop = .maxDuration
            }
            if autoStop != nil { autoStopRequested = true }
        }
        lock.unlock()

        lock.lock()
        if let micFile {
            do {
                try micFile.write(from: buffer)
                micAudioWritten = true
            } catch {
                log("mic audio write failed: \(error.localizedDescription)")
            }
        }
        lock.unlock()
        backend?.append(buffer, elapsedMs: now, quietForMs: quietFor)
        if let emitLevel {
            send(["type": "level", "elapsedMs": now, "level": (Double(emitLevel) * 1000).rounded() / 1000])
        }
        if let autoStop { queue.async { self.stop(autoStop) } }
    }

    /// RMS mapped from -55…-10 dBFS onto 0…1.
    static func normalizedLevel(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let channels = buffer.floatChannelData, buffer.frameLength > 0 else { return 0 }
        let samples = channels[0]
        let count = Int(buffer.frameLength)
        var sum: Float = 0
        for index in 0..<count { sum += samples[index] * samples[index] }
        let rms = (sum / Float(count)).squareRoot()
        guard rms > 0 else { return 0 }
        let decibels = 20 * log10(rms)
        return min(1, max(0, (decibels + 55) / 45))
    }

    // MARK: events

    private func transcript(_ update: TranscriptUpdate) {
        lock.lock()
        let suppressed = suppressTranscripts
        if let endMs = update.endMs, !update.text.isEmpty { lastVoiceMs = max(lastVoiceMs, min(endMs, elapsedMs)) }
        lock.unlock()
        if suppressed { return }
        send([
            "type": "transcript", "utterance": update.utterance, "revision": update.revision,
            "isFinal": update.isFinal, "text": update.text,
            "startMs": update.startMs as Any? ?? NSNull(), "endMs": update.endMs as Any? ?? NSNull(),
            "segments": update.segments,
        ])
    }

    private func mark(_ markId: String?) {
        guard let markId, !markId.isEmpty else {
            send(["type": "error", "code": "bad-command", "message": "mark requires markId", "fatal": false])
            return
        }
        guard phase == .listening || phase == .preparing else {
            send(["type": "error", "code": "bad-command", "message": "mark outside a live session", "fatal": false])
            return
        }
        lock.lock()
        let now = elapsedMs
        // A click on the screen is the person working, not silence.
        lastVoiceMs = max(lastVoiceMs, now)
        lock.unlock()
        send(["type": "mark", "markId": markId, "elapsedMs": now])
    }

    /// Annotating (a tool bar click, a gesture) keeps the silence timer from ending
    /// dictation: the person is pointing, not done talking. No event is sent.
    private func activity() {
        guard phase == .listening || phase == .preparing else { return }
        lock.lock()
        lastVoiceMs = max(lastVoiceMs, elapsedMs)
        lock.unlock()
    }

    // MARK: lifecycle

    enum EndReason: String {
        case stopped, cancelled, silence, error
        case maxDuration = "max-duration"
    }

    private func isEnded() -> Bool {
        queue.sync { phase == .ended }
    }

    private func stopAudio() {
        if let configObserver { NotificationCenter.default.removeObserver(configObserver) }
        configObserver = nil
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
        lock.lock()
        micFile = nil
        lock.unlock()
    }

    private func stop(_ reason: EndReason) {
        switch phase {
        case .idle:
            end(reason)
        case .preparing:
            // Nothing heard yet: there is nothing to finalize.
            backend?.cancel()
            end(reason)
        case .listening:
            phase = .finalizing
            send(["type": "state", "state": "finalizing"])
            stopAudio()
            var finished = false
            let complete: () -> Void = { [weak self] in
                self?.queue.async {
                    guard let self, !finished else { return }
                    finished = true
                    // A fatal recognition error during finalization was already
                    // reported; the session must not then claim a clean stop.
                    self.end(self.finalizationFailed ? .error : reason)
                }
            }
            backend?.finish(complete)
            queue.asyncAfter(deadline: .now() + Self.finalizeWatchdogSeconds) { [weak self] in
                guard let self, !finished, self.phase == .finalizing else { return }
                finished = true
                // Words already delivered stay with the caller; the session
                // ends as an error so the stop barrier never reads as clean.
                send(["type": "error", "code": "recognition-failed", "message": "finalization timed out", "fatal": true])
                self.backend?.cancel()
                self.end(.error)
            }
        case .finalizing, .ended:
            return
        }
    }

    private func cancel() {
        lock.lock()
        suppressTranscripts = true
        lock.unlock()
        guard phase != .ended else { return }
        stopAudio()
        backend?.cancel()
        end(.cancelled)
    }

    private func recognitionFailed(_ failure: SpeechFailure) {
        guard phase == .listening || phase == .finalizing else { return }
        send(["type": "error", "code": failure.code, "message": failure.message, "fatal": true])
        if phase == .finalizing { finalizationFailed = true }
        if phase == .listening {
            stopAudio()
            backend?.cancel()
            end(.error)
        }
    }

    private func fail(_ code: String, _ message: String) {
        queue.async {
            guard self.phase != .ended else { return }
            send(["type": "error", "code": code, "message": message, "fatal": true])
            self.stopAudio()
            self.backend?.cancel()
            self.end(.error)
        }
    }

    private func end(_ reason: EndReason) {
        guard phase != .ended else { return }
        phase = .ended
        lock.lock()
        let now = elapsedMs
        let wroteMic = micAudioWritten
        micFile = nil
        lock.unlock()
        var event: [String: Any] = ["type": "ended", "reason": reason.rawValue, "elapsedMs": now]
        if let path = options?.micAudioPath {
            if wroteMic && reason != .cancelled {
                event["micAudioPath"] = path
            } else {
                try? FileManager.default.removeItem(atPath: path)
            }
        }
        send(event)
        exit(0)
    }

    /// stdin closed: the parent is gone, so nothing may keep the mic open.
    func inputClosed() {
        queue.async { self.cancel() }
        queue.async { exit(0) }
    }
}

// MARK: - Entry

func serve() -> Never {
    let session = Session()
    Thread.detachNewThread {
        while let line = readLine(strippingNewline: true) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { continue }
            guard let data = trimmed.data(using: .utf8),
                let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            else {
                send(["type": "error", "code": "bad-command", "message": "invalid JSON", "fatal": false])
                continue
            }
            session.command(object)
        }
        session.inputClosed()
    }
    dispatchMain()
}

let arguments = Array(CommandLine.arguments.dropFirst())
func argument(_ flag: String) -> String? {
    guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}

if arguments.first == "--probe" {
    let locale = argument("--locale")
    Task { await probe(locale) }
    dispatchMain()
} else if arguments == ["--serve"] {
    serve()
} else {
    send(["type": "error", "code": "bad-arguments", "message": "usage: intent-dock-speech --probe [--locale <bcp47>] | --serve", "fatal": true])
    exit(2)
}
