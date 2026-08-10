/**
 * intentd Stack Sample Service
 *
 * Captures a point-in-time sample of the running intentd daemon's thread
 * stacks via the `debug.sampleStacks` RPC (PROTOCOL §5.43) and writes the
 * rendered text report to a temp file for the Help menu's
 * "Sample intentd Process..." flow (temp file → save dialog → move/cleanup).
 */

import { app } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import { Logger } from '../../../shared/logger';
import { getBackendClient } from '../../backend/main/backend.ipc';

const logger = new Logger('StackSampleService');

/** Sampling window requested from the daemon (clamped server-side into [100, 10000]). */
export const SAMPLE_DURATION_MS = 5_000;

/** Sampling frequency in Hz (clamped server-side into [1, 250]; 99 is the daemon default). */
export const SAMPLE_FREQUENCY_HZ = 99;

/**
 * Per-call request timeout. The RPC blocks for (at least) the whole sampling
 * window, so the timeout must comfortably exceed SAMPLE_DURATION_MS.
 */
export const SAMPLE_TIMEOUT_MS = SAMPLE_DURATION_MS + 15_000;

/** `debug.sampleStacks` result shape (PROTOCOL §5.43). */
export interface StackSampleResult {
  /** Rendered text report — never empty (the header always renders). */
  report: string;
  /** Effective (clamped/defaulted) sampling window the capture actually used. */
  durationMs: number;
  /** Effective (clamped/defaulted) sampling frequency. */
  frequencyHz: number;
  /**
   * Total samples captured across all threads. CPU-time sampling means an
   * idle daemon can legitimately return 0 — this is NOT an error.
   */
  sampleCount: number;
  /** Number of distinct (thread, stack) entries in the report. */
  distinctStacks: number;
}

/** Minimal request surface of the shared JSON-RPC client (test seam). */
export interface StackSampleRpcClient {
  request<T = unknown>(
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number },
  ): Promise<T>;
}

/** Capture a stack sample of the connected intentd daemon (PROTOCOL §5.43). */
export async function captureStackSample(
  client: StackSampleRpcClient = getBackendClient(),
): Promise<StackSampleResult> {
  return client.request<StackSampleResult>(
    'debug.sampleStacks',
    { durationMs: SAMPLE_DURATION_MS, frequencyHz: SAMPLE_FREQUENCY_HZ },
    { timeoutMs: SAMPLE_TIMEOUT_MS },
  );
}

/**
 * Capture a stack sample and write the report to a temp file.
 * Returns the temp file path; the caller owns moving/deleting it.
 */
export async function createStackSampleFile(
  client?: StackSampleRpcClient,
): Promise<{ filePath: string; sampleCount: number; distinctStacks: number }> {
  const sample = await captureStackSample(client);
  const filePath = path.join(app.getPath('temp'), `intentd-sample-${Date.now()}.txt`);
  await fs.writeFile(filePath, sample.report, 'utf8');
  logger.info('intentd stack sample captured', {
    filePath,
    durationMs: sample.durationMs,
    frequencyHz: sample.frequencyHz,
    sampleCount: sample.sampleCount,
    distinctStacks: sample.distinctStacks,
  });
  return { filePath, sampleCount: sample.sampleCount, distinctStacks: sample.distinctStacks };
}
