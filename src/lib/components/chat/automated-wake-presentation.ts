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
  let hook: HookWakeAttribution | null = null;
  let pr: PrMonitorWakeAttribution | null = null;
  for (const metadata of metadataCandidates(message)) {
    hook ??= getHookWakeAttribution(metadata);
    pr ??= getPrMonitorWakeAttribution(metadata);
    if (hook || pr) break;
  }
  hook ??= getHookWakeAttribution(undefined, rawText);
  pr ??= hook ? null : getPrMonitorWakeAttribution(undefined, rawText);

  const queueInfo = getQueueInfo(message.metadata);
  const withoutQueueNote = queueInfo ? stripDequeueWaitNote(rawText) : rawText;
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
