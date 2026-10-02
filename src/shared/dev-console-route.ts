/** Diagnostic windows are transient and must never enter session restore. */
export const DEV_CONSOLE_ROUTE = '/dev-console';
export function isDevConsoleRoute(pathname: string): boolean {
  return pathname === DEV_CONSOLE_ROUTE || pathname.startsWith(DEV_CONSOLE_ROUTE + '/');
}
