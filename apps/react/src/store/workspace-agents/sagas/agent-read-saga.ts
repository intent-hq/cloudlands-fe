import { readAgentSession } from '@/features/agent/agent-read-service';
import { store } from '@/store';
import { selectAgentSession } from '@/store/agent-session/agent-session-selectors';
import { selectPrincipalActionContext } from '@/store/principal/principal-selectors';
import { createAgentReadSaga } from '../../../../../../src/store/renderer/slices/workspace-agents/sagas/agent-read-saga-factory';
import { cleanupDeletedAgentTabs } from './deleted-agent-cleanup';

/** Inert binding; its future lifetime owner must start it after Store initialization. */
export const agentReadSaga = createAgentReadSaga({
  admission: {
    kind: 'principal',
    contextSelector: selectPrincipalActionContext,
    readCurrentContext: () => selectPrincipalActionContext.select(store.state),
    get dispatch() {
      return store.dispatch;
    },
  },
  readAgentSession,
  selectAgentSession,
  cleanupDeletedAgentTabs,
});
