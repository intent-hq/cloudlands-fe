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
import {
  AgentStatus,
  type AgentSession,
} from "$shared/types";
import { AgentActivationState } from "$shared/types/agent-session";

vi.mock("typed-redux-saga",
  async () =>
  await import("$store/renderer/utils/test-helpers/typed-redux-saga-mock"),
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

import { selectWorkspaceById } from "$store/renderer/slices/workspace/workspace-selectors";
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
import { upsertSession } from '../../agent-session/agent-session-slice';

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
  backendSessionId: "backend-1",
  workspaceId: WS_ID,
  status: AgentStatus.Idle,
  messages: [],
} as AgentSession;

const staleShell = {
  ...mockSession,
  backendSessionId: null,
  status: AgentStatus.Pending,
  activationState: AgentActivationState.PENDING,
} as AgentSession;

const restoredSession = {
  ...mockSession,
  backendSessionId: "backend-restored" as AgentSession['backendSessionId'],
  status: AgentStatus.Idle,
} as AgentSession;

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

    it("restores a stale same-id shell using a fresh persistence read", async () => {
      loadSessionMock.mockResolvedValue(restoredSession);

      await expectSaga(handleEnsureAgentSessionLoaded, WS_ID, AGENT_ID)
        .provide([
          [matchers.select.selector(selectAgentSession.select), staleShell],
          [matchers.select.selector(selectWorkspaceById.select), mockWorkspace],
          [matchers.select.selector(selectAllWorkspaceAgents.select), []],
        ])
        .put.like({ action: { type: upsertSession({} as AgentSession).type } })
        .silentRun(50);

      expect(loadSessionMock).toHaveBeenCalledWith(AGENT_ID, WS_ID, { bypassCache: true });
      expect(loadAgentConfigMock).not.toHaveBeenCalled();
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

    it("resolves with a restored backend session instead of returning a stale shell", async () => {
      const action = restoreAgentSessionRequested(WS_ID, AGENT_ID);
      loadSessionMock.mockResolvedValue(restoredSession);

      await expectSaga(handleRestoreAgentSessionRequested, action)
        .provide([
          [matchers.select.selector(selectAgentSession.select), staleShell],
          [matchers.select.selector(selectWorkspaceById.select), mockWorkspace],
          [matchers.select.selector(selectAllWorkspaceAgents.select), []],
        ])
        .put.like({ action: { type: upsertSession({} as AgentSession).type } })
        .put(action.success(restoredSession))
        .silentRun(50);

      expect(loadSessionMock).toHaveBeenCalledWith(AGENT_ID, WS_ID, { bypassCache: true });
    });

    it("surfaces an actionable error session when a stale shell cannot be restored", async () => {
      const action = restoreAgentSessionRequested(WS_ID, AGENT_ID);
      loadSessionMock.mockResolvedValue(null);
      loadAgentConfigMock.mockResolvedValue(null);
      const expectedFailureSession = {
        ...staleShell,
        workspaceId: WS_ID as AgentSession['workspaceId'],
        activationState: AgentActivationState.ERROR,
        lastActivationError: 'Failed to restore agent session from disk',
      } as AgentSession;

      await expectSaga(handleRestoreAgentSessionRequested, action)
        .provide([
          [matchers.select.selector(selectAgentSession.select), staleShell],
          [matchers.select.selector(selectWorkspaceById.select), mockWorkspace],
          [matchers.select.selector(selectAllWorkspaceAgents.select), []],
        ])
        .put(upsertSession(expectedFailureSession))
        .put(action.success(expectedFailureSession))
        .silentRun(50);
    });
  });
});

