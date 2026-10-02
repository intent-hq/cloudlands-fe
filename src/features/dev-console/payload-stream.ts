import type {
  DevConsoleFrame,
  DevConsolePayload,
  DevConsoleRecord,
} from '$shared/types/dev-console';
import { formatDatePattern, formatInteger, formatNumber } from '$lib/i18n/format';
import * as m from '$shared/paraglide/messages.js';
import { payloadDocument } from './traffic-view';

function payloadStateLabel(payload: DevConsolePayload) {
  return {
    complete: m.devConsole_fullState_label,
    truncated: m.devConsole_truncated_label,
    absent: m.devConsole_absent_label,
    unserializable: m.devConsole_unserializable_label,
  }[payload.state]();
}

export function frameMetadata(frame: DevConsoleFrame) {
  const elapsed = formatNumber(frame.intervalMs, { maximumFractionDigits: 1 });
  return (
    [
      m.devConsole_payloadBytes_label({
        retained: formatInteger(frame.payload.retainedBytes),
        original:
          frame.payload.originalBytes === null
            ? m.devConsole_unknown_label()
            : formatInteger(frame.payload.originalBytes),
      }),
      payloadStateLabel(frame.payload),
    ].join(' · ') +
    '\n' +
    m.devConsole_observed_label({ time: formatDatePattern(frame.timestamp, 'HH:mm:ss.SSS') }) +
    ' · ' +
    (frame.intervalFromRequest === true
      ? m.devConsole_sinceRequest_label({ elapsed })
      : frame.intervalFromRequest === false
        ? m.devConsole_sincePrevious_label({ elapsed })
        : m.devConsole_interval_label({ elapsed }))
  );
}

/** One virtualized editor per side, irrespective of the number of retained frames. */
export function payloadSide(record: DevConsoleRecord, side: DevConsoleFrame['side']) {
  const original = side === 'request' ? record.payload : record.response;
  const frames =
    record.frames?.filter((frame) => frame.side === side) ??
    (original
      ? [
          {
            sequence: side === 'request' ? 0 : 1,
            side,
            rpcMethod: record.rpcMethod,
            timestamp:
              side === 'request' ? record.timestamp : (record.completedAt ?? record.timestamp),
            intervalFromRequest: record.kind === 'request' ? true : undefined,
            intervalMs: side === 'request' ? 0 : (record.durationMs ?? 0),
            payload: original,
          },
        ]
      : []);
  return {
    frames,
    text:
      frames.length === 1
        ? frames[0].payload.text
        : frames
            .map(
              (frame) =>
                `──────── #${formatInteger(frame.sequence + 1)} · ${frame.rpcMethod} ────────\n${frameMetadata(frame)}\n${payloadDocument(frame.payload.text).text}`,
            )
            .join('\n\n'),
    // Copy keeps captured whitespace and truncated prefixes, without diagnostic headings.
    copyText: frames.map((frame) => frame.payload.text).join('\n\n'),
  };
}
