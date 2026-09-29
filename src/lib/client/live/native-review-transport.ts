import { repositoryRootKey } from '$shared/types/repository-context';
import {
  NativeReviewOwnerSchema,
  NativeReviewInputSchema,
  type NativeReviewOwner,
  type NativeReviewInput,
  type NativeReviewRetirement,
} from '$shared/types/native-review-operation';
import { prepareBackendNativeReview } from './backend-transport';

export function createNativeReviewTransport(prepare = prepareBackendNativeReview) {
  return {
    async begin(
      owner: NativeReviewOwner,
      input: NativeReviewInput,
      handler: (kind: NativeReviewRetirement) => void,
    ) {
      const original = NativeReviewOwnerSchema.parse(owner),
        query = NativeReviewInputSchema.parse(input);
      if (repositoryRootKey(original.root) !== repositoryRootKey(query.review.root))
        throw new Error('NATIVE_REVIEW_UNAVAILABLE');
      const session = await prepare(query);
      if (repositoryRootKey(session.preview.root) !== repositoryRootKey(original.root)) {
        await session.release();
        throw new Error('NATIVE_REVIEW_UNAVAILABLE');
      }
      let stop: () => void;
      try {
        stop = session.onRetired(handler);
      } catch (error) {
        await session.release();
        throw error;
      }
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
