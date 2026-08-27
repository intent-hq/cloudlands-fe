/**
 * Centralized Logging Configuration
 *
 * Controls log levels for different components to reduce noise
 * and improve signal-to-noise ratio in development.
 */

// Define LogLevel enum here to avoid circular dependency
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SUCCESS = 4,
}

export interface LoggingConfig {
  defaultLevel: LogLevel;
  categories: Record<string, LogLevel>;
  enableRuntimeConfig: boolean;
  enableConsoleOutput: boolean;
  enableFileOutput: boolean;
}

// Check if we're in development mode
const isDevelopment = process.env.NODE_ENV === 'development';
const isDebugMode = process.env.DEBUG === 'true';

/**
 * Default logging configuration
 *
 * In development: INFO level for most components, DEBUG for critical ones
 * In production: WARN level to reduce noise
 */
export const LOGGING_CONFIG: LoggingConfig = {
  // Default log level based on environment
  defaultLevel: isDevelopment ? LogLevel.INFO : LogLevel.WARN,

  // Per-category log levels
  // These override the default level for specific components
  categories: {
    // File system operations - reduce noise
    FileExplorerStore: isDevelopment && !isDebugMode ? LogLevel.WARN : LogLevel.DEBUG,
    FileTrackingStore: isDevelopment && !isDebugMode ? LogLevel.WARN : LogLevel.DEBUG,
    GitStore: isDevelopment && !isDebugMode ? LogLevel.WARN : LogLevel.DEBUG,

    // Workspace operations - keep at INFO for important events
    'workspace-page': LogLevel.INFO,
    WorkspaceStore: LogLevel.INFO,
    WorkspaceContent: LogLevel.INFO,

    // Agent operations - keep at INFO for debugging
    AgentLoader: LogLevel.INFO,
    AgentService: LogLevel.INFO,
    AgentStateService: LogLevel.INFO,

    // Activity and events - keep at INFO for debugging event flow
    ActivityLog: LogLevel.INFO,
    EventsClient: LogLevel.INFO,
    EventSystem: LogLevel.INFO,

    // Terminal operations
    TerminalHistoryTracker: LogLevel.WARN,
    TerminalManager: LogLevel.INFO,

    // UI components - reduce noise
    LineChangesMainState: LogLevel.WARN,
    CodeChangesPanel: LogLevel.WARN,

    // IPC handlers - reduce startup noise (set DEBUG=true to see setup messages)
    // WorkspaceIPC is kept at INFO level because it contains critical initialization logs
    WorkspaceIPC: LogLevel.INFO,
    NotesIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    NotesPrimitivesIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    ConfigIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    FileTrackingIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    GitIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    PersistenceIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    InitUnifiedHandlers: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    UnifiedAgentHandlers: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    CommentsIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    LineAttributionIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    AgentContextIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    GitTrackingIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    ObservabilityIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    RulesIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    LineChangesIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    AgentTestingIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    FirstVisitStateIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    EndUserRulesIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    AcceptChangesIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    SetupScriptsIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    'Terminal-IPC': isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    // Additional IPC handlers
    'Diffs-IPC': isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    'editor-ipc': isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    EventsIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    FileIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    'MCP-IPC': isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    'RemoteFS-IPC': isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    SystemIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    AuggieIPC: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    'DeepLink-IPC': isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    'IDE-IPC': isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    'SSH-IPC': isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    TerminalProfessional: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    'WorkspacePR-IPC': isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    'AgentMissing-IPC': isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    // Backend services - reduce noise during startup
    InitUnifiedBackend: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    // CDP - reduce startup noise
    CdpMcpBridge: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    CdpConnection: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,
    // HTTP MCP Bridge - reduce startup noise
    HttpMcpBridge: isDebugMode ? LogLevel.DEBUG : LogLevel.WARN,

    // System level
    GlobalCleanup: LogLevel.WARN,
    App: LogLevel.INFO,

    // Allowlisted renderer diagnostics forwarded into console-output.log by
    // forwardRendererConsoleToMainLog(). Pinned to INFO so these survive the
    // production defaultLevel of WARN — they exist to populate debug bundles,
    // so filtering them out in packaged builds would defeat the purpose.
    RendererConsole: LogLevel.INFO,

    // Build identity lines (#3649): the startup app-version banner and the
    // connected-daemon build log. Pinned to INFO so they survive the
    // production defaultLevel of WARN — their whole purpose is identifying
    // which builds produced a packaged-app log file.
    BuildInfo: LogLevel.INFO,

    // UI components - reduce noise during normal operation
    TipTapEditor: LogLevel.WARN,
    ContextPicker: LogLevel.WARN,
    BranchSelector: LogLevel.WARN,
    ChatPanel: LogLevel.WARN,
    NoteWithComments: LogLevel.WARN,
    PanelLayoutManager: LogLevel.WARN,
    PanelContentRenderer: LogLevel.WARN,
    SimpleRichInput: LogLevel.WARN,
    IssueSuggestions: LogLevel.WARN,

    // Auth stores - reduce noise
    LinearAuthStore: LogLevel.WARN,
    SentryAuthStore: LogLevel.WARN,
    GitHubAuthStore: LogLevel.WARN,

    // Agent services - reduce routine log noise
    AgentProxies: LogLevel.WARN,
    AgentSubscriptions: LogLevel.INFO,
    PermissionSaga: LogLevel.WARN,
    'browser/index': LogLevel.WARN,

    // Monaco/Editor - reduce noise
    default: LogLevel.WARN,
    EditorConfig: LogLevel.WARN,
    CommentDecorationsExtension: LogLevel.WARN,
    CommentLoader: LogLevel.WARN,
    CommentManagerV2: LogLevel.WARN,
    CommentsStoreV2: LogLevel.WARN,

    // Terminal overlay - reduce noise
    TerminalOverlayStore: LogLevel.WARN,

    // Workspace page - reduce routine initialization noise
    'workspace-loader': LogLevel.WARN,
    'workspace-unified-state': LogLevel.WARN,
    '+layout': LogLevel.WARN,
    ReadyTasks: LogLevel.WARN,
  },

  // Allow runtime configuration via localStorage
  enableRuntimeConfig: true,

  // Console output settings
  enableConsoleOutput: true,

  // File output settings (main process only)
  enableFileOutput: typeof window === 'undefined', // Only in main process
};

/**
 * Get the log level for a specific category
 */
export function getLogLevel(category: string): LogLevel {
  // Check for runtime override first
  if (LOGGING_CONFIG.enableRuntimeConfig && typeof window !== 'undefined' && window.localStorage) {
    try {
      const overrides = localStorage.getItem('log-level-overrides');
      if (overrides) {
        const parsed = JSON.parse(overrides);
        if (parsed[category] !== undefined) {
          return parsed[category] as LogLevel;
        }
      }
    } catch {
      // Ignore errors in reading overrides
    }
  }

  // Check category-specific level
  if (LOGGING_CONFIG.categories[category] !== undefined) {
    return LOGGING_CONFIG.categories[category];
  }

  // Fall back to default level
  return LOGGING_CONFIG.defaultLevel;
}
