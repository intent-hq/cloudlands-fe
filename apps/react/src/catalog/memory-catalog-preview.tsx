// Source appearance scaffolding only: never opens a polling session or mocks transport.
// Source: src/lib/components/modals/diagnostics-audit.preview.svelte.
// i18n-ignore (exact source fixture values)
import { useEffect } from 'react';
import { AgentMemoryBreakdownDialog } from '@/features/layout/components/agent-memory-breakdown-dialog';
import { store } from '@/store';
import {
  agentMemoryBreakdownClosed,
  agentMemoryUsageFailed,
  agentMemoryUsageRequested,
  agentMemoryUsageSucceeded,
} from '../../../../src/store/renderer/slices/daemon-health/daemon-health-slice';
import type { AgentMemoryUsageWirePayload } from '../../../../src/store/renderer/slices/daemon-health/daemon-health-types';

export const memoryCatalogStates = [
  'memory',
  'memory-loading',
  'memory-empty',
  'memory-error',
  'memory-stale',
  'memory-long',
  'memory-expanded',
] as const;

export function MemoryCatalogPreview({ state }: { state: (typeof memoryCatalogStates)[number] }) {
  useEffect(() => {
    store.dispatch(agentMemoryBreakdownClosed());
    store.dispatch(agentMemoryUsageRequested());
    if (state === 'memory-error') store.dispatch(agentMemoryUsageFailed());
    else if (state !== 'memory-loading') {
      const agents: AgentMemoryUsageWirePayload['agents'] =
        state === 'memory-empty'
          ? []
          : Array.from({ length: state === 'memory-long' ? 18 : 2 }, (_, index) => ({
              agentId: `agent-${index}`,
              agentName: `Design reviewer ${index + 1}`,
              workspaceId:
                state === 'memory-long'
                  ? 'workspace-with-a-very-long-identifier-for-overflow'
                  : 'design-system',
              provider: 'codex',
              model: 'preview',
              rootPid: 100 + index,
              processCount: 1,
              memoryBytes: 128 * 1024 * 1024,
              processes: [
                {
                  pid: 100 + index,
                  parentPid: 1,
                  name: 'node',
                  cmdline:
                    '/fixture/runtime/node /fixture/agents/design-review/index.mjs --workspace design-system',
                  memoryBytes: 128 * 1024 * 1024,
                },
              ],
            }));
      store.dispatch(
        agentMemoryUsageSucceeded({
          sampledAt: '2026-09-22T00:00:00Z',
          totalBytes: agents.length * 128 * 1024 * 1024,
          agents,
        }),
      );
      if (state === 'memory-stale') {
        store.dispatch(agentMemoryUsageRequested());
        store.dispatch(agentMemoryUsageFailed());
      }
    }
    return () => {
      store.dispatch(agentMemoryBreakdownClosed());
    };
  }, [state]);

  // The source memory-expanded state also requires the user to open an accordion.
  return <AgentMemoryBreakdownDialog onClose={() => {}} />;
}
