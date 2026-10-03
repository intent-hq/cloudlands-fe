import type { StoreState } from '../../types';
import { captureAgentMutationOwnership } from '$features/agent/agent-read-ownership';
import { getPrincipalConnectionContext } from '../principal/principal-context';
import { selectPrincipalSnapshot } from '../principal/principal-selectors';
import { selectWorkspaceParticipationContext } from '../workspace/workspace-selectors';
import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { pendingScopeActivated, pendingSubmissionAccepted } from './pending-submissions-slice';
import { sameSubmissionScope } from './pending-submissions-model';
import type {
  PendingSubmissionsState,
  SubmissionInput,
  SubmissionScope,
} from './pending-submissions-types';

type AdmissionStore = {
  state: { pendingSubmissions: PendingSubmissionsState };
  dispatch: (action: ReturnType<typeof pendingSubmissionAccepted>) => unknown;
};

/** Call synchronously after validation and BEFORE dispatching serialized/async preparation.
 * null means keep the unsent draft (scope lost or admission full). Never auto-resend.
 * The owner must check current participation + mutation ownership before calling.
 */
export function admitPendingSubmission(
  store: AdmissionStore,
  scope: SubmissionScope,
  input: Omit<SubmissionInput, 'id' | 'createdAt'>,
): SubmissionInput | null {
  const entry = store.state.pendingSubmissions.byAgentId[scope.agentId];
  if (!entry || !sameSubmissionScope(entry.scope, scope)) return null;
  const submission = { ...structuredClone(input), id: crypto.randomUUID(), createdAt: Date.now() };
  store.dispatch(pendingSubmissionAccepted(scope, submission));
  const current = store.state.pendingSubmissions.byAgentId[scope.agentId];
  return current && getItem(current.submissions, submission.id) ? submission : null;
}

/** Renderer integration boundary: capture admitted identity and mutation ownership together. */
export function admitAgentSubmission(
  store: {
    state: StoreState;
    dispatch: (
      action:
        ReturnType<typeof pendingScopeActivated> | ReturnType<typeof pendingSubmissionAccepted>,
    ) => unknown;
  },
  agentId: string,
  workspaceId: string,
  capability: unknown,
  input: Omit<SubmissionInput, 'id' | 'createdAt'>,
) {
  const participation = selectWorkspaceParticipationContext.select(store.state, workspaceId);
  const principalId = selectPrincipalSnapshot.select(store.state)?.principal.id;
  const authority = getPrincipalConnectionContext(store.state);
  if (!participation || !principalId || !authority) return null;
  const ownership = captureAgentMutationOwnership(agentId, workspaceId);
  const scope = {
    agentId,
    workspaceId,
    principalId,
    participation,
    authority,
    owner: ownership.key,
  };
  const isCurrent = () =>
    ownership.isCurrent(store.state.agentSessions?.byAgentId[agentId]?.workspaceId) &&
    selectWorkspaceParticipationContext.select(store.state, workspaceId) === participation &&
    selectPrincipalSnapshot.select(store.state)?.principal.id === principalId &&
    getPrincipalConnectionContext(store.state) === authority;
  if (!isCurrent()) return null;
  store.dispatch(pendingScopeActivated(scope, capability));
  const submission = admitPendingSubmission(store, scope, input);
  if (!submission) return null;
  return {
    scope,
    submission,
    isCurrent: () => {
      const entry = store.state.pendingSubmissions.byAgentId[agentId];
      return (
        isCurrent() &&
        !!entry &&
        sameSubmissionScope(entry.scope, scope) &&
        (!!getItem(entry.operations, submission.id) || !!getItem(entry.submissions, submission.id))
      );
    },
  };
}
