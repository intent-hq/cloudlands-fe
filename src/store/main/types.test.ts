import {
  type StreamingStore,
} from "@augmentcode/ag-redux-toolkit/streaming-store";
import {
  describe,
  expectTypeOf,
  it,
} from "vitest";

import type { StoreState } from "$store/renderer/types";

import type { store as configuredMainStore } from "./configured-store";
import type { MainStoreState } from "./types";

describe("MainStoreState", () => {
  it("is structurally incompatible with the renderer StoreState in both directions", () => {
    type RendererAssignableToMain = StoreState extends MainStoreState ? true : false;
    type MainAssignableToRenderer = MainStoreState extends StoreState ? true : false;

    expectTypeOf<RendererAssignableToMain>().toEqualTypeOf<false>();
    expectTypeOf<MainAssignableToRenderer>().toEqualTypeOf<false>();
  });

  it("uses the StreamingStore family, not the renderer Svelte Store family", () => {
    type ConfiguredMainStore = typeof configuredMainStore;
    type MainStoreHasSvelteReadableState = ConfiguredMainStore extends { getReadableState: unknown } ? true : false;

    expectTypeOf<ConfiguredMainStore>().toMatchTypeOf<StreamingStore<any, any>>();
    expectTypeOf<MainStoreHasSvelteReadableState>().toEqualTypeOf<false>();
  });
});
