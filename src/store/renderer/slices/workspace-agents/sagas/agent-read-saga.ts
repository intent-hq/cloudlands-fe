import { readAgentSession } from '$features/agent/agent-read-service';
import { selectAgentSession } from '../../agent-session/agent-session-selectors';
import { createAgentReadSaga } from './agent-read-saga-factory';
import { cleanupDeletedAgentTabs } from './deleted-agent-cleanup';

// Compatibility binding for the existing root saga until the Svelte renderer is retired.
export const agentReadSaga = createAgentReadSaga({
  readAgentSession,
  selectAgentSession,
  cleanupDeletedAgentTabs,
});
