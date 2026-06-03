import { untrack } from 'svelte';
import {
  writable,
  type Readable,
} from 'svelte/store';


import type { AgentSession } from '$shared/types';
import { store as appStore } from '$store/renderer/store';
import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';

type AgentIdAccessor = () => string | null | undefined;

export function useAgentSession(agentId: AgentIdAccessor): Readable<AgentSession | undefined> {
  const agentIdStore = writable(untrack(() => agentId() ?? ''));

  $effect(() => {
    agentIdStore.set(agentId() ?? '');
  });

  const selectAgentSessionReadable =
    'withStore' in selectAgentSession ? selectAgentSession.withStore(appStore) : selectAgentSession;

  return selectAgentSessionReadable(agentIdStore);
}
