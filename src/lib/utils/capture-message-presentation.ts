import { consumeDockEvidencePrefix } from './parseStoredMessage';
import {
  consumeEditedCaptureEnvelope,
  dockCaptureDisplayCandidates,
} from './dock-evidence-display';

interface CaptureMessagePresentation {
  text: string;
  /** Only an exactly matched Edited envelope owns capture cards. */
  captureMetadata?: Record<string, unknown>;
}

/** Display-only projection. Never use this copy to reconstruct editing or send payloads. */
export function captureMessagePresentation(
  content: string,
  metadata?: Record<string, unknown> | null,
): CaptureMessagePresentation {
  const original = { text: content };
  const candidates = dockCaptureDisplayCandidates(metadata);
  // Inspect Screen without trusting it yet: only an exact adjacent Edited
  // envelope from one contribution can vouch for the pair.
  const screen = consumeDockEvidencePrefix(content, { trusted: true });
  const text = screen?.remaining ?? content;
  const matches = candidates.flatMap((metadata) => {
    const envelope = consumeEditedCaptureEnvelope(text, metadata);
    return envelope ? [{ metadata, envelope }] : [];
  });
  if (matches.length !== 1) {
    // Ordinary screenshots have no Edited envelope. Only the unit's own
    // provenance (or a genuinely singleton batch) may own its Screen prefix;
    // a candidate inside a mixed batch cannot vouch for another member's text.
    const own = metadata;
    const single =
      own?.type === 'dock_screen_evidence' ||
      (Array.isArray(own?.mergedMessageMetadata) && own.mergedMessageMetadata.length === 1);
    if (
      matches.length === 0 &&
      screen &&
      single &&
      candidates.length === 1 &&
      (candidates[0].edited_captures === undefined ||
        (Array.isArray(candidates[0].edited_captures) &&
          candidates[0].edited_captures.length === 0)) &&
      !text.startsWith('[Edited capture outputs]') // i18n-ignore (persisted producer marker)
    )
      return { text: screen.remaining };
    return original;
  }
  return { text: matches[0].envelope.remaining, captureMetadata: matches[0].metadata };
}
