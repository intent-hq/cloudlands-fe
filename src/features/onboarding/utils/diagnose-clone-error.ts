/**
 * Classify a workspace-creation error string into a diagnosis the UI can
 * render with actionable guidance. The `rawMessage` is preserved on the
 * diagnosis so the UI can surface it for debugging even when a known kind
 * is matched.
 *
 * The `kind` values are deliberately kept stable so the error component
 * and any telemetry can switch on them without duplicating regex.
 */

export type CloneErrorKind =
  | 'auth-required'
  | 'askpass-missing'
  | 'repo-not-found'
  | 'access-denied'
  | 'network'
  | 'destination-exists'
  | 'git-not-installed'
  | 'unknown';

export interface CloneErrorDiagnosis {
  kind: CloneErrorKind;
  rawMessage: string;
}

export function diagnoseCloneError(message: string | null | undefined): CloneErrorDiagnosis {
  const raw = message ?? '';
  const m = raw.toLowerCase();

  if (!raw.trim()) {
    return { kind: 'unknown', rawMessage: raw };
  }

  // Order matters: askpass-missing should win over auth-required since the
  // surface message often contains both (askpass exec fails, then prompts
  // disabled triggers the auth message).
  if (
    m.includes('ssh-askpass-intent') ||
    (m.includes('cannot exec') && m.includes('askpass')) ||
    (m.includes('app.asar') && m.includes('not a directory'))
  ) {
    return { kind: 'askpass-missing', rawMessage: raw };
  }

  if (
    m.includes('terminal prompts disabled') ||
    m.includes('could not read username') ||
    m.includes('could not read password') ||
    m.includes('authentication failed') ||
    (m.includes('requires authentication') && !m.includes('github authentication is required')) ||
    m.includes('permission denied (publickey)')
  ) {
    return { kind: 'auth-required', rawMessage: raw };
  }

  if (
    m.includes('repository not found') ||
    m.includes('returned error: 404') ||
    m.includes('404: not found')
  ) {
    return { kind: 'repo-not-found', rawMessage: raw };
  }

  if (m.includes('returned error: 403') || m.includes('access denied')) {
    return { kind: 'access-denied', rawMessage: raw };
  }

  if (
    m.includes('could not resolve host') ||
    m.includes('network is unreachable') ||
    m.includes('network error') ||
    m.includes('operation timed out')
  ) {
    return { kind: 'network', rawMessage: raw };
  }

  if (
    m.includes('already exists and is not an empty directory') ||
    m.includes('already exists and is not empty')
  ) {
    return { kind: 'destination-exists', rawMessage: raw };
  }

  if (
    m.includes('git is not installed') ||
    m.includes('spawn git enoent') ||
    m.includes("'git' is not recognized")
  ) {
    return { kind: 'git-not-installed', rawMessage: raw };
  }

  return { kind: 'unknown', rawMessage: raw };
}
