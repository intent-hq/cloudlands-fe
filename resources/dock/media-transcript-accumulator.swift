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

  mutating func receive(_ units: [MediaTranscriptUnit], isFinal: Bool, utteranceStartMs: Double? = nil) {
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
    // Metadata keeps the utterance origin stable even when a revision deletes
    // its first word. Without an origin, the snapshot's first timed unit defines
    // the replacement window. A rolling window can begin inside an older
    // cumulative snapshot: retain the genuinely earlier units, not its whole tail.
    let replacementStart = utteranceStartMs.flatMap { $0.isFinite && $0 >= 0 && $0 <= start ? $0 : nil } ?? start
    var retained: [Span] = []
    for span in spans {
      if span.end <= replacementStart || span.start >= end {
        retained.append(span)
        continue
      }
      guard span.start < replacementStart else { continue }
      var prefix: [MediaTranscriptUnit] = []
      for unit in span.units {
        if let unitStart = unit.startMs, let unitEnd = unit.endMs,
          unitStart >= replacementStart || unitEnd > replacementStart { break }
        prefix.append(unit)
      }
      while let last = prefix.last, last.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        prefix.removeLast()
      }
      if let prefixEnd = prefix.compactMap(\.endMs).max() {
        retained.append(Span(start: span.start, end: prefixEnd, units: prefix))
      }
    }
    spans = retained
    spans.append(Span(start: replacementStart, end: end, units: units))
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
