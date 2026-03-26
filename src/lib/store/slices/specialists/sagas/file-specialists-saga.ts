import { call, put, select, takeEvery } from "typed-redux-saga";
import { getItems } from "$lib/store/utils/collection-utils";
import { SPECIALISTS_CHANNELS } from "$shared/ipc/channels";
import { exportBuiltinToFile, saveFileSpecialist, deleteFileSpecialist, openSpecialistsFolder, loadFileSpecialists, setFileSpecialists, setFileSpecialistsLoaded, type FileSpecialist, type SpecialistsState, } from "../specialists-slice";
function* reloadFileSpecialists() {
    try {
        if (typeof window !== "undefined" && window.electronAPI) {
            const result: any = yield* call([window.electronAPI, window.electronAPI.invoke], SPECIALISTS_CHANNELS.LIST_FILES, {});
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
                        source: 'file' as const,
                    };
                });
                yield* put(setFileSpecialists(fileSpecs));
                if (errors.length > 0) {
                }
            }
        }
    }
    catch (error) {
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
    catch (error) {
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
    catch (error) {
    }
}
function* handleDeleteFileSpecialist(action: ReturnType<typeof deleteFileSpecialist>) {
    const [specialistId] = action.payload;
    try {
        if (typeof window !== "undefined" && window.electronAPI) {
            const result: any = yield* call([window.electronAPI, window.electronAPI.invoke], SPECIALISTS_CHANNELS.DELETE_FILE, { id: specialistId });
            if (result?.success) {
                yield* call(reloadFileSpecialists);
            }
            else if (result?.error) {
            }
        }
    }
    catch (error) {
    }
}
function* handleOpenFolder() {
    try {
        if (typeof window !== "undefined" && window.electronAPI) {
            yield* call([window.electronAPI, window.electronAPI.invoke], SPECIALISTS_CHANNELS.OPEN_FOLDER, {});
        }
    }
    catch (error) {
    }
}
export function* fileSpecialistsSaga() {
    yield* takeEvery(exportBuiltinToFile, handleExportBuiltin);
    yield* takeEvery(saveFileSpecialist, handleSaveFileSpecialist);
    yield* takeEvery(deleteFileSpecialist, handleDeleteFileSpecialist);
    yield* takeEvery(openSpecialistsFolder, handleOpenFolder);
    yield* takeEvery(loadFileSpecialists, reloadFileSpecialists);
}
