import {
  consumeEditedCaptureEnvelope,
  dockCaptureDisplayCandidates,
  editedCaptureCards,
  type CaptureResource,
  type EditedCapture,
} from '$lib/utils/dock-evidence-display';
import { consumeDockEvidencePrefix } from '$lib/utils/parseStoredMessage';
type QueueResource = Omit<CaptureResource, 'type'> & { type?: string };

interface CaptureDisplay {
  text: string;
  captures: EditedCapture[];
}

/** Display only: exact producer metadata owns its adjacent envelopes. Resource
 * joins remain separately required for cards, never for hiding generated text. */
export function queuedCaptureDisplay(group: CaptureUnit): CaptureDisplay {
  const original = { text: group.content, captures: [] };
  const candidates = dockCaptureDisplayCandidates(group.messageMetadata);
  // Inspect Screen without trusting it yet: only an exact adjacent Edited
  // envelope from one contribution can vouch for the pair.
  const screen = consumeDockEvidencePrefix(group.content, { trusted: true });
  const text = screen?.remaining ?? group.content;
  const matches = candidates.flatMap((metadata) => {
    const envelope = consumeEditedCaptureEnvelope(text, metadata);
    return envelope ? [{ metadata, envelope }] : [];
  });
  if (matches.length !== 1) return original;
  const { metadata, envelope } = matches[0];
  // Queue arrays own the resource kind; contradictory explicit tags are refused.
  const blocks: CaptureResource[] = [
    ...(group.imageBlocks ?? [])
      .filter((b) => b.type === undefined || b.type === 'image')
      .map((b) => ({ ...b, type: 'image' })),
    ...(group.fileBlocks ?? [])
      .filter((b) => b.type === undefined || b.type === 'file')
      .map((b) => ({ ...b, type: 'file' })),
  ];
  return { text: envelope.remaining, captures: editedCaptureCards(metadata, blocks) };
}

/** Retain the small summary API for callers that do not render cards. */
export function queuedCapturePresentation(group: CaptureUnit): {
  text: string;
  captureSummary: Array<'screenshot' | 'recording'>;
} {
  const display = queuedCaptureDisplay(group);
  return { text: display.text, captureSummary: display.captures.map((capture) => capture.kind) };
}

interface CaptureUnit {
  content: string;
  messageMetadata?: Record<string, unknown>;
  imageBlocks?: readonly QueueResource[];
  fileBlocks?: readonly QueueResource[];
}
/** A single wrapper may be a projection of the whole confirmed row. Only that
 * identical unit can inherit its provenance; multi-unit groups need their own. */
export function queuedCaptureGroup(
  message: CaptureUnit & { deliveryGroups?: readonly CaptureUnit[] },
  group: CaptureUnit,
): CaptureUnit {
  if (
    group.messageMetadata !== undefined ||
    message.deliveryGroups?.length !== 1 ||
    group.content !== message.content
  )
    return group;
  const references = (unit: CaptureUnit) =>
    JSON.stringify([
      (unit.imageBlocks ?? []).map((b) => [b.attachmentId, b.type ?? 'image', b.mimeType]),
      (unit.fileBlocks ?? []).map((b) => [b.attachmentId, b.type ?? 'file', b.mimeType]),
    ]);
  return references(group) === references(message)
    ? { ...group, messageMetadata: message.messageMetadata }
    : group;
}
