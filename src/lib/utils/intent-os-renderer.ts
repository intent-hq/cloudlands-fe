/**
 * Whether this app renderer runs on Intent OS. Main decides (`INTENT_OS=1`)
 * and passes it through the preload (`window.electronAPI.intentOs`); see
 * src/shared/intent-os.ts. Kept apart from platform-capabilities so tests
 * that mock that module still load preference defaults. Exported with an
 * explicit window for tests.
 */
export function isIntentOsRenderer(win?: unknown): boolean {
  const target = win ?? (typeof window === 'undefined' ? undefined : window);
  const api = (target as { electronAPI?: { intentOs?: unknown } } | undefined)?.electronAPI;
  return api?.intentOs === true;
}
