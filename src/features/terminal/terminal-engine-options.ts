import type { TerminalsClient } from '$lib/client/app-client';
import type { TerminalState } from './terminal-state-machine';

export interface TerminalCallbacks {
  onReady?: () => void;
  onExit?: (exitCode: number) => void;
  onCommandStart?: () => void;
  onCommandFinished?: () => void;
  onCwdChanged?: (cwd: string) => void;
  onError?: (error: Error) => void;
  onSearchResultsChange?: (resultIndex: number, resultCount: number) => void;
  onToggleSearch?: () => void;
}

type TerminalShortcut = 'toggle-overlay' | 'new-terminal' | 'close-terminal';

/** Host-owned integrations; the engine never imports application state or IPC. */
export interface TerminalHostCallbacks {
  onOpenLink?: (uri: string) => void;
  onShortcut?: (shortcut: TerminalShortcut) => void;
  history?: {
    onOutput(terminalId: string, workspaceId: string, data: string): void;
    onCommandStart(terminalId: string, workspaceId: string, command: string): void;
    onCommandFinish(terminalId: string, workspaceId: string): void;
  };
}

export type TerminalEngineOptions = TerminalCallbacks &
  TerminalHostCallbacks & {
    workspaceId: string;
    container: HTMLElement;
    terminals: TerminalsClient;
    fontFamily: string;
    /** Hosts may own focus so asynchronous initialization does not steal later input. */
    autoFocus?: boolean;
    /** Reject late work when the host's principal/workspace/connection is retired. */
    isCurrent?: () => boolean;
  } & (
    | { lifecycle: 'attach-only'; terminalId: string }
    | { lifecycle?: 'create-or-attach'; terminalId?: string }
  );

export interface TerminalInfo {
  id: string;
  workspaceId: string;
  state: TerminalState;
  cwd?: string;
  isExecuting: boolean;
  stats?: {
    bufferSize: number;
    lineCount: number;
    uptime: number;
  };
}
