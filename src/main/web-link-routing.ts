/**
 * Where a web link goes when the device has no system browser (Intent OS).
 * Pure decisions, kept apart from Electron so they can be tested alone; the
 * opener in ./open-external.ts acts on them.
 */

import { CHIEF_WORKSPACE_ID, ROOT_WORKSPACE_ID } from '../shared/types/branded-ids';

/** Intent OS starts Intent with this variable set to `1`: it has no system browser. */
const NO_SYSTEM_BROWSER_ENV = 'INTENT_NO_SYSTEM_BROWSER';

/** Whether the system browser is unavailable, so web links must stay in Intent. */
export function isSystemBrowserDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[NO_SYSTEM_BROWSER_ENV] === '1';
}

/** Whether `url` is an http(s) URL. */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/** A window that could show the link, and the workspace it shows (if any). */
interface WebLinkCandidate<W> {
  window: W;
  workspaceId: string | undefined;
}

type InAppWebLinkTarget<W> =
  { kind: 'panel'; window: W; workspaceId: string } | { kind: 'sign-in-window' };

/**
 * The in-app target of a web link: a browser panel in the first candidate
 * (focused or most recent window first) that shows a workspace, else the
 * sign-in window. Root and Home are not workspaces: they have no browser panel.
 */
export function chooseInAppWebLinkTarget<W>(
  candidates: readonly WebLinkCandidate<W>[],
): InAppWebLinkTarget<W> {
  for (const { window, workspaceId } of candidates) {
    if (workspaceId && workspaceId !== ROOT_WORKSPACE_ID && workspaceId !== CHIEF_WORKSPACE_ID) {
      return { kind: 'panel', window, workspaceId };
    }
  }
  return { kind: 'sign-in-window' };
}
