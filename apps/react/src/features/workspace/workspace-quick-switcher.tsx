import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ContentDialog } from '@/components/patterns/confirm';
import { Combobox, type ComboboxGroup } from '@/components/ui/combobox';
import { CommandPaletteItemTitle } from '@/components/command-palette-item-title';
import { Button } from '@/components/ui/button';
import { ShortcutChip } from '@/components/ui/kbd';
import { ErrorState } from '@/components/patterns/screen';
import { store } from '@/store';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import {
  selectWorkspaceById,
  selectWorkspaceListLoadedForBackend,
  selectWorkspaceListReadStatus,
} from '@/store/workspace/workspace-selectors';
import {
  selectQuickSwitcherItems,
  type QuickSwitcherItem,
} from '@/store/workspace/quick-switcher-selectors';
import { selectCurrentConnectionId } from '@/store/connections/connections-selectors';
import { selectWorkspaceAgentMetadataStatus } from '@/store/workspace-agents/workspace-agents-selectors';
import {
  agentMetadataAcquired,
  agentMetadataReleased,
} from '../../../../../src/store/renderer/slices/agent-session/agent-session-slice';
import { workspaceAgentMetadataRetryRequested } from '../../../../../src/store/renderer/slices/workspace-agents/workspace-agents-slice';
import { loadWorkspacesRequested } from '../../../../../src/store/renderer/slices/workspace/workspace-slice';
import { getEffectiveShortcut, useEffectiveShortcut } from '@/lib/effective-shortcuts';
import { matchesShortcut } from '$lib/utils/shortcut-bindings';
import { isFocusInTerminal } from '$lib/utils/keyboardShortcuts';
import { formatShortcut } from '$lib/utils/shortcuts';
import { normalizeHomeConfiguration } from '../../../../../src/features/home/home-workspaces-persistence';
import { m } from '$shared/paraglide/messages.js';

export function WorkspaceQuickSwitcher() {
  const { workspaceId } = useParams({ strict: false });
  const context = selectPrincipalActionContext().value;
  const workspace = selectWorkspaceById(workspaceId ?? '').value;
  return (
    <QuickSwitcher
      key={JSON.stringify([context, workspaceId, workspace?.worktreePath])}
      workspaceId={workspaceId}
      context={context}
    />
  );
}

function QuickSwitcher({ workspaceId, context }: { workspaceId?: string; context: string | null }) {
  const [open, setOpen] = useState(false);
  const shortcut = useEffectiveShortcut('global.command-palette-alt');
  const alive = useRef(false);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        isFocusInTerminal(target) ||
        target?.closest('.monaco-editor,.cm-editor,[data-shortcut-input],[data-shortcut-entry]') ||
        document.querySelector('[role="dialog"],[role="alertdialog"]')
      )
        return;
      if (
        !matchesShortcut(
          event,
          getEffectiveShortcut('global.command-palette-alt'),
          navigator.platform.toUpperCase().includes('MAC'),
        )
      )
        return;
      event.preventDefault();
      if (alive.current) setOpen(true);
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);
  return (
    <>
      <div className="flex justify-end px-4 py-2" data-testid="quick-switcher-toolbar">
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          {m.workspace_quickSwitcher_open_label()}{' '}
          <ShortcutChip>{formatShortcut(shortcut)}</ShortcutChip>
        </Button>
      </div>
      {open && (
        <SwitcherDialog
          workspaceId={workspaceId}
          context={context}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function SwitcherDialog({
  workspaceId,
  context,
  onClose,
}: {
  workspaceId?: string;
  context: string | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const [query, setQuery] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(false);
  const accepted = useRef(false);
  const consumer = useRef(crypto.randomUUID());
  const backendId = selectCurrentConnectionId().value;
  const loaded = selectWorkspaceListLoadedForBackend(backendId).value;
  const listStatus = selectWorkspaceListReadStatus().value;
  const authority = selectAdmittedWorkspaceReadContext(workspaceId ?? '').value;
  const agentStatus = selectWorkspaceAgentMetadataStatus(workspaceId ?? '', context).value;
  const workspace = selectWorkspaceById(workspaceId ?? '').value;
  const items = selectQuickSwitcherItems(workspaceId, query).value;
  useLayoutEffect(() => {
    alive.current = true;
    if (workspaceId && authority)
      store.dispatch(agentMetadataAcquired(consumer.current, workspaceId));
    const id = consumer.current;
    return () => {
      alive.current = false;
      store.dispatch(agentMetadataReleased(id));
    };
  }, [workspaceId, authority]);
  const groups: ComboboxGroup[] = [
    {
      key: 'agent',
      label: m.workspace_quickSwitcher_conversations_label({
        workspace: workspace?.title || workspaceId || '',
      }),
      options: [],
    },
    { key: 'workspace', label: m.lib_commandPalette_workspaces_label(), options: [] },
  ];
  for (const item of items)
    groups[item.kind === 'agent' ? 0 : 1].options.push({
      value: `${item.kind}:${item.id}`,
      label: item.label,
      description: item.description,
      data: item,
    });
  const rawHomeQuery = workspaceId ? search.homeQuery : search.q;
  const homeQuery = typeof rawHomeQuery === 'string' ? rawHomeQuery : undefined;
  function canActivate(item: QuickSwitcherItem) {
    if (!alive.current || accepted.current) return false;
    const current = selectQuickSwitcherItems
      .select(store.state, workspaceId, query)
      .find((row) => row.id === item.id && row.kind === item.kind);
    if (
      !context ||
      selectPrincipalActionContext.select(store.state) !== context ||
      (workspaceId &&
        (selectAdmittedWorkspaceReadContext.select(store.state, workspaceId) !== authority ||
          selectWorkspaceById.select(store.state, workspaceId)?.worktreePath !==
            workspace?.worktreePath)) ||
      !current ||
      current.workspaceId !== item.workspaceId ||
      current.rootPath !== item.rootPath
    ) {
      setUnavailable(true);
      return false;
    }
    return true;
  }
  function activate(item: QuickSwitcherItem) {
    if (!canActivate(item)) return;
    accepted.current = true;
    onClose();
    void navigate({
      to: '/workspaces/$workspaceId',
      params: { workspaceId: item.workspaceId },
      search: {
        homeQuery: homeQuery,
        homeFilter: normalizeHomeConfiguration({
          filter: workspaceId ? search.homeFilter : search.filter,
        }).filter,
        ...(item.kind === 'agent' ? { agent: item.id } : {}),
      },
    });
  }
  return (
    <ContentDialog
      open
      title={m.workspace_quickSwitcher_open_label()}
      description={m.workspace_quickSwitcher_scope_description()}
      initialFocus={input}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      onCloseAutoFocus={(event) => {
        if (accepted.current) event.preventDefault();
      }}
    >
      <div className="grid min-w-0 gap-3">
        {(listStatus === 'error' || unavailable) && (
          <ErrorState
            density="compact"
            message={m.workspace_quickSwitcher_unavailable_error()}
            retryLabel={m.ui_combobox_retry_label()}
            onRetry={() => {
              setUnavailable(false);
              store.dispatch(loadWorkspacesRequested());
            }}
          />
        )}
        {workspaceId && agentStatus?.status === 'error' && (
          <ErrorState
            density="compact"
            message={m.workspace_quickSwitcher_conversationsError_error()}
            retryLabel={m.ui_combobox_retry_label()}
            onRetry={() => {
              if (context)
                store.dispatch(
                  workspaceAgentMetadataRetryRequested(consumer.current, workspaceId, context),
                );
            }}
          />
        )}
        {workspaceId && (!authority || !agentStatus || agentStatus.status === 'loading') && (
          <output className="type-caption text-muted-foreground">
            {m.workspace_quickSwitcher_loadingConversations_description()}
          </output>
        )}
        <Combobox
          onBeforeOpenChange={(next, reason) =>
            next || reason === 'escape' || reason === 'selection'
          }
          open
          staticPosition
          portal={false}
          inputRef={input}
          groups={groups}
          filterOption={null}
          loading={!loaded}
          ariaLabel={m.workspace_quickSwitcher_search_ariaLabel()}
          searchPlaceholder={m.workspace_quickSwitcher_search_placeholder()}
          onQueryChange={setQuery}
          emptyText={m.ui_dropdown_noResults_label()}
          optionLabel={(option) => <CommandPaletteItemTitle item={{ label: option.label }} />}
          optionDescription={(option) => (
            <span
              className="type-caption max-w-1/2 truncate text-muted-foreground"
              title={option.description}
            >
              {option.description}
            </span>
          )}
          onBeforeCommit={(option) => canActivate(option.data as QuickSwitcherItem)}
          onCommit={(_value, option) => activate(option.data as QuickSwitcherItem)}
          onOpenChange={(next) => {
            if (!next) onClose();
          }}
        />
      </div>
    </ContentDialog>
  );
}
