/**
 * The open entry of Intent apps (`docs/protocol/methods/apps.md` →
 * "Window identity and open entry"): `intent --open-app <appId>` and
 * `intent://app/<appId>`, both handled by the first instance.
 *
 * This file has no Electron imports so tests can load it.
 */
import { isIntentAppId } from './intent-apps-types';

const OPEN_APP_FLAG = '--open-app';

export interface OpenAppRequest {
  appId: string;
  /** The request came as an `intent://app/<id>` link, not as the flag. */
  fromLink: boolean;
}

/** `intent://app/<appId>` (an optional trailing `/`), else null. */
export function parseOpenAppLink(raw: string): string | null {
  const text = raw.trim();
  const match = /^intent:\/\/app\/([^/?#]+)\/?$/i.exec(text);
  if (!match) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  return isIntentAppId(id) ? id : null;
}

/** Whether `raw` is an app link at all (valid or not), so no other router takes it. */
export function isOpenAppLink(raw: string): boolean {
  return /^intent:\/\/app(?:[/?#]|$)/i.test(raw.trim());
}

/**
 * Find the open request in a command line: `--open-app <id>`, `--open-app=<id>`
 * or an `intent://app/<id>` argument. An invalid id is no request.
 */
export function findOpenAppRequest(argv: readonly string[]): OpenAppRequest | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === OPEN_APP_FLAG) {
      const next = argv[index + 1];
      return isIntentAppId(next) ? { appId: next, fromLink: false } : null;
    }
    if (arg.startsWith(`${OPEN_APP_FLAG}=`)) {
      const value = arg.slice(OPEN_APP_FLAG.length + 1);
      return isIntentAppId(value) ? { appId: value, fromLink: false } : null;
    }
    if (isOpenAppLink(arg)) {
      const appId = parseOpenAppLink(arg);
      return appId ? { appId, fromLink: true } : null;
    }
  }
  return null;
}
