/**
 * Every key `local-prefs.json` may hold, in one place.
 *
 * `getLocalPref`, `setLocalPref`, `deleteLocalPref` and the dock helpers in
 * `local-prefs.ts` accept only `LocalPrefKey`, so an unlisted string key does
 * not compile. `local-pref-keys.test.ts` fails when a listed key has no
 * production reader left. When you remove a feature, either keep a reader or
 * move its keys to `RETIRED_LOCAL_PREF_KEYS`, which `deleteRetiredLocalPrefs`
 * clears from users' files at startup. Never drop a key from both lists while
 * released builds may still have saved it.
 *
 * This file has no imports so tests can load it without Electron.
 */

/**
 * Production code uses only `LocalPrefKey`; the array lets the registry test
 * enumerate the keys.
 * @internal
 */
export const LOCAL_PREF_KEYS = [
  // Auto-update
  'updateChannel',
  /** Legacy boolean, migrated to `updateChannel` on first load. */
  'betaUpdatesEnabled',
  'shareUpdateStatistics',
  'lastUpdateCheckDay',
  'lastUpdateWeek',
  'lastUpdateMonth',
  'firstSeenDay',
  'firstSeenEstimated',
  // Backend connection and identity
  'backendClientId',
  'backendClientIdentitiesV1',
  'keychainSyncEnabled',
  'selfBackendFingerprint',
  'selfPublishSuppressed',
  // Dock and machine rail
  'dockLabEnabled',
  'dockEnabled',
  'dockPlacement',
  'dockShortcutOverrides',
  'dockMediaLastSavedChoice',
  'dockBackendId',
  'machineRailEnabled',
  // Window chrome, release notes, feature codes
  'menuBarAutoHide',
  'lastSeenReleaseNotesVersion',
  'featureCodes',
] as const;

/** A key of a live feature; the only keys the local-prefs API accepts. */
export type LocalPrefKey = (typeof LOCAL_PREF_KEYS)[number];

/**
 * Keys of removed features. `deleteRetiredLocalPrefs` deletes them at startup
 * so a removed feature leaves nothing behind (Browser access left a saved
 * access key, cloudlands-fe#4740 → #4744).
 */
export const RETIRED_LOCAL_PREF_KEYS = [
  // Browser access (removed in cloudlands-fe#4740)
  'browserAccess.enabled',
  'browserAccess.port',
  'browserAccess.accessKey',
  'browserAccess.pageOrigin',
] as const;

export type RetiredLocalPrefKey = (typeof RETIRED_LOCAL_PREF_KEYS)[number];
