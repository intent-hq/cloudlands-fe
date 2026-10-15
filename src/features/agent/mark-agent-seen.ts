import {
  createMarkAgentSeen,
  type MarkAgentSeenDependencies,
  type MarkAgentSeenParams,
} from './mark-agent-seen-factory';

// Source-renderer compatibility binding until its AppClient/Store facade is retired.
export {
  MARK_AGENT_SEEN_DEBOUNCE_MS,
  MARK_AGENT_SEEN_DEDUPE_LIMIT,
  newestPersistedMessageId,
} from './mark-agent-seen-factory';

/**
 * Fire-time seams, dynamically imported once and shared by every fire —
 * concurrent triggers (e.g. a multi-agent boundary) await the same in-flight
 * import instead of racing duplicate loads.
 */
let seamsPromise: ReturnType<MarkAgentSeenDependencies['loadSeams']> | null = null;

function loadSeams(): NonNullable<typeof seamsPromise> {
  seamsPromise ??= Promise.all([import('$store/renderer/store'), import('$lib/client')]).then(
    ([storeModule, clientModule]) => ({
      getState: () => storeModule.store.state,
      markSeen: (params: MarkAgentSeenParams) => clientModule.appClient.agents.markSeen(params),
    }),
  );
  return seamsPromise;
}

const marker = createMarkAgentSeen({ loadSeams });
export const {
  markAgentSeenOnTurnFinish,
  markAgentSeenOnUserSend,
  markAgentSeenOnView,
  markAgentSeenOnTranscriptHydrated,
  markAgentSeenAtBoundary,
  cancelPendingMarkAgentSeen,
  releaseViewAwaitingTranscript,
} = marker;
