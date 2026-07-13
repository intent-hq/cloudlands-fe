/**
 * Browser Capture Types
 *
 * Types for the uisnap-style browser snapshot and capture functionality.
 */

/**
 * Options for waiting before capture
 */
export interface WaitForOptions {
  /** Wait for a console message matching this pattern */
  console?: string | RegExp;
  /** Wait for network to be idle for N milliseconds */
  networkIdle?: number;
  /** Wait for an element matching this selector to appear */
  selector?: string;
  /** Maximum time to wait (default: 30000ms) */
  timeout?: number;
}

/**
 * Options for a simple snapshot (no session needed)
 */
export interface SnapshotOptions {
  /** Tab to capture (defaults to first tab) */
  tabId?: string;
  /** Workspace ID for storage location */
  workspaceId: string;
  /** Optional name for the snapshot (defaults to timestamp) */
  name?: string;
  /** Reload the page before capturing */
  reload?: boolean;
  /** Wait conditions before capturing */
  waitFor?: WaitForOptions;
}

/**
 * Result of a snapshot capture
 */
export interface SnapshotResult {
  /** Directory containing all snapshot files */
  dir: string;
  /** Path to accessibility tree YAML file */
  a11y: string;
  /** Path to screenshot PNG file */
  screenshot: string;
  /** Path to console logs JSONL file (if captured) */
  console?: string;
  /** Path to network requests JSONL file (if captured) */
  network?: string;
  /** Metadata about the capture */
  metadata: {
    url: string;
    title: string;
    timestamp: string;
    domain: string;
  };
}

/**
 * Options for starting a capture session
 */
export interface SessionOptions {
  /** Tab to capture (defaults to first tab) */
  tabId?: string;
  /** Workspace ID for storage location */
  workspaceId: string;
  /** Optional name for the session (defaults to timestamp) */
  name?: string;
}

/**
 * Active capture session
 */
export interface CaptureSession {
  /** Unique session ID */
  id: string;
  /** Tab being captured */
  tabId: string;
  /** Workspace ID */
  workspaceId: string;
  /** Session name */
  name: string;
  /** Domain of the page */
  domain: string;
  /** Output directory */
  outputDir: string;
  /** Step counter */
  stepCount: number;
  /** Whether capture is active (listening to events) */
  captureActive: boolean;
  /** Active trace IDs */
  activeTraces: Map<string, TraceState>;
  /** Accumulated console messages (when capture is active) */
  consoleBuffer: ConsoleMessage[];
  /** Accumulated network requests (when capture is active) */
  networkBuffer: NetworkRequest[];
}

/**
 * State for an active performance trace
 */
export interface TraceState {
  /** Trace name/ID */
  name: string;
  /** Start timestamp */
  startTime: number;
}

/**
 * Console message captured from CDP
 */
export interface ConsoleMessage {
  timestamp: string;
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
  url?: string;
  lineNumber?: number;
}

/**
 * Network request captured from CDP
 */
export interface NetworkRequest {
  timestamp: string;
  requestId: string;
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  duration?: number;
  size?: number;
  failed?: boolean;
  failureReason?: string;
}

/**
 * Result of ending a capture session
 */
export interface SessionResult {
  /** Directory containing all session files */
  dir: string;
  /** Paths to step directories */
  steps: string[];
  /** Path to console logs JSONL file */
  console: string;
  /** Path to network requests JSONL file */
  network: string;
  /** Paths to trace files */
  traces: string[];
  /** Session metadata */
  metadata: {
    url: string;
    title: string;
    domain: string;
    startTime: string;
    endTime: string;
    stepCount: number;
  };
}

/**
 * Options for captureStep
 */
export interface CaptureStepOptions {
  /** Reload the page before capturing this step */
  reload?: boolean;
  /** Wait conditions before capturing */
  waitFor?: WaitForOptions;
}

/**
 * Summary of captured data - generated automatically for easy triage
 */
export interface CaptureSummary {
  /** When the capture was taken */
  capturedAt: string;
  /** URL of the page */
  url: string;
  /** Page title */
  title: string;

  /** Console message summary */
  console: {
    total: number;
    errors: number;
    warnings: number;
    info: number;
    log: number;
    debug: number;
    /** Top error messages with counts */
    topErrors: Array<{ message: string; count: number }>;
    /** Top warning messages with counts */
    topWarnings: Array<{ message: string; count: number }>;
  };

  /** Network request summary */
  network: {
    total: number;
    failed: number;
    /** Requests by HTTP status code */
    byStatus: Record<string, number>;
    /** Requests by MIME type category */
    byType: Record<string, number>;
    /** Slowest requests */
    slowest: Array<{ url: string; duration: number; status?: number }>;
    /** Failed requests */
    failures: Array<{ url: string; status?: number; error?: string }>;
  };
}
