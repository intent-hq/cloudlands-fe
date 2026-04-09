import { call, delay, fork, put, select, takeEvery } from "typed-redux-saga";
import { getItems } from "$lib/store/utils/collection-utils";
import { SPECIALISTS_CHANNELS } from "$shared/ipc/channels";
import { selectActiveWorkspace, selectWorkspaceById } from "$lib/store/slices/workspace/workspace-selectors";
import { workspaceMounted } from "$lib/store/slices/workspace-lifecycle/workspace-lifecycle-slice";
import { takeEveryFromElectronChannel, takeEveryFromWindowEvent } from "$lib/store/utils/ipc-channel";
import {
    exportBuiltinToFile,
    saveFileSpecialist,
    deleteFileSpecialist,
    openSpecialistsFolder,
    loadFileSpecialists,
    setFileSpecialists,
    setFileSpecialistsLoaded,
    type FileSpecialist,
    type SpecialistsState,
} from "../specialists-slice";

import type { Workspace } from "$shared/types";

function workspaceToPath(workspace: Workspace | undefined): string | undefined {
    return workspace?.worktreePath ?? workspace?.repositoryPath ?? workspace?.path;
}

function getActiveWorkspacePath(state: any): string | undefined {
    const workspace = selectActiveWorkspace.select(state);
    return workspaceToPath(workspace);
}

/**
 * Resolve workspace path, preferring a specific workspace ID when available.
 * This avoids a race where workspaceMounted fires before setActiveWorkspaceId
 * has been processed (the latter runs in a Svelte $effect).
 */
function getWorkspacePathForId(state: any, wsId?: string): string | undefined {
    if (wsId) {
        const ws = selectWorkspaceById.select(state, wsId);
        if (ws) return workspaceToPath(ws);
    }
    // Fallback to active workspace (for calls without a specific wsId)
    return getActiveWorkspacePath(state);
}

function* reloadFileSpecialists(wsId?: string) {
    try {
        if (typeof window !== "undefined" && window.electronAPI) {
            const workspacePath: string | undefined = yield* select(
                (state: any) => getWorkspacePathForId(state, wsId),
            );
            const result: any = yield* call(
                [window.electronAPI, window.electronAPI.invoke],
                SPECIALISTS_CHANNELS.LIST_FILES,
                { workspacePath },
            );
            if (result?.success && result.data) {
                const { specialists, errors } = result.data;
                // Get current state to preserve existing codingAgent values
                const state: SpecialistsState = yield* select((s: any) => s.specialists);
                const previousFileSpecialistsById = new Map(getItems(state.fileSpecialists).map((fs) => [fs.id, fs]));
                const fileSpecs: FileSpecialist[] = specialists.map((s: any) => {
                    const previous = previousFileSpecialistsById.get(s.id);
                    // Preserve existing codingAgent if frontmatter doesn't provide one (including empty strings)
                    const codingAgent = s.frontmatter.codingAgent || previous?.codingAgent;
                    return {
                        id: s.id,
                        name: s.frontmatter.name,
                        description: s.frontmatter.description,
                        codingAgent,
                        model: s.frontmatter.model || '',
                        modelTier: s.frontmatter.modelTier,
                        behaviorPrompt: s.behaviorPrompt,
                        roleReminder: s.frontmatter.roleReminder,
                        filePath: s.filePath,
                        source: s.source,
                    };
                });
                yield* put(setFileSpecialists(fileSpecs));
                if (errors.length > 0) {
                }
            }
        }
    }
    catch {
    }
    finally {
        yield* put(setFileSpecialistsLoaded(true));
    }
}
function* handleExportBuiltin(action: ReturnType<typeof exportBuiltinToFile>) {
    const [specialistId] = action.payload;
    try {
        if (typeof window !== "undefined" && window.electronAPI) {
            const result: any = yield* call([window.electronAPI, window.electronAPI.invoke], SPECIALISTS_CHANNELS.EXPORT_BUILTIN, { id: specialistId });
            if (result?.success) {
                yield* call(reloadFileSpecialists);
            }
            else if (result?.error) {
            }
        }
    }
    catch {
    }
}
function* handleSaveFileSpecialist(action: ReturnType<typeof saveFileSpecialist>) {
    const [specialist] = action.payload;
    try {
        if (typeof window !== "undefined" && window.electronAPI) {
            const result: any = yield* call([window.electronAPI, window.electronAPI.invoke], SPECIALISTS_CHANNELS.WRITE_FILE, specialist);
            if (result?.success) {
                yield* call(reloadFileSpecialists);
            }
            else if (result?.error) {
            }
        }
    }
    catch {
    }
}
function* handleDeleteFileSpecialist(action: ReturnType<typeof deleteFileSpecialist>) {
    const [specialist] = action.payload;
    try {
        if (typeof window !== "undefined" && window.electronAPI) {
            const result: any = yield* call(
                [window.electronAPI, window.electronAPI.invoke],
                SPECIALISTS_CHANNELS.DELETE_FILE,
                specialist,
            );
            if (result?.success) {
                yield* call(reloadFileSpecialists);
            }
            else if (result?.error) {
            }
        }
    }
    catch {
    }
}
function* handleOpenFolder() {
    try {
        if (typeof window !== "undefined" && window.electronAPI) {
            yield* call([window.electronAPI, window.electronAPI.invoke], SPECIALISTS_CHANNELS.OPEN_FOLDER, {});
        }
    }
    catch {
    }
}
/**
 * Watch for specialist file changes pushed from the main process file watcher.
 * When files are added/changed/removed externally, the main process sends
 * 'specialists:files-changed' and we reload the specialist list.
 */
function* watchSpecialistFilesChanged() {
    yield* takeEveryFromElectronChannel<Record<string, never>>(
        "specialists:files-changed",
        function* () {
            const activeWorkspace: Workspace | undefined = yield* select(selectActiveWorkspace.select);
            const wsId = activeWorkspace?.id;
            yield* call(reloadFileSpecialists, wsId);
        },
    );
}

type FileChangedDetail = {
    workspaceId: string;
    files: string[];
    type: string;
};

/**
 * Watch for file:changed browser events emitted by workspace-content-file-manager.
 * When specialist files (.augment/specialists/*.md) are saved, reload the specialist list.
 */
function* watchFileChangesForSpecialists() {
    yield* takeEveryFromWindowEvent<FileChangedDetail>(
        "file:changed",
        function* (detail) {
            const specialistFiles = detail.files?.filter(
                (f: string) => f.includes('.augment/specialists/') && f.endsWith('.md'),
            );
            if (specialistFiles && specialistFiles.length > 0) {
                yield* delay(100); // Wait for atomic write (temp → rename) to complete
                yield* call(reloadFileSpecialists, detail.workspaceId);
            }
        },
    );
}

function* handleWorkspaceMounted(action: ReturnType<typeof workspaceMounted>) {
    const [wsId] = action.payload;
    yield* call(reloadFileSpecialists, wsId);
}

export function* fileSpecialistsSaga() {
    yield* takeEvery(exportBuiltinToFile, handleExportBuiltin);
    yield* takeEvery(saveFileSpecialist, handleSaveFileSpecialist);
    yield* takeEvery(deleteFileSpecialist, handleDeleteFileSpecialist);
    yield* takeEvery(openSpecialistsFolder, handleOpenFolder);
    yield* takeEvery(loadFileSpecialists, reloadFileSpecialists);
    yield* takeEvery(workspaceMounted, handleWorkspaceMounted);
    yield* fork(watchSpecialistFilesChanged);
    yield* fork(watchFileChangesForSpecialists);
}
