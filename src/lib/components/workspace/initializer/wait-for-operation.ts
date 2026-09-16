import type { Readable } from 'svelte/store';
import type { WorkspaceInitializerOperation } from '$store/renderer/slices/workspace-initializer/workspace-initializer-types';

export function waitForWorkspaceInitializerOperation<T>(
  operation$: Readable<WorkspaceInitializerOperation<T>>,
  version: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const onAbort = () => {
      unsubscribe();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    unsubscribe = operation$.subscribe((operation) => {
      if (operation.version !== version || operation.status === 'loading') return;
      unsubscribe();
      signal?.removeEventListener('abort', onAbort);
      if (operation.status === 'error') reject(new Error(operation.error ?? 'Operation failed'));
      else if (operation.status === 'success') resolve(operation.data as T);
    });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
