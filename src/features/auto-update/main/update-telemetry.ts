/**
 * Update-check telemetry helpers (main process).
 *
 * With telemetry on, electron-updater's generic feed points at
 * `https://updates.intentapp.dev/desktop/<channel>?p=…&v=…&src=…&k=…&d=…`.
 * That service counts the request and 302-redirects to the fixed
 * `cloudlands-releases` GitHub asset, so GitHub stays the only source of
 * manifests and installers. electron-updater 6.x copies the feed's query
 * string onto every file it resolves from the feed (channel yml, installer,
 * blockmaps), so downloads are counted too.
 *
 * No identifier is stored or sent: the query only carries platform/arch, app
 * version, install source, check trigger, once-per-UTC-day/ISO-week/month
 * flags, a once-ever new-install flag and a coarse install-age bucket. Only
 * dates are stored locally.
 */

import type { UpdateChannel } from '../types';

/** FE-local pref: the Settings → "Share anonymous update statistics" toggle. */
export const SHARE_UPDATE_STATISTICS_PREF = 'shareUpdateStatistics';
/**
 * FE-local pref: UTC day (YYYY-MM-DD) of the last successful update check on
 * any feed. Gates the stable channel's once-a-day automatic checks and the
 * telemetry `d` flag.
 */
export const LAST_UPDATE_CHECK_DAY_PREF = 'lastUpdateCheckDay';
/** FE-local pref: UTC ISO week (YYYY-Www) of the last successful check (`w`). */
export const LAST_UPDATE_WEEK_PREF = 'lastUpdateWeek';
/** FE-local pref: UTC month (YYYY-MM) of the last successful check (`m`). */
export const LAST_UPDATE_MONTH_PREF = 'lastUpdateMonth';
/** FE-local pref: UTC day (YYYY-MM-DD) this install was first seen (`a`). */
export const FIRST_SEEN_DAY_PREF = 'firstSeenDay';
/**
 * FE-local pref: whether `firstSeenDay` is an estimate (an install that
 * predates the cohort telemetry) rather than a recorded fresh install.
 * Estimated installs never send `i=1`. `true` with no day means unknown.
 */
export const FIRST_SEEN_ESTIMATED_PREF = 'firstSeenEstimated';

/**
 * Why a check ran (`k`). `daily` is the stable channel's hourly tick after the
 * UTC day rolled over; `periodic` is the alpha/beta hourly tick.
 */
export type UpdateCheckTrigger = 'startup' | 'daily' | 'periodic' | 'focus' | 'manual' | 'channel';
export type InstallSource = 'dmg' | 'nsis' | 'appimage' | 'deb' | 'unknown';
export type InstallAgeBucket = '0d' | '1-7d' | '8-30d' | '31-90d' | '91-365d' | '365d+' | 'unknown';
type UpdateFeedKind = 'telemetry' | 'github' | 'custom';

type Env = Readonly<Record<string, string | undefined>>;

export interface TelemetryParams {
  platform: string;
  arch: string;
  version: string;
  source: InstallSource;
  trigger: UpdateCheckTrigger;
  daily: boolean;
  /** First successful check of the UTC ISO week (`w`). */
  weekly: boolean;
  /** First successful check of the UTC calendar month (`m`). */
  monthly: boolean;
  /** First successful check ever on a genuinely fresh install (`i`). */
  install: boolean;
  /** Install-age bucket (`a`). */
  age: InstallAgeBucket;
}

/** How this copy of the app was installed, from the platform's updater target. */
export function detectInstallSource(platform: string, env: Env): InstallSource {
  switch (platform) {
    case 'darwin':
      return 'dmg';
    case 'win32':
      return 'nsis';
    case 'linux':
      // electron-builder's AppImage runtime exports APPIMAGE; deb installs
      // have no such marker.
      return env.APPIMAGE ? 'appimage' : 'deb';
    default:
      return 'unknown';
  }
}

/** UTC calendar day as YYYY-MM-DD. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** True when no update check has succeeded yet on `now`'s UTC day. */
export function isFirstCheckOfUtcDay(lastCheckDay: unknown, now: Date): boolean {
  return lastCheckDay !== utcDay(now);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC ISO-8601 week (weeks start Monday) as YYYY-Www, in the ISO week-numbering year. */
export function utcIsoWeek(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const isoWeekday = date.getUTCDay() || 7;
  // The Thursday of this week decides its ISO year.
  date.setUTCDate(date.getUTCDate() + 4 - isoWeekday);
  const year = date.getUTCFullYear();
  const week = Math.ceil(((date.getTime() - Date.UTC(year, 0, 1)) / DAY_MS + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** UTC calendar month as YYYY-MM. */
export function utcMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** True when no update check has succeeded yet in the `current` week/month key. */
export function isFirstCheckOfPeriod(lastPeriod: unknown, current: string): boolean {
  return lastPeriod !== current;
}

const UTC_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Midnight UTC of a valid YYYY-MM-DD day, otherwise null. */
function parseUtcDay(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = UTC_DAY_RE.exec(value);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return utcDay(new Date(ms)) === value ? ms : null;
}

/**
 * Install-age bucket from the first-seen day, in whole UTC days. A missing or
 * malformed day, or one after today (clock moved back), is `unknown`.
 */
export function installAgeBucket(firstSeenDay: unknown, now: Date): InstallAgeBucket {
  const first = parseUtcDay(firstSeenDay);
  if (first === null) return 'unknown';
  const today = parseUtcDay(utcDay(now)) as number;
  const days = Math.round((today - first) / DAY_MS);
  if (days < 0) return 'unknown';
  if (days === 0) return '0d';
  if (days <= 7) return '1-7d';
  if (days <= 30) return '8-30d';
  if (days <= 90) return '31-90d';
  if (days <= 365) return '91-365d';
  return '365d+';
}

export interface ResolveFirstSeenInput {
  storedDay: unknown;
  storedEstimated: unknown;
  /** Any earlier successful-check pref (day/week/month) exists. */
  hasPriorUpdateState: boolean;
  /** userData creation estimate (see user-data-age), or null when unavailable. */
  userDataCreatedAtMs: number | null;
  processStartMs: number;
  now: Date;
}

export interface FirstSeen {
  /** YYYY-MM-DD, or null when unknown. */
  day: string | null;
  estimated: boolean;
  /** True when this is a new decision that should be stored. */
  persist: boolean;
}

/** Slack for userData being created just before the main process clock started. */
const FRESH_USER_DATA_SLACK_MS = 60_000;

/**
 * Decide the first-seen day once per install. A stored decision is kept
 * (a stored unknown estimate stays unknown). Otherwise a userData folder
 * created during this process run, with no earlier successful-check prefs,
 * is a genuine new install recorded as today; anything else is an estimate
 * from userData's age, or unknown when that is unavailable.
 */
export function resolveFirstSeen(input: ResolveFirstSeenInput): FirstSeen {
  if (parseUtcDay(input.storedDay) !== null) {
    return {
      day: input.storedDay as string,
      estimated: input.storedEstimated !== false,
      persist: false,
    };
  }
  if (input.storedEstimated === true) return { day: null, estimated: true, persist: false };
  const createdAt = input.userDataCreatedAtMs;
  if (createdAt === null || !Number.isFinite(createdAt) || createdAt <= 0) {
    return { day: null, estimated: true, persist: true };
  }
  const fresh =
    !input.hasPriorUpdateState && createdAt >= input.processStartMs - FRESH_USER_DATA_SLACK_MS;
  if (fresh) return { day: utcDay(input.now), estimated: false, persist: true };
  return { day: utcDay(new Date(createdAt)), estimated: true, persist: true };
}

export function isDoNotTrack(env: Env): boolean {
  const value = env.DO_NOT_TRACK?.trim().toLowerCase();
  return value === '1' || value === 'true';
}

export function buildTelemetryFeedUrl(
  base: string,
  channel: Exclude<UpdateChannel, 'disabled'>,
  params: TelemetryParams,
): string {
  const query = new URLSearchParams({
    p: `${params.platform}-${params.arch}`,
    v: params.version,
    src: params.source,
    k: params.trigger,
    d: params.daily ? '1' : '0',
    w: params.weekly ? '1' : '0',
    m: params.monthly ? '1' : '0',
    i: params.install ? '1' : '0',
    a: params.age,
  });
  return `${base}/${channel}?${query.toString()}`;
}

export interface ResolveUpdateFeedInput {
  channel: Exclude<UpdateChannel, 'disabled'>;
  githubBase: string;
  telemetryBase: string;
  telemetry: TelemetryParams;
  shareStatistics: boolean;
  githubFallbackActive: boolean;
  env: Env;
}

export interface ResolvedUpdateFeed {
  kind: UpdateFeedKind;
  url: string;
}

/**
 * Pick the feed for one check. A custom AUTO_UPDATE_URL (dev/testing) always
 * wins; the toggle being off, DO_NOT_TRACK, or an earlier telemetry failure
 * this session all select the GitHub feed directly.
 */
export function resolveUpdateFeed(input: ResolveUpdateFeedInput): ResolvedUpdateFeed {
  const custom = input.env.AUTO_UPDATE_URL;
  if (custom) {
    return { kind: 'custom', url: `${custom}/${input.channel}` };
  }
  if (!input.shareStatistics || isDoNotTrack(input.env) || input.githubFallbackActive) {
    return { kind: 'github', url: `${input.githubBase}/${input.channel}` };
  }
  return {
    kind: 'telemetry',
    url: buildTelemetryFeedUrl(input.telemetryBase, input.channel, input.telemetry),
  };
}

const TELEMETRY_HOST = 'updates.intentapp.dev';
const TELEMETRY_PATH_PREFIX = '/desktop/';
const GITHUB_HOST = 'github.com';
const GITHUB_PATH_PREFIX = '/intent-hq/cloudlands-releases/releases/download/';
const GITHUB_ASSET_HOST_SUFFIX = '.githubusercontent.com';

/**
 * Whether the updater may fetch `rawUrl`. `extraPrefixes` are exact URL
 * prefixes (scheme + host + path) the user configured explicitly, i.e. a
 * custom AUTO_UPDATE_URL.
 */
export function isAllowedUpdateUrl(rawUrl: string, extraPrefixes: readonly string[] = []): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  for (const prefix of extraPrefixes) {
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    if (url.href.startsWith(normalized)) return true;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname;
  if (host === TELEMETRY_HOST) return url.pathname.startsWith(TELEMETRY_PATH_PREFIX);
  if (host === GITHUB_HOST) return url.pathname.startsWith(GITHUB_PATH_PREFIX);
  return host.endsWith(GITHUB_ASSET_HOST_SUFFIX);
}

/** The slice of Electron's `Session` the allowlist needs. */
export interface UpdaterSessionLike {
  webRequest: {
    onBeforeRequest(
      listener: (
        details: { url: string },
        callback: (response: { cancel: boolean }) => void,
      ) => void,
    ): void;
  };
}

/**
 * Cancel any request on the updater's own session (electron-updater 6.x's
 * dedicated `electron-updater` partition, `autoUpdater.netSession`) outside
 * the approved hosts. electron-updater follows redirects manually by issuing
 * a fresh request per hop, so every redirect target passes through here too;
 * a cancelled hop fails the check, which the service then retries on GitHub.
 * The macOS code-signature and Windows publisher checks remain the primary
 * protection; this mainly covers Linux, which only verifies sha512.
 */
export function installUpdateRequestAllowlist(
  session: UpdaterSessionLike,
  extraPrefixes: readonly string[] = [],
  onBlocked?: (url: string) => void,
): void {
  session.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isAllowedUpdateUrl(details.url, extraPrefixes);
    if (!allowed) onBlocked?.(details.url);
    callback({ cancel: !allowed });
  });
}

/** Header electron-updater 6.x fills from the persistent `.updaterId` file. */
const STAGING_ID_HEADER = 'x-user-staging-id';

/** The slice of Electron's `Session` the header filter needs. */
export interface UpdaterHeaderSessionLike {
  webRequest: {
    onBeforeSendHeaders(
      listener: (
        details: { url: string; requestHeaders: Record<string, string> },
        callback: (response: { requestHeaders: Record<string, string> }) => void,
      ) => void,
    ): void;
  };
}

function isTelemetryHostUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).hostname === TELEMETRY_HOST;
  } catch {
    return false;
  }
}

/**
 * electron-updater 6.x sends the persistent per-installation `.updaterId` as
 * `x-user-staging-id` on every feed request. Drop it (case-insensitively)
 * from each request to the telemetry host on the updater's own session, so
 * no identifier reaches updates.intentapp.dev, including redirect hops back
 * to it. Direct GitHub requests keep electron-updater's headers unchanged
 * (staged rollouts are decided locally from the same id), and other sessions
 * are untouched.
 */
export function installTelemetryHeaderFilter(session: UpdaterHeaderSessionLike): void {
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    if (!isTelemetryHostUrl(details.url)) {
      callback({ requestHeaders: details.requestHeaders });
      return;
    }
    const requestHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(details.requestHeaders)) {
      if (name.toLowerCase() !== STAGING_ID_HEADER) requestHeaders[name] = value;
    }
    callback({ requestHeaders });
  });
}
