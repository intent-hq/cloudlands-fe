/**
 * Side-effect boundary for draft persistence, promotion, and workspace adoption.
 *
 * The route owns the runner lifetime while the saga translates controller effects to daemon calls.
 */
export { createWorkspaceAdoption } from './adoption';
export { createDraftTransactionRunner, type DraftTransactionRunner } from './transaction-runner';
export { newWorkspaceEffectSaga } from './new-workspace-saga';
export type { NewWorkspaceSagaDependencies } from './new-workspace-saga';
