/**
 * ⚠️ STUB FILE - NOT IMPLEMENTED ⚠️
 *
 * This file was auto-generated to resolve a missing build dependency.
 * All functions return null/no-op - the feature is disabled.
 *
 * These functions are called by instruction-service.ts to add
 * team context and global knobs to agent prompts.
 *
 * TODO: Implement actual agent teams functionality
 */

import { Logger } from '$shared/logger';

const logger = new Logger('AgentTeamsService');

let initPromise: Promise<void> | null = null;

/**
 * Initialize the agent teams service (call once during app startup)
 */
export async function initAgentTeamsService(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }
  initPromise = (async () => {
    try {
      logger.info('Agent teams service initialized (stub)');
    } catch (error) {
      logger.error('Failed to initialize agent teams service', error as Error);
    }
  })();
  return initPromise;
}

/** STUB: Returns null (no team context added to prompts) */
export function formatActiveTeamForPrompt(): string | null {
  return null;
}

/** STUB: Returns null (no global knobs added to prompts) */
export function formatGlobalKnobsForPrompt(): string | null {
  return null;
}
