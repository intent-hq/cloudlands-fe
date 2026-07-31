import type { Task } from 'redux-saga';
import { call, cancel, delay, fork, put, spawn, take, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import { stripWorkspacePrefix } from '$lib/utils/file-utils';
import { m } from '$shared/paraglide/messages.js';
import { createFileRequested } from '../../app-layout/app-layout-slice';
import { selectFileExplorerState } from '../../file-explorer/file-explorer-selectors';
import { refreshDirectoryRequested } from '../../file-explorer/file-explorer-slice';
import {
  workspaceDeleted,
  workspaceUnmounted,
} from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { openWorkspaceFile } from '../../workspace-navigation/workspace-navigation-slice';
import { selectFileContentEntry } from '../files-selectors';
import {
  saveFileContentFailed,
  saveFileContentRequested,
  saveFileContentSucceeded,
  updateFileContent,
} from '../files-slice';

const logger = createLogger('FilesWriteSaga');
export const FILE_CONTENT_SAVE_DEBOUNCE_MS = 1500;

type SaveRequest = {
  workspaceId: string;
  path: string;
  absolutePath: string;
  content: string;
};
type SaveSlot = { workspaceId: string; task?: Task; pending?: SaveRequest; token: symbol };
type DebounceSlot = { workspaceId: string; task?: Task; token: symbol };
type CreateSlot = { workspaceId: string; task?: Task };

function saveKey(workspaceId: string, path: string): string {
  return `${workspaceId}::${path}`;
}

function* saveFileContentWorker(request: SaveRequest) {
  const { workspaceId, path, content } = request;
  try {
    const result: Awaited<ReturnType<typeof appClient.files.write>> = yield* call(
      [appClient.files, appClient.files.write],
      workspaceId,
      path,
      content,
    );
    if (result.success) {
      yield* put(saveFileContentSucceeded(workspaceId, path, content));
      return;
    }
    yield* put(
      saveFileContentFailed(
        workspaceId,
        path,
        result.error ?? m.fileExplorer_layout_saveFailed_error(),
      ),
    );
  } catch (error) {
    logger.error('Failed to save file content', error);
    const message = error instanceof Error ? error.message : String(error);
    yield* put(saveFileContentFailed(workspaceId, path, message));
  }
}

function* runSaveSlot(
  slots: Map<string, SaveSlot>,
  key: string,
  slot: SaveSlot,
  request: SaveRequest,
): SagaGenerator<void> {
  try {
    yield* call(saveFileContentWorker, request);
  } finally {
    if (slots.get(key) !== slot) return;
    const pending = slot.pending;
    slot.pending = undefined;
    if (!pending) {
      slots.delete(key);
      return;
    }
    const task = yield* spawn(runSaveSlot, slots, key, slot, pending);
    slot.task = task;
  }
}

function* queueSave(slots: Map<string, SaveSlot>, request: SaveRequest) {
  const key = saveKey(request.workspaceId, request.path);
  const existing = slots.get(key);
  if (existing?.task) {
    existing.pending = request;
    return;
  }
  const slot: SaveSlot = {
    workspaceId: request.workspaceId,
    token: Symbol(key),
  };
  slots.set(key, slot);
  slot.task = yield* spawn(runSaveSlot, slots, key, slot, request);
}

function* createFileWorker(workspaceId: string, folderPath: string, fileName: string) {
  const absoluteFilePath = `${folderPath}/${fileName}`;
  const explorer = yield* selectFileExplorerState.effect(workspaceId);
  const relativePath = stripWorkspacePrefix(absoluteFilePath, explorer.workspacePath);
  if (!explorer.workspacePath || !relativePath || relativePath === absoluteFilePath) {
    return;
  }
  try {
    const result: Awaited<ReturnType<typeof appClient.files.write>> = yield* call(
      [appClient.files, appClient.files.write],
      workspaceId,
      relativePath,
      '',
    );
    if (!result.success) return;
    yield* put(refreshDirectoryRequested(workspaceId, absoluteFilePath));
    yield* put(openWorkspaceFile(workspaceId, absoluteFilePath));
  } catch (error) {
    logger.error('Failed to create file', error);
  }
}

export function* filesWriteSaga() {
  const debounces = new Map<string, DebounceSlot>();
  const saves = new Map<string, SaveSlot>();
  const creates = new Map<symbol, CreateSlot>();
  try {
    while (true) {
      const action: ReturnType<
        | typeof createFileRequested
        | typeof saveFileContentRequested
        | typeof updateFileContent
        | typeof workspaceDeleted
        | typeof workspaceUnmounted
      > = yield* take([
        createFileRequested,
        saveFileContentRequested,
        updateFileContent,
        workspaceDeleted,
        workspaceUnmounted,
      ]);

      if (action.type === createFileRequested.type) {
        const [workspaceId, folderPath, fileName] = action.payload as [string, string, string];
        if (workspaceId && folderPath && fileName) {
          const key = Symbol(`${workspaceId}:${folderPath}/${fileName}`);
          creates.set(key, { workspaceId });
          const task = yield* spawn(function* () {
            try {
              yield* call(createFileWorker, workspaceId, folderPath, fileName);
            } finally {
              creates.delete(key);
            }
          });
          if (creates.has(key)) creates.set(key, { workspaceId, task });
        }
        continue;
      }

      if (action.type === updateFileContent.type) {
        const [workspaceId, path, content] = action.payload as [string, string, string];
        const entry = yield* selectFileContentEntry.effect(workspaceId, path);
        const absolutePath = entry?.absolutePath;
        if (!absolutePath) continue;
        const key = saveKey(workspaceId, path);
        const existing = debounces.get(key);
        if (existing?.task) yield* cancel(existing.task);
        const token = Symbol(key);
        debounces.set(key, { workspaceId, token });
        const task = yield* fork(function* () {
          try {
            yield* delay(FILE_CONTENT_SAVE_DEBOUNCE_MS);
            if (debounces.get(key)?.token !== token) return;
            debounces.delete(key);
            yield* put(saveFileContentRequested(workspaceId, path, absolutePath, content));
          } finally {
            if (debounces.get(key)?.token === token) debounces.delete(key);
          }
        });
        if (debounces.get(key)?.token === token) {
          debounces.set(key, { workspaceId, task, token });
        }
        continue;
      }

      if (action.type === saveFileContentRequested.type) {
        const [workspaceId, path, absolutePath, content] = action.payload as [
          string,
          string,
          string,
          string,
        ];
        const key = saveKey(workspaceId, path);
        const debounce = debounces.get(key);
        debounces.delete(key);
        if (debounce?.task) yield* cancel(debounce.task);
        yield* call(queueSave, saves, { workspaceId, path, absolutePath, content });
        continue;
      }

      const [workspaceId] = action.payload as [string];
      for (const [key, debounce] of debounces) {
        if (debounce.workspaceId !== workspaceId) continue;
        debounces.delete(key);
        if (debounce.task) yield* cancel(debounce.task);
      }
      for (const [key, save] of saves) {
        if (save.workspaceId !== workspaceId) continue;
        saves.delete(key);
        save.pending = undefined;
        if (save.task) yield* cancel(save.task);
      }
      for (const [key, create] of creates) {
        if (create.workspaceId !== workspaceId) continue;
        creates.delete(key);
        if (create.task) yield* cancel(create.task);
      }
    }
  } finally {
    for (const debounce of debounces.values()) {
      if (debounce.task) yield* cancel(debounce.task);
    }
    for (const save of saves.values()) {
      save.pending = undefined;
      if (save.task) yield* cancel(save.task);
    }
    for (const create of creates.values()) {
      if (create.task) yield* cancel(create.task);
    }
    debounces.clear();
    saves.clear();
    creates.clear();
  }
}
