/**
 * HUD question capture — pure extraction of §7.1 question resource blocks
 * from a daemon `agent:stream:end` event (PROTOCOL §7: `trailingBlocks`
 * carries the drained `AtTurnEnd` question attachments, byte-identical to the
 * persisted message's trailing blocks). Returns one `HudCapturedQuestion` per
 * decodable `application/vnd.intent.question+json` block, in wire order.
 */
import type { WorkspaceEvent } from '$features/events/types';
import type { HudCapturedQuestion } from '$store/renderer/slices/hud/hud-slice';

/** §7.1 question attachment MIME type. */
export const HUD_QUESTION_MIME = 'application/vnd.intent.question+json';

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Extract captured questions from an `agent:stream:end` event; [] otherwise. */
export function extractQuestionsFromStreamEnd(event: WorkspaceEvent): HudCapturedQuestion[] {
  if (event.type !== 'agent:stream:end') return [];
  const workspaceId = str(event.workspaceId);
  const data =
    event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {};
  const agentId = str(data.agentId);
  if (!workspaceId || !agentId || !Array.isArray(data.trailingBlocks)) return [];
  const ts = str(event.timestamp) ?? '';
  const questions: HudCapturedQuestion[] = [];
  for (const block of data.trailingBlocks) {
    if (!block || typeof block !== 'object') continue;
    const resource = (block as { resource?: unknown }).resource;
    if (!resource || typeof resource !== 'object') continue;
    const { mimeType, text } = resource as { mimeType?: unknown; text?: unknown };
    if (mimeType !== HUD_QUESTION_MIME || typeof text !== 'string') continue;
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      continue;
    }
    if (!payload || typeof payload !== 'object') continue;
    const header = str((payload as { header?: unknown }).header);
    const question = str((payload as { question?: unknown }).question);
    if (!header || !question) continue;
    questions.push({ workspaceId, agentId, header, question, ts });
  }
  return questions;
}
