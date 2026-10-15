import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/patterns/screen';
import { TerminalSearchBar } from '@/components/terminal/terminal-search-bar';
import { DestructiveConfirm } from '@/components/patterns/confirm';
import { store } from '@/store';
import {
  selectTerminalAuthorityKey,
  selectTerminalContext,
  selectTerminalOperations,
  selectTerminalRead,
  selectTerminalsForWorkspace,
} from '@/store/terminals/terminals-selectors';
import { selectWorkspaceById } from '@/store/workspace/workspace-selectors';
import { selectCodeFontFamilyCSS } from '@/store/user-preferences/user-preferences-selectors';
import { createWorkspaceTerminalClient } from '@/features/terminals/terminal-runtime';
import {
  terminalViewRefreshRequested,
  selectTerminal,
  terminalOperationRequested,
  terminalViewRetired,
  terminalViewOpened,
} from '../../../../../src/store/renderer/slices/terminals/terminals-slice';
import type { TerminalEngine } from '../../../../../src/features/terminal/TerminalEngine';
import { openExternalUrl } from '$lib/utils/open-external';
import { m } from '$shared/paraglide/messages.js';

function TerminalSession({
  workspaceId,
  terminalId,
  context,
  viewId,
  reconnect,
}: {
  workspaceId: string;
  terminalId: string;
  context: string;
  viewId: string;
  reconnect: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<TerminalEngine | null>(null);
  const fontFamily = selectCodeFontFamilyCSS().value;
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'exited'>('loading');
  const [error, setError] = useState<string>();
  const [exitCode, setExitCode] = useState(0);
  const [search, setSearch] = useState(false);
  const [matches, setMatches] = useState({ index: -1, count: 0 });
  useLayoutEffect(() => {
    let active = true;
    const current = () =>
      active &&
      selectTerminalContext.select(store.state, workspaceId) === context &&
      selectTerminalRead.select(store.state, workspaceId)?.viewId === viewId;
    const container = host.current;
    const focusOrigin = document.activeElement;
    void (async () => {
      const { TerminalEngine } =
        await import('../../../../../src/features/terminal/TerminalEngine');
      if (!current() || !container) return;
      const instance = new TerminalEngine({
        workspaceId,
        terminalId,
        container,
        terminals: createWorkspaceTerminalClient(workspaceId, current),
        fontFamily,
        lifecycle: 'attach-only',
        autoFocus: false,
        isCurrent: current,
        onReady: () => {
          if (current()) {
            setPhase('ready');
            if (document.activeElement === focusOrigin) engine.current?.focus();
          }
        },
        onError: (reason) => {
          if (current()) {
            setError(reason.message);
            setPhase('error');
          }
        },
        onExit: (code) => {
          if (current()) {
            setExitCode(code);
            setPhase('exited');
          }
        },
        onToggleSearch: () => {
          if (current()) setSearch((value) => !value);
        },
        onSearchResultsChange: (index, count) => {
          if (current()) setMatches({ index, count });
        },
        onOpenLink: (uri) => {
          if (current())
            void openExternalUrl(uri).catch((reason) => {
              if (current()) setError(String(reason));
            });
        },
      });
      engine.current = instance;
      await instance.initialize();
    })().catch((reason) => {
      if (current()) {
        setError(reason instanceof Error ? reason.message : String(reason));
        setPhase('error');
      }
    });
    return () => {
      active = false;
      engine.current?.dispose({ killPty: false });
      engine.current = null;
      container?.replaceChildren();
    };
  }, [workspaceId, terminalId, context, viewId, fontFamily]);
  return (
    <div
      data-testid="workspace-terminal-view"
      data-terminal-id={terminalId}
      data-terminal-phase={phase}
      className="min-w-0"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {phase === 'loading' ? (
          <LoadingState label={m.ui_spinner_loading_ariaLabel()} />
        ) : phase === 'ready' ? (
          <output>{m.workspace_terminal_ready_label()}</output>
        ) : phase === 'exited' ? (
          <output>{m.events_activity_terminalExitedCode_label({ exitCode })}</output>
        ) : null}
        <Button variant="ghost" size="sm" onClick={reconnect}>
          {m.workspace_terminal_reconnect_label()}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="relative min-w-0 rounded-md border border-border bg-background p-2">
        <div ref={host} className="h-80 min-w-0 sm:h-96" data-testid="terminal-engine" />
        <TerminalSearchBar
          isOpen={search}
          currentMatchIndex={matches.index}
          totalMatches={matches.count}
          onFindNext={(query) => engine.current?.findNext(query)}
          onFindPrevious={(query) => engine.current?.findPrevious(query)}
          onClose={() => {
            setSearch(false);
            engine.current?.clearSearch();
            engine.current?.focus();
          }}
        />
      </div>
    </div>
  );
}

function TerminalView(props: {
  workspaceId: string;
  terminalId: string;
  context: string;
  viewId: string;
}) {
  const [attempt, setAttempt] = useState(0);
  return (
    <TerminalSession key={attempt} {...props} reconnect={() => setAttempt((value) => value + 1)} />
  );
}

/** The canonical terminal owner stores entities and operation facts; this host owns DOM lifetime. */
export function WorkspaceTerminals({ workspaceId }: { workspaceId: string }) {
  const context = selectTerminalContext(workspaceId).value;
  return (
    <WorkspaceTerminalScope
      key={`${workspaceId}:${context}`}
      workspaceId={workspaceId}
      context={context}
    />
  );
}
function WorkspaceTerminalScope({
  workspaceId,
  context,
}: {
  workspaceId: string;
  context: string | null;
}) {
  const [viewId] = useState(() => crypto.randomUUID());
  const authorityKey = selectTerminalAuthorityKey(workspaceId).value;
  const workspace = selectWorkspaceById(workspaceId).value;
  const terminals = selectTerminalsForWorkspace(workspaceId).value;
  const read = selectTerminalRead(workspaceId).value;
  const operations = selectTerminalOperations(workspaceId).value;
  const [selection, setSelection] = useState<{ id: string | null; createId?: string } | null>(null);
  const [close, setClose] = useState<{ id: string; context: string; viewId: string } | null>(null);
  const current = !!context && read?.context === context && read.viewId === viewId;
  const unresolved = operations.filter(
    (entry) =>
      entry.status === 'queued' || entry.status === 'running' || entry.status === 'unknown',
  );
  const latest = operations.filter((entry) => entry.authorityKey === authorityKey).at(-1);
  useLayoutEffect(() => {
    if (!context) return;
    store.dispatch(terminalViewOpened(workspaceId, context, viewId));
    store.dispatch(terminalViewRefreshRequested(workspaceId, viewId));
    return () => {
      store.dispatch(terminalViewRetired(workspaceId, context, viewId));
    };
  }, [workspaceId, context, viewId]);
  const created =
    latest?.kind === 'create' && latest.status === 'confirmed' && latest.context === context
      ? latest
      : undefined;
  const shown = created && selection?.createId !== created.id ? created.result?.id : selection?.id;
  const setShown = (id: string | null) => setSelection({ id, createId: created?.id });
  function request(kind: 'create' | 'close', terminalId?: string) {
    if (
      !context ||
      !authorityKey ||
      selectTerminalContext.select(store.state, workspaceId) !== context ||
      selectTerminalRead.select(store.state, workspaceId)?.viewId !== viewId
    )
      return;
    const root = workspace?.worktreePath || workspace?.repositoryPath;
    if (!root) return;
    store.dispatch(
      terminalOperationRequested({
        id: crypto.randomUUID(),
        workspaceId,
        context,
        authorityKey,
        viewId,
        root,
        kind,
        terminalId,
        status: 'queued',
      }),
    );
  }
  return (
    <section className="min-w-0" data-testid="workspace-terminals">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="type-heading-sm">{m.terminal_sidebar_terminals_title()}</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!context || read?.loading}
            onClick={() => store.dispatch(terminalViewRefreshRequested(workspaceId, viewId))}
          >
            {m.fileExplorer_sidebar_refresh_tooltip()}
          </Button>
          <Button
            size="sm"
            disabled={
              !current ||
              read.loading ||
              !!read.error ||
              unresolved.some((entry) => entry.kind === 'create')
            }
            onClick={() => request('create')}
          >
            {m.lib_commandPalette_newTerminal_command()}
          </Button>
        </div>
      </div>
      <p className="mb-3 type-caption text-muted-foreground">
        {m.workspace_terminal_scope_description()}
      </p>
      {(!context || read?.error) && (
        <p role="alert">{read?.error || m.workspace_client_accessChanged_error()}</p>
      )}
      {unresolved.some((entry) => entry.status === 'unknown') && (
        <p role="alert">{m.workspace_terminal_unknown_description()}</p>
      )}
      {latest?.status === 'failed' && (
        <p role="alert">{latest.result?.error || m.terminal_adapter_openFailed_error()}</p>
      )}
      {context && (!current || read.loading) && (
        <LoadingState label={m.ui_spinner_loading_ariaLabel()} />
      )}
      {current && !read.error && !read.loading && !terminals.length && (
        <p>{m.terminal_sidebar_noTerminals_label()}</p>
      )}
      {current && (
        <ul className="grid gap-3">
          {terminals.map((terminal) => (
            <li key={terminal.id} className="min-w-0" data-terminal-row={terminal.id}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-all">
                  {terminal.customName ||
                    terminal.name ||
                    m.workspace_terminalDock_terminal_fallback()}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    store.dispatch(selectTerminal(workspaceId, terminal.id));
                    setShown(terminal.id);
                  }}
                >
                  {m.ui_fileActions_open_label()}
                </Button>
                {shown === terminal.id && (
                  <Button variant="ghost" size="sm" onClick={() => setShown(null)}>
                    {m.workspace_terminal_detach_label()}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={unresolved.some((entry) => entry.terminalId === terminal.id)}
                  onClick={() => context && setClose({ id: terminal.id, context, viewId })}
                >
                  {m.terminal_sidebar_closeTerminal_label()}
                </Button>
              </div>
              {shown === terminal.id && context && (
                <TerminalView
                  key={`${context}:${terminal.id}`}
                  workspaceId={workspaceId}
                  terminalId={terminal.id}
                  context={context}
                  viewId={viewId}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <DestructiveConfirm
        open={!!close && close.context === context && close.viewId === viewId}
        onOpenChange={(open) => {
          if (!open) setClose(null);
        }}
        title={m.terminal_sidebar_closeTerminal_label()}
        description={m.workspace_terminal_close_description()}
        confirmLabel={m.terminal_sidebar_closeTerminal_label()}
        onConfirm={() => {
          if (
            close &&
            close.context === context &&
            close.viewId === viewId &&
            terminals.some((t) => t.id === close.id)
          )
            request('close', close.id);
          setClose(null);
        }}
      />
    </section>
  );
}
