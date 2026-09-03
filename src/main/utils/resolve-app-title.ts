import { resolveDevInstance } from './resolve-dev-instance';

/**
 * Build the window/app title.
 * - In production: "Intent"
 * - In dev with --name: "Electron [MyName]"
 * - In dev without --name: "Electron [Dev N]" or "Electron [Dev]"
 */
export function resolveAppTitle(): string {
  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev) return 'Intent';

  const devName = (process.env.DEV_NAME || '').trim();
  if (devName) return `Electron [${devName}]`;

  const devInstance = resolveDevInstance();
  return devInstance ? `Electron [Dev ${devInstance}]` : 'Electron [Dev]';
}

export function decorateWindowTitle(title: string): string {
  if (process.env.NODE_ENV !== 'development') return title;
  return `${title} — ${resolveAppTitle()}`;
}

export function setResolvedAppName(
  app: { setName(name: string): void },
  processTarget: { title: string } = process,
): string {
  const appName = resolveAppTitle();
  app.setName(appName);
  if (process.env.NODE_ENV === 'development') {
    processTarget.title = appName;
  }
  return appName;
}
