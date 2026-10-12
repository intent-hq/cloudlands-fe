// Source: src/lib/components/chat/AgentMessageAttributionHeader.svelte.
import { useState } from 'react';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { Button } from '@/components/ui/button';
import { AgentAvatarWithState } from '@/features/agent/components/agent-avatar/agent-avatar-with-state';
import { cn } from '@/lib/utils';
import { store } from '@/store';
import {
  selectAgentProvider,
  selectAgentSession,
} from '@/store/agent-session/agent-session-selectors';
import { selectPendingCount } from '@/store/permission/permission-selectors';
import {
  SUBSCRIPTION_CHEVRON_CLASS,
  SUBSCRIPTION_CHEVRON_SIZE_CLASS,
  SUBSCRIPTION_DISCLOSURE_ROW_CLASS,
  SUBSCRIPTION_LEADING_COLUMN_CLASS,
  SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS,
} from '$lib/components/chat/subscription-disclosure-classes';
import { faChevronDown } from '$lib/icons/phosphor-icon-definitions';
import type { AgentMessageAttribution } from '$lib/utils/agent-message-attribution';
import { m } from '$shared/paraglide/messages.js';
import type { WorkspaceId } from '$shared/types/branded-ids';
import { getAgentAttentionRequest } from '$shared/utils/agent-attention';
import { getAvatarStateForSession } from '../../../../../../src/features/agent/components/agent-avatar/avatar-state-core';
import { openAgentTabRequested } from '../../../../../../src/store/renderer/slices/app-layout/app-layout-slice';

export interface AgentMessageAttributionHeaderProps {
  attribution: AgentMessageAttribution;
  expanded: boolean;
  controlsId: string;
  ontoggle: () => void;
  /** Pinned controls return to the source instead of navigating or expanding. */
  onPinnedActivate?: () => void;
  /** Explicit identity fallback before the sender session is available. */
  specialist?: string | null;
  class?: string;
  /** React override for the source class prop, including an explicit empty string. */
  className?: string;
  /** Host route context, captured once per mounted header like the source context. */
  workspaceId: WorkspaceId | undefined;
  /** Host assistant navigation runs first, with the actual button as native currentTarget. */
  onOpenAssistantAgentFromEvent: (
    event: MouseEvent,
    workspaceId: string,
    agentId: string,
  ) => boolean;
  /** Host navigation receives the current source URL and the original native anchor event. */
  onOpenLink: (
    url: string,
    context: { workspaceId?: WorkspaceId; event: MouseEvent },
  ) => void | Promise<void>;
}

/** React ref cleanup keeps listeners local to each real control and its latest props. */
function bindActivation(node: HTMLElement | null, activate: (event: MouseEvent) => void) {
  if (!node) return;
  const stopDoubleClick = (event: MouseEvent) => event.stopPropagation();
  node.addEventListener('click', activate);
  node.addEventListener('dblclick', stopDoubleClick);
  return () => {
    node.removeEventListener('click', activate);
    node.removeEventListener('dblclick', stopDoubleClick);
  };
}

/** The transcript must key this component by sender, preserving init-bound selector identity. */
export function AgentMessageAttributionHeader({
  attribution,
  expanded,
  controlsId,
  ontoggle,
  onPinnedActivate,
  specialist = null,
  class: sourceClass = '',
  className,
  workspaceId,
  onOpenAssistantAgentFromEvent,
  onOpenLink,
}: AgentMessageAttributionHeaderProps) {
  const [sender] = useState(() => {
    const fromAgentId = attribution.fromAgentId;
    return {
      workspaceId,
      session: selectAgentSession(fromAgentId),
      permissionCount: selectPendingCount(fromAgentId),
      provider: selectAgentProvider(fromAgentId),
    };
  });
  // These direct signal reads are tracked by the React app's Signals Babel transform.
  const senderSession = sender.session.value;
  const senderPermissionCount = sender.permissionCount.value;
  const senderProvider = sender.provider.value;
  const senderSpecialist =
    specialist ??
    senderSession?.metadata?.specialist ??
    senderSession?.agentMetadata?.specialist ??
    null;
  const senderAttentionRequest = getAgentAttentionRequest(senderSession);
  const senderAvatarState = getAvatarStateForSession(senderSession, {
    hasPermissionRequest: senderPermissionCount > 0,
    attentionKind: senderAttentionRequest?.kind ?? null,
  });
  const displayName =
    attribution.kind === 'chief' ? m.layout_chiefCard_title() : attribution.displayName;

  function handleClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (onPinnedActivate) {
      onPinnedActivate();
      return;
    }

    const panelElement = (event.currentTarget as HTMLElement | null)?.closest('[data-panel-id]');
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    const openInAdjacentPanel = event.metaKey || event.ctrlKey;
    if (sender.workspaceId) {
      if (onOpenAssistantAgentFromEvent(event, sender.workspaceId, attribution.fromAgentId)) {
        return;
      }
      store.dispatch(
        openAgentTabRequested(sender.workspaceId, {
          agentId: attribution.fromAgentId,
          sourcePanelId,
          openInAdjacentPanel,
        }),
      );
    }
  }

  function handleToggle(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    (onPinnedActivate ?? ontoggle)();
  }

  async function handleSourceClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (attribution.kind !== 'chief' || !attribution.sourceUrl) return;
    await onOpenLink(attribution.sourceUrl, { workspaceId: sender.workspaceId, event });
  }

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- The source row only enlarges pinned activation; the sibling buttons provide keyboard access.
    <div
      className={cn(
        SUBSCRIPTION_DISCLOSURE_ROW_CLASS,
        'h-auto! py-1.5! [&_[data-slot=button]]:h-auto!',
        className ?? sourceClass,
      )}
      data-testid="agent-message-disclosure-header"
      onClick={onPinnedActivate ? () => onPinnedActivate?.() : undefined}
    >
      {attribution.kind === 'chief' && attribution.sourceUrl && !onPinnedActivate ? (
        <a
          ref={(node) => bindActivation(node, handleSourceClick)}
          className="flex min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded text-left font-[inherit] text-muted-foreground no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ maxWidth: 'calc(100% - 2.5rem)' }}
          href={attribution.sourceUrl}
          title={m.chat_msgAttribution_openSource_title()}
          data-testid="agent-message-attribution"
        >
          <span
            className={SUBSCRIPTION_LEADING_COLUMN_CLASS}
            aria-hidden="true"
            data-testid="agent-message-avatar-column"
            data-agent-message-leading-identity=""
          >
            <AgentAvatarWithState
              agentId={attribution.fromAgentId}
              specialist={senderSpecialist}
              provider={senderProvider}
              state={senderAvatarState}
              variant="standard"
            />
          </span>
          <span className="min-w-0 font-normal wrap-anywhere whitespace-normal text-muted-foreground">
            {displayName}
          </span>
        </a>
      ) : attribution.kind === 'chief' ? (
        <span
          className="flex min-w-0 shrink-0 items-center gap-2 text-left font-[inherit] text-muted-foreground"
          style={{ maxWidth: 'calc(100% - 2.5rem)' }}
          data-testid="agent-message-attribution"
        >
          <span
            className={SUBSCRIPTION_LEADING_COLUMN_CLASS}
            aria-hidden="true"
            data-testid="agent-message-avatar-column"
            data-agent-message-leading-identity=""
          >
            <AgentAvatarWithState
              agentId={attribution.fromAgentId}
              specialist={senderSpecialist}
              provider={senderProvider}
              state={senderAvatarState}
              variant="standard"
            />
          </span>
          <span className="min-w-0 font-normal wrap-anywhere whitespace-normal text-muted-foreground">
            {displayName}
          </span>
        </span>
      ) : (
        <Button
          ref={(node) => bindActivation(node, handleClick)}
          type="button"
          variant="plain"
          className={`${SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS} flex min-h-6 min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded border-none bg-transparent p-0 text-left font-[inherit] whitespace-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
          truncateLabel={false}
          style={{ maxWidth: 'calc(100% - 2.5rem)' }}
          title={
            onPinnedActivate
              ? m.chat_stickyMessageHeader_scrollToPrevious_title()
              : m.chat_msgAttribution_openAgent_title({ name: displayName })
          }
          data-testid="agent-message-attribution"
        >
          <span
            className={SUBSCRIPTION_LEADING_COLUMN_CLASS}
            aria-hidden="true"
            data-testid="agent-message-avatar-column"
            data-agent-message-leading-identity=""
          >
            <AgentAvatarWithState
              agentId={attribution.fromAgentId}
              specialist={senderSpecialist}
              provider={senderProvider}
              state={senderAvatarState}
              variant="standard"
            />
          </span>
          <span
            className="min-w-0 font-normal wrap-anywhere whitespace-normal text-muted-foreground"
            data-testid="agent-message-actor-name"
          >
            {displayName}
          </span>
        </Button>
      )}
      <Button
        ref={(node) => bindActivation(node, handleToggle)}
        type="button"
        variant="plain"
        className={`${SUBSCRIPTION_ROW_TYPOGRAPHY_CLASS} flex min-h-6 min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden rounded border-none bg-transparent p-0 text-left font-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        aria-expanded={onPinnedActivate ? undefined : expanded}
        aria-controls={onPinnedActivate ? undefined : controlsId}
        aria-label={
          onPinnedActivate
            ? m.chat_stickyMessageHeader_scrollToPrevious_title()
            : m.chat_msgAttribution_sentMessage_after()
        }
        data-testid="agent-message-disclosure-toggle"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap">
          <span className="min-w-0 shrink truncate" data-testid="agent-message-status">
            {m.chat_msgAttribution_sentMessage_after()}
          </span>
        </span>
        <span
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center"
          data-testid="agent-message-chevron-column"
        >
          <IconDefinitionIcon
            icon={faChevronDown}
            size={16}
            className={`${SUBSCRIPTION_CHEVRON_SIZE_CLASS} ${SUBSCRIPTION_CHEVRON_CLASS} ${expanded ? '' : 'rotate-90'}`}
          />
        </span>
      </Button>
    </div>
  );
}

export default AgentMessageAttributionHeader;
