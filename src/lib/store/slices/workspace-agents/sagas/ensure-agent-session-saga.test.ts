import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { expectSaga } from "redux-saga-test-plan";
import * as matchers from "redux-saga-test-plan/matchers";

vi.mock("typed-redux-saga",
  async () =>
  await import("$lib/store/utils/test-helpers/typed-redux-saga-mock"),
  );

const { loadSessionMock,
  loadAgentConfigMock } = vi.hoisted(() => ({
  loadSessionMock: vi.fn(async () => null),
  loadAgentConfigMock: vi.fn(async () => null),
  }));

vi.mock("$features/agent/browser",
  () => ({
  persistenceService: {
    loadSession: loadSessionMock,
  loadAgentConfig: loadAgentConfigMock,
  },
  }));

import { selectWorkspaceById } from "$lib/store/slices/workspace/workspace-selectors";
import { selectAllWorkspaceAgents } from "../workspace-agents-selectors";
import {
  ensureAgentSessionLoaded,
  restoreAgentSessionRequested,
} from "../workspace-agents-slice";
import {
  _resetInFlightEnsureKeysForTest,
  handleEnsureAgentSessionLoaded,
  handleRestoreAgentSessionRequested,
  watchEnsureAgentSessionLoadedSaga,
} from "./ensure-agent-session-saga";
import { selectAgentSession } from '../../agent-session/agent-session-selectors';

const WS_ID = "ws-1";
const AGENT_ID = "agent-1";

const mockWorkspace = {
  id: WS_ID,
  branch: "feature/test",
  repositoryOwner: "o",
  repositoryName: "r",
} as any;

const mockSession = {
  id: AGENT_ID,
  workspaceId: WS_ID,
  messages: [],
} as any;

describe("ensureAgentSessionLoaded saga", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadSessionMock.mockResolvedValue(null);
    loadAgentConfigMock.mockResolvedValue(null);
    _resetInFlightEnsureKeysForTest();
  });

  afterEach(() => {
    _resetInFlightEnsureKeysForTest();
  });

  describe("handleEnsureAgentSessionLoaded", () => {
    it("no-ops when the session already exists (hit)", async () => {
      await expectSaga(handleEnsureAgentSessionLoaded, WS_ID, AGENT_ID)
        .provide([
          [matchers.select.selector(selectAgentSession.select), mockSession],
        ])
        .silentRun(50);

      expect(loadSessionMock).not.toHaveBeenCalled();
    });

    it("loads from persistence when the session is missing (miss)", async () => {
      await expectSaga(handleEnsureAgentSessionLoaded, WS_ID, AGENT_ID)
        .provide([
          [matchers.select.selector(selectAgentSession.select), undefined],
          [matchers.select.selector(selectWorkspaceById.select), mockWorkspace],
          [matchers.call.fn(loadSessionMock), null],
          [matchers.select.selector(selectAllWorkspaceAgents.select), []],
          [matchers.call.fn(loadAgentConfigMock), null],
        ])
        .call.fn(loadSessionMock)
        .silentRun(50);
    });

    it("does not fall back to the current workspace when explicit workspace lookup misses", async () => {
      await expectSaga(handleEnsureAgentSessionLoaded, WS_ID, AGENT_ID)
        .provide([
          [matchers.select.selector(selectAgentSession.select), undefined],
          [matchers.select.selector(selectWorkspaceById.select), undefined],
        ])
        .silentRun(50);

      expect(loadSessionMock).not.toHaveBeenCalled();
      expect(loadAgentConfigMock).not.toHaveBeenCalled();
    });

    it("does nothing when no workspace can be resolved", async () => {
      await expectSaga(handleEnsureAgentSessionLoaded, WS_ID, AGENT_ID)
        .provide([
          [matchers.select.selector(selectAgentSession.select), undefined],
          [matchers.select.selector(selectWorkspaceById.select), undefined],
        ])
        .silentRun(50);

      expect(loadSessionMock).not.toHaveBeenCalled();
    });

    it("swallows errors from persistence restore", async () => {
      await expectSaga(handleEnsureAgentSessionLoaded, WS_ID, AGENT_ID)
        .provide([
          [matchers.select.selector(selectAgentSession.select), undefined],
          [matchers.select.selector(selectWorkspaceById.select), mockWorkspace],
          [
            matchers.call.fn(loadSessionMock),
            Promise.reject(new Error("boom")),
          ],
        ])
        .silentRun(50);
    });
  });

  describe("watchEnsureAgentSessionLoadedSaga", () => {
    it("debounces duplicate dispatches for the same (wsId, agentId) while a load is in flight", async () => {
      // A never-resolving restore keeps the first worker in-flight for the
      // entire test run, so the in-flight Set must suppress the 2nd/3rd
      // dispatches. If debouncing is broken, we would see 3 calls instead of 1.
      loadSessionMock.mockImplementation(
        () => new Promise(() => {}),
      );

      await expectSaga(watchEnsureAgentSessionLoadedSaga)
        .provide([
          [matchers.select.selector(selectAgentSession.select), undefined],
          [matchers.select.selector(selectWorkspaceById.select), mockWorkspace],
        ])
        .dispatch(ensureAgentSessionLoaded(WS_ID, AGENT_ID))
        .dispatch(ensureAgentSessionLoaded(WS_ID, AGENT_ID))
        .dispatch(ensureAgentSessionLoaded(WS_ID, AGENT_ID))
        .silentRun(100);

      expect(loadSessionMock).toHaveBeenCalledTimes(1);
    });

    it("allows concurrent loads for different (wsId, agentId) pairs", async () => {
      loadSessionMock.mockImplementation(
        () => new Promise(() => {}),
      );

      await expectSaga(watchEnsureAgentSessionLoadedSaga)
        .provide([
          [matchers.select.selector(selectAgentSession.select), undefined],
          [matchers.select.selector(selectWorkspaceById.select), mockWorkspace],
        ])
        .dispatch(ensureAgentSessionLoaded(WS_ID, AGENT_ID))
        .dispatch(ensureAgentSessionLoaded(WS_ID, "agent-2"))
        .silentRun(100);

      expect(loadSessionMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("handleRestoreAgentSessionRequested", () => {
    it("returns null without falling back when explicit workspace lookup misses", async () => {
      const action = restoreAgentSessionRequested(WS_ID, AGENT_ID);

      await expectSaga(handleRestoreAgentSessionRequested, action)
        .provide([
          [matchers.select.selector(selectAgentSession.select), undefined],
          [matchers.select.selector(selectWorkspaceById.select), undefined],
        ])
        .put(action.success(null))
        .silentRun(50);

      expect(loadSessionMock).not.toHaveBeenCalled();
      expect(loadAgentConfigMock).not.toHaveBeenCalled();
    });
  });
});

