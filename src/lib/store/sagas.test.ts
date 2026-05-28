import {
  describe,
  expect,
  it,
} from "vitest";

import { panelContextSaga } from "./slices/workspace-navigation/sagas/panel-context-saga";
import {
  retroactiveNavigationMountCheckSaga,
  watchWorkspaceNavigationLifecycleSaga,
  watchWorkspaceNavigationPersistenceSaga,
} from "./slices/workspace-navigation/sagas/workspace-navigation-saga";
import {
  sagaNames,
  sagas,
} from "./sagas";

describe("renderer saga registry", () => {
  it("registers workspace navigation static child sagas independently", () => {
    expect(sagas).not.toHaveProperty("workspaceNavigationSaga");
    expect(sagas.workspaceNavigationLifecycleSaga).toBe(watchWorkspaceNavigationLifecycleSaga);
    expect(sagas.retroactiveNavigationMountCheckSaga).toBe(retroactiveNavigationMountCheckSaga);
    expect(sagas.workspaceNavigationPersistenceSaga).toBe(watchWorkspaceNavigationPersistenceSaga);
    expect(sagas.panelContextSaga).toBe(panelContextSaga);
  });

  it("includes promoted child saga names in startup order", () => {
    expect(sagaNames).toEqual(expect.arrayContaining([
      "workspaceNavigationLifecycleSaga",
      "retroactiveNavigationMountCheckSaga",
      "workspaceNavigationPersistenceSaga",
      "panelContextSaga",
    ]));
    expect(sagaNames).not.toContain("workspaceNavigationSaga");
  });
});