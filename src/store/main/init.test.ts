import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  initMainStoreBridge: vi.fn(),
  runSaga: vi.fn(() => ({ cancel: vi.fn() })),
  setSagaContext: vi.fn(),
}));

vi.mock("./middleware", () => ({
  middleware: [],
  runSaga: mocks.runSaga,
  setSagaContext: mocks.setSagaContext,
}));

vi.mock("./redux-store-bridge", () => ({
  initMainStoreBridge: mocks.initMainStoreBridge,
}));

import { initMainStore } from "./init";
import { mainSagaEntries } from "./sagas";

describe("initMainStore", () => {
  it("starts each registered main saga independently through the safe runner", () => {
    const context = initMainStore();

    expect(mocks.initMainStoreBridge).toHaveBeenCalledOnce();
    expect(mocks.initMainStoreBridge).toHaveBeenCalledWith(context.store);
    expect(mocks.setSagaContext).toHaveBeenCalledOnce();
    expect(mocks.setSagaContext).toHaveBeenCalledWith({
      readableStoreState: expect.objectContaining({ subscribe: expect.any(Function) }),
    });
    expect(mocks.runSaga).toHaveBeenCalledTimes(mainSagaEntries.length);

    mainSagaEntries.forEach(({ saga }, index) => {
      expect(mocks.runSaga).toHaveBeenNthCalledWith(index + 1, saga);
    });
  });
});