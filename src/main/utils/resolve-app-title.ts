import { resolveDevInstance } from './resolve-dev-instance';

/**
 * Build the window/app title.
 * - In production: "Intent"
 * - In dev with --name: "Intent [MyName]"
 * - In dev without --name: "Intent [Dev N]" or "Intent [Dev]"
 */
export function resolveAppTitle(): string {
  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev) return 'Intent';

  const devName = (process.env.DEV_NAME || '').trim();
  if (devName) return `Intent [${devName}]`;

  const devInstance = resolveDevInstance();
  return devInstance ? `Intent [Dev ${devInstance}]` : 'Intent [Dev]';
}
