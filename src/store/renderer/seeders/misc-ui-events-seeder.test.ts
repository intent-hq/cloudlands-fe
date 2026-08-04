/**
 * Regression test for the seeder's `specialist.list` ingest.
 *
 * The seeder used to carry its own copies of the SpecialistDef → store mappers,
 * which silently dropped new wire fields (`hidden` — a wire-delivered
 * chief-of-staff without it shadowed the SPECIALISTS constant's `hidden: true`
 * per-id fallback and resurfaced in pickers). The seeder now routes through the
 * shared `dispatchSpecialistList`, so this suite asserts the initial ingest
 * carries `hidden` for both bundled and file tiers.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// FAKE seam: `$lib/client` is stubbed so no transport is constructed. The
// seeder receives its client via the seedMockStore param below.
vi.mock("$lib/client", () => ({ appClient: {} }));
vi.mock("svelte-sonner", () => ({ toast: { error: vi.fn() } }));

import type { AppClient } from "$lib/client";
import type { SpecialistDef } from "$lib/client/app-client";
import { store as appStore } from "$store/renderer/store";
import { SPECIALISTS } from "$lib/constants/specialists";
import type { FileSpecialist } from "$store/renderer/slices/specialists/specialists-slice";
import { seedMockStore } from "../mock-bootstrap";
import "./misc-ui-events-seeder";

// PROTOCOL §5.11-shaped wire defs: the bundled chief-of-staff carries
// `hidden: true`; the user-tier override of it must carry it too.
const CHIEF_BUNDLED: SpecialistDef = {
  id: "chief-of-staff",
  name: "Chief of Staff",
  description: "App-level assistant",
  prompt: "You assist.",
  behaviorPrompt: "You assist.",
  source: "bundled",
  hidden: true,
};

const HIDDEN_USER_DEF: SpecialistDef = {
  id: "secret-helper",
  name: "Secret Helper",
  description: "Hidden user specialist",
  prompt: "You help quietly.",
  behaviorPrompt: "You help quietly.",
  source: "user",
  path: "/home/u/.intent/specialists/secret-helper.md",
  hidden: true,
};

function makeClient(defs: SpecialistDef[]): AppClient {
  return {
    system: { status: vi.fn(() => Promise.resolve({})) },
    settings: { getProviderSettings: vi.fn(() => Promise.resolve(null)) },
    models: { list: vi.fn(() => Promise.resolve([])) },
    specialists: { list: vi.fn(() => Promise.resolve(defs)) },
    workspaces: { list: vi.fn(() => Promise.resolve([])) },
  } as unknown as AppClient;
}

type SpecialistsState = {
  specialists?: {
    bundledSpecialists?: typeof SPECIALISTS;
    fileSpecialists?: { map: Record<string, FileSpecialist> };
  };
};

describe("misc-ui-events-seeder specialist.list ingest", () => {
  beforeAll(() => appStore.init());
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("carries hidden on the bundled tier (wire chief-of-staff stays hidden)", async () => {
    await seedMockStore(appStore, makeClient([CHIEF_BUNDLED]));

    const state = appStore.state as SpecialistsState;
    const chief = state.specialists?.bundledSpecialists?.find(
      (s) => s.id === "chief-of-staff",
    );
    expect(chief).toBeDefined();
    expect(chief?.hidden).toBe(true);
  });

  it("carries hidden on the file tier", async () => {
    await seedMockStore(appStore, makeClient([HIDDEN_USER_DEF]));

    const state = appStore.state as SpecialistsState;
    expect(state.specialists?.fileSpecialists?.map["secret-helper"]?.hidden).toBe(true);
  });

  it("keeps all built-ins present when the daemon returns an empty list", async () => {
    await seedMockStore(appStore, makeClient([]));

    const state = appStore.state as SpecialistsState;
    const bundledIds = new Set(state.specialists?.bundledSpecialists?.map((s) => s.id));
    for (const builtin of SPECIALISTS) {
      expect(bundledIds.has(builtin.id), `bundled set missing ${builtin.id}`).toBe(true);
    }
  });
});
