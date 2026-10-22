import { z } from 'zod';
import { repositoryRootKey } from '$shared/types/repository-context';
import {
  SelectionRootSchema,
  type RepositorySelectionEdit,
  type SelectionRetirement,
} from '$shared/types/repository-selection';
import { captureBackendRepositorySelection } from './backend-transport';

const editSchema = z
  .object({
    root: SelectionRootSchema,
    editId: z.string().min(1),
    admission: z.string().nullable(),
  })
  .strict();
export function createRepositorySelectionTransport(capture = captureBackendRepositorySelection) {
  return {
    async begin(request: RepositorySelectionEdit, handler: (kind: SelectionRetirement) => void) {
      const original = editSchema.parse(request);
      const session = await capture(original.root);
      if (repositoryRootKey(session.preview.root) !== repositoryRootKey(original.root)) {
        await session.release();
        throw new Error('REPOSITORY_SELECTION_UNAVAILABLE');
      }
      const stop = session.onRetired(handler);
      let released = false;
      return {
        preview: session.preview,
        onRetired: session.onRetired,
        confirm: session.confirm,
        reconcile: session.reconcile,
        async release() {
          if (released) return;
          released = true;
          stop();
          await session.release();
        },
      };
    },
  };
}
