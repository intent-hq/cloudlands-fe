/** Whether tab windows are on in this run (shared/types/tab-window.ts). */
import { get } from 'svelte/store';
import { browserPagesMode } from '$lib/components/browser/main-owned-browser-page';
import { isElectron } from '$lib/electron-bridge';

/**
 * Whether tabs can open in their own windows in this run: desktop only, and
 * part of the "Browser pages in the main process" Labs setting (a browser
 * tab moves with its live page only on that path).
 */
export function tabWindowsAvailable(): boolean {
  return isElectron() && get(browserPagesMode) === 'main';
}
