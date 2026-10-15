import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ListEmpty } from '@/components/ui/list';
import { RelativeTime } from '@/components/ui/relative-time';
import { SidebarExpandableSearch } from '@/components/workspace/sidebar/sidebar-expandable-search';
import { SidebarHeaderAction } from '@/components/workspace/sidebar/sidebar-header-action';
import { DesktopAgentAvatar } from './desktop-agent-avatar';
import { ErrorState, LoadingState } from '@/components/patterns/screen';
import { store } from '@/store';
import {
  selectForegroundWorkspaceAgents,
  selectWorkspaceAgentMetadataStatus,
} from '@/store/workspace-agents/workspace-agents-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { workspaceAgentMetadataRetryRequested } from '../../../../../src/store/renderer/slices/workspace-agents/workspace-agents-slice';
import { selectCurrentWorkspaceTabId } from '@/store/tab-state/tab-state-selectors';
import { selectDesktopLayout } from '@/store/desktop/desktop-selectors';
import {
  agentMetadataAcquired,
  agentMetadataReleased,
} from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import {
  openTab,
  openTabInAdjacentOrSplit,
} from '../../../../../src/store/renderer/slices/panel-layout/panel-layout-slice';
import {
  getFlatWorkspaceAgentRows,
  filterWorkspaceAgentRows,
} from '$lib/components/workspace/workspace-agents-list-utils';
import { m } from '$shared/paraglide/messages.js';

/** The mounted source WorkspaceAgentsList foreground rows; metadata keeps its existing owner. */
export function DesktopAgents({
  workspaceId,
  active,
  onClose,
  onUnavailable,
}: {
  workspaceId: string;
  active: boolean;
  onClose: () => void;
  onUnavailable: (title: string) => void;
}) {
  const consumer = useId();
  const authority = selectAdmittedWorkspaceReadContext(workspaceId).value;
  const agents = selectForegroundWorkspaceAgents(workspaceId).value;
  const context = selectPrincipalActionContext().value;
  const status = selectWorkspaceAgentMetadataStatus(workspaceId, context).value;
  const layout = selectDesktopLayout(workspaceId).value;
  const [query, setQuery] = useState('');
  const lifetime = useMemo(
    () => ({ active, authority, workspaceId }),
    [active, authority, workspaceId],
  );
  const liveLifetime = useRef<typeof lifetime | null>(null);
  useLayoutEffect(() => {
    liveLifetime.current = lifetime;
    return () => {
      if (liveLifetime.current === lifetime) liveLifetime.current = null;
    };
  }, [lifetime]);
  function current() {
    return (
      liveLifetime.current === lifetime &&
      active &&
      !!authority &&
      selectCurrentWorkspaceTabId.select(store.state) === workspaceId &&
      selectAdmittedWorkspaceReadContext.select(store.state, workspaceId) === authority
    );
  }
  useLayoutEffect(() => {
    if (!active || !authority) return;
    store.dispatch(agentMetadataAcquired(consumer, workspaceId));
    return () => {
      store.dispatch(agentMetadataReleased(consumer));
    };
  }, [consumer, workspaceId, active, authority]);
  const rows = filterWorkspaceAgentRows(
    getFlatWorkspaceAgentRows(agents.filter((a) => !a.retiredAt)),
    query,
  );
  function open(agentId: string, adjacent: boolean) {
    if (!current()) return;
    if (
      selectWorkspaceAgentMetadataStatus.select(store.state, workspaceId, context)?.status !==
      'ready'
    )
      return;
    const agent = selectForegroundWorkspaceAgents
      .select(store.state, workspaceId)
      .find((a) => a.id === agentId && !a.retiredAt);
    if (!agent || agent.workspaceId !== workspaceId) return;
    const tab = { type: 'agent' as const, agentId, workspaceId, title: agent.name, closable: true };
    store.dispatch(
      adjacent
        ? openTabInAdjacentOrSplit(
            workspaceId,
            tab,
            selectDesktopLayout.select(store.state, workspaceId).focusedPanelId ?? undefined,
          )
        : openTab(workspaceId, tab),
    );
  }
  return (
    <section className="desktop-context-card desktop-agents-card">
      <div className="desktop-context-heading">
        <h2 className="text-ui font-semibold flex-1">
          {m.workspace_multiSelectSidebar_agentsTab_label()}
        </h2>
        <SidebarExpandableSearch
          scope="agents"
          query={query}
          onQueryChange={setQuery}
          placeholder={m.workspace_multiSelectSidebar_searchAgents_placeholder()}
        />
        <SidebarHeaderAction
          icon="plus"
          label={m.layout_panelEmptyState_agent_label()}
          onClick={() => onUnavailable(m.layout_panelEmptyState_agent_label())}
        />
        <SidebarHeaderAction icon="close" label={m.ui_tab_close_ariaLabel()} onClick={onClose} />
      </div>
      <div className="desktop-agent-rows">
        {status?.status === 'error' ? (
          <ErrorState
            density="compact"
            message={status.error}
            retryLabel={m.ui_combobox_retry_label()}
            onRetry={() => {
              if (
                current() &&
                context &&
                context === selectPrincipalActionContext.select(store.state)
              )
                store.dispatch(
                  workspaceAgentMetadataRetryRequested(consumer, workspaceId, context),
                );
            }}
          />
        ) : status?.status !== 'ready' ? (
          <LoadingState density="compact" count={2} label={m.chat_chatMessage_loading_label()} />
        ) : rows.length === 0 ? (
          <output className="block" aria-live="polite">
            <ListEmpty
              message={
                query.trim()
                  ? m.workspace_agentsList_noSearchResults_label()
                  : m.workspace_agentsList_empty_label()
              }
              className={query.trim() ? 'min-h-14 py-3' : undefined}
            />
          </output>
        ) : (
          rows.map(({ agent }) => (
            <Button
              key={agent.id}
              variant="plain"
              wrapContent={false}
              className="desktop-agent-row"
              data-agent-panel-row={agent.id}
              aria-current={
                Object.values(layout.panels).some((p) =>
                  p.tabs.some((t) => t.id === p.activeTabId && t.agentId === agent.id),
                )
                  ? 'true'
                  : undefined
              }
              onClick={(event) => open(agent.id, event.metaKey || event.ctrlKey)}
            >
              <DesktopAgentAvatar
                agentId={agent.id}
                active={Object.values(layout.panels).some((p) =>
                  p.tabs.some((t) => t.id === p.activeTabId && t.agentId === agent.id),
                )}
              />
              <span className="desktop-agent-name" data-agent-row-name>
                {agent.name}
              </span>
              {agent.updatedAt && (
                <span data-agent-row-time>
                  <RelativeTime
                    date={agent.updatedAt}
                    compact
                    className="text-ui text-subtle tabular-nums"
                  />
                </span>
              )}
            </Button>
          ))
        )}
      </div>
    </section>
  );
}
