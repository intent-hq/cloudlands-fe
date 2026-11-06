import {
  consumeEditedCapturePrefix,
  editedCaptureCards,
  isDockEvidenceMessage,
  type CaptureResource,
} from '$lib/utils/dock-evidence-display';
import { consumeDockEvidencePrefix } from '$lib/utils/parseStoredMessage';

/** Display only: each delivery unit must vouch for its own prefix and resources. */
export function queuedCapturePresentation(group: {
  content: string;
  messageMetadata?: Record<string, unknown>;
  imageBlocks?: readonly CaptureResource[];
  fileBlocks?: readonly CaptureResource[];
}): { text: string; captureSummary: Array<'screenshot' | 'recording'> } {
  const original = { text: group.content, captureSummary: [] };
  if (!isDockEvidenceMessage(group.messageMetadata)) return original;
  const blocks = [...(group.imageBlocks ?? []), ...(group.fileBlocks ?? [])];
  const screen = consumeDockEvidencePrefix(group.content, { trusted: true });
  const edited = consumeEditedCapturePrefix(screen?.remaining ?? group.content, group.messageMetadata, blocks);
  // Hide neither prefix unless the edited producer payload and resource joins
  // agree; malformed or unrelated JSON remains fully visible.
  if (!edited) return original;
  return {
    text: edited.remaining,
    captureSummary: editedCaptureCards(group.messageMetadata, blocks).map((capture) => capture.kind),
  };
}
