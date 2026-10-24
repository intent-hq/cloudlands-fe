/**
 * Single-flight, watchdog-bounded graceful shutdown (intent-hq/monorepo#1300).
 *
 * Every step that can block — including the optional window-session save the
 * SIGTERM/SIGINT path performs because signal quits skip `before-quit` — runs
 * inside the hard-exit watchdog, so a stalled disk write can never keep the
 * process alive. `beginTeardown()` claims the shutdown synchronously before
 * any await, so repeated signals are no-ops instead of queueing more saves.
 */

import { runWithHardExitTimeout } from './hard-exit-timeout';

export interface GracefulShutdownOptions {
  /** Persist window sessions before cleanup closes the windows. */
  persistWindowSessions?: boolean;
}

export interface GracefulShutdownSteps {
  /** Claim the shutdown; return false when one is already in progress. */
  beginTeardown: () => boolean;
  persistWindowSessions: () => Promise<void>;
  onPersistError: (error: unknown) => void;
  /** The cleanup chain; ends the process on success. */
  cleanup: () => Promise<void>;
  onHardExit: () => void;
  hardExitMs: number;
}

export async function runGracefulShutdown(
  steps: GracefulShutdownSteps,
  options: GracefulShutdownOptions = {},
): Promise<void> {
  if (!steps.beginTeardown()) return;
  await runWithHardExitTimeout(
    async () => {
      if (options.persistWindowSessions) {
        try {
          await steps.persistWindowSessions();
        } catch (error) {
          steps.onPersistError(error);
        }
      }
      await steps.cleanup();
    },
    steps.onHardExit,
    steps.hardExitMs,
  );
}
