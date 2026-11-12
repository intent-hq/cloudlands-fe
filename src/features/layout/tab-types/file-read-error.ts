import { m } from '$shared/paraglide/messages.js';

/**
 * The file-read failures the file panel can tell apart. The read saga stores
 * only a message string (the translated not-found message, or the daemon's
 * error text via `mutationErrorMessage`), so classification is textual.
 */
export type FileReadErrorKind = 'access-denied' | 'not-found' | 'generic';

// Daemon / OS wording: intentd's file_ops `ACCESS_DENIED` ("Access denied: path
// outside workspace") and an OS EACCES ("Permission denied (os error 13)").
const ACCESS_DENIED_PATTERN = /access denied|permission denied|outside (?:the )?workspace/i; // i18n-ignore (daemon wire text)
// intentd's "File not found: <path>" and an OS ENOENT ("No such file or directory").
const NOT_FOUND_PATTERN = /file not found|no such file or directory/i; // i18n-ignore (daemon wire text)

export function classifyFileReadError(error: string): FileReadErrorKind {
  if (ACCESS_DENIED_PATTERN.test(error)) return 'access-denied';
  if (error === m.files_read_notFound_error() || NOT_FOUND_PATTERN.test(error)) return 'not-found';
  return 'generic';
}

/** A short plain-language line for the file panel's error state. */
export function fileReadErrorLabel(kind: FileReadErrorKind): string {
  switch (kind) {
    case 'access-denied':
      return m.layout_fileTab_errorAccessDenied_label();
    case 'not-found':
      return m.layout_fileTab_errorNotFound_label();
    case 'generic':
      return m.layout_fileTab_errorGeneric_label();
  }
}
