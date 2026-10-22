import {
  deriveFailureSummary,
  type FailureSummaryInput,
} from '$features/agent/utils/failure-summary';
import type { ComposedTranscript } from './chat-scrollback-composition';

/** One render projection over canonical, deduplicated scrollback. Queue-only readers do no history work. */
export function projectFailureTranscript(
  transcript: ComposedTranscript,
  input: Omit<FailureSummaryInput, 'messages' | 'breakBeforeMessageIds'>,
) {
  const boundary =
    transcript.gapBeforeGroupIndex === null
      ? undefined
      : transcript.groups[transcript.gapBeforeGroupIndex]?.messages[0]?.id;
  const summary = deriveFailureSummary({
    ...input,
    messages: transcript.groups.flatMap((group) => group.messages),
    breakBeforeMessageIds: new Set(boundary ? [boundary] : []),
  });
  return {
    ...summary,
    runsByAnchor: new Map(summary.history.map((run) => [run.anchorMessageId, run])),
    collapsedMessageIds: new Set(
      summary.history.flatMap((run) => run.records.slice(1).map((record) => record.messageId)),
    ),
  };
}
