import { describe, expect, it, vi } from "vitest";
import * as sagaEffects from "redux-saga/effects";

vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any) {
    return yield sagaEffects.select(selector);
  },
}));

const { createAgentMock } = vi.hoisted(() => ({
  createAgentMock: vi.fn(),
}));

vi.mock("$features/agent/services/agent-factory", () => ({
  agentFactory: {
    createAgent: createAgentMock,
  },
}));

vi.mock("$features/layout/panel-layout-adapter", () => ({
  hasPanelLayoutManager: () => false,
  getPanelLayoutManager: () => null,
}));

vi.mock("$lib/store/redux-dispatch-bridge", () => ({
  getReduxStore: () => ({ getState: () => ({}), dispatch: vi.fn() }),
}));

vi.mock("$lib/utils/agent-name-generator", () => ({
  generateSpecialistAgentName: (_base: string, _existing: string[]) => "Agent",
}));

import {
  handleCreateAgentRequestedSaga,
  handleCreateAgentWithSpecialistRequestedSaga,
} from "./agent-creation-saga";

function makeWorkspace(wsId: string) {
  return {
    id: wsId,
    worktreePath: "/fake/path",
    repositoryPath: "/fake/repo",
    path: "/fake",
  };
}

/**
 * Steps through a generator, providing mock values for SELECT effects based on
 * the order they appear in the saga. Returns the CALL effect to agentFactory.createAgent.
 *
 * The saga yields effects in this order:
 *   1. SELECT (selectWorkspaceById.effect)
 *   2. PUT (clearInitialAgentConfig)
 *   3. SELECT (selectAllWorkspaceAgents)
 *   4. SELECT (selectWorkspaceDefaultModel)
 *   5. SELECT (selectActiveProviderId)
 *   6. CALL ([agentFactory, agentFactory.createAgent])
 */
function stepToCreateAgentCall(
  gen: Generator,
  wsId: string,
  opts: { model: string; globalProvider: string },
) {
  // 1. SELECT → workspace
  let step = gen.next();
  expect(step.done).toBe(false);
  expect((step.value as any).type).toBe("SELECT");

  // provide workspace → 2. PUT(clearInitialAgentConfig)
  step = gen.next(makeWorkspace(wsId));
  expect((step.value as any).type).toBe("PUT");

  // advance past PUT → 3. SELECT(agents)
  step = gen.next();
  expect((step.value as any).type).toBe("SELECT");

  // provide agents → 4. SELECT(model)
  step = gen.next([]);
  expect((step.value as any).type).toBe("SELECT");

  // provide model → 5. SELECT(globalProvider)
  step = gen.next(opts.model);
  expect((step.value as any).type).toBe("SELECT");

  // provide globalProvider → 6. CALL
  step = gen.next(opts.globalProvider);
  expect((step.value as any).type).toBe("CALL");
  return step.value as any;
}

describe("handleCreateAgentRequestedSaga — provider derivation (PR #418 regression)", () => {
  it("derives provider from compound model prefix (claude-code:default)", () => {
    const gen = handleCreateAgentRequestedSaga("ws-1");
    const callEffect = stepToCreateAgentCall(gen, "ws-1", {
      model: "claude-code:default",
      globalProvider: "codex",
    });
    const config = callEffect.payload.args[1];
    expect(config.provider).toBe("claude-code");
  });

  it("falls back to global provider for unprefixed model (sonnet4.5)", () => {
    const gen = handleCreateAgentRequestedSaga("ws-2");
    const callEffect = stepToCreateAgentCall(gen, "ws-2", {
      model: "sonnet4.5",
      globalProvider: "auggie",
    });
    const config = callEffect.payload.args[1];
    expect(config.provider).toBe("auggie");
  });
});

describe("handleCreateAgentWithSpecialistRequestedSaga — provider derivation (no specialist match)", () => {
  /**
   * Same stepping as handleCreateAgentRequestedSaga since specialistId=null
   * skips the specialist lookup branch entirely.
   */
  function stepSpecialistToCreateAgentCall(
    gen: Generator,
    wsId: string,
    opts: { model: string; globalProvider: string },
  ) {
    // 1. SELECT → workspace
    let step = gen.next();
    expect(step.done).toBe(false);
    expect((step.value as any).type).toBe("SELECT");

    // provide workspace → 2. PUT(clearInitialAgentConfig)
    step = gen.next(makeWorkspace(wsId));
    expect((step.value as any).type).toBe("PUT");

    // advance past PUT → 3. SELECT(agents)
    step = gen.next();
    expect((step.value as any).type).toBe("SELECT");

    // provide agents → 4. SELECT(model)
    step = gen.next([]);
    expect((step.value as any).type).toBe("SELECT");

    // provide model → 5. SELECT(globalProvider)
    step = gen.next(opts.model);
    expect((step.value as any).type).toBe("SELECT");

    // provide globalProvider → 6. CALL
    step = gen.next(opts.globalProvider);
    expect((step.value as any).type).toBe("CALL");
    return step.value as any;
  }

  it("derives provider from compound model prefix (claude-code:default)", () => {
    const gen = handleCreateAgentWithSpecialistRequestedSaga("ws-3", null);
    const callEffect = stepSpecialistToCreateAgentCall(gen, "ws-3", {
      model: "claude-code:default",
      globalProvider: "codex",
    });
    const config = callEffect.payload.args[1];
    expect(config.provider).toBe("claude-code");
  });

  it("falls back to global provider for unprefixed model (sonnet4.5)", () => {
    const gen = handleCreateAgentWithSpecialistRequestedSaga("ws-4", null);
    const callEffect = stepSpecialistToCreateAgentCall(gen, "ws-4", {
      model: "sonnet4.5",
      globalProvider: "auggie",
    });
    const config = callEffect.payload.args[1];
    expect(config.provider).toBe("auggie");
  });
});

describe("handleCreateAgentWithSpecialistRequestedSaga — specialist lookup branch", () => {
  /**
   * Steps through the generator when a real specialist ID is provided. The saga
   * yields effects in this order when the specialist is found:
   *   1. SELECT (selectWorkspaceById.effect)
   *   2. PUT (clearInitialAgentConfig)
   *   3. SELECT (selectAllWorkspaceAgents)
   *   4. SELECT (selectWorkspaceDefaultModel)
   *   5. SELECT (selectActiveProviderId)
   *   6. SELECT (selectSpecialists)                — specialist lookup
   *   7. SELECT (selectEffectiveCodingAgent)       — provider override
   *   8. SELECT (selectEffectiveModel)             — model override
   *   9. SELECT (selectEffectiveBehaviorPrompt)    — behavior prompt
   *  10. CALL  ([agentFactory, agentFactory.createAgent])
   */
  function stepWithSpecialistToCreateAgentCall(
    gen: Generator,
    wsId: string,
    opts: {
      model: string;
      globalProvider: string;
      specialist: { id: string; name: string };
      effectiveProvider: string;
      effectiveModel: string;
      effectiveBehaviorPrompt: string | undefined;
    },
  ) {
    // 1. SELECT → workspace
    let step = gen.next();
    expect(step.done).toBe(false);
    expect((step.value as any).type).toBe("SELECT");

    // provide workspace → 2. PUT
    step = gen.next(makeWorkspace(wsId));
    expect((step.value as any).type).toBe("PUT");

    // advance past PUT → 3. SELECT(agents)
    step = gen.next();
    expect((step.value as any).type).toBe("SELECT");

    // provide agents → 4. SELECT(model)
    step = gen.next([]);
    expect((step.value as any).type).toBe("SELECT");

    // provide model → 5. SELECT(globalProvider)
    step = gen.next(opts.model);
    expect((step.value as any).type).toBe("SELECT");

    // provide globalProvider → 6. SELECT(specialists)
    step = gen.next(opts.globalProvider);
    expect((step.value as any).type).toBe("SELECT");

    // provide specialists list (containing matching specialist) → 7. SELECT(effectiveCodingAgent)
    step = gen.next([opts.specialist]);
    expect((step.value as any).type).toBe("SELECT");

    // provide effectiveProvider → 8. SELECT(effectiveModel)
    step = gen.next(opts.effectiveProvider);
    expect((step.value as any).type).toBe("SELECT");

    // provide effectiveModel → 9. SELECT(effectiveBehaviorPrompt)
    step = gen.next(opts.effectiveModel);
    expect((step.value as any).type).toBe("SELECT");

    // provide effectiveBehaviorPrompt → 10. CALL
    step = gen.next(opts.effectiveBehaviorPrompt);
    expect((step.value as any).type).toBe("CALL");
    return step.value as any;
  }

  it("creates an agent with specialist metadata and specialist-picker source", () => {
    const gen = handleCreateAgentWithSpecialistRequestedSaga("ws-5", "implementor");
    const callEffect = stepWithSpecialistToCreateAgentCall(gen, "ws-5", {
      model: "sonnet4.5",
      globalProvider: "auggie",
      specialist: { id: "implementor", name: "Implementor" },
      effectiveProvider: "claude-code",
      effectiveModel: "opus",
      effectiveBehaviorPrompt: "Be a careful implementor.",
    });
    const config = callEffect.payload.args[1];
    expect(config.metadata).toEqual({ specialist: "implementor" });
    expect(config.source).toBe("specialist-picker");
    // Effective values from specialist overrides take precedence
    expect(config.provider).toBe("claude-code");
    expect(config.model).toBe("opus");
    expect(config.behaviorPrompt).toBe("Be a careful implementor.");
  });
});
