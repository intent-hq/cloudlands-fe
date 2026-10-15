import { openDesktopFile } from './desktop-file-open';
import { useLayoutEffect, useRef, useState } from 'react';
import { EyeIcon, HandIcon, WarningIcon } from '@phosphor-icons/react';
import type { ContentBlock } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import { classifyTool, isContextEngineTool } from '$lib/utils/tool-classifier';
import { parseToolResult } from '$lib/components/chat/tool-result-parser';
import {
  buildToolDisplayModel,
  sanitizeToolPayload,
  sanitizeToolText,
} from '$lib/components/chat/tool-display-model';
import {
  getToolCallState,
  shouldRenderToolCall,
} from '$lib/components/chat/tool-call-presentation';
import { getToolResultPayload, extractPayloadText } from '$lib/components/chat/tool-result-pairing';
import { truncatedToolBlockIds } from '$lib/components/chat/block-hydration';
import { resolveToolLeadingIcon } from '$lib/components/chat/tool-leading-icon';
import { OPERATIONAL_INLINE_DETAILS_CLASS } from '$lib/components/chat/operational-disclosure-classes';
import { ChatOperationalRow } from '@/features/chat/components/chat-operational-row';
import { ToolStatusIcon } from '@/features/chat/components/tool-status-icon';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/patterns/screen';
import { store } from '@/store';
import {
  selectAgentHistoryMessages,
  selectAgentMessages,
} from '@/store/agent-session/agent-session-selectors';
import { getToolInputEntries } from '$lib/components/chat/tool-input-presentation';
import { selectHydratedBlock } from '@/store/chat-state/chat-state-selectors';
import { messageBlockHydrationRequested } from '../../../../../src/store/renderer/slices/chat-state/chat-state-slice';

/** Source ToolCall's ordinary raw-detail branch; full tool families remain explicitly scoped. */
export function DesktopToolCall({
  call,
  workspaceId,
  panelId,
  resultBlock,
  agentId,
  messageId,
  isStreaming,
  adjacent,
  saved,
  isCurrent,
  onUnavailable,
}: {
  call: ContentBlock;
  workspaceId?: string;
  panelId?: string;
  resultBlock?: ContentBlock;
  agentId: string;
  messageId: string;
  isStreaming: boolean;
  adjacent: boolean;
  saved: { expanded?: boolean };
  isCurrent: () => boolean;
  onUnavailable: (title: string) => void;
}) {
  const lifetime = useRef(false);
  const savedRecord = useRef(saved);
  useLayoutEffect(() => {
    savedRecord.current = saved;
  }, [saved]);
  useLayoutEffect(() => {
    lifetime.current = true;
    return () => {
      lifetime.current = false;
    };
  }, [lifetime]);
  // Validate the actual canonical row at activation, including before selector emission.
  const rowCurrent = () => {
    if (!lifetime.current || !isCurrent()) return false;
    const message = [
      ...selectAgentMessages.select(store.state, agentId),
      ...selectAgentHistoryMessages.select(store.state, agentId),
    ].find((row) => row.id === messageId);
    const original = message?.contentBlocks?.find(
      (block) => block.id === call.id && block.toolCallId === call.toolCallId,
    );
    const entry = selectHydratedBlock.select(store.state, agentId, messageId, call.id ?? '');
    const sameCall = (block: ContentBlock | undefined) =>
      Boolean(
        block &&
        block.id === call.id &&
        block.toolCallId === call.toolCallId &&
        block.name === call.name &&
        block.input === call.input &&
        block.inputTruncated === call.inputTruncated,
      );
    return (
      sameCall(original) ||
      (Boolean(original?.inputTruncated) && entry?.status === 'loaded' && sameCall(entry.block))
    );
  };
  const [expanded, setExpanded] = useState(saved.expanded ?? false);
  const callEntry = selectHydratedBlock(agentId, messageId, call.id ?? '').value;
  const resultEntry = selectHydratedBlock(agentId, messageId, resultBlock?.id ?? '').value;
  const shownCall = call.inputTruncated && callEntry?.status === 'loaded' ? callEntry.block : call;
  const shownResult =
    resultBlock?.outputTruncated && resultEntry?.status === 'loaded'
      ? resultEntry.block
      : resultBlock;
  const input = shownCall.input ?? {},
    result = getToolResultPayload(shownResult);
  const parsed = result != null ? parseToolResult(shownCall.name ?? '', input, result) : null;
  const display = classifyTool(shownCall.name, input, result),
    state = getToolCallState(shownResult, isStreaming);
  const model = buildToolDisplayModel({
    toolName: shownCall.name ?? '',
    display,
    input,
    result,
    parsedResult: parsed,
    toolState: state,
  });
  const contextEngine = isContextEngineTool(shownCall.name ?? '');
  const supported =
    !contextEngine &&
    (state === 'error' ||
      !parsed ||
      parsed.type === 'unknown' ||
      ((parsed.type === 'file-view' || parsed.type === 'confirmation') && !parsed.content));
  const truncated = truncatedToolBlockIds(call, resultBlock);
  const entries = [
    call.inputTruncated ? callEntry : undefined,
    resultBlock?.outputTruncated ? resultEntry : undefined,
  ].filter(Boolean);
  const pending =
    truncated.length > 0 &&
    (entries.length !== truncated.length || entries.some((e) => e?.status !== 'loaded'));
  const error = entries.find((e) => e?.status === 'error');
  const hydrate = () => {
    if (rowCurrent())
      for (const id of truncated)
        store.dispatch(messageBlockHydrationRequested(agentId, messageId, id));
  };
  const openFile = (adjacent: boolean) => {
    if (!rowCurrent()) return;
    if (
      !workspaceId ||
      !display.filePath ||
      !openDesktopFile(workspaceId, display.filePath, rowCurrent, {
        sourcePanelId: panelId,
        openInAdjacentPanel: adjacent,
      })
    )
      onUnavailable(m.desktop_shell_unported_description());
  };
  const fromFileControl = (event: Event) =>
    event.target instanceof Element &&
    Boolean(event.target.closest('[data-testid=tool-call-file-link]'));
  const toggle = (event?: Event) => {
    if (event && fromFileControl(event)) return;
    if (!rowCurrent() || !model.hasDetails) return;
    const next = !expanded;
    setExpanded(next);
    savedRecord.current.expanded = next;
    if (next) hydrate();
  };
  const sanitizedInput = sanitizeToolPayload(input),
    sanitizedResult = sanitizeToolPayload(result);
  // Same rawDetails eligibility as ToolDetails: internal-only input is not a body.
  const hasInput = getToolInputEntries(sanitizedInput as Record<string, unknown>) !== null;
  const errorText =
    state === 'error'
      ? sanitizeToolText(
          extractPayloadText(result) ??
            (result && typeof result === 'object' && 'message' in result ? result.message : ''),
        )
      : '';
  const action = input.action ?? input.method;
  const actions = Array.isArray(input.actions)
    ? input.actions.flatMap((item) =>
        item && typeof item === 'object' && typeof item.action === 'string' ? [item.action] : [],
      )
    : undefined;
  const icon = resolveToolLeadingIcon({
    toolName: shownCall.name,
    category: display.category,
    action: actions?.length ? actions : typeof action === 'string' ? action : undefined,
    toolKind: shownCall.metadata?.toolKind,
  });
  const Icon = icon === 'eye' ? EyeIcon : HandIcon;
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
  if (!shouldRenderToolCall(display, model, input, result, state)) return null;
  const summary = (
    <>
      {model.sentenceSegments.map((segment, index) =>
        segment.kind === 'file' ? (
          <Button
            key={index}
            variant="plain"
            wrapContent={false}
            truncateLabel={false}
            className="type-body inline h-auto min-h-0 gap-0 min-w-0 cursor-pointer truncate whitespace-pre font-normal underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
            data-testid="tool-call-file-link"
            data-tool-secondary=""
            aria-label={model.accessibleSentence}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openFile(event.metaKey || event.ctrlKey);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                openFile(event.metaKey || event.ctrlKey);
              }
            }}
          >
            {segment.text}
          </Button>
        ) : (
          <span
            key={index}
            className="shrink-0 whitespace-pre font-normal"
            data-tool-primary={segment.kind === 'primary' ? '' : undefined}
            data-tool-secondary={segment.kind === 'secondary' ? '' : undefined}
          >
            {segment.text}
          </span>
        ),
      )}
    </>
  );
  return (
    <ChatOperationalRow
      leading={<Icon size={16} aria-hidden="true" />}
      summary={summary}
      summaryContainsControls={model.sentenceSegments.some((segment) => segment.kind === 'file')}
      trailing={
        model.status ? (
          <ToolStatusIcon status={model.status === 'error' ? 'error' : 'completed'} />
        ) : undefined
      }
      showChevron={false}
      interactive={model.hasDetails}
      expanded={expanded}
      controls={`tool-details-${call.id}`}
      ariaLabel={model.accessibleSentence}
      title={model.hasDetails ? m.chat_toolCall_technicalDetails_label() : model.accessibleSentence}
      summaryTitle={model.accessibleSentence}
      onclick={toggle}
      onkeydown={(event) => {
        if (fromFileControl(event)) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle(event);
        }
      }}
      detailsId={`tool-details-${call.id}`}
      detailsClass={OPERATIONAL_INLINE_DETAILS_CLASS}
      adjacentOperationalRow={adjacent}
      streaming={state === 'running'}
      toolIcon
      toolUseId={call.id}
      toolCallId={call.toolCallId}
      conversationLayer="tool-activity"
      disclosureTestId="tool-call-disclosure"
      summaryTestId="tool-call-summary"
      animateDetailsHeight
      details={
        <div className="flex min-w-0 flex-col text-sm" data-tool-details-inline="">
          {pending &&
            (error?.status === 'error' ? (
              <ErrorState
                density="compact"
                message={m.common_resourceNotFound_loadFailed_title({
                  resourceLabel: m.chat_toolCall_technicalDetails_label(),
                })}
                details={error.error}
                retryLabel={m.ui_combobox_retry_label()}
                onRetry={hydrate}
              />
            ) : (
              <LoadingState
                density="compact"
                count={1}
                label={m.chat_toolCall_loadingFullOutput_label()}
              />
            ))}
          {!supported ? (
            <Button
              variant="ghost"
              onClick={() => {
                if (rowCurrent()) onUnavailable(m.desktop_shell_unported_description());
              }}
            >
              {m.desktop_shell_unported_description()}
            </Button>
          ) : (
            <>
              {state === 'error' && (
                <div className="flex min-w-0 items-start gap-2" data-tool-detail-error="">
                  <WarningIcon size={12} className="text-danger mt-0.5 shrink-0" />
                  <pre className="m-0 min-w-0 whitespace-pre-wrap break-words font-mono text-xs text-danger">
                    {errorText || m.chat_toolDetails_noErrorDetails_label()}
                  </pre>
                </div>
              )}
              <div className="flex min-w-0 flex-col gap-2" data-tool-raw-details="">
                {hasInput && raw(m.chat_toolDetails_input_label(), sanitizedInput, 'input')}
                {state !== 'running' &&
                  result != null &&
                  raw(m.chat_toolDetails_result_label(), sanitizedResult, 'output')}
              </div>
            </>
          )}
        </div>
      }
    />
  );
}
