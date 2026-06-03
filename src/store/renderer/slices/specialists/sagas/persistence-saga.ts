/**
 * Persistence Saga (Wave 2: stripped)
 *
 * Previously persisted overrides and custom specialists to electron-store.
 * After Wave 2, overrides and custom specialists are fully file-based:
 * - Overrides → user specialist files in ~/.augment/specialists/
 * - Custom specialists → user specialist files in ~/.augment/specialists/
 *
 * Migration code in specialist-file-loader.ts handles the one-time upgrade
 * from electron-store → files for users upgrading from older versions.
 *
 * This saga is now a no-op but kept to avoid import/fork breakage.
 */

export function* persistenceSaga() {
    // No-op: electron-store persistence removed in Wave 2.
    // Overrides and custom specialists are now persisted via file-specialists-saga.
}
