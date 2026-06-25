/**
 * Root app saga registry.
 *
 * The registry is intentionally empty: renderer side effects have been removed
 * and the store is now seeded from mocks at boot (see `mock-bootstrap.ts`).
 * Individual saga files remain in place and are removed in a later wave.
 */

export const sagas = [] as const;
