// Source: src/lib/components/chat/AutomatedWakeCardHeader.svelte.
import { useCallback, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { observeOverflow, truncatedTitle } from '$lib/actions/observe-overflow';
import type { AutomatedWakePresentation } from '$lib/components/chat/automated-wake-presentation';
import { CHAT_OPERATIONAL_ICON_CLASS } from '$lib/components/chat/operational-disclosure-classes';
import {
  SUBSCRIPTION_CHEVRON_CLASS,
  SUBSCRIPTION_CHEVRON_SIZE_CLASS,
  SUBSCRIPTION_DISCLOSURE_ROW_CLASS,
  SUBSCRIPTION_ICON_BUTTON_CLASS,
  SUBSCRIPTION_ICON_CLASS,
  SUBSCRIPTION_LEADING_COLUMN_CLASS,
} from '$lib/components/chat/subscription-disclosure-classes';
import {
  faBolt,
  faChevronDown,
  faCodePullRequest,
  faTerminal,
} from '$lib/icons/phosphor-icon-definitions';
import {
  getPrMonitorWakeChipLabel,
  getPrMonitorWakeUrl,
} from '$lib/utils/pr-monitor-wake-attribution';
import { m } from '$shared/paraglide/messages.js';
import type { Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';

export interface AutomatedWakeCardHeaderProps {
  presentation: AutomatedWakePresentation;
  expanded: boolean;
  controlsId: string;
  workspace?: Workspace | null;
  ontoggle: () => void;
  /** Pinned controls return to the source instead of navigating or expanding. */
  onPinnedActivate?: () => void;
  /** The host owns navigation, including opening the PR in an external browser. */
  onOpenLink: (
    url: string,
    context: { workspaceId?: WorkspaceId; forceExternal: true },
  ) => void | Promise<void>;
}

export function AutomatedWakeCardHeader({
  presentation,
  expanded,
  controlsId,
  workspace = null,
  ontoggle,
  onPinnedActivate,
  onOpenLink,
}: AutomatedWakeCardHeaderProps) {
  const [hookNameOverflow, setHookNameOverflow] = useState(false);
  const scriptTitleAction = useRef<ReturnType<typeof truncatedTitle>>(undefined);
  const statusTitleAction = useRef<ReturnType<typeof truncatedTitle>>(undefined);
  const hookNameRef = useCallback((node: HTMLSpanElement | null) => {
    if (!node) return;
    const observer = observeOverflow(node, setHookNameOverflow);
    return () => observer?.destroy?.();
  }, []);
  const scriptNameRef = useCallback((node: HTMLSpanElement | null) => {
    if (!node) return;
    const action = truncatedTitle(node, undefined);
    scriptTitleAction.current = action;
    return () => {
      action?.destroy?.();
      scriptTitleAction.current = undefined;
    };
  }, []);
  const statusRef = useCallback((node: HTMLSpanElement | null) => {
    if (!node) return;
    const action = truncatedTitle(node, undefined);
    statusTitleAction.current = action;
    return () => {
      action?.destroy?.();
      statusTitleAction.current = undefined;
    };
  }, []);

  const workspaceRepo =
    workspace?.repositoryOwner && workspace?.repositoryName
      ? `${workspace.repositoryOwner}/${workspace.repositoryName}`
      : undefined;
  const statusLabel = (() => {
    if (presentation.kind === 'script') {
      switch (presentation.attribution.reason) {
        case 'finished':
          return m.chat_scriptMonitor_finished_description();
        case 'ttl-expired':
          return m.chat_scriptMonitor_expired_description();
        case 'output-match':
          return m.chat_scriptMonitor_matched_description();
        case 'line-count':
          return m.chat_scriptMonitor_counted_description();
      }
    }
    if (presentation.kind === 'pr') return m.chat_prMonitorWakeAttribution_wokeAgent_after();
    if (presentation.state === 'active') {
      return m.chat_hookWakeAttribution_wokeAgentStillActive_after();
    }
    if (presentation.state === 'retired') {
      return m.chat_hookWakeAttribution_wokeAgentRetired_after();
    }
    return m.chat_hookWakeAttribution_wokeAgent_after();
  })();
  const scriptName =
    presentation.kind === 'script' ? presentation.attribution.scriptName : undefined;
  const chipLabel =
    presentation.kind === 'pr'
      ? getPrMonitorWakeChipLabel(presentation.attribution, workspaceRepo)
      : undefined;

  useLayoutEffect(() => {
    scriptTitleAction.current?.update?.(scriptName);
  }, [scriptName, presentation.kind]);

  useLayoutEffect(() => {
    statusTitleAction.current?.update?.(statusLabel);
  }, [statusLabel]);

  function openPr(event: MouseEvent<HTMLButtonElement>) {
    if (presentation.kind !== 'pr') return;
    event.stopPropagation();
    if (onPinnedActivate) {
      onPinnedActivate();
      return;
    }
    void onOpenLink(getPrMonitorWakeUrl(presentation.attribution), {
      workspaceId: workspace?.id ? WorkspaceId(String(workspace.id)) : undefined,
      forceExternal: true,
    });
  }

  function handleRowClick(event: MouseEvent<HTMLDivElement>) {
    // Sibling buttons (PR chip, chevron toggle) own their own clicks.
    if ((event.target as HTMLElement | null)?.closest('button')) return;
    (onPinnedActivate ?? ontoggle)();
  }

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- Preserve the source row hit-target; keyboard activation belongs to its chevron Button.
    <div
      className={`${SUBSCRIPTION_DISCLOSURE_ROW_CLASS} cursor-pointer`}
      data-testid="automated-wake-header"
      data-wake-kind={presentation.kind}
      data-wake-state={presentation.state}
      onClick={handleRowClick}
    >
      <span className={SUBSCRIPTION_LEADING_COLUMN_CLASS} aria-hidden="true">
        <IconDefinitionIcon
          icon={
            presentation.kind === 'hook'
              ? faBolt
              : presentation.kind === 'script'
                ? faTerminal
                : faCodePullRequest
          }
          size={16}
          className={`${CHAT_OPERATIONAL_ICON_CLASS} ${SUBSCRIPTION_ICON_CLASS}`}
        />
      </span>
      <span
        className="grid min-w-0 flex-1 grid-cols-[minmax(4rem,max-content)_minmax(0,1fr)] items-baseline gap-1 overflow-hidden whitespace-nowrap text-left"
        data-testid="automated-wake-text-lane"
      >
        {presentation.kind === 'hook' ? (
          <span
            key="hook"
            ref={hookNameRef}
            className="min-w-0 max-w-full truncate text-muted-foreground"
            title={
              presentation.attribution.rawName !== presentation.attribution.displayName
                ? presentation.attribution.rawName
                : hookNameOverflow
                  ? presentation.attribution.displayName
                  : undefined
            }
            data-testid="automated-wake-primary-label"
          >
            {presentation.attribution.displayName}
          </span>
        ) : presentation.kind === 'script' ? (
          <span key="script" ref={scriptNameRef} className="min-w-0 truncate text-muted-foreground">
            {presentation.attribution.scriptName}
          </span>
        ) : (
          <Button
            type="button"
            variant="plain"
            className="type-body h-auto! min-w-0 max-w-full justify-start overflow-hidden whitespace-nowrap p-0! text-left font-inherit text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="pr-monitor-wake-chip"
            title={
              onPinnedActivate
                ? m.chat_stickyMessageHeader_scrollToPrevious_title()
                : m.chat_prMonitorWakeAttribution_openPrWithLabel_tooltip({ label: chipLabel! })
            }
            onClick={openPr}
          >
            <span className="min-w-0 truncate">{chipLabel}</span>
          </Button>
        )}
        <span
          ref={statusRef}
          className="type-body min-w-0 truncate whitespace-nowrap font-normal text-muted-foreground"
          data-testid="wake-status"
        >
          {statusLabel}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost-light"
        size="icon-xs"
        iconOnly
        className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded ${SUBSCRIPTION_ICON_BUTTON_CLASS} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        aria-expanded={onPinnedActivate ? undefined : expanded}
        aria-controls={onPinnedActivate ? undefined : controlsId}
        aria-label={
          onPinnedActivate
            ? m.chat_stickyMessageHeader_scrollToPrevious_title()
            : expanded
              ? m.chat_agentSubscriptions_collapseWatches_ariaLabel()
              : m.chat_agentSubscriptions_expandWatches_ariaLabel()
        }
        onClick={onPinnedActivate ?? ontoggle}
        data-testid="automated-wake-toggle"
      >
        <IconDefinitionIcon
          icon={faChevronDown}
          size={16}
          className={`${SUBSCRIPTION_CHEVRON_SIZE_CLASS} ${SUBSCRIPTION_CHEVRON_CLASS} ${expanded ? '' : 'rotate-90'}`}
        />
      </Button>
    </div>
  );
}

export default AutomatedWakeCardHeader;
