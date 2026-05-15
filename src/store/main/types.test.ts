import {
  describe,
  expectTypeOf,
  it,
} from "vitest";

import type { StoreState } from "$lib/store/types";

import type { MainStoreState } from "./types";

describe("MainStoreState", () => {
  it("is structurally incompatible with the renderer StoreState in both directions", () => {
    type RendererAssignableToMain = StoreState extends MainStoreState ? true : false;
    type MainAssignableToRenderer = MainStoreState extends StoreState ? true : false;

    expectTypeOf<RendererAssignableToMain>().toEqualTypeOf<false>();
    expectTypeOf<MainAssignableToRenderer>().toEqualTypeOf<false>();
  });
});
