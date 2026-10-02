import {
  getScriptMonitorWakeAttribution,
  type ScriptMonitorWakeAttribution,
} from '$lib/utils/script-monitor-wake-attribution';
import type { AgentMessage } from '$shared/types';
import { extractAllContent } from '$shared/types';
import {
  getHookWakeAttribution,
  stripHookWakePrefix,
  stripHookWakeStateNote,
  type HookWakeAttribution,
} from '$lib/utils/hook-wake-attribution';
import {
  getPrMonitorWakeAttribution,
  stripPrMonitorWakePrefix,
  type PrMonitorWakeAttribution,
} from '$lib/utils/pr-monitor-wake-attribution';
import { getQueueInfo, stripDequeueWaitNote, type QueueInfo } from '$lib/utils/queue-info';

export type AutomatedWakePresentation =
  | {
      kind: 'script';
      attribution: ScriptMonitorWakeAttribution;
      bodyText: string;
      queueInfo: QueueInfo | null;
      state: 'delivered';
    }
  | {
      kind: 'hook';
      attribution: HookWakeAttribution;
      bodyText: string;
      queueInfo: QueueInfo | null;
      state: 'active' | 'retired' | 'delivered';
    }
  | {
      kind: 'pr';
      attribution: PrMonitorWakeAttribution;
      bodyText: string;
      queueInfo: QueueInfo | null;
      state: 'delivered';
    };

function metadataCandidates(message: AgentMessage): unknown[] {
  const candidates: unknown[] = [message.metadata];
  for (const block of message.contentBlocks ?? []) {
    if (block.type === 'text') candidates.push(block.messageMetadata);
  }
  return candidates;
}

function hookState(attribution: HookWakeAttribution): 'active' | 'retired' | 'delivered' {
  if (attribution.reason === 'evicted') return 'retired';
  if (attribution.reason === 'dispatched' && attribution.hookStillActive === true) return 'active';
  if (attribution.reason === 'dispatched' && attribution.hookStillActive === false)
    return 'retired';
  return 'delivered';
}

export function getAutomatedWakePresentation(
  message: AgentMessage | null | undefined,
): AutomatedWakePresentation | null {
  if (!message || String(message.role).toLowerCase() !== 'user') return null;

  const rawText = extractAllContent(message);
  let script: ScriptMonitorWakeAttribution | null = null;
  let hook: HookWakeAttribution | null = null;
  let pr: PrMonitorWakeAttribution | null = null;
  for (const metadata of metadataCandidates(message)) {
    script ??= getScriptMonitorWakeAttribution(metadata);
    hook ??= getHookWakeAttribution(metadata);
    pr ??= getPrMonitorWakeAttribution(metadata);
    if (hook || pr || script) break;
  }
  hook ??= getHookWakeAttribution(undefined, rawText);
  pr ??= hook ? null : getPrMonitorWakeAttribution(undefined, rawText);

  const queueInfo = getQueueInfo(message.metadata);
  const withoutQueueNote = queueInfo ? stripDequeueWaitNote(rawText) : rawText;
  if (script)
    return {
      kind: 'script',
      attribution: script,
      bodyText: withoutQueueNote.trim(),
      queueInfo,
      state: 'delivered',
    };
  if (hook) {
    return {
      kind: 'hook',
      attribution: hook,
      bodyText: stripHookWakeStateNote(stripHookWakePrefix(withoutQueueNote, hook.rawName)).trim(),
      queueInfo,
      state: hookState(hook),
    };
  }
  if (pr) {
    return {
      kind: 'pr',
      attribution: pr,
      bodyText: stripPrMonitorWakePrefix(withoutQueueNote).trim(),
      queueInfo,
      state: 'delivered',
    };
  }
  return null;
}
