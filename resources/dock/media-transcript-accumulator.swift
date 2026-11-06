import Foundation

struct MediaTranscriptUnit {
  let text: String
  let startMs: Double?
  let endMs: Double?
  let alignment: String
}

/// SFSpeechRecognizer can publish a timed utterance, reset its hypothesis after
/// a pause, then finish the file with an empty result. Only timed snapshots are
/// committed before EOF; revisions replace the overlapping utterance, not the file.
struct MediaTranscriptAccumulator {
  private struct Span {
    let start: Double
    let end: Double
    let units: [MediaTranscriptUnit]
  }
  private var spans: [Span] = []
  private var fallback: [MediaTranscriptUnit] = []

  mutating func receive(_ units: [MediaTranscriptUnit], isFinal: Bool) {
    guard !units.map(\.text).joined().trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    let timed = units.filter { unit in
      guard let start = unit.startMs, let end = unit.endMs else { return false }
      return start.isFinite && end.isFinite && start >= 0 && end > start
    }
    guard let start = timed.compactMap(\.startMs).min(), let end = timed.compactMap(\.endMs).max() else {
      if isFinal && spans.isEmpty {
        fallback = units.map { MediaTranscriptUnit(text: $0.text, startMs: nil, endMs: nil, alignment: "untimed") }
      }
      return
    }
    spans.removeAll { $0.start < end && start < $0.end }
    spans.append(Span(start: start, end: end, units: units))
    spans.sort { $0.start < $1.start }
    fallback = []
  }

  var units: [MediaTranscriptUnit] {
    if spans.isEmpty { return fallback }
    var out: [MediaTranscriptUnit] = []
    for span in spans {
      if out.last?.text.last?.isWhitespace == false && span.units.first?.text.first?.isWhitespace == false {
        out.append(MediaTranscriptUnit(text: " ", startMs: nil, endMs: nil, alignment: "untimed"))
      }
      out.append(contentsOf: span.units)
    }
    return out
  }
}
