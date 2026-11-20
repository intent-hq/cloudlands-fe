import {
  editedCaptureCards,
  type CaptureResource,
  type EditedCapture,
} from '$lib/utils/dock-evidence-display';
import { captureMessagePresentation } from '$lib/utils/capture-message-presentation';
type QueueResource = Omit<CaptureResource, 'type'> & { type?: string };

interface CaptureDisplay {
  text: string;
  captures: EditedCapture[];
}

/** Display only: exact producer metadata owns its adjacent envelopes. Resource
 * joins remain separately required for cards, never for hiding generated text. */
export function queuedCaptureDisplay(group: CaptureUnit): CaptureDisplay {
  const display = captureMessagePresentation(group.content, group.messageMetadata);
  if (!display.captureMetadata) return { text: display.text, captures: [] };
  // Queue arrays own the resource kind; contradictory explicit tags are refused.
  const blocks: CaptureResource[] = [
    ...(group.imageBlocks ?? [])
      .filter((b) => b.type === undefined || b.type === 'image')
      .map((b) => ({ ...b, type: 'image' })),
    ...(group.fileBlocks ?? [])
      .filter((b) => b.type === undefined || b.type === 'file')
      .map((b) => ({ ...b, type: 'file' })),
  ];
  return { text: display.text, captures: editedCaptureCards(display.captureMetadata, blocks) };
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
