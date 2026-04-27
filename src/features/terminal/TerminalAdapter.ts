/**
 * Terminal Adapter - Clean Architecture Implementation
 *
 * Modular terminal adapter with proper separation of concerns
 */

import { Terminal, IDisposable } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import * as AddOnSearch from '@xterm/addon-search';
const SearchAddon = AddOnSearch.SearchAddon;
import '@xterm/xterm/css/xterm.css';
import { Logger } from '../../shared/logger';
import { TerminalStateMachine, TerminalState } from './terminal-state-machine';
import { TerminalBufferManager } from './terminal-buffer-manager';
import { TerminalThemeManager } from './terminal-theme-manager';
import { terminalHistoryTracker } from './terminal-history-tracker';
import { isGitHubUrl } from '$shared/utils/link-helpers';
import { sanitizeCommandForDisplay } from '$shared/utils/sanitize-credentials';
import { dispatchWindowEvent } from '$lib/utils/window-events';
import { dispatch } from '$lib/store/redux-dispatch-bridge';
import {
  closeActiveTerminalRequested,
  toggleTerminalOverlay,
} from '$lib/store/slices/terminals/terminals-slice';

const logger = new Logger('TerminalAdapter');

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

export interface TerminalOptions extends TerminalCallbacks {
  workspaceId: string;
  terminalId?: string;
  container: HTMLElement;
}

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

// In some browser builds (prod), `process` may be undefined. Guard access.
const isWindowsPlatform = typeof process !== 'undefined' && process.platform === 'win32';

export class TerminalAdapter {
  private xterm: Terminal;
  private fitAddon: FitAddon;
  private searchAddon: any; // SearchAddon type issues
  private webLinksAddon: WebLinksAddon;
  private webglAddon: WebglAddon | null = null;

  private stateMachine: TerminalStateMachine;
  private bufferManager: TerminalBufferManager;
  private themeManager: TerminalThemeManager;

  private terminalId: string;
  private workspaceId: string;
  private container: HTMLElement;

  private eventListeners: Array<() => void> = [];
  private resizeObserver: ResizeObserver | null = null;
  private visibilityObserver: IntersectionObserver | null = null;
  private wasVisible: boolean = true;
  private resizeDebounceTimer: NodeJS.Timeout | null = null;
  private bufferSaveTimer: NodeJS.Timeout | null = null;
  private dataDisposable: IDisposable | null = null;
  private resizeDisposable: IDisposable | null = null;
  private selectionDisposable: IDisposable | null = null;
  private ipcCleanup: (() => void) | null = null; // Cleanup function for IPC handlers
  private themeCleanup: (() => void) | null = null; // Cleanup function for theme handler
  private webglContextLostCleanup: (() => void) | null = null; // Cleanup for WebGL context loss listener

  private isDisposed: boolean = false;
  private isXtermOpened: boolean = false; // Track if xterm.open() has been called

  // Auto-reconnect state
  private autoReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private autoReconnectAttempts: number = 0;
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;
  private static readonly BASE_RECONNECT_DELAY_MS = 1000; // 1s, 2s, 4s, 8s, 16s

  // IPC health check / heartbeat
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
  private static readonly HEARTBEAT_TIMEOUT_MS = 10_000; // 10 seconds

  // WebGL context loss recovery
  private webglRecoveryAttempts: number = 0;
  private static readonly MAX_WEBGL_RECOVERY_ATTEMPTS = 3;

  private exitedNormally: boolean = false; // Track normal shell exit vs unexpected disconnect

  private lastCwd: string | undefined;
  private isExecuting: boolean = false;
  private startTime: number = Date.now();

  // Command tracking
  private commandBuffer = ''; // Track the current command being typed
  private currentLineBuffer = ''; // Track the current line
  private isAtPrompt = false; // Track if we're at a command prompt

  // Callbacks
  private callbacks: TerminalCallbacks;

  constructor(options: TerminalOptions) {
    this.workspaceId = options.workspaceId;
    this.terminalId =
      options.terminalId || `terminal-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    this.container = options.container;
    this.callbacks = {
      onReady: options.onReady,
      onExit: options.onExit,
      onCommandStart: options.onCommandStart,
      onCommandFinished: options.onCommandFinished,
      onCwdChanged: options.onCwdChanged,
      onError: options.onError,
      onToggleSearch: options.onToggleSearch,
    };

    // Initialize state machine
    this.stateMachine = new TerminalStateMachine(this.terminalId);
    this.setupStateMachineListeners();

    // Initialize managers
    this.bufferManager = new TerminalBufferManager(this.workspaceId, this.terminalId);
    this.themeManager = new TerminalThemeManager(this.container);

    // Initialize XTerm.js with optimized settings
    this.xterm = new Terminal({
      allowProposedApi: true,
      fontFamily: '"SF Mono", Monaco, Menlo, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      letterSpacing: 0,
      cursorBlink: true,
      cursorStyle: 'block',
      cursorWidth: 1,
      scrollback: 10000,
      allowTransparency: true,
      windowsMode: isWindowsPlatform,
      macOptionIsMeta: true,
      rightClickSelectsWord: true,
      convertEol: true,
      drawBoldTextInBrightColors: true,
      fastScrollModifier: 'ctrl',
      scrollSensitivity: 1,
      theme: this.themeManager.getCurrentTheme(),
    });

    // Load addons
    this.fitAddon = new FitAddon();
    this.xterm.loadAddon(this.fitAddon);

    // Custom link handler to open URLs in browser panel instead of popup
    this.webLinksAddon = new WebLinksAddon((_event, uri) => {
      this.handleLinkClick(uri);
    });
    this.xterm.loadAddon(this.webLinksAddon);

    this.searchAddon = new SearchAddon();
    this.xterm.loadAddon(this.searchAddon);

    // Listen for search result changes
    this.searchAddon.onDidChangeResults((results: { resultIndex: number; resultCount: number }) => {
      this.callbacks.onSearchResultsChange?.(results.resultIndex, results.resultCount);
    });
  }

  /**
   * Search decoration options for highlighting matches
   * Uses different colors for active match vs other matches
   */
  private getSearchDecorations() {
    return {
      matchBackground: '#515c6a',
      matchBorder: '#515c6a',
      matchOverviewRuler: '#515c6a',
      activeMatchBackground: '#eab308',
      activeMatchBorder: '#ca8a04',
      activeMatchColorOverviewRuler: '#eab308',
    };
  }

  /**
   * Setup state machine event listeners
   */
  private setupStateMachineListeners(): void {
    // Listen for state transitions
    this.stateMachine.onTransition((from, to) => {
      // Note: onReady callback is NOT called here to avoid duplicate calls.
      // It is called explicitly after initialization/reconnection is complete.
      if (to === TerminalState.ERROR) {
        this.handleError(new Error(`Terminal entered error state from ${from}`));
      }

      // Auto-reconnect when entering DISCONNECTED or ERROR state
      if (to === TerminalState.DISCONNECTED || to === TerminalState.ERROR) {
        this.stopHeartbeat();
        // Don't auto-reconnect if the shell exited normally
        if (!this.exitedNormally) {
          this.scheduleAutoReconnect();
        }
      }

      // Reset reconnect attempts on successful connection and start heartbeat
      if (to === TerminalState.CONNECTED) {
        this.autoReconnectAttempts = 0;
        this.cancelAutoReconnect();
        this.startHeartbeat();
      }
    });

    // Listen for errors
    this.stateMachine.onError((error) => {
      this.handleError(error);
    });
  }

  /**
   * Initialize the terminal
   */
  async initialize(skipBufferRestore: boolean = false): Promise<void> {
    if (this.isDisposed) {
      throw new Error('Cannot initialize disposed terminal');
    }

    if (!this.stateMachine.canTransition('initialize')) {
      throw new Error(`Cannot initialize terminal in state ${this.stateMachine.getState()}`);
    }

    this.stateMachine.transition('initialize');

    try {
      // Open XTerm in the container - only if not already opened
      if (!this.isXtermOpened) {
        this.xterm.open(this.container);
        this.isXtermOpened = true;
        logger.info(`[initialize] XTerm opened for terminal ${this.terminalId}`);
      } else {
        logger.warn(
          `[initialize] XTerm already opened for terminal ${this.terminalId}, skipping open()`,
        );
      }

      // Load WebGL addon only for dark themes
      // Light themes use the Canvas renderer for proper CSS font-smoothing/anti-aliasing
      // WebGL uses greyscale anti-aliasing which looks poor on light backgrounds
      const currentTheme = this.themeManager.getCurrentTheme();
      if (currentTheme.isDark) {
        this.loadWebglAddon();
      } else {
        logger.debug('[Renderer] Using Canvas renderer for light theme (better anti-aliasing)');
      }

      // Apply theme
      this.themeManager.applyTheme(this.xterm);

      // Ensure container has dimensions before fitting
      const containerRect = this.container.getBoundingClientRect();

      if (containerRect.width > 0 && containerRect.height > 0) {
        // Fit to container
        this.fitAddon.fit();
      } else {
        logger.warn('Container has no dimensions, delaying fit');
        // Try fitting after a delay
        setTimeout(() => {
          this.fitAddon.fit();
        }, 100);
      }

      // Setup resize observer with debouncing
      this.setupResizeObserver();

      // Setup XTerm event handlers
      this.setupXTermEventHandlers();

      // Setup theme change listener
      this.setupThemeChangeListener();

      // Get terminal dimensions
      const cols = this.xterm.cols;
      const rows = this.xterm.rows;

      // Check if terminal exists on backend
      let terminalExists = false;
      try {
        const info = await window.electronAPI.invoke('terminal:professional:info', {
          terminalId: this.terminalId,
        });
        terminalExists = info.success && info.info;
      } catch (error) {
        logger.warn(`Could not check terminal existence: ${error}`);
      }

      // Restore buffer based on whether terminal exists on backend
      // - If terminal exists on backend: use backend buffer (has real PTY output)
      // - If terminal doesn't exist: use local buffer (from localStorage)
      if (!skipBufferRestore) {
        if (terminalExists) {
          // Terminal exists on backend - restore from backend buffer
          try {
            const bufferResult = await window.electronAPI.invoke(
              'terminal:professional:get-buffer',
              {
                terminalId: this.terminalId,
              },
            );
            if (bufferResult.success && bufferResult.buffer) {
              logger.info(
                `Restoring ${bufferResult.buffer.length} bytes of buffered output from backend`,
              );
              this.xterm.write(bufferResult.buffer);
              // Parse the restored buffer to extract command history
              this.parseTerminalOutput(bufferResult.buffer);
            }
          } catch (error) {
            logger.warn('Could not restore terminal buffer from backend:', error);
          }
        } else {
          // Terminal doesn't exist on backend - try local buffer
          const snapshot = await this.bufferManager.restoreBuffer();
          if (snapshot) {
            logger.info('Restoring terminal buffer from local storage');
            this.restoreFromSnapshot(snapshot);
          }
        }
      }

      // Start buffer auto-save
      this.startBufferAutoSave();

      // Transition to connecting state
      this.stateMachine.transition('connect');

      if (!terminalExists) {
        // Open new PTY connection
        logger.debug(`[initialize] Terminal ${this.terminalId} creating new PTY`);
        await this.openPtyConnection(cols, rows);
      } else {
        // Terminal already exists on backend - reconnect to it
        this.setupIpcEventHandlers();

        // Mark as connected
        this.stateMachine.transition('connected');

        // Resize the backend PTY to match current xterm dimensions (must be after CONNECTED state)
        this.resize(cols, rows);

        // Notify ready
        this.callbacks.onReady?.();
      }

      // Focus the terminal after initialization - use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        if (!this.isDisposed) {
          this.xterm.focus();
        }
      });
    } catch (error) {
      this.stateMachine.reportError(error as Error);
      throw error;
    }
  }

  /**
   * Open connection to PTY process
   */
  private async openPtyConnection(cols: number, rows: number): Promise<void> {
    try {
      const result = await window.electronAPI.invoke('terminal:professional:create', {
        terminalId: this.terminalId,
        workspaceId: this.workspaceId,
        cols,
        rows,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to open terminal');
      }

      // Setup IPC event handlers
      this.setupIpcEventHandlers();

      // Mark as connected
      this.stateMachine.transition('connected');

      // Notify ready
      this.callbacks.onReady?.();
    } catch (error) {
      this.stateMachine.reportError(error as Error);
      throw error;
    }
  }

  /**
   * Setup XTerm event handlers
   */
  private setupXTermEventHandlers(): void {
    // Dispose old handlers if they exist to prevent duplicates
    if (this.dataDisposable) {
      this.dataDisposable.dispose();
      this.dataDisposable = null;
    }
    if (this.resizeDisposable) {
      this.resizeDisposable.dispose();
      this.resizeDisposable = null;
    }
    if (this.selectionDisposable) {
      this.selectionDisposable.dispose();
      this.selectionDisposable = null;
    }

    // Handle custom keyboard shortcuts
    this.xterm.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const isMod = isMac ? event.metaKey : event.ctrlKey;

      // Cmd+K on macOS to clear terminal (like Terminal.app)
      if (
        event.metaKey &&
        event.key === 'k' &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey
      ) {
        if (event.type === 'keydown') {
          this.clear();
        }
        // Return false to prevent the event from being passed to the terminal
        return false;
      }

      // Cmd+J (Mac) / Ctrl+J (Win/Linux) - toggle terminal overlay
      // Dispatch the Redux action directly because xterm captures keyboard
      // events before they can bubble to document-level handlers. The matching
      // overlay (workspace vs root) reacts via its own selector subscription.
      if (isMod && event.key === 'j' && !event.shiftKey && !event.altKey) {
        if (event.type === 'keydown') {
          dispatch(toggleTerminalOverlay(this.workspaceId));
        }
        return false;
      }

      // Cmd+F (Mac) / Ctrl+F (Win/Linux) - toggle search
      // Routed via per-terminal callback so only the originating terminal's
      // search bar toggles.
      if (isMod && event.key === 'f' && !event.shiftKey && !event.altKey) {
        if (event.type === 'keydown') {
          this.callbacks.onToggleSearch?.();
        }
        return false; // Prevent terminal from handling
      }

      // Cmd+T (Mac) / Ctrl+T (Win/Linux) - create new terminal
      // When the terminal is focused, Cmd+T should create a new terminal
      // instead of the default "new tab" behavior
      if (isMod && (event.key === 't' || event.key === 'T') && !event.shiftKey && !event.altKey) {
        if (event.type === 'keydown') {
          dispatchWindowEvent('workspace:new-terminal', { workspaceId: this.workspaceId });
        }
        return false;
      }

      // Cmd+W (Mac) / Ctrl+W (Win/Linux) - close active terminal tab
      if (isMod && (event.key === 'w' || event.key === 'W') && !event.shiftKey && !event.altKey) {
        if (event.type === 'keydown') {
          dispatch(closeActiveTerminalRequested(this.workspaceId));
        }
        return false;
      }

      // Cmd+Shift+] / Cmd+Shift+[ - cycle terminal tabs
      // Return false to let the overlay's window keydown handler pick these up
      if (isMod && event.shiftKey && !event.altKey &&
          (event.key === ']' || event.key === '}' || event.key === '[' || event.key === '{')) {
        return false;
      }

      // Ctrl+` or Ctrl+Shift+` (tilde) - toggle/create terminal
      if (
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (event.key === '`' || event.key === '~')
      ) {
        if (event.type === 'keydown') {
          if (event.shiftKey || event.key === '~') {
            dispatchWindowEvent('workspace:new-terminal', { workspaceId: this.workspaceId });
          } else {
            dispatch(toggleTerminalOverlay(this.workspaceId));
          }
        }
        return false;
      }

      // Return true to allow all other key events to be handled normally
      return true;
    });

    // Intercept paste events to sanitize ANSI escape sequences
    // We use a paste event listener rather than keyboard handler because:
    // 1. Keyboard handlers can't fully prevent browser paste behavior
    // 2. This also handles right-click paste and other paste methods
    this.container.addEventListener('paste', this.handlePasteEvent);

    // Handle user input - write method handles state checks
    this.dataDisposable = this.xterm.onData((data) => {
      if (!this.isDisposed) {
        this.write(data);
      }
    });

    // Handle resize
    this.resizeDisposable = this.xterm.onResize(({ cols, rows }) => {
      if (!this.isDisposed && this.stateMachine.canAcceptInput()) {
        this.resize(cols, rows);
      }
    });

    // Handle selection - no-op for now, but keep the listener for future features
    this.selectionDisposable = this.xterm.onSelectionChange(() => {});
  }

  /**
   * Setup IPC event handlers for PTY communication
   */
  private setupIpcEventHandlers(): void {
    // Clean up existing IPC handlers to prevent duplicates
    if (this.ipcCleanup) {
      this.ipcCleanup();
      this.ipcCleanup = null;
    }

    // Use a closure flag to disable the handler - this works even if off() fails to remove the listener
    // (contextBridge may wrap functions, breaking reference equality for removeListener)
    let handlerDisabled = false;

    const handleData = (data: { terminalId: string; data: string }) => {
      // Skip if handler has been disabled by cleanup
      if (handlerDisabled) {
        return;
      }

      if (
        data &&
        data.terminalId === this.terminalId &&
        !this.isDisposed &&
        this.stateMachine.canAcceptInput()
      ) {
        this.xterm.write(data.data);
        this.parseTerminalOutput(data.data);
      }
    };

    // Handle exit
    const handleExit = (data: { terminalId: string; exitCode: number }) => {
      if (data && data.terminalId === this.terminalId && !this.isDisposed) {
        this.exitedNormally = true;
        this.callbacks.onExit?.(data.exitCode);
        this.stateMachine.transition('disconnect');
      }
    };

    // Handle errors
    const handleError = (data: { terminalId: string; error: string }) => {
      if (data && data.terminalId === this.terminalId && !this.isDisposed) {
        this.stateMachine.reportError(new Error(data.error));
      }
    };

    // Handle command start
    const handleCommandStart = (data: { terminalId: string }) => {
      if (data && data.terminalId === this.terminalId && !this.isDisposed) {
        this.isExecuting = true;
        this.callbacks.onCommandStart?.();
      }
    };

    // Handle command finished
    const handleCommandFinished = (data: { terminalId: string }) => {
      if (data && data.terminalId === this.terminalId && !this.isDisposed) {
        this.isExecuting = false;
        this.callbacks.onCommandFinished?.();
      }
    };

    // Handle command executed (from backend, e.g., setup script)
    const handleCommandExecuted = (data: { terminalId: string; command: string }) => {
      if (data && data.terminalId === this.terminalId && !this.isDisposed) {
        logger.debug(`[TerminalAdapter] Backend command executed: ${sanitizeCommandForDisplay(data.command)}`);
        // Track the command in history
        terminalHistoryTracker.onCommandStart(this.terminalId, this.workspaceId, data.command);
        this.isExecuting = true;
        this.callbacks.onCommandStart?.();
      }
    };

    // Handle CWD changes
    const handleCwdChanged = (data: { terminalId: string; cwd: string }) => {
      if (data && data.terminalId === this.terminalId && !this.isDisposed) {
        this.lastCwd = data.cwd;
        this.callbacks.onCwdChanged?.(data.cwd);
      }
    };

    // Register listeners - use professional terminal events
    // Use ID-based listener removal for reliable cleanup with context isolation
    const dataListenerId = window.electronAPI.on('terminal:professional:data', handleData);
    const exitListenerId = window.electronAPI.on('terminal:professional:exit', handleExit);
    const errorListenerId = window.electronAPI.on('terminal:professional:error', handleError);
    const commandStartListenerId = window.electronAPI.on(
      'terminal:professional:command:start',
      handleCommandStart,
    );
    const commandFinishedListenerId = window.electronAPI.on(
      'terminal:professional:command:finished',
      handleCommandFinished,
    );
    const commandExecutedListenerId = window.electronAPI.on(
      'terminal:professional:command:executed',
      handleCommandExecuted,
    );
    const cwdChangedListenerId = window.electronAPI.on(
      'terminal:professional:cwd:changed',
      handleCwdChanged,
    );

    // Store cleanup function for IPC handlers
    this.ipcCleanup = () => {
      // CRITICAL: Set the disabled flag FIRST to immediately stop processing
      // This works even if offById() fails to remove the listener
      handlerDisabled = true;

      // Remove the listeners using ID-based removal for reliable cleanup
      if (dataListenerId) window.electronAPI.offById('terminal:professional:data', dataListenerId);
      if (exitListenerId) window.electronAPI.offById('terminal:professional:exit', exitListenerId);
      if (errorListenerId) window.electronAPI.offById('terminal:professional:error', errorListenerId);
      if (commandStartListenerId)
        window.electronAPI.offById('terminal:professional:command:start', commandStartListenerId);
      if (commandFinishedListenerId)
        window.electronAPI.offById('terminal:professional:command:finished', commandFinishedListenerId);
      if (commandExecutedListenerId)
        window.electronAPI.offById('terminal:professional:command:executed', commandExecutedListenerId);
      if (cwdChangedListenerId)
        window.electronAPI.offById('terminal:professional:cwd:changed', cwdChangedListenerId);
    };
    // Note: ipcCleanup is called in dispose() directly, no need to add to eventListeners
  }

  /**
   * Setup resize observer with debouncing
   */
  private setupResizeObserver(): void {
    // Disconnect old observer if it exists to prevent duplicates
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clear any pending resize timer
    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = null;
    }

    this.resizeObserver = new ResizeObserver(() => {
      // Debounce resize events
      if (this.resizeDebounceTimer) {
        clearTimeout(this.resizeDebounceTimer);
      }

      this.resizeDebounceTimer = setTimeout(() => {
        if (!this.isDisposed && this.stateMachine?.canAcceptInput()) {
          this.fitAddon.fit();
        }
      }, 100);
    });

    this.resizeObserver.observe(this.container);

    // Setup visibility observer to reconnect ResizeObserver when container becomes visible
    this.setupVisibilityObserver();
  }

  /**
   * Setup IntersectionObserver to detect when the terminal container becomes visible.
   * When the container transitions from hidden → visible, we reconnect the ResizeObserver
   * and call fitAddon.fit() so PTY dimensions stay in sync.
   */
  private setupVisibilityObserver(): void {
    // Clean up existing observer
    if (this.visibilityObserver) {
      this.visibilityObserver.disconnect();
      this.visibilityObserver = null;
    }

    this.visibilityObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const isVisible = entry.isIntersecting;

        if (isVisible && !this.wasVisible) {
          // Container transitioned from hidden → visible
          logger.debug(`[visibility] Terminal ${this.terminalId} became visible, reconnecting ResizeObserver`);

          // Reconnect ResizeObserver if it was disconnected
          if (!this.resizeObserver) {
            this.resizeObserver = new ResizeObserver(() => {
              if (this.resizeDebounceTimer) {
                clearTimeout(this.resizeDebounceTimer);
              }
              this.resizeDebounceTimer = setTimeout(() => {
                if (!this.isDisposed && this.stateMachine?.canAcceptInput()) {
                  this.fitAddon.fit();
                }
              }, 100);
            });
            this.resizeObserver.observe(this.container);
          }

          // Fit immediately to sync PTY dimensions
          if (!this.isDisposed && this.stateMachine?.canAcceptInput()) {
            this.fitAddon.fit();
          }
        }

        this.wasVisible = isVisible;
      }
    });

    this.visibilityObserver.observe(this.container);
  }

  /**
   * Load the WebGL addon and attach a context loss recovery listener.
   * On context loss, the addon is disposed and recreated automatically.
   * Falls back to Canvas renderer if recreation fails.
   */
  private loadWebglAddon(): void {
    // Clean up any existing WebGL addon and listener first
    this.disposeWebglAddon();

    try {
      this.webglAddon = new WebglAddon();
      this.xterm.loadAddon(this.webglAddon);

      // Listen for WebGL context loss on the canvas element
      const canvas = this.xterm.element?.querySelector('canvas');
      if (canvas) {
        const handleContextLost = (event: Event) => {
          event.preventDefault();
          logger.warn(
            `[WebGL] Context lost for terminal ${this.terminalId}, recovering...`,
          );

          if (this.isDisposed) return;

          // Dispose the broken addon
          this.disposeWebglAddon();

          // Attempt to recreate after a short delay to let the GPU recover
          setTimeout(() => {
            if (this.isDisposed) return;

            const currentTheme = this.themeManager.getCurrentTheme();
            if (!currentTheme.isDark) {
              logger.info(
                '[WebGL] Skipping WebGL recovery on light theme, using Canvas renderer',
              );
              return;
            }

            // Guard against infinite recovery loops
            if (this.webglRecoveryAttempts >= TerminalAdapter.MAX_WEBGL_RECOVERY_ATTEMPTS) {
              logger.warn(
                `[WebGL] Max recovery attempts (${TerminalAdapter.MAX_WEBGL_RECOVERY_ATTEMPTS}) reached for terminal ${this.terminalId}, staying on Canvas renderer`,
              );
              return;
            }

            this.webglRecoveryAttempts++;

            try {
              this.loadWebglAddon();
              logger.info(`[WebGL] Successfully recovered from context loss (attempt ${this.webglRecoveryAttempts})`);
            } catch (error) {
              logger.warn(
                '[WebGL] Failed to recover from context loss, falling back to Canvas renderer:',
                error,
              );
              this.webglAddon = null;
            }
          }, 100);
        };

        canvas.addEventListener('webglcontextlost', handleContextLost);
        this.webglContextLostCleanup = () => {
          canvas.removeEventListener('webglcontextlost', handleContextLost);
        };
      }
    } catch (error) {
      logger.warn('Failed to load WebGL renderer, falling back to Canvas renderer:', error);
      this.webglAddon = null;
    }
  }

  /**
   * Dispose the WebGL addon and its context loss listener.
   */
  private disposeWebglAddon(): void {
    if (this.webglContextLostCleanup) {
      this.webglContextLostCleanup();
      this.webglContextLostCleanup = null;
    }

    if (this.webglAddon) {
      try {
        this.webglAddon.dispose();
      } catch (error) {
        logger.warn('Error disposing WebGL addon:', error);
      }
      this.webglAddon = null;
    }
  }


  /**
   * Setup theme change listener
   *
   * On light themes, we disable WebGL and use the Canvas renderer instead.
   * The Canvas renderer respects CSS font-smoothing properties, which allows
   * for proper subpixel anti-aliasing on light backgrounds.
   * WebGL renders directly to a GPU canvas using greyscale anti-aliasing,
   * which looks poor on light backgrounds.
   */
  private setupThemeChangeListener(): void {
    // Clean up old theme handler if it exists
    if (this.themeCleanup) {
      this.themeCleanup();
      this.themeCleanup = null;
    }

    // Listen for terminal theme changes
    const handleThemeChange = (event: CustomEvent) => {
      const newTheme = event.detail?.theme;
      if (newTheme && this.xterm) {
        logger.info(`[Theme] Theme changed to: ${newTheme.name} (isDark: ${newTheme.isDark})`);
        this.themeManager.applyTheme(this.xterm, newTheme);

        // Toggle WebGL based on theme:
        // - Dark theme: use WebGL for better performance
        // - Light theme: use Canvas renderer for proper font-smoothing/anti-aliasing
        if (newTheme.isDark) {
          // Enable WebGL for dark themes if not already loaded
          if (!this.webglAddon) {
            this.loadWebglAddon();
          }
        } else {
          // Dispose WebGL for light themes to use Canvas renderer with proper anti-aliasing
          if (this.webglAddon) {
            this.disposeWebglAddon();
            logger.info('[WebGL] Disposed WebGL addon for light theme (using Canvas renderer)');
          }
        }
      }
    };

    window.addEventListener('terminal-theme-changed', handleThemeChange as EventListener);

    // Store cleanup function
    this.themeCleanup = () => {
      window.removeEventListener('terminal-theme-changed', handleThemeChange as EventListener);
    };
  }

  /**
   * Parse terminal output for shell integration
   */
  private parseTerminalOutput(data: string): void {
    // Track output for history
    terminalHistoryTracker.onOutput(this.terminalId, this.workspaceId, data);

    // Check for command start/end markers
    if (data.includes('\x1b]133;C\x07')) {
      // Command finished
      if (this.isExecuting) {
        this.isExecuting = false;
        this.callbacks.onCommandFinished?.();
        terminalHistoryTracker.onCommandFinish(this.terminalId, this.workspaceId);
      }
      // Reset command buffer when command finishes
      this.commandBuffer = '';
      this.isAtPrompt = true;
    } else if (data.includes('\x1b]133;A\x07')) {
      // Command started (prompt appeared)
      if (!this.isExecuting) {
        this.isExecuting = true;
        this.callbacks.onCommandStart?.();
      }
      // We're at a new prompt
      this.isAtPrompt = true;
      this.commandBuffer = '';
    }

    // Detect prompts to track when commands finish
    // Match $ or % at the end of a line as a prompt
    // Common prompt formats: "user@host:dir$ ", "[user@host dir]$ ", "➜ dir $", etc.
    const promptPattern = /[\$%]\s*$/;

    // Pattern to detect command lines echoed in the output
    // This matches lines like "$ bash /path/to/script.sh" or "user@host:~$ npm install"
    const commandLinePattern = /^.*[\$%]\s+(.+)$/;

    const lines = data.split(/\r?\n/);
    for (const line of lines) {
      // Strip ALL ANSI/terminal escape codes more comprehensively
      const cleanLine = line
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '') // CSI sequences like [?2004h
        .replace(/\x1b\][^\x07]*\x07/g, '') // OSC sequences (terminated by BEL)
        .replace(/\x1b\][^\x1b]*\x1b\\/g, '') // OSC sequences (terminated by ST)
        .replace(/\x1b[()][AB0-2]/g, '') // Character set selection
        .replace(/\x1b[=>]/g, '') // Application/Normal keypad
        .replace(/\x1b[78]/g, '') // Save/restore cursor
        .replace(/\x1b[DME]/g, '') // Line feed, reverse line feed, next line
        .replace(/\x1b[HZ]/g, '') // Tab set, tab clear
        .replace(/\x1b[c]/g, '') // Reset
        .replace(/\[\?[0-9;]*[a-zA-Z]/g, '') // Remaining CSI without ESC (partial)
        .replace(/\x07/g, '') // Bell character
        .replace(/\x00-\x08\x0b\x0c\x0e-\x1f/g, '') // Other control characters
        .trim();

      // Skip empty lines or pure terminal control sequences
      if (!cleanLine || /^\[[\?0-9;]*[a-zA-Z]$/.test(cleanLine)) {
        continue;
      }

      // Try to detect a command being executed from output
      // This helps for initial terminals where we restore from buffer
      const commandMatch = cleanLine.match(commandLinePattern);
      if (commandMatch && commandMatch[1]) {
        const command = commandMatch[1].trim();
        // Only track if it looks like a real command (not just a prompt)
        // Also validate that the command looks reasonable (starts with alphanumeric, /, ., or ~)
        // This helps filter out false positives from malformed escape code stripping
        const looksLikeCommand = /^[a-zA-Z0-9.\/~]/.test(command);
        if (command.length > 0 && !this.isExecuting && looksLikeCommand) {
          logger.info(`[TerminalAdapter] Detected command from output: ${sanitizeCommandForDisplay(command)}`);
          terminalHistoryTracker.onCommandStart(this.terminalId, this.workspaceId, command);
          this.isExecuting = true;
          this.callbacks.onCommandStart?.();
        } else if (command.length > 0 && !looksLikeCommand) {
          logger.debug(`[TerminalAdapter] Skipping suspicious command detection: ${sanitizeCommandForDisplay(command)}`);
        }
      }

      // Check for a prompt pattern (command finished)
      // A line ending with $ or % is likely a prompt (but NOT followed by a command)
      // Only match prompts that are JUST a prompt, not a prompt + command
      if (promptPattern.test(cleanLine) && !commandMatch) {
        // If we were executing a command and now see a prompt, command has finished
        if (this.isExecuting) {
          this.isExecuting = false;
          this.callbacks.onCommandFinished?.();
          terminalHistoryTracker.onCommandFinish(this.terminalId, this.workspaceId);
          logger.debug(`[TerminalAdapter] Command finished, prompt detected: ${sanitizeCommandForDisplay(cleanLine)}`);
        }
        this.isAtPrompt = true;
        this.commandBuffer = '';
      }
    }

    // Check for CWD changes
    const cwdMatch = data.match(/\x1b\]7;file:\/\/[^/]*([^\x07]*)\x07/);
    if (cwdMatch) {
      const cwd = decodeURIComponent(cwdMatch[1]);
      if (cwd !== this.lastCwd) {
        this.lastCwd = cwd;
        this.callbacks.onCwdChanged?.(cwd);
      }
    }
  }

  /**
   * Start automatic buffer saving
   */
  private startBufferAutoSave(): void {
    // Save buffer every 5 seconds if there are changes
    this.bufferSaveTimer = setInterval(() => {
      if (this.stateMachine?.canAcceptInput()) {
        this.saveBuffer();
      }
    }, 5000);
  }

  /**
   * Save current buffer to storage
   */
  private async saveBuffer(): Promise<void> {
    try {
      const buffer = this.xterm.buffer.active;
      const lines: string[] = [];

      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i);
        if (line) {
          lines.push(line.translateToString(true));
        }
      }

      await this.bufferManager.saveBuffer(lines, buffer.cursorX, buffer.cursorY);
    } catch (error) {
      logger.error('Failed to save buffer:', error);
    }
  }

  /**
   * Restore terminal from buffer snapshot
   */
  private restoreFromSnapshot(snapshot: any): void {
    if (snapshot.lines && snapshot.lines.length > 0) {
      this.xterm.clear();

      // Restore the buffer content but remove any trailing prompt lines
      const lines = [...snapshot.lines];

      // Remove empty lines from the end
      while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
      }

      // Now check if the last non-empty lines form a prompt
      // We need to handle various prompt formats:
      // 1. Single line: "user@host path % "
      // 2. Two lines: "user@host path" + "% "
      // 3. Wrapped: "user@host long-pa" + "th % "

      const promptSymbolPattern = /[\$>#%]\s*$/;
      const userHostPattern = /@[\w-]+/;

      // Strategy: Look for prompt patterns and remove them
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1];
        const secondLastLine = lines.length > 1 ? lines[lines.length - 2] : '';


        // Case 1: Complete prompt on one line
        if (promptSymbolPattern.test(lastLine) && userHostPattern.test(lastLine)) {
          lines.pop();
        }
        // Case 2: Prompt symbol alone on last line (like "eec21b % ")
        else if (promptSymbolPattern.test(lastLine) && lastLine.trim().length < 80) {
          lines.pop();
          // Also remove the previous line if it has the username
          if (lines.length > 0 && userHostPattern.test(lines[lines.length - 1])) {
            lines.pop();
          }
        }
        // Case 3: Check for wrapped prompts across 3 lines
        // Sometimes the prompt can be: "user@host very-long-path-that-wr"
        //                               "aps-to-next-li"
        //                               "ne % "
        else if (lines.length >= 2) {
          // Join the last few lines to check if they form a prompt
          const combined = secondLastLine + lastLine;
          if (promptSymbolPattern.test(combined) && userHostPattern.test(combined)) {
            lines.pop();
            lines.pop();
          }
        }
      }

      // Write the cleaned buffer content
      for (let i = 0; i < lines.length; i++) {
        if (i < lines.length - 1) {
          this.xterm.writeln(lines[i]);
        } else {
          // For the last line, write without newline if it has content
          if (lines[i].trim()) {
            this.xterm.writeln(lines[i]);
          }
        }
      }

      logger.debug(
        `Restored terminal buffer for ${this.terminalId} with ${lines.length} lines (prompt removed)`,
      );
    }
  }

  /**
   * Read the actual command text from xterm's buffer at the current cursor line.
   * This captures the fully rendered text including tab completions and shell-side edits,
   * which the raw keystroke-based commandBuffer misses.
   */
  private getCommandFromXtermBuffer(): string | null {
    try {
      const buffer = this.xterm.buffer.active;
      const cursorY = buffer.cursorY + buffer.baseY;
      const line = buffer.getLine(cursorY);
      if (!line) return null;

      const lineText = line.translateToString(true);
      if (!lineText || !lineText.trim()) return null;

      // Strip ANSI escape sequences that might be embedded in the buffer
      const cleanText = lineText
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
        .replace(/\x1b\][^\x07]*\x07/g, '')
        .replace(/\x1b[()][AB0-2]/g, '')
        .replace(/\x07/g, '')
        .trim();

      if (!cleanText) return null;

      // Strip the prompt prefix to get just the command.
      // Use greedy match to find the LAST $ or % followed by space(s) and the command.
      // This avoids matching $ or % that appear earlier in the prompt text.
      const promptMatch = cleanText.match(/^.*[\$%#❯➜]\s+(.+)$/);
      if (promptMatch && promptMatch[1]) {
        return promptMatch[1].trim();
      }

      // If no prompt detected, return null and let caller fall back
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Write data to terminal
   */
  write(data: string): void {
    if (this.isDisposed || !this.stateMachine.canAcceptInput()) {
      return;
    }

    // Track command buffer as user types
    if (data === '\r' || data === '\n') {
      // Enter key pressed - execute command.
      // Try to read the actual command from xterm's buffer first, which includes
      // tab completions, arrow-key history, and other shell-side edits.
      // Fall back to commandBuffer for cases where the buffer read fails.
      const xtermCommand = this.getCommandFromXtermBuffer();
      const command = xtermCommand || this.commandBuffer.trim();

      if (command) {
        // Track the command that's about to be executed
        terminalHistoryTracker.onCommandStart(
          this.terminalId,
          this.workspaceId,
          command,
        );
        // Mark as executing so we know to finish tracking when prompt appears
        this.isExecuting = true;
        logger.debug(`Command executed: ${sanitizeCommandForDisplay(command)}${xtermCommand ? ' (from xterm buffer)' : ' (from keystroke buffer)'}`);
      }
      // Clear the command buffer
      this.commandBuffer = '';
      this.currentLineBuffer = '';
    } else if (data === '\x7f' || data === '\b') {
      // Backspace - remove last character from buffer
      if (this.commandBuffer.length > 0) {
        this.commandBuffer = this.commandBuffer.slice(0, -1);
      }
    } else if (data === '\x03') {
      // Ctrl+C - clear the buffer
      this.commandBuffer = '';
      this.currentLineBuffer = '';
    } else if (data === '\x15') {
      // Ctrl+U - clear line
      this.commandBuffer = '';
      this.currentLineBuffer = '';
    } else if (!data.match(/[\x00-\x1F\x7F]/)) {
      // Regular character - add to buffer
      this.commandBuffer += data;
      this.currentLineBuffer += data;
    }

    window.electronAPI
      .invoke('terminal:professional:write', {
        terminalId: this.terminalId,
        data,
      })
      .then((result) => {
        if (!result.success) {
          logger.error(`[write] Terminal ${this.terminalId}: write failed - ${result.error}`);
        }
      })
      .catch((error) => {
        logger.error(`[write] Terminal ${this.terminalId}: IPC error - ${error}`);
        if (!this.isDisposed) {
          this.stateMachine.reportError(error);
        }
      });
  }

  /**
   * Handle paste events by sanitizing ANSI escape sequences from clipboard content.
   * This prevents pasted text with embedded ANSI codes from corrupting terminal styling state.
   */
  private handlePasteEvent = (event: ClipboardEvent): void => {
    if (this.isDisposed || !this.stateMachine.canAcceptInput()) {
      return;
    }

    // Prevent xterm's default paste handling to avoid double-paste
    event.preventDefault();
    event.stopPropagation();

    const text = event.clipboardData?.getData('text/plain');
    if (!text) {
      return;
    }

    // Strip ANSI escape sequences from pasted content
    // Matches: ESC [ followed by optional numbers/semicolons and a letter
    const sanitizedText = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

    // Write the sanitized text to the terminal
    this.write(sanitizedText);

    // Reset SGR attributes to default after paste to ensure any residual styling state is cleared
    this.xterm.write('\x1b[0m');
  };

  /**
   * Resize terminal
   */
  resize(cols: number, rows: number): void {
    if (this.isDisposed || !this.stateMachine.canAcceptInput()) {
      return;
    }

    window.electronAPI
      .invoke('terminal:professional:resize', {
        terminalId: this.terminalId,
        cols,
        rows,
      })
      .catch((error) => {
        logger.error('Failed to resize terminal:', error);
      });
  }

  /**
   * Focus the terminal
   */
  focus(): void {
    if (!this.isDisposed) {
      this.xterm.focus();
    }
  }

  /**
   * Blur the terminal
   */
  blur(): void {
    if (!this.isDisposed) {
      this.xterm.blur();
    }
  }

  /**
   * Clear the terminal
   */
  clear(): void {
    if (!this.isDisposed) {
      this.xterm.clear();
    }
  }

  /**
   * Reattach terminal to a new container
   */
  async reattach(container: HTMLElement): Promise<void> {
    if (this.isDisposed || this.stateMachine.isDisposed()) {
      throw new Error('Cannot reattach disposed terminal');
    }

    // Cancel any pending auto-reconnect since we're manually reattaching
    this.cancelAutoReconnect();
    this.autoReconnectAttempts = 0;
    this.webglRecoveryAttempts = 0;
    this.exitedNormally = false;

    // Ensure IPC handlers are set up (they may have been cleaned up on detach or during refresh)
    this.setupIpcEventHandlers();

    // Ensure state machine is in CONNECTED state for input to work
    // This handles the case where the terminal was reattached after a renderer refresh
    const currentState = this.stateMachine.getState();
    if (currentState !== TerminalState.CONNECTED) {
      logger.info(
        `[reattach] Terminal ${this.terminalId} not in CONNECTED state (${currentState}), attempting to restore`,
      );
      // Check if terminal exists on backend and transition accordingly
      try {
        const info = await window.electronAPI.invoke('terminal:professional:info', {
          terminalId: this.terminalId,
        });
        if (info.success && info.info) {
          // Terminal exists on backend, force state to connected
          // This is safe because we know the PTY is running
          if (currentState === TerminalState.DISCONNECTED || currentState === TerminalState.ERROR) {
            this.stateMachine.transition('reconnect');
            this.stateMachine.transition('reconnected');
          } else if (currentState === TerminalState.CONNECTING) {
            this.stateMachine.transition('connected');
          }
          logger.info(
            `[reattach] Terminal ${this.terminalId} state restored to ${this.stateMachine.getState()}`,
          );
        }
      } catch (error) {
        logger.warn(`[reattach] Could not check terminal state: ${error}`);
      }
    }

    // If the terminal element exists, try to move it instead of recreating
    // Note: We check for terminalElement existence, not parentNode, because
    // the old container may have been removed from the DOM (e.g., when drawer closes)
    const terminalElement = this.xterm.element;
    if (terminalElement) {
      // Move the existing terminal element to the new container
      // This works even if the element has no parent (was detached)
      container.appendChild(terminalElement);

      // Update container reference
      this.container = container;

      // Dispose and recreate WebGL addon (it loses context when moved)
      this.disposeWebglAddon();

      // Re-apply theme
      this.themeManager.applyTheme(this.xterm);

      // Re-initialize WebGL addon only for dark themes (light themes use Canvas renderer)
      const currentTheme = this.themeManager.getCurrentTheme();
      if (currentTheme.isDark) {
        this.loadWebglAddon();
      } else {
        logger.debug('[Renderer] Using Canvas renderer after move (light theme)');
      }

      // Refit to new container - may need to wait for container to have dimensions
      const containerRect = container.getBoundingClientRect();
      if (containerRect.width > 0 && containerRect.height > 0) {
        this.fitAddon.fit();
      } else {
        // Container not visible yet, delay fit
        setTimeout(() => {
          if (!this.isDisposed) {
            this.fitAddon.fit();
          }
        }, 50);
      }

      // Setup resize observer for new container
      this.setupResizeObserver();

      // Re-setup XTerm event handlers to ensure input works after reattachment
      this.setupXTermEventHandlers();

      // Reset command buffer state when reattaching
      this.commandBuffer = '';
      this.currentLineBuffer = '';
      this.isAtPrompt = false;

      // Restart heartbeat since reattach doesn't trigger a state transition to CONNECTED
      this.startHeartbeat();

      // Focus the terminal - use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        if (!this.isDisposed) {
          this.xterm.focus();
        }
      });

      return;
    }

    // Fallback: If we can't move the element, recreate it
    // This should rarely happen since we now check for terminalElement existence, not parentNode
    logger.warn(`Could not move terminal element, recreating for terminal ${this.terminalId}`);

    // Clear old container
    if (this.container) {
      this.container.innerHTML = '';
    }

    // Dispose old WebGL addon if it exists
    this.disposeWebglAddon();

    // Remove old data handler if it exists
    if (this.dataDisposable) {
      this.dataDisposable.dispose();
      this.dataDisposable = null;
    }

    // Set new container
    this.container = container;

    // Reopen xterm in new container - but warn if already opened (indicates a problem)
    if (this.isXtermOpened) {
      logger.warn(
        `[reattach] XTerm was already opened for terminal ${this.terminalId}, calling open() again may cause duplicate handlers`,
      );
    }
    this.xterm.open(container);
    this.isXtermOpened = true;

    // Re-apply theme first to get current theme
    this.themeManager.applyTheme(this.xterm);

    // Re-initialize WebGL addon only for dark themes (light themes use Canvas renderer)
    const currentTheme = this.themeManager.getCurrentTheme();
    if (currentTheme.isDark) {
      this.loadWebglAddon();
    } else {
      logger.debug('[Renderer] Using Canvas renderer on reattach (light theme)');
    }

    // Refit
    this.fitAddon.fit();

    // Re-setup XTerm event handlers (including onData for user input)
    this.setupXTermEventHandlers();

    // Setup resize observer for new container
    this.setupResizeObserver();

    // Reset command buffer state when reattaching
    this.commandBuffer = '';
    this.currentLineBuffer = '';
    this.isAtPrompt = false;

    // Restart heartbeat since reattach doesn't trigger a state transition to CONNECTED
    this.startHeartbeat();

    // Focus the terminal - use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      if (!this.isDisposed) {
        this.xterm.focus();
      }
    });

    // The terminal content should already be there from the backend PTY session
    // No need to send newlines or refresh commands
  }

  /**
   * Update callbacks
   */
  updateCallbacks(callbacks: Partial<TerminalCallbacks>): void {
    Object.assign(this.callbacks, callbacks);
  }

  /**
   * Search in terminal
   */
  findNext(
    term: string,
    options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean },
  ): boolean {
    return this.searchAddon.findNext(term, {
      caseSensitive: options?.caseSensitive ?? false,
      wholeWord: options?.wholeWord ?? false,
      regex: options?.regex ?? false,
      incremental: false,
      decorations: this.getSearchDecorations(),
    });
  }

  /**
   * Search backwards
   */
  findPrevious(
    term: string,
    options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean },
  ): boolean {
    return this.searchAddon.findPrevious(term, {
      caseSensitive: options?.caseSensitive ?? false,
      wholeWord: options?.wholeWord ?? false,
      regex: options?.regex ?? false,
      incremental: false,
      decorations: this.getSearchDecorations(),
    });
  }

  /**
   * Clear search highlighting
   */
  clearSearch(): void {
    this.searchAddon.clearDecorations();
  }

  /**
   * Get terminal information
   */
  getInfo(): TerminalInfo {
    const bufferStats = this.bufferManager.getStats();

    return {
      id: this.terminalId,
      workspaceId: this.workspaceId,
      state: this.stateMachine.getState(),
      cwd: this.lastCwd,
      isExecuting: this.isExecuting,
      stats: bufferStats
        ? {
          bufferSize: bufferStats.size,
          lineCount: bufferStats.lineCount,
          uptime: Date.now() - this.startTime,
        }
        : undefined,
    };
  }


  /**
   * Start the periodic IPC heartbeat.
   * Only runs while the terminal is in CONNECTED state.
   * Pings the backend PTY at regular intervals; on failure or timeout,
   * transitions to DISCONNECTED which triggers auto-reconnect.
   */
  private startHeartbeat(): void {
    // Don't start if already running or disposed
    if (this.heartbeatTimer || this.isDisposed) {
      return;
    }

    logger.debug(`[heartbeat] Starting for terminal ${this.terminalId} (every ${TerminalAdapter.HEARTBEAT_INTERVAL_MS}ms)`);

    this.heartbeatTimer = setInterval(() => {
      this.performHealthCheck();
    }, TerminalAdapter.HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Stop the periodic IPC heartbeat.
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      logger.debug(`[heartbeat] Stopped for terminal ${this.terminalId}`);
    }
  }

  /**
   * Perform a single health check by pinging the backend PTY via terminal:professional:info.
   * If the ping fails or times out, transition to DISCONNECTED to trigger auto-reconnect.
   */
  private async performHealthCheck(): Promise<void> {
    // Only check while CONNECTED and IPC handlers are set up
    if (this.isDisposed || !this.ipcCleanup || this.stateMachine.getState() !== TerminalState.CONNECTED) {
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      // Race the info call against a timeout
      const result = await Promise.race([
        window.electronAPI.invoke('terminal:professional:info', {
          terminalId: this.terminalId,
        }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Heartbeat timeout')), TerminalAdapter.HEARTBEAT_TIMEOUT_MS);
        }),
      ]);

      if (timeoutId) clearTimeout(timeoutId);

      if (this.isDisposed) return;

      // Check if the PTY is still alive
      if (!result.success || !result.info) {
        logger.warn(
          `[heartbeat] Terminal ${this.terminalId}: PTY not found on backend, transitioning to DISCONNECTED`,
        );
        this.stopHeartbeat();
        this.stateMachine.transition('disconnect');
      }
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);

      if (this.isDisposed) return;

      logger.warn(
        `[heartbeat] Terminal ${this.terminalId}: health check failed:`,
        error,
      );
      this.stopHeartbeat();
      this.stateMachine.transition('disconnect');
    }
  }


  /**
   * Schedule an auto-reconnect attempt with exponential backoff.
   * Called when the terminal enters DISCONNECTED or ERROR state.
   */
  private scheduleAutoReconnect(): void {
    // Don't reconnect if disposed or already at max attempts
    if (this.isDisposed) {
      return;
    }

    if (this.autoReconnectAttempts >= TerminalAdapter.MAX_RECONNECT_ATTEMPTS) {
      logger.warn(
        `[auto-reconnect] Terminal ${this.terminalId}: max reconnect attempts (${TerminalAdapter.MAX_RECONNECT_ATTEMPTS}) reached, giving up`,
      );
      return;
    }

    // Cancel any existing reconnect timer
    this.cancelAutoReconnect();

    const delay = TerminalAdapter.BASE_RECONNECT_DELAY_MS * Math.pow(2, this.autoReconnectAttempts);
    this.autoReconnectAttempts++;

    logger.info(
      `[auto-reconnect] Terminal ${this.terminalId}: scheduling attempt ${this.autoReconnectAttempts}/${TerminalAdapter.MAX_RECONNECT_ATTEMPTS} in ${delay}ms`,
    );

    this.autoReconnectTimer = setTimeout(() => {
      this.autoReconnectTimer = null;
      this.attemptAutoReconnect();
    }, delay);
  }

  /**
   * Cancel any pending auto-reconnect timer.
   */
  private cancelAutoReconnect(): void {
    if (this.autoReconnectTimer) {
      clearTimeout(this.autoReconnectTimer);
      this.autoReconnectTimer = null;
    }
  }

  /**
   * Attempt to auto-reconnect the terminal.
   * Checks if the PTY still exists on the backend and re-establishes the connection.
   */
  private async attemptAutoReconnect(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    const currentState = this.stateMachine.getState();
    // Only reconnect from DISCONNECTED or ERROR states
    if (currentState !== TerminalState.DISCONNECTED && currentState !== TerminalState.ERROR) {
      logger.debug(
        `[auto-reconnect] Terminal ${this.terminalId}: skipping, state is ${currentState}`,
      );
      return;
    }

    this.exitedNormally = false;

    logger.info(
      `[auto-reconnect] Terminal ${this.terminalId}: attempting reconnect (attempt ${this.autoReconnectAttempts})`,
    );

    try {
      // Check if PTY still exists on backend
      const info = await window.electronAPI.invoke('terminal:professional:info', {
        terminalId: this.terminalId,
      });

      if (this.isDisposed) return; // Check again after async call

      if (info.success && info.info) {
        // PTY exists — re-setup IPC handlers and transition back to CONNECTED
        logger.info(
          `[auto-reconnect] Terminal ${this.terminalId}: PTY exists on backend, re-establishing connection`,
        );

        this.setupIpcEventHandlers();
        this.stateMachine.transition('reconnect');
        this.stateMachine.transition('reconnected');

        // Resize to match current xterm dimensions
        if (this.xterm.cols && this.xterm.rows) {
          this.resize(this.xterm.cols, this.xterm.rows);
        }

        this.callbacks.onReady?.();
        logger.info(`[auto-reconnect] Terminal ${this.terminalId}: reconnected successfully`);
      } else {
        // PTY doesn't exist — try to create a new one via the existing reconnect() method
        logger.info(
          `[auto-reconnect] Terminal ${this.terminalId}: PTY not found, creating new PTY`,
        );
        await this.reconnect();
        logger.info(`[auto-reconnect] Terminal ${this.terminalId}: new PTY created successfully`);
      }
    } catch (error) {
      logger.error(
        `[auto-reconnect] Terminal ${this.terminalId}: attempt ${this.autoReconnectAttempts} failed:`,
        error,
      );
      // Explicitly re-schedule — the state listener may not trigger if no transition occurred
      this.scheduleAutoReconnect();
    }
  }

  /**
   * Handle errors
   */
  private handleError(error: Error): void {
    logger.error(`Terminal ${this.terminalId} error:`, error);
    this.callbacks.onError?.(error);

    // Show error in terminal
    if (!this.isDisposed) {
      this.xterm.writeln(`\r\n\x1b[31mError: ${error.message}\x1b[0m\r\n`);
    }
  }

  /**
   * Handle link clicks - open URLs in browser panel instead of popup.
   * GitHub URLs are always opened in the external browser.
   */
  private handleLinkClick(uri: string): void {
    try {
      // GitHub URLs always open in external browser
      if (isGitHubUrl(uri)) {
        logger.debug('GitHub URL detected in terminal, opening in external browser', {
          uri,
          workspaceId: this.workspaceId,
        });
        window.electronAPI?.invoke('shell:openExternal', { url: uri });
        return;
      }

      // Import and use the panel layout manager to open browser panel
      import('$features/layout/panel-layout-adapter')
        .then(({ getPanelLayoutManager }) => {
          const layoutManager = getPanelLayoutManager(this.workspaceId);
          layoutManager.openBrowserPanel(uri);
          logger.debug('Opened URL in browser panel', { uri, workspaceId: this.workspaceId });
        })
        .catch((err) => {
          logger.warn('Failed to open URL in browser panel, falling back to external browser', {
            uri,
            error: err,
          });
          // Fallback to external browser
          window.electronAPI?.invoke('shell:openExternal', { url: uri });
        });
    } catch (err) {
      logger.warn('Failed to handle link click', { uri, error: err });
      // Fallback to external browser
      window.electronAPI?.invoke('shell:openExternal', { url: uri });
    }
  }

  /**
   * Reconnect to terminal
   */
  async reconnect(): Promise<void> {
    if (this.isDisposed) {
      throw new Error('Cannot reconnect disposed terminal');
    }

    if (!this.stateMachine.canTransition('reconnect')) {
      throw new Error(`Cannot reconnect in state ${this.stateMachine.getState()}`);
    }

    this.exitedNormally = false;
    this.stateMachine.transition('reconnect');

    try {
      const cols = this.xterm.cols;
      const rows = this.xterm.rows;

      // Create new PTY connection
      const result = await window.electronAPI.invoke('terminal:professional:create', {
        terminalId: this.terminalId,
        workspaceId: this.workspaceId,
        cols,
        rows,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to reconnect terminal');
      }

      // Setup IPC event handlers
      this.setupIpcEventHandlers();

      // Mark as reconnected (different action than 'connected')
      this.stateMachine.transition('reconnected');

      // Notify ready
      this.callbacks.onReady?.();
    } catch (error) {
      this.stateMachine.reportError(error as Error);
      throw error;
    }
  }

  /**
   * Detach terminal from container (for reuse)
   */
  detach(): void {
    // Clean up IPC handlers to prevent stale handlers during detach
    if (this.ipcCleanup) {
      this.ipcCleanup();
      this.ipcCleanup = null;
    }

    // Stop heartbeat and cancel auto-reconnect to prevent IPC calls on detached terminal
    this.stopHeartbeat();
    this.cancelAutoReconnect();

    // Disconnect resize observer for the current container
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Disconnect visibility observer
    if (this.visibilityObserver) {
      this.visibilityObserver.disconnect();
      this.visibilityObserver = null;
    }

    // Clear resize timer if active
    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = null;
    }

    // Remove the xterm element from the container so it doesn't conflict
    // with other terminals that may be attached to the same container
    const terminalElement = this.xterm.element;
    if (terminalElement && terminalElement.parentNode) {
      terminalElement.parentNode.removeChild(terminalElement);
    }

    // Note: We don't dispose xterm here as we want to reuse it
    // The terminal remains in memory for reattachment
  }

  /**
   * Dispose of the terminal
   */
  dispose(): void {
    if (this.isDisposed || this.stateMachine.isDisposed()) {
      return;
    }

    // Mark as disposed first
    this.isDisposed = true;

    // Cancel any pending auto-reconnect and heartbeat
    this.cancelAutoReconnect();
    this.stopHeartbeat();

    // Transition to disposed state
    this.stateMachine.transition('dispose');

    // Save buffer one last time
    this.saveBuffer().catch(() => {});

    // Clear timers
    if (this.resizeDebounceTimer) {
      clearTimeout(this.resizeDebounceTimer);
      this.resizeDebounceTimer = null;
    }

    if (this.bufferSaveTimer) {
      clearInterval(this.bufferSaveTimer);
      this.bufferSaveTimer = null;
    }

    // Disconnect resize observer
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Disconnect visibility observer
    if (this.visibilityObserver) {
      this.visibilityObserver.disconnect();
      this.visibilityObserver = null;
    }

    // Dispose XTerm event handlers
    if (this.dataDisposable) {
      try {
        this.dataDisposable.dispose();
      } catch (error) {
        logger.error('Error disposing data handler:', error);
      }
      this.dataDisposable = null;
    }
    if (this.resizeDisposable) {
      try {
        this.resizeDisposable.dispose();
      } catch (error) {
        logger.error('Error disposing resize handler:', error);
      }
      this.resizeDisposable = null;
    }
    if (this.selectionDisposable) {
      try {
        this.selectionDisposable.dispose();
      } catch (error) {
        logger.error('Error disposing selection handler:', error);
      }
      this.selectionDisposable = null;
    }

    // Clean up IPC handlers
    if (this.ipcCleanup) {
      try {
        this.ipcCleanup();
      } catch (error) {
        logger.error('Error cleaning up IPC handlers:', error);
      }
      this.ipcCleanup = null;
    }

    // Clean up theme listener
    if (this.themeCleanup) {
      try {
        this.themeCleanup();
      } catch (error) {
        logger.error('Error cleaning up theme listener:', error);
      }
      this.themeCleanup = null;
    }

    // Remove paste event listener
    this.container?.removeEventListener('paste', this.handlePasteEvent);

    // Remove any remaining event listeners
    this.eventListeners.forEach((cleanup) => {
      try {
        cleanup();
      } catch (error) {
        logger.error('Error cleaning up event listener:', error);
      }
    });
    this.eventListeners = [];

    // Close PTY connection - use dispose instead of close
    window.electronAPI
      .invoke('terminal:professional:dispose', {
        terminalId: this.terminalId,
      })
      .catch((error) => {
        logger.error('Error disposing PTY connection:', error);
      });

    // Dispose addons first (before disposing xterm)
    try {
      // Dispose search addon
      if (this.searchAddon?.dispose) {
        this.searchAddon.dispose();
      }

      // Dispose web links addon
      if (this.webLinksAddon?.dispose) {
        this.webLinksAddon.dispose();
      }

      // Dispose WebGL addon and context loss listener
      this.disposeWebglAddon();

      // Dispose fit addon
      if (this.fitAddon?.dispose) {
        this.fitAddon.dispose();
      }
    } catch (error) {
      logger.error('Error disposing addons:', error);
    }

    // Dispose managers
    try {
      this.themeManager.dispose();
    } catch (error) {
      logger.error('Error disposing theme manager:', error);
    }

    try {
      this.stateMachine.dispose();
    } catch (error) {
      logger.error('Error disposing state machine:', error);
    }

    // Finally dispose XTerm and its renderer
    try {
      // Clear the terminal first
      this.xterm.clear();

      // Dispose the terminal (this will also dispose the renderer)
      this.xterm.dispose();
    } catch (error) {
      logger.error('Error disposing xterm:', error);
    }
  }
}
