import Foundation

@main struct TranscriptAccumulatorRegression {
  static func main() {
    func timed(_ text: String, _ start: Double, _ end: Double) -> MediaTranscriptUnit {
      MediaTranscriptUnit(text: text, startMs: start, endMs: end, alignment: "word")
    }
    func text(_ value: MediaTranscriptAccumulator) -> String { value.units.map(\.text).joined() }
    var chunks = MediaTranscriptAccumulator()
    chunks.receive([timed("opening", 210, 2200)], isFinal: false)
    chunks.receive([timed("middle", 0, 0)], isFinal: false)
    chunks.receive([timed("middle", 12960, 15100)], isFinal: false)
    chunks.receive([timed("closing", 27930, 30300)], isFinal: false)
    chunks.receive([], isFinal: true)
    precondition(text(chunks) == "opening middle closing", "Pause resets lost an earlier utterance")
    precondition(chunks.units.compactMap(\.startMs) == [210, 12960, 27930])
    var revised = MediaTranscriptAccumulator()
    revised.receive([timed("old", 200, 1200)], isFinal: false)
    revised.receive([timed("corrected", 200, 1400)], isFinal: false)
    precondition(text(revised) == "corrected", "A revised utterance duplicated its prior hypothesis")
    revised.receive([timed("corrected", 200, 1400), MediaTranscriptUnit(text: " ", startMs: nil, endMs: nil, alignment: "untimed"), timed("tail", 2000, 2500)], isFinal: true)
    precondition(text(revised) == "corrected tail", "Cumulative final result duplicated confirmed spans")
    var empty = MediaTranscriptAccumulator()
    empty.receive([timed("guess", 0, 0)], isFinal: false)
    empty.receive([], isFinal: true)
    precondition(empty.units.isEmpty, "Untimed provisional text was promoted as confirmed speech")
    var fallback = MediaTranscriptAccumulator()
    fallback.receive([timed("untimed", 0, 0)], isFinal: true)
    precondition(text(fallback) == "untimed" && fallback.units.allSatisfy { $0.startMs == nil && $0.alignment == "untimed" })
    var unchanged = chunks
    unchanged.receive([timed("guess", 0, 0)], isFinal: false)
    precondition(text(unchanged) == text(chunks), "A provisional reset erased confirmed utterances")
    var rolling = MediaTranscriptAccumulator()
    rolling.receive([timed("opening", 200, 1200),
      MediaTranscriptUnit(text: " ", startMs: nil, endMs: nil, alignment: "untimed"),
      timed("outdated", 12900, 14000)], isFinal: false)
    rolling.receive([timed("corrected", 12800, 15000),
      MediaTranscriptUnit(text: " ", startMs: nil, endMs: nil, alignment: "untimed"),
      timed("closing", 28000, 29000)], isFinal: true)
    precondition(text(rolling) == "opening corrected closing", "Rolling overlap erased the nonoverlapped prefix")
    var deletion = MediaTranscriptAccumulator()
    deletion.receive([timed("keep", 200, 1000), timed("deleted", 1500, 2000)], isFinal: false)
    deletion.receive([timed("keep", 200, 1000)], isFinal: true)
    precondition(text(deletion) == "keep", "A same-start revision retained a deleted tail")
    var leadingDeletion = MediaTranscriptAccumulator()
    leadingDeletion.receive([timed("deleted", 200, 500), timed("keep", 600, 1000)], isFinal: false, utteranceStartMs: 200)
    leadingDeletion.receive([timed("keep", 600, 1000)], isFinal: true, utteranceStartMs: 200)
    precondition(text(leadingDeletion) == "keep", "A revision retained a deleted first word from the same utterance")
    print("{\"cases\":9,\"passed\":true,\"syntheticOnly\":true,\"firstStartMs\":210,\"lastStartMs\":27930}")
  }
}
