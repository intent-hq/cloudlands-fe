type ErrorLike = {
  name?: string;
  message?: string;
  stack?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function unwrapReason(reason: unknown): unknown {
  if (isRecord(reason) && 'error' in reason) return (reason as { error?: unknown }).error;
  return reason;
}

function toErrorLike(value: unknown): ErrorLike | null {
  if (!value) return null;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (!isRecord(value)) return null;

  const name = typeof value.name === 'string' ? value.name : undefined;
  const message = typeof value.message === 'string' ? value.message : undefined;
  const stack = typeof value.stack === 'string' ? value.stack : undefined;
  if (!name && !message && !stack) return null;
  return { name, message, stack };
}

function stringifyLoose(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  const like = toErrorLike(value);
  if (like?.name || like?.message) return `${like.name ?? ''}${like.name ? ': ' : ''}${like.message ?? ''}`;
  try {
    return String(value);
  } catch {
    return '';
  }
}

function combinedStringFromArgs(args: unknown[]): string {
  const parts: string[] = [];
  for (const arg of args) {
    parts.push(stringifyLoose(arg));

    // Common pattern: console.error('...', { error: { message: ... } })
    if (isRecord(arg) && 'error' in arg) {
      parts.push(stringifyLoose((arg as { error?: unknown }).error));
    }
  }
  return parts.filter(Boolean).join(' ');
}

export function shouldSuppressMonacoConsoleError(args: unknown[]): boolean {
  const errorStr = combinedStringFromArgs(args);

  const suppressedErrors = [
    'Canceled',
    'TextModel got disposed',
    'Got bad scroll event',
    'Could not find source file',
    // TextMate grammar tokenization errors (stack-based state machine issues)
    'trying to pop an empty stack',
    'no diff result available', // Race condition when diff editor models are disposed before diff computation completes
  ];

  const isWebviewNavigationError =
    errorStr.includes('GUEST_VIEW_MANAGER_CALL') &&
    (errorStr.includes('ERR_ABORTED') || errorStr.includes('-3'));

  const shouldSuppress = suppressedErrors.some((msg) => errorStr.includes(msg));
  const isDelayerCancel = errorStr.includes('Delayer') && errorStr.includes('cancel');
  const isInmemoryTsError =
    errorStr.includes('inmemory://') &&
    (errorStr.includes('getSyntacticDiagnostics') ||
      errorStr.includes('getSemanticDiagnostics') ||
      errorStr.includes('getQuickInfoAtPosition') ||
      errorStr.includes('TypeScriptWorker'));

  return shouldSuppress || isDelayerCancel || isInmemoryTsError || isWebviewNavigationError;
}

export function shouldSuppressMonacoUnhandledRejection(reason: unknown): boolean {
  const unwrapped = unwrapReason(reason);
  const like = toErrorLike(unwrapped) ?? toErrorLike(reason);

  const errorName = like?.name ?? (isRecord(unwrapped) && typeof unwrapped.name === 'string' ? unwrapped.name : '');
  const errorMessage =
    like?.message ?? (isRecord(unwrapped) && typeof unwrapped.message === 'string' ? unwrapped.message : '');
  const errorStr = `${stringifyLoose(unwrapped)} ${stringifyLoose(reason)}`;

  if (errorStr.includes('Could not find source file') && errorStr.includes('inmemory://')) return true;

  if (
    errorStr.includes('GUEST_VIEW_MANAGER_CALL') &&
    (errorStr.includes('ERR_ABORTED') || errorStr.includes('-3'))
  ) {
    return true;
  }

  if (
    errorName === 'Canceled' ||
    errorMessage === 'Canceled' ||
    errorStr.includes('Canceled: Canceled') ||
    (errorStr.includes('Canceled') && errorStr.includes('WordHighlighter'))
  ) {
    return true;
  }

  // Some Monaco disposals/cancellations show up as structured-clone objects with just `message`.
  if (errorStr.includes('TextModel got disposed')) return true;

  // TextMate grammar tokenization errors (stack-based state machine issues)
  if (errorStr.includes('trying to pop an empty stack')) return true;

  // Race condition when diff editor models are disposed before diff computation completes
  if (errorStr.includes('no diff result available')) return true;

  return false;
}
