import { appClient } from '$lib/client';
import { scriptOutputReplyLines, scriptOutputToLines } from '$lib/utils/script-output-text';
import {
  selectCanReadScriptDefinition,
  selectScriptById,
  selectScriptOutput,
} from '$store/renderer/slices/scripts/scripts-selectors';
import type { StoreState } from '$store/renderer/types';

/**
 * The last `maxLines` output lines of a script, for agent context.
 *
 * The daemon's stored output is authoritative: the renderer buffers live
 * chunks only while an output viewer is open in the workspace (the
 * `script:output` stream is not subscribed otherwise), so the live buffer may
 * hold just the tail since that viewer opened. It is the fallback when the
 * daemon read fails or has nothing.
 */
export async function readScriptContextOutputLines(
  state: StoreState,
  workspaceId: string | null,
  scriptId: string,
  maxLines = 100,
): Promise<string[]> {
  const live = scriptOutputToLines(selectScriptOutput.select(state, workspaceId, scriptId)).slice(
    -maxLines,
  );
  if (!workspaceId || !scriptId) return live;
  const script = selectScriptById.select(state, workspaceId, scriptId);
  if (!selectCanReadScriptDefinition.select(state, workspaceId, script)) return [];
  try {
    const stored = scriptOutputReplyLines(
      await appClient.scripts.output(workspaceId, scriptId, maxLines),
    );
    return stored.length > 0 ? stored.slice(-maxLines) : live;
  } catch {
    return live;
  }
}
