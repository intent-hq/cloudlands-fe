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
  | 'path-invalid'
  | 'git-not-installed'
  | 'unknown';

export interface CloneErrorDiagnosis {
  kind: CloneErrorKind;
  rawMessage: string;
}

/**
 * Daemon-authored `error.data.code` values from the `workspace.create` clone
 * failure taxonomy (PROTOCOL §9.1, monorepo#826), mapped to diagnosis kinds.
 * These are a stable wire contract — when present they win over the prose
 * regexes below. The daemon's `clone-failed` fallback is intentionally
 * unmapped so the message-based classification still gets a chance.
 */
const DAEMON_CODE_TO_KIND: Record<string, CloneErrorKind> = {
  'auth-required': 'auth-required',
  'repo-not-found': 'repo-not-found',
  'access-denied': 'access-denied',
  network: 'network',
  'destination-exists-non-empty': 'destination-exists',
  'path-invalid': 'path-invalid',
};

export function diagnoseCloneError(
  message: string | null | undefined,
  errorCode?: string | null,
): CloneErrorDiagnosis {
  const raw = message ?? '';

  // A daemon-authored machine-readable code is authoritative — no prose
  // matching needed (PROTOCOL §9.1). Exception: an askpass packaging failure
  // classifies daemon-side as auth-required, but the local fix (move the app
  // out of quarantine) is more specific — so for auth-required only, let the
  // prose classification win when (and only when) it positively identifies
  // askpass-missing. This is a documented stopgap until the daemon can emit a
  // distinct code for askpass exec failures (intent-hq/monorepo#837).
  const daemonKind = errorCode ? DAEMON_CODE_TO_KIND[errorCode] : undefined;
  if (daemonKind) {
    if (daemonKind === 'auth-required' && classifyByProse(raw) === 'askpass-missing') {
      return { kind: 'askpass-missing', rawMessage: raw };
    }
    return { kind: daemonKind, rawMessage: raw };
  }

  return { kind: classifyByProse(raw), rawMessage: raw };
}

/** Message-based fallback classification for errors without a daemon code. */
function classifyByProse(raw: string): CloneErrorKind {
  const m = raw.toLowerCase();

  if (!raw.trim()) {
    return 'unknown';
  }

  // Order matters: askpass-missing should win over auth-required since the
  // surface message often contains both (askpass exec fails, then prompts
  // disabled triggers the auth message).
  if (
    m.includes('ssh-askpass-intent') ||
    (m.includes('cannot exec') && m.includes('askpass')) ||
    (m.includes('app.asar') && m.includes('not a directory'))
  ) {
    return 'askpass-missing';
  }

  if (
    m.includes('terminal prompts disabled') ||
    m.includes('could not read username') ||
    m.includes('could not read password') ||
    m.includes('authentication failed') ||
    (m.includes('requires authentication') && !m.includes('github authentication is required')) ||
    m.includes('permission denied (publickey)')
  ) {
    return 'auth-required';
  }

  if (
    m.includes('repository not found') ||
    m.includes('returned error: 404') ||
    m.includes('404: not found')
  ) {
    return 'repo-not-found';
  }

  if (m.includes('returned error: 403') || m.includes('access denied')) {
    return 'access-denied';
  }

  if (
    m.includes('could not resolve host') ||
    m.includes('network is unreachable') ||
    m.includes('network error') ||
    m.includes('operation timed out')
  ) {
    return 'network';
  }

  if (
    m.includes('already exists and is not an empty directory') ||
    m.includes('already exists and is not empty')
  ) {
    return 'destination-exists';
  }

  if (
    m.includes('git is not installed') ||
    m.includes('spawn git enoent') ||
    m.includes("'git' is not recognized")
  ) {
    return 'git-not-installed';
  }

  return 'unknown';
}
