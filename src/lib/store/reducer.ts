import { storeUtilityReducer } from "./slices/store-utility/store-utility-slice";
import { tabDragReducer } from "./slices/tab-drag/tab-drag-slice";
import { tabScrollReducer } from "./slices/tab-scroll/tab-scroll-slice";

export const reducers = {
  storeUtility: storeUtilityReducer,
  tabDrag: tabDragReducer,
  tabScroll: tabScrollReducer,
} as const;

