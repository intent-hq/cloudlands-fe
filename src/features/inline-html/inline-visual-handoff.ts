import type { InlineVisualSnapshot } from './inline-visual-types';

/** Host-only DOM event; the opaque authored frame cannot reach its parent DOM. */
export const INLINE_VISUAL_DRAFT_EVENT = 'intent:inline-visual-draft';
export interface InlineVisualDraftDetail {
  workspaceId: string;
  agentId: string;
  snapshot: InlineVisualSnapshot;
}

export function appendInlineVisualDraft(draft: string, snapshot: InlineVisualSnapshot): string {
  const title = snapshot.title.replace(/\s+/g, ' ').trim();
  const json = JSON.stringify({ inputs: snapshot.inputs, results: snapshot.results }, null, 2);
  const longestRun = (json.match(/`+/g) ?? []).reduce(
    (length, run) => Math.max(length, run.length),
    0,
  );
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${draft}${draft ? '\n\n' : ''}${title}\n\n${fence}json\n${json}\n${fence}`;
}
