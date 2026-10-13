/** Shared deny policy: generic IPC must never bypass sender-bound repository owners. */
export function requiresRepositoryRoute(method: string, params: unknown): boolean {
  return (
    method.startsWith('sourceControl.read.') ||
    method.startsWith('sourceControl.checkout.') ||
    method === 'workspace.repositoryContext' ||
    method === 'workspace.repositoryContext.capture' ||
    method === 'workspace.repositoryContext.release' ||
    method === 'workspace.repositorySelection.capture' ||
    method === 'workspace.repositorySelection.save' ||
    method === 'workspace.repositorySelection.reset' ||
    method === 'workspace.repositorySelection.reconcile' ||
    method === 'workspace.repositorySelection.release' ||
    method === 'accept-changes.reconcile' ||
    method === 'accept-changes.release' ||
    ((method === 'accept-changes.prepare' || method === 'accept-changes.execute') &&
      params !== null &&
      typeof params === 'object' &&
      Object.prototype.hasOwnProperty.call(params, 'review'))
  );
}
export function isRepositoryCheckoutCreate(method: string, params: unknown): boolean {
  return (
    method === 'workspace.create' &&
    params !== null &&
    typeof params === 'object' &&
    Object.prototype.hasOwnProperty.call(params, 'repositoryCheckout')
  );
}
