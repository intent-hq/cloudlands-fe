/**
 * Generic test fixture for registering and executing mock store seed functions
 * in insertion order. Production renderer hydration is saga-owned; this module
 * remains for focused tests that need an explicit seeding harness.
 */
import type { Store } from '@augmentcode/themis/svelte-store';

import type { AppClient } from '$lib/client';
import { appClient } from '$lib/client';

/** Everything a seeder needs to populate one domain's state. */
export interface MockSeederContext {
  /** The configured renderer store to dispatch seed actions into. */
  store: Store<any, any>;
  /** The mock-backed client fixtures are pulled from. */
  client: AppClient;
}

/** Seeds one domain's slice state from the `AppClient`. May be async. */
export type MockSeeder = (context: MockSeederContext) => void | Promise<void>;

interface RegisteredSeeder {
  name: string;
  seed: MockSeeder;
}

const seeders: RegisteredSeeder[] = [];

/**
 * Register a domain seeder. Registering the same `name` again replaces the
 * previous entry (idempotent across hot reloads / repeated module evaluation).
 */
export function registerMockSeeder(name: string, seed: MockSeeder): void {
  const existingIndex = seeders.findIndex((entry) => entry.name === name);
  if (existingIndex >= 0) {
    seeders[existingIndex] = { name, seed };
    return;
  }
  seeders.push({ name, seed });
}

/** Names of the currently registered seeders, in registration order. */
export function getRegisteredMockSeeders(): readonly string[] {
  return seeders.map((entry) => entry.name);
}

/** Remove all registered seeders. Primarily for tests. */
export function clearMockSeeders(): void {
  seeders.length = 0;
}

/**
 * Run every registered seeder in registration order, seeding the store from the
 * given client (defaults to the process-wide mock `appClient`). Seeders run
 * sequentially so later domains can rely on state populated by earlier ones.
 */
export async function seedMockStore(
  store: Store<any, any>,
  client: AppClient = appClient,
): Promise<void> {
  for (const { seed } of [...seeders]) {
    await seed({ store, client });
  }
}
