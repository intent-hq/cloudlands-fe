import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testSaga } from "redux-saga-test-plan";
import * as sagaEffects from "redux-saga/effects";
import { workspaceClient } from "$lib/store/slices/workspace/utils/workspace.client";
import { ChangeStage } from "$features/file-tracking/types";
import { WorkspaceId } from "$shared/types/branded-ids";

vi.mock("typed-redux-saga", () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  takeEvery: function* (pattern: any, saga: any, ...args: any[]) {
    return yield sagaEffects.takeEvery(pattern, saga, ...args);
  },
}));

const { mockUpdateCurrentContext } = vi.hoisted(() => ({
  mockUpdateCurrentContext: vi.fn(),
}));

vi.mock("$lib/store/slices/workspace/utils/workspace.client", () => ({
  workspaceClient: {
    updateCurrentContext: mockUpdateCurrentContext,
  },
}));

import { clearCurrentlyViewed, markAsViewed } from "../../note-read-tracking/note-read-tracking-slice";
import { selectWorkspaceNavigationState } from "../workspace-navigation-selectors";
import {
  hydrateWorkspaceNavigation,
  openWorkspaceNote,
  setWorkspaceMainPanel,
} from "../workspace-navigation-slice";
import { handlePanelChanged, panelContextSaga } from "./panel-context-saga";

describe("panelContextSaga", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T01:15:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates MCP context and marks the selected note as viewed", () => {
    const navState = {
      mainPanel: {
        type: "notes",
        selectedNoteId: "note-1",
      },
    } as const;

    testSaga(handlePanelChanged, openWorkspaceNote("ws-1", "note-1"))
      .next()
      .select(selectWorkspaceNavigationState.select, "ws-1")
      .next(navState)
      .call([workspaceClient, workspaceClient.updateCurrentContext], WorkspaceId("ws-1"), {
        workspaceId: WorkspaceId("ws-1"),
        mainContentType: "note",
        mainContentId: "note-1",
        mainContentPath: undefined,
        mainContentUrl: undefined,
        lastUpdated: "2026-03-25T01:15:00.000Z",
      })
      .next()
      .put(markAsViewed("note-1"))
      .next()
      .isDone();
  });

  it("clears viewed-note state when the main panel is not showing a note", () => {
    const navState = {
      mainPanel: {
        type: "file",
        selectedFile: "src/main.ts",
      },
    } as const;

    testSaga(handlePanelChanged, setWorkspaceMainPanel("ws-1", "file", { selectedFile: "src/main.ts" }))
      .next()
      .select(selectWorkspaceNavigationState.select, "ws-1")
      .next(navState)
      .call([workspaceClient, workspaceClient.updateCurrentContext], WorkspaceId("ws-1"), {
        workspaceId: WorkspaceId("ws-1"),
        mainContentType: "file",
        mainContentId: "src/main.ts",
        mainContentPath: "src/main.ts",
        mainContentUrl: undefined,
        lastUpdated: "2026-03-25T01:15:00.000Z",
      })
      .next()
      .put(clearCurrentlyViewed())
      .next()
      .isDone();
  });

  it("includes diffInfo when the main panel shows a tracked diff", () => {
    const navState = {
      mainPanel: {
        type: "file-tracking-diff",
        selectedFile: "src/main.ts",
        selectedChangeId: "change-1",
        selectedTrackedChange: {
          id: "change-1",
          file: "src/main.ts",
          relativePath: "src/main.ts",
          stage: ChangeStage.Staged,
          stats: {
            additions: 12,
            deletions: 4,
          },
          status: "added",
          attribution: {
            timestamp: 0,
          },
        },
      },
    } as const;

    testSaga(handlePanelChanged, setWorkspaceMainPanel("ws-1", "file-tracking-diff", navState.mainPanel))
      .next()
      .select(selectWorkspaceNavigationState.select, "ws-1")
      .next(navState)
      .call([workspaceClient, workspaceClient.updateCurrentContext], WorkspaceId("ws-1"), {
        workspaceId: WorkspaceId("ws-1"),
        mainContentType: "diff",
        mainContentId: "change-1",
        mainContentPath: "src/main.ts",
        mainContentUrl: undefined,
        diffInfo: {
          additions: 12,
          deletions: 4,
          isStaged: true,
          gitStatus: "added",
          changeType: "created",
        },
        lastUpdated: "2026-03-25T01:15:00.000Z",
      })
      .next()
      .put(clearCurrentlyViewed())
      .next()
      .isDone();
  });

  it("registers panel-change watchers including hydration", () => {
    const iterator = panelContextSaga();

    const first = iterator.next().value as any;
    const second = iterator.next().value as any;
    expect(first.type).toBe("FORK");
    expect(first.payload.args[0]).toBe(hydrateWorkspaceNavigation);
    expect(first.payload.args[1]).toBe(handlePanelChanged);
    expect(second.type).toBe("FORK");
  });
});