// Source: src/lib/components/chat/PrMonitorWakeAttributionHeader.svelte.
import { useState, type MouseEvent } from 'react';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { Button } from '@/components/ui/button';
import { store } from '@/store';
import { selectWorkspaceById } from '@/store/workspace/workspace-selectors';
import {
  SUBSCRIPTION_DISCLOSURE_ROW_CLASS,
  SUBSCRIPTION_ICON_CLASS,
  SUBSCRIPTION_LEADING_COLUMN_CLASS,
} from '$lib/components/chat/subscription-disclosure-classes';
import { faCodePullRequest } from '$lib/icons/phosphor-icon-definitions';
import {
  type PrMonitorWakeAttribution,
  getPrMonitorWakeChipLabel,
  getPrMonitorWakeUrl,
} from '$lib/utils/pr-monitor-wake-attribution';
import { m } from '$shared/paraglide/messages.js';
import type { WorkspaceId } from '$shared/types/branded-ids';

export interface PrMonitorWakeAttributionHeaderProps {
  attribution: PrMonitorWakeAttribution;
  /** Optional source class name. */
  class?: string;
  /** React alias for class; the source class prop takes precedence. */
  className?: string;
  /** Caller route context, captured once for this mounted header. */
  workspaceId: WorkspaceId | undefined;
  /** The host owns navigation, including opening the PR in an external browser. */
  onOpenLink: (
    url: string,
    context: { workspaceId?: WorkspaceId; forceExternal: true },
  ) => void | Promise<void>;
}

export function PrMonitorWakeAttributionHeader({
  attribution,
  class: sourceClass,
  className,
  workspaceId: initialWorkspaceId,
  onOpenLink,
}: PrMonitorWakeAttributionHeaderProps) {
  // Preserve the source's one-time route/workspace read, including an unknown repo.
  const [{ workspaceId, workspaceRepo }] = useState(() => {
    const workspace = initialWorkspaceId
      ? selectWorkspaceById.select(store.state, initialWorkspaceId)
      : undefined;
    return {
      workspaceId: initialWorkspaceId,
      workspaceRepo:
        workspace?.repositoryOwner && workspace?.repositoryName
          ? `${workspace.repositoryOwner}/${workspace.repositoryName}`
          : undefined,
    };
  });
  const chipLabel = getPrMonitorWakeChipLabel(attribution, workspaceRepo);

  // React supplies its click event in place of the source's native MouseEvent.
  function handleOpenPr(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    void onOpenLink(getPrMonitorWakeUrl(attribution), {
      workspaceId,
      forceExternal: true,
    });
  }

  return (
    <div
      className={`${SUBSCRIPTION_DISCLOSURE_ROW_CLASS} rounded-md ${sourceClass ?? className ?? ''}`}
      data-testid="pr-monitor-wake-attribution"
    >
      <span className={SUBSCRIPTION_LEADING_COLUMN_CLASS} aria-hidden="true">
        <IconDefinitionIcon
          icon={faCodePullRequest}
          size={14}
          className={`h-3.5! w-3.5! shrink-0 ${SUBSCRIPTION_ICON_CLASS}`}
        />
      </span>
      <span className="grid min-w-0 flex-1 grid-cols-[minmax(4rem,max-content)_minmax(0,1fr)] items-baseline gap-1 overflow-hidden whitespace-nowrap">
        <Button
          type="button"
          variant="plain"
          className="type-body h-auto! min-w-0 max-w-full cursor-pointer justify-start truncate p-0! text-left font-normal text-muted-foreground hover:underline"
          data-testid="pr-monitor-wake-chip"
          title={m.chat_prMonitorWakeAttribution_openPr_tooltip()}
          onClick={handleOpenPr}
        >
          {chipLabel}
        </Button>
        <span
          className="min-w-0 truncate whitespace-nowrap font-normal text-muted-foreground"
          data-testid="pr-monitor-wake-status"
        >
          {m.chat_prMonitorWakeAttribution_wokeAgent_after()}
        </span>
      </span>
    </div>
  );
}

export default PrMonitorWakeAttributionHeader;
