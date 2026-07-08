// NOTE: Git-specific environment variables are applied per-command in shared/git/git-env.ts
// to avoid leaking non-interactive settings into user terminals.

// Base dev port used for deriving instance numbers (keeps menu/window titles unique)
const DEV_PORT_BASE = 5190;

export function resolveDevInstance(): string {
  const envInstance = (process.env.DEV_INSTANCE || '').trim();
  if (envInstance) return envInstance;

  const devPort = Number(process.env.DEV_PORT);
  if (Number.isFinite(devPort) && devPort >= DEV_PORT_BASE) {
    return String(devPort - DEV_PORT_BASE + 1);
  }

  return '';
}
