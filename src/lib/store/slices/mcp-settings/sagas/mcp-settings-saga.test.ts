import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { runSaga } from "redux-saga";

vi.mock(
  "typed-redux-saga",
  async () => await import("$lib/store/utils/test-helpers/typed-redux-saga-mock"),
);

vi.mock("$lib/utils/client-logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

import { handleLoadServers } from "./mcp-settings-saga";
import {
  initialState,
  setDisabledServers,
} from "../mcp-settings-slice";

const mockInvoke = vi.fn();

type DispatchedAction = ReturnType<typeof setDisabledServers> | { type: string; payload?: unknown };

function installElectronApi(): void {
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: { invoke: mockInvoke },
  });
}

function mockLoadResponses(disabledResponse: unknown): void {
  mockInvoke.mockImplementation(async (channel: string, data?: { key?: string }) => {
    if (channel === "settings:get" && data?.key === "enableUserMcpServers") {
      return { success: true, data: true };
    }
    if (channel === "settings:get" && data?.key === "disabledMcpServers") {
      return disabledResponse;
    }
    if (channel === "user-mcp:mcp-list") {
      return { success: true, data: [] };
    }
    return { success: false, error: `Unexpected IPC call: ${channel}` };
  });
}

async function collectLoadActions(disabledResponse: unknown): Promise<DispatchedAction[]> {
  const dispatched: DispatchedAction[] = [];
  mockLoadResponses(disabledResponse);

  await runSaga(
    {
      dispatch: (action: DispatchedAction) => dispatched.push(action),
      getState: () => ({
        mcpSettings: {
          ...initialState,
          disabledServers: { existing: true },
        },
      }),
    },
    handleLoadServers,
  ).toPromise();

  return dispatched;
}

beforeEach(() => {
  vi.clearAllMocks();
  installElectronApi();
});

describe("handleLoadServers", () => {
  it("does not clear disabled servers when the persisted payload is malformed", async () => {
    const dispatched = await collectLoadActions({ success: true, data: { malformed: true } });

    expect(dispatched.filter((action) => action.type === setDisabledServers.type)).toEqual([]);
  });

  it("dispatches normalized disabled servers when the persisted payload is an array", async () => {
    const dispatched = await collectLoadActions({ success: true, data: ["alpha", 42, " beta "] });

    expect(dispatched).toContainEqual(setDisabledServers({ alpha: true, beta: true }));
  });
});