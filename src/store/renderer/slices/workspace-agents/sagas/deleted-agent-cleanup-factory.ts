/**
 * Shared cleanup for a daemon-reported deleted agent (`agent.get` rejecting
 * with the agent-not-found shape, PROTOCOL §5.5). A stale panel tab / route
 * still referencing the agent is an EXPECTED condition, not an error
 * (monorepo#1753): callers WARN once and close the referencing tabs so the
 * workspace falls back to its home view, instead of surfacing an error UI.
 *
 * Used by both the agent-read saga (session shell loads) and the chat-read
 * saga (transcript hydration) so the close/destroy/clear sequence lives in
 * one place.
 */
import { call } from 'typed-redux-saga';

import { createLogger } from '../../../../../lib/utils/client-logger';
import { IPC_CHANNELS } from '../../../../../shared/ipc-registry';
import {
  closeTabsByAgentId,
  destroyTabsByOwnerAgent,
  pruneRecentlyClosed,
} from '../../panel-layout/panel-layout-slice';

import {
  isAgentReadScopeCurrent,
  putAgentReadAction,
  type AgentReadScope,
} from './agent-read-admission';

const logger = createLogger('DeletedAgentCleanup');

export function createDeletedAgentCleanup({
  invoke,
}: {
  invoke: (
    channel: typeof IPC_CHANNELS.BROWSER.CLEAR_AGENT_TABS,
    data: { agentId: string },
  ) => Promise<unknown>;
}) {
  return function* cleanupDeletedAgentTabs(
    wsId: string,
    agentId: string,
    scope: AgentReadScope = { kind: 'source' },
  ) {
    if (!isAgentReadScopeCurrent(scope)) return;
    // WARN once and close any panel tabs pointing at the dead agent; with no
    // referencing tab (speculative load) the close is a no-op.
    logger.warn('Agent no longer exists on daemon; closing stale tabs', { wsId, agentId });
    if (!(yield* putAgentReadAction(scope, closeTabsByAgentId(wsId, agentId)))) return;
    // A deletion missed while the app was closed: destroy the dead agent's
    // owned browser tabs too (monorepo#2857), and clear main's CDP/ownership
    // registrations — an earlier list-tabs reply may already have rehydrated
    // them for the persisted hidden tabs.
    if (!(yield* putAgentReadAction(scope, destroyTabsByOwnerAgent(wsId, agentId)))) return;
    // `closeTabsByAgentId` is a normal close that parks each tab in
    // `recentlyClosed` — and because this recovery covers a deletion event
    // MISSED while the app was closed, no event-driven prune follows it (the
    // `agent:deleted` mutation-saga path is the one that prunes). Prune here so
    // "Reopen closed tab" cannot resurrect the deleted agent and loop straight
    // back into this cleanup.
    if (!(yield* putAgentReadAction(scope, pruneRecentlyClosed(wsId, { agentId })))) return;
    try {
      if (scope.kind === 'source') {
        yield* call(invoke, IPC_CHANNELS.BROWSER.CLEAR_AGENT_TABS, { agentId });
      } else {
        yield* call(() => {
          if (!isAgentReadScopeCurrent(scope)) return;
          return invoke(IPC_CHANNELS.BROWSER.CLEAR_AGENT_TABS, { agentId });
        });
      }
    } catch (clearError) {
      logger.warn('Failed to clear main-process registrations for deleted agent tabs', {
        agentId,
        error: clearError,
      });
    }
  };
}
