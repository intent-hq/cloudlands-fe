/**
 * Which machine an open entry (`intent --open-app <appId>`, `intent://app/<appId>`)
 * opens. The entry names no machine, and each machine has its own library, so
 * one app id can be installed on more than one machine:
 *
 * 1. This computer, when its library has the app (Intent OS's top bar lists
 *    only local apps and opens them this way).
 * 2. Else the machine of the focused Intent window, when its library has it.
 * 3. Else the one other machine whose library has it.
 * 4. Else nothing: no library that main has read has the app, or more than
 *    one has it and nothing above picks one.
 *
 * Only libraries that main has read count: a remote machine's library is read
 * once one of its windows reads the Intent apps state. This file has no
 * Electron imports so tests can load it.
 */
import { LOCAL_CONNECTION_ID } from '../../../shared/types/connections';

export interface OpenAppCandidate {
  backendId: string;
  /** Installed app ids in the machine's library as main last read it. */
  appIds: readonly string[];
}

export type OpenAppTarget =
  | { kind: 'machine'; backendId: string }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; backendIds: string[] };

export function pickOpenAppTarget(
  appId: string,
  candidates: readonly OpenAppCandidate[],
  focusedBackendId: string | null,
): OpenAppTarget {
  const having = candidates
    .filter((candidate) => candidate.appIds.includes(appId))
    .map((candidate) => candidate.backendId);
  if (having.includes(LOCAL_CONNECTION_ID))
    return { kind: 'machine', backendId: LOCAL_CONNECTION_ID };
  if (focusedBackendId && having.includes(focusedBackendId)) {
    return { kind: 'machine', backendId: focusedBackendId };
  }
  if (having.length === 1) return { kind: 'machine', backendId: having[0] };
  if (having.length === 0) return { kind: 'missing' };
  return { kind: 'ambiguous', backendIds: [...having].sort() };
}
