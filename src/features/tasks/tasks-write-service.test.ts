import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentType, NoteVisibility } from "$shared/types";
import type { Note, TaskStatus, WorkspaceTask } from "$shared/types";
import { NoteId, WorkspaceId } from "$shared/types/branded-ids";

// FAKE seam: appClient.tasks.* are stubbed so no mutation reaches the daemon.
// The service runs against the REAL configured store so optimistic dispatch and
// rollback across the notes + tasks slices are exercised end to end.
vi.mock("$lib/client", () => ({
  appClient: {
    tasks: {
      updateNoteStatus: vi.fn(() => Promise.resolve({ success: true })),
      createPrerequisite: vi.fn(() => Promise.resolve({ success: true })),
    },
  },
}));

import { appClient } from "$lib/client";
import { store as appStore } from "$store/renderer/store";
import { loadWorkspaceNotesSucceeded } from "$store/renderer/slices/workspace-notes/workspace-notes-slice";
import { loadWorkspaceTasksSucceeded } from "$store/renderer/slices/workspace-tasks/workspace-tasks-slice";
import { selectNoteById } from "$store/renderer/slices/workspace-notes/workspace-notes-selectors";
import { selectWorkspaceTasks } from "$store/renderer/slices/workspace-tasks/workspace-tasks-selectors";
import { createPrerequisiteTask, updateTaskNoteStatus } from "./tasks-write-service";

const tasksApi = appClient.tasks as unknown as Record<string, ReturnType<typeof vi.fn>>;
const WS = "ws-task-svc-1";

function makeTaskNote(id: string, status: TaskStatus): Note {
  const now = new Date().toISOString();
  return {
    id: NoteId(id),
    workspaceId: WorkspaceId(WS),
    title: "Task Title",
    content: "body",
    contentType: ContentType.Markdown,
    tags: [],
    isPinned: false,
    isArchived: false,
    visibility: NoteVisibility.Workspace,
    metadata: { task: { status } },
    createdAt: now,
    updatedAt: now,
  };
}

function makeTask(id: string, status: TaskStatus): WorkspaceTask {
  return { id, title: `Task ${id}`, status };
}

function seed(status: TaskStatus): void {
  appStore.dispatch(loadWorkspaceNotesSucceeded([WS], { [WS]: [makeTaskNote("t1", status)] }));
  appStore.dispatch(loadWorkspaceTasksSucceeded(WS, [makeTask("t1", status)]));
}

function noteStatus(): TaskStatus | undefined {
  return selectNoteById.select(appStore.state, WS, "t1")?.metadata?.task?.status;
}

function taskStatus(): TaskStatus | undefined {
  return selectWorkspaceTasks.select(appStore.state, WS).find((t) => t.id === "t1")?.status;
}

describe("tasksWriteService (fake seam, real store)", () => {
  beforeAll(() => {
    appStore.init();
  });
  beforeEach(() => {
    tasksApi.updateNoteStatus.mockResolvedValue({ success: true } as never);
    tasksApi.createPrerequisite.mockResolvedValue({ success: true } as never);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("applies the status optimistically to both slices and forwards task.updateNoteStatus", async () => {
    seed("not_started");

    await updateTaskNoteStatus(WS, "t1", "in_progress");

    expect(tasksApi.updateNoteStatus).toHaveBeenCalledWith("t1", "in_progress");
    expect(noteStatus()).toBe("in_progress");
    expect(taskStatus()).toBe("in_progress");
  });

  it("rolls both slices back to the prior status on failure", async () => {
    seed("not_started");
    tasksApi.updateNoteStatus.mockResolvedValueOnce({ success: false, error: "no" } as never);

    await updateTaskNoteStatus(WS, "t1", "complete");

    expect(tasksApi.updateNoteStatus).toHaveBeenCalledWith("t1", "complete");
    expect(noteStatus()).toBe("not_started");
    expect(taskStatus()).toBe("not_started");
  });

  it("createPrerequisiteTask forwards to the seam and returns the surfaced id", async () => {
    tasksApi.createPrerequisite.mockResolvedValueOnce({ success: true, id: "task-9" } as never);

    const id = await createPrerequisiteTask("dep-1", "Prereq title", {
      content: "body",
      status: "not_started",
    });

    expect(id).toBe("task-9");
    expect(tasksApi.createPrerequisite).toHaveBeenCalledWith("dep-1", "Prereq title", {
      content: "body",
      status: "not_started",
    });
  });

  it("createPrerequisiteTask returns undefined when the seam mutation fails", async () => {
    tasksApi.createPrerequisite.mockResolvedValueOnce({ success: false, error: "no" } as never);

    expect(await createPrerequisiteTask("dep-1", "Prereq title")).toBeUndefined();
  });
});
