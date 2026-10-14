import { useId, useLayoutEffect, useState } from 'react';
import { EyeIcon, HandIcon } from '@phosphor-icons/react';
import type { ContentBlock } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import { getWorkspaceConfirmationPresentation } from '$lib/components/chat/workspace-confirmation-presentation';
import { sanitizeToolPayload, sanitizeToolText } from '$lib/components/chat/tool-display-model';
import { extractPayloadText } from '$lib/components/chat/tool-result-pairing';
import { truncatedToolBlockIds } from '$lib/components/chat/block-hydration';
import { resolveToolLeadingIcon } from '$lib/components/chat/tool-leading-icon';
import { OPERATIONAL_INLINE_DETAILS_CLASS } from '$lib/components/chat/operational-disclosure-classes';
import { ChatOperationalRow } from '@/features/chat/components/chat-operational-row';
import { ToolStatusIcon } from '@/features/chat/components/tool-status-icon';
import { CopyButton } from '@/components/ui/copy-button';
import { ErrorState, LoadingState } from '@/components/patterns/screen';
import { selectHydratedBlock } from '@/store/chat-state/chat-state-selectors';
import { store } from '@/store';
import { messageBlockHydrationRequested } from '../../../../../src/store/renderer/slices/chat-state/chat-state-slice';

export function WorkspaceConfirmationTool({
  call,
  resultBlock,
  agentId,
  messageId,
  isStreaming,
}: {
  call: ContentBlock;
  resultBlock?: ContentBlock;
  agentId: string;
  messageId: string;
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const callEntry = selectHydratedBlock(agentId, messageId, call.id ?? '').value;
  const resultEntry = selectHydratedBlock(agentId, messageId, resultBlock?.id ?? '').value;
  // A newer complete canonical block always wins over cached slim hydration.
  const displayedCall =
    call.inputTruncated && callEntry?.status === 'loaded' ? callEntry.block : call;
  const displayedResult =
    resultBlock?.outputTruncated && resultEntry?.status === 'loaded'
      ? resultEntry.block
      : resultBlock;
  const truncated = truncatedToolBlockIds(call, resultBlock);
  const dispatch = store.dispatch;
  useLayoutEffect(() => {
    if (expanded)
      for (const blockId of truncatedToolBlockIds(call, resultBlock))
        dispatch(messageBlockHydrationRequested(agentId, messageId, blockId));
  }, [expanded, call, resultBlock, agentId, messageId, dispatch]);
  const presentation = getWorkspaceConfirmationPresentation(
    displayedCall,
    displayedResult,
    isStreaming,
  );
  if (!presentation?.admitted) return null;
  const { input, result, parsed, display, state, model } = presentation;
  const entries = [
    call.inputTruncated ? callEntry : undefined,
    resultBlock?.outputTruncated ? resultEntry : undefined,
  ].filter(Boolean);
  const loaded =
    truncated.length > 0 &&
    entries.length === truncated.length &&
    entries.every((entry) => entry?.status === 'loaded');
  const error = entries.find((entry) => entry?.status === 'error');
  const errorText =
    state === 'error'
      ? sanitizeToolText(
          extractPayloadText(result) ??
            (typeof result === 'object' && result && 'message' in result ? result.message : ''),
        )
      : '';
  const action = input.action ?? input.method;
  const kind = resolveToolLeadingIcon({
    toolName: call.name,
    category: display.category,
    action: typeof action === 'string' ? action : undefined,
    toolKind: call.metadata?.toolKind,
  });
  const Icon = kind === 'eye' ? EyeIcon : HandIcon;
  const toggle = () => setExpanded((value) => !value);
  const raw = (label: string, value: unknown, section: string) => (
    <section className="min-w-0" data-tool-detail-section={section}>
      <div className="type-caption mb-1 text-muted-foreground">{label}</div>
      <pre
        className={`m-0 ${section === 'input' ? 'max-h-48' : 'max-h-72'} overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-subtle`}
      >
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
  return (
    <ChatOperationalRow
      leading={<Icon size={16} aria-hidden="true" />}
      summary={model.sentence}
      trailing={
        model.status ? (
          <ToolStatusIcon status={model.status === 'error' ? 'error' : 'completed'} />
        ) : undefined
      }
      showChevron={false}
      interactive={model.hasDetails}
      expanded={expanded}
      controls={detailsId}
      ariaLabel={model.accessibleSentence}
      title={model.hasDetails ? m.chat_toolCall_technicalDetails_label() : model.accessibleSentence}
      summaryTitle={model.accessibleSentence}
      onclick={toggle}
      onkeydown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle();
        }
      }}
      detailsId={detailsId}
      detailsClass={OPERATIONAL_INLINE_DETAILS_CLASS}
      streaming={state === 'running'}
      toolIcon
      toolUseId={call.id}
      toolCallId={call.toolCallId}
      conversationLayer="tool-activity"
      disclosureTestId="tool-call-disclosure"
      summaryTestId="tool-call-summary"
      animateDetailsHeight
      details={
        <div
          data-workspace-confirmation-body=""
          data-hydration={
            truncated.length ? (loaded ? 'loaded' : error ? 'error' : 'pending') : 'complete'
          }
          className="group/details relative flex min-w-0 flex-col gap-2 text-sm"
        >
          {truncated.length > 0 &&
            !loaded &&
            (error?.status === 'error' ? (
              <ErrorState
                density="compact"
                message={m.common_resourceNotFound_loadFailed_title({
                  resourceLabel: m.chat_toolCall_technicalDetails_label(),
                })}
                details={error.error}
                retryLabel={m.ui_combobox_retry_label()}
                onRetry={() => {
                  for (const id of truncated)
                    dispatch(messageBlockHydrationRequested(agentId, messageId, id));
                }}
              />
            ) : (
              <LoadingState
                density="compact"
                count={1}
                label={m.chat_toolCall_loadingFullOutput_label()}
              />
            ))}
          {state === 'error' && (
            <p className="type-body text-danger" data-tool-detail-error="">
              {errorText || m.chat_toolDetails_noErrorDetails_label()}
            </p>
          )}
          {state !== 'error' && state !== 'running' && parsed.content && (
            <div className="absolute top-0 right-0 z-10 flex items-center opacity-0 transition-opacity group-hover/details:opacity-100 focus-within:opacity-100">
              <CopyButton
                text={typeof input.content === 'string' ? input.content : parsed.content}
                label={m.chat_toolDetails_copyContent_title()}
                className="text-muted-foreground"
              />
            </div>
          )}
          {state !== 'error' && parsed.content ? (
            <pre
              data-tool-confirmation-text=""
              className="m-0 p-2 text-sm leading-relaxed max-h-72 overflow-y-auto text-muted-foreground whitespace-pre-wrap break-words"
            >
              {parsed.content}
            </pre>
          ) : (
            <>
              {Object.keys(input).some((key) => !key.startsWith('_')) &&
                raw(m.chat_toolDetails_input_label(), sanitizeToolPayload(input), 'input')}
              {result != null &&
                !model.isOkOnlyWorkspaceResult &&
                raw(m.chat_toolDetails_result_label(), sanitizeToolPayload(result), 'output')}
            </>
          )}
        </div>
      }
    />
  );
}
