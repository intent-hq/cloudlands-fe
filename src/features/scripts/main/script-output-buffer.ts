/**
 * Script Output Buffer
 *
 * Ring buffer for script output with batched delivery.
 * Stores up to MAX_LINES lines and delivers batches via callback
 * with a configurable window (default 50ms) to avoid flooding IPC.
 */

import { Logger } from '../../../shared/logger';

const logger = new Logger('ScriptOutputBuffer');

const MAX_LINES = 5000;
const DEFAULT_BATCH_WINDOW_MS = 50;

export interface OutputLine {
  text: string;
  stream: 'stdout' | 'stderr';
  timestamp: number;
}

export type OutputBatchCallback = (lines: OutputLine[]) => void;

export class ScriptOutputBuffer {
  private lines: OutputLine[] = [];
  private pendingBatch: OutputLine[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private batchCallback: OutputBatchCallback | null = null;
  private readonly maxLines: number;
  private readonly batchWindowMs: number;

  constructor(
    options: {
      maxLines?: number;
      batchWindowMs?: number;
    } = {},
  ) {
    this.maxLines = options.maxLines ?? MAX_LINES;
    this.batchWindowMs = options.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS;
  }

  /**
   * Set the callback for batched output delivery.
   */
  onBatch(callback: OutputBatchCallback): void {
    this.batchCallback = callback;
  }

  /**
   * Append raw data from a stream. Splits on newlines and stores individual lines.
   */
  append(data: string, stream: 'stdout' | 'stderr'): void {
    const now = Date.now();
    // Split on newlines but keep partial lines (last element may be incomplete)
    const parts = data.split(/\r?\n/);

    for (let i = 0; i < parts.length; i++) {
      const text = parts[i];
      // Skip empty strings from trailing newlines, but keep them between lines
      if (i === parts.length - 1 && text === '') continue;

      const line: OutputLine = { text, stream, timestamp: now };
      this.lines.push(line);
      this.pendingBatch.push(line);
    }

    // Trim ring buffer if over capacity
    if (this.lines.length > this.maxLines) {
      const excess = this.lines.length - this.maxLines;
      this.lines.splice(0, excess);
    }

    // Schedule batch delivery
    this.scheduleBatch();
  }

  /**
   * Add a separator line (e.g., on restart).
   */
  addSeparator(message: string): void {
    const line: OutputLine = {
      text: `\r\n--- ${message} ---\r\n`,
      stream: 'stdout',
      timestamp: Date.now(),
    };
    this.lines.push(line);
    this.pendingBatch.push(line);

    // Trim ring buffer if over capacity
    if (this.lines.length > this.maxLines) {
      const excess = this.lines.length - this.maxLines;
      this.lines.splice(0, excess);
    }

    this.scheduleBatch();
  }

  /**
   * Get all stored lines.
   */
  getLines(): OutputLine[] {
    return [...this.lines];
  }

  /**
   * Get the last N lines.
   */
  getLastLines(n: number): OutputLine[] {
    if (n >= this.lines.length) return [...this.lines];
    return this.lines.slice(-n);
  }

  /**
   * Get all output as a single string.
   */
  getText(): string {
    return this.lines.map((l) => l.text).join('\n');
  }

  /**
   * Get the last N lines as text.
   */
  getLastText(n: number): string {
    return this.getLastLines(n)
      .map((l) => l.text)
      .join('\n');
  }

  /**
   * Get total line count.
   */
  get lineCount(): number {
    return this.lines.length;
  }

  /**
   * Clear all stored output.
   */
  clear(): void {
    this.lines = [];
    this.pendingBatch = [];
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  /**
   * Flush any pending batch immediately.
   */
  flush(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.deliverBatch();
  }

  /**
   * Dispose of the buffer, clearing timers and callbacks.
   */
  dispose(): void {
    this.flush();
    this.batchCallback = null;
    this.lines = [];
  }

  private scheduleBatch(): void {
    if (this.batchTimer) return; // Already scheduled
    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this.deliverBatch();
    }, this.batchWindowMs);
  }

  private deliverBatch(): void {
    if (this.pendingBatch.length === 0) return;
    const batch = this.pendingBatch;
    this.pendingBatch = [];
    if (this.batchCallback) {
      try {
        this.batchCallback(batch);
      } catch (err) {
        logger.error('Error in output batch callback', err as Error);
      }
    }
  }
}

