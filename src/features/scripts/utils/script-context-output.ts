import { appClient } from '$lib/client';
import { scriptOutputToLines } from '$lib/utils/script-output-text';
import {
  selectCanReadScriptDefinition,
  selectScriptById,
  selectScriptOutput,
} from '$store/renderer/slices/scripts/scripts-selectors';
import type { StoreState } from '$store/renderer/types';

/** `script.output` reply when the daemon has nothing buffered for the script. */
const NO_OUTPUT_SENTINEL = 'No output yet.';

/**
 * The last `maxLines` output lines of a script, for agent context.
 *
 * The renderer buffers live chunks only while an output viewer is mounted
 * (the `script:output` stream is not subscribed otherwise), so an empty live
 * buffer falls back to the daemon's retained output via `script.output`.
 */
export async function readScriptContextOutputLines(
  state: StoreState,
  workspaceId: string | null,
  scriptId: string,
  maxLines = 100,
): Promise<string[]> {
  const live = scriptOutputToLines(selectScriptOutput.select(state, workspaceId, scriptId));
  if (live.length > 0 || !workspaceId || !scriptId) return live.slice(-maxLines);
  const script = selectScriptById.select(state, workspaceId, scriptId);
  if (!selectCanReadScriptDefinition.select(state, workspaceId, script)) return [];
  try {
    const text = await appClient.scripts.output(workspaceId, scriptId, maxLines);
    if (!text || text.trim() === NO_OUTPUT_SENTINEL) return [];
    return text.replace(/\n$/, '').split('\n').slice(-maxLines);
  } catch {
    return [];
  }
}
