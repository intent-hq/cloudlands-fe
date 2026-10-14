// Source: EventWakeupBanner.svelte. Read-only connected disclosure; the host owns navigation.
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { AgentAvatarStack } from '@/features/agent/components/agent-avatar/agent-avatar-stack';
import { AgentAvatarWithState } from '@/features/agent/components/agent-avatar/agent-avatar-with-state';
import { selectAgentSessionsById } from '@/store/agent-session/agent-session-selectors';
import { getAvatarStateForSession } from '../../../../../../src/features/agent/components/agent-avatar/avatar-state-core';
import {
  getEventWakePresentation,
  type EventWakeMetadata,
} from '$lib/components/chat/event-wake-presentation';
import {
  SUBSCRIPTION_CARD_CONTAINMENT_CLASS,
  SUBSCRIPTION_CARD_SURFACE_CLASS,
  SUBSCRIPTION_CHEVRON_CLASS,
  SUBSCRIPTION_CHEVRON_SIZE_CLASS,
  SUBSCRIPTION_DISCLOSURE_ROW_CLASS,
  SUBSCRIPTION_ICON_CLASS,
  SUBSCRIPTION_LEADING_COLUMN_CLASS,
  SUBSCRIPTION_WAKE_BODY_PADDING_CLASS,
} from '$lib/components/chat/subscription-disclosure-classes';
import { CHAT_OPERATIONAL_ICON_CLASS } from '$lib/components/chat/operational-disclosure-classes';
import { faBell, faChevronDown } from '$lib/icons/phosphor-icon-definitions';
import { m } from '$shared/paraglide/messages.js';
import { extractAllContent, type AgentMessage } from '$shared/types';
import { formatInteger } from '$lib/i18n/format';

export function EventWakeupBanner({
  message,
  workspaceId,
  onOpenAgent,
}: {
  message: AgentMessage;
  workspaceId: string;
  onOpenAgent: (workspaceId: string, agentId: string) => void;
}) {
  const detailsId = useId();
  const [expanded, setExpanded] = useState(false);
  const sessions = selectAgentSessionsById().value;
  const sessionFor = (agentId: string) => {
    const session = sessions[agentId];
    return session?.workspaceId === workspaceId ? session : undefined;
  };
  const metadata = message.metadata as EventWakeMetadata | undefined;
  const presentation = getEventWakePresentation({
    metadata,
    messageText: extractAllContent(message),
    workspaceId,
    getAgentName: (agentId) => sessionFor(agentId)?.name,
  });
  const {
    friendlySummary,
    agentSummaryRoles,
    agentEvents,
    displayEventDetails,
    displayLegacyEventTypes,
    eventTypeLabel,
    isAgentCompletionEvent,
    agentStatusLabel,
    usesHeaderAgentIdentity,
  } = presentation;
  return (
    <div
      className={`${SUBSCRIPTION_CARD_CONTAINMENT_CLASS} ${SUBSCRIPTION_CARD_SURFACE_CLASS}`}
      data-testid="event-wakeup-card"
    >
      <div className={SUBSCRIPTION_DISCLOSURE_ROW_CLASS} data-testid="event-wakeup-header">
        {agentEvents.length > 0 ? (
          <div
            className="flex min-w-0 shrink-0 items-center overflow-hidden"
            data-testid="event-wakeup-avatar-stack"
          >
            <AgentAvatarStack
              items={agentEvents.map((event) => ({ key: event.agentId, agentId: event.agentId }))}
              maxVisible={5}
              align="start"
              interactive
              variant="standard"
              overflowTestId="event-wakeup-avatar-overflow"
              itemContent={(item) => {
                const event = agentEvents.find((event) => event.agentId === item.agentId)!;
                const session = sessionFor(item.agentId);
                const name = event.agentName ?? m.chat_shared_agentName_fallback();
                return (
                  <Button
                    type="button"
                    variant="plain"
                    size="icon-sm"
                    iconOnly
                    className="h-(--agent-avatar-standard-surface-size)! w-(--agent-avatar-standard-surface-size)! shrink-0 rounded-(--agent-avatar-standard-corner-radius) border-0 p-0! leading-none"
                    aria-label={m.chat_msgAttribution_openAgent_title({ name })}
                    tooltip={name}
                    data-testid="event-wakeup-agent"
                    data-agent-id={item.agentId}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenAgent(workspaceId, item.agentId);
                    }}
                  >
                    <AgentAvatarWithState
                      agentId={item.agentId}
                      variant="standard"
                      specialist={
                        session?.metadata?.specialist ?? session?.agentMetadata?.specialist
                      }
                      state={getAvatarStateForSession(session, {
                        isCompleted: event.type !== 'agent:created',
                      })}
                    />
                  </Button>
                );
              }}
            />
          </div>
        ) : (
          <span className={SUBSCRIPTION_LEADING_COLUMN_CLASS} aria-hidden="true">
            <IconDefinitionIcon
              icon={faBell}
              size={16}
              className={`${CHAT_OPERATIONAL_ICON_CLASS} ${SUBSCRIPTION_ICON_CLASS}`}
            />
          </span>
        )}
        <Button
          type="button"
          variant="plain"
          wrapContent={false}
          className="type-body flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden rounded border-none bg-transparent p-0! text-left font-inherit text-muted-foreground"
          aria-label={friendlySummary}
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((value) => !value)}
          data-testid="event-wakeup-summary"
        >
          {agentSummaryRoles ? (
            <span
              className="flex min-w-0 flex-1 items-baseline gap-1 overflow-hidden"
              aria-hidden="true"
            >
              <strong
                className="type-body min-w-0 truncate font-normal text-muted-foreground"
                title={agentSummaryRoles.name}
                data-testid="event-wakeup-agent-name"
              >
                {agentSummaryRoles.name}
              </strong>
              <span
                className="type-body min-w-0 shrink truncate font-normal text-muted-foreground"
                title={agentSummaryRoles.status}
                data-testid="event-wakeup-status"
              >
                {agentSummaryRoles.status}
              </span>
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate" title={friendlySummary} aria-hidden="true">
              {friendlySummary}
            </span>
          )}
          <span
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center"
            aria-hidden="true"
          >
            <IconDefinitionIcon
              icon={faChevronDown}
              size={16}
              className={`${SUBSCRIPTION_CHEVRON_SIZE_CLASS} ${SUBSCRIPTION_CHEVRON_CLASS} ${expanded ? '' : 'rotate-90'}`}
            />
          </span>
        </Button>
      </div>
      {expanded && (
        <section
          id={detailsId}
          className={`w-full min-w-0 max-w-full overflow-hidden border-t border-border ${SUBSCRIPTION_WAKE_BODY_PADDING_CLASS}`}
          aria-label={m.chat_eventWakeup_subscriptionWakeup_tooltip()}
          data-testid="event-wakeup-details"
        >
          {displayEventDetails.length > 0 ? (
            <ol className="min-w-0 space-y-2">
              {displayEventDetails.map((event) => (
                <li
                  key={event.key}
                  className="min-w-0 overflow-hidden"
                  data-testid="event-wakeup-detail"
                  data-event-detail-key={event.key}
                >
                  {!usesHeaderAgentIdentity(event) && (
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                      {event.agentName && isAgentCompletionEvent(event.type) ? (
                        <>
                          <strong className="type-body min-w-0 break-words font-medium text-foreground [overflow-wrap:anywhere]">
                            {event.agentName}
                          </strong>
                          <span className="type-body font-normal text-muted-foreground">
                            {agentStatusLabel(event.type)}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="type-caption font-medium text-primary-ink">
                            {event.label}
                          </span>
                          {event.agentName && (
                            <span className="type-caption min-w-0 break-words font-normal text-muted-foreground [overflow-wrap:anywhere]">
                              {event.agentName}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  {event.timestamp && (
                    <time
                      className="type-caption mt-0.5 block w-fit tabular-nums font-normal text-subtle"
                      dateTime={event.datetime}
                      data-testid="event-wakeup-timestamp"
                    >
                      {event.timestamp}
                    </time>
                  )}
                  {event.summary && (
                    <p
                      className="type-body mt-1.5 w-full max-w-[68ch] whitespace-pre-wrap font-normal text-foreground [overflow-wrap:anywhere]"
                      data-testid="event-wakeup-report"
                    >
                      {event.summary}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          ) : displayLegacyEventTypes.length > 0 ? (
            <ul className="type-caption min-w-0 space-y-1 text-subtle">
              {displayLegacyEventTypes.map((type, index) => (
                <li key={`${index}:${type}`} className="break-words [overflow-wrap:anywhere]">
                  {eventTypeLabel(type)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="type-caption text-subtle">
              {(metadata?.eventCount ?? 0) === 1
                ? m.chat_eventWakeup_triggered_one({
                    count: formatInteger(metadata?.eventCount ?? 0),
                  })
                : m.chat_eventWakeup_triggered_many({
                    count: formatInteger(metadata?.eventCount ?? 0),
                  })}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
