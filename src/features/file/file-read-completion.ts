import {
  getPhysicalRequestCompletion,
  type RecoveryRequestCompletion,
} from '$shared/event-recovery/session';

export function fileReadAuthorityDenied(error: unknown): boolean {
  const value = error as { rpcCode?: unknown; data?: { code?: unknown } } | null;
  return (
    value?.rpcCode === -32003 ||
    value?.rpcCode === -32001 ||
    (value?.rpcCode === -32602 && value.data?.code === 'not-found')
  );
}

/** Preserve logical deadlines while observing failures on the original caller. */
export function observeFileReadFailure<T>(
  result: Promise<T>,
  failed?: (error: unknown) => void,
): Promise<T> {
  const observe = (error: unknown) => {
    failed?.(error);
    const completion = getPhysicalRequestCompletion(error);
    if (completion)
      void completion.then((value) => {
        if (!value.retired) for (const late of value.errors) observe(late);
      });
  };
  return result.catch((error) => {
    observe(error);
    throw error;
  });
}

async function failedCompletion(error: unknown): Promise<RecoveryRequestCompletion> {
  const pending = getPhysicalRequestCompletion(error);
  if (!pending) return { errors: [error], retired: false };
  const result = await pending;
  if (result.retired) return result;
  const nested = await Promise.all(result.errors.map(failedCompletion));
  return { retired: false, errors: nested.flatMap((value) => (value.retired ? [] : value.errors)) };
}

/** Every physical sibling survives the first logical rejection, including nested timeouts. */
export async function fileReadsCompleted(
  reads: readonly Promise<unknown>[],
): Promise<RecoveryRequestCompletion> {
  const outcomes = await Promise.all(
    reads.map((read) => read.then(() => ({ errors: [], retired: false }), failedCompletion)),
  );
  return {
    retired: outcomes.length > 0 && outcomes.every((outcome) => outcome.retired),
    errors: outcomes.flatMap((outcome) => (outcome.retired ? [] : outcome.errors)),
  };
}

export function allFileReads<T>(
  reads: Promise<T>[],
  failed?: (error: unknown) => void,
): Promise<T[]> {
  const observed = reads.map((read) => observeFileReadFailure(read, failed));
  const completion = fileReadsCompleted(observed);
  return Promise.all(observed).catch((error: unknown) => {
    const fields = error as { rpcCode?: unknown; data?: unknown } | null;
    throw Object.assign(
      new Error(error instanceof Error ? error.message : 'File read failed', { cause: error }),
      {
        rpcCode: fields?.rpcCode,
        data: fields?.data,
        completion,
      },
    );
  });
}
