import type { StoreState } from "$store/renderer/types";

import type { MainStoreState } from "./types";

declare const rendererState: StoreState;
declare const mainState: MainStoreState;

// @ts-expect-error MainStoreState must stay incompatible with renderer StoreState.
const rendererFromMain: StoreState = mainState;

// @ts-expect-error StoreState must stay incompatible with MainStoreState.
const mainFromRenderer: MainStoreState = rendererState;

void rendererFromMain;
void mainFromRenderer;
