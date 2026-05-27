import { untrack } from 'svelte';
import {
  writable,
  type Readable,
} from 'svelte/store';


import type { AgentSession } from '$shared/types';
import { store as appStore } from '$lib/store/store';
import { selectAgentSession } from '$lib/store/slices/agent-session/agent-session-selectors';

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
