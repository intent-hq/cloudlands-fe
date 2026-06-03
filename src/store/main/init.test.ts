import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  disposeConfiguredStore: vi.fn(),
  initMainStoreBridge: vi.fn(),
  render: vi.fn((component: (_renderer: unknown, props: { run: () => void }) => void, options: { props: { run: () => void } }) => {
    component({}, options.props);
    return { body: "" };
  }),
  createSelector: vi.fn((selectorFunc: (state: unknown, ...args: unknown[]) => unknown) => Object.assign(
    vi.fn(),
    {
      withStore: vi.fn(() => vi.fn()),
      select: selectorFunc,
      effect: vi.fn(),
    },
  )),
  runSaga: vi.fn(() => vi.fn()),
}));

const storeMock = vi.hoisted(() => ({
  init: vi.fn(() => mocks.disposeConfiguredStore),
  createSelector: mocks.createSelector,
  runSaga: mocks.runSaga,
  dispatch: vi.fn(),
  state: {},
}));

vi.mock("svelte/server", () => ({
  render: mocks.render,
}));

vi.mock("./configured-store", () => ({
  store: storeMock,
}));

vi.mock("./redux-store-bridge", () => ({
  initMainStoreBridge: mocks.initMainStoreBridge,
}));

import { initMainStore } from "./init";
import { mainSagaEntries } from "./sagas";

describe("initMainStore", () => {
  beforeEach(() => {
    mocks.disposeConfiguredStore.mockClear();
    mocks.initMainStoreBridge.mockClear();
    mocks.render.mockClear();
    mocks.createSelector.mockClear();
    mocks.runSaga.mockClear();
    storeMock.init.mockClear();
    storeMock.dispatch.mockClear();
  });

  it("initializes the configured StreamingStore and starts each registered main saga", () => {
    const context = initMainStore();

    expect(mocks.render).toHaveBeenCalledOnce();
    expect(storeMock.init).toHaveBeenCalledOnce();
    expect(mocks.initMainStoreBridge).toHaveBeenCalledOnce();
    expect(mocks.initMainStoreBridge).toHaveBeenCalledWith(context.store);
    expect(context.store).toBe(storeMock);
    expect(mocks.runSaga).toHaveBeenCalledTimes(mainSagaEntries.length);

    mainSagaEntries.forEach(({ saga }, index) => {
      expect(mocks.runSaga).toHaveBeenNthCalledWith(index + 1, saga);
    });
  });

  it("disposes started main sagas before disposing the configured store", () => {
    const stopSagaFns = mainSagaEntries.map(() => vi.fn());
    const pendingStopSagaFns = [...stopSagaFns];
    mocks.runSaga.mockImplementation(() => pendingStopSagaFns.shift() ?? vi.fn());

    const context = initMainStore();
    context.dispose();

    stopSagaFns.forEach((stopSaga) => expect(stopSaga).toHaveBeenCalledOnce());
    expect(mocks.disposeConfiguredStore).toHaveBeenCalledOnce();
    expect(mocks.runSaga).toHaveBeenCalledTimes(mainSagaEntries.length);
  });
});
