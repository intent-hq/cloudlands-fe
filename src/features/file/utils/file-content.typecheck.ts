import type { FilesClient } from '$lib/client/app-client';
import type { LiveFilesClient } from '$lib/client/live/live-files-client';
import {
  deleteFileRequested,
  loadFileContentSucceeded,
  restoreFileContentRequested,
  saveFileContentRequested,
  updateFileContent,
} from '$store/renderer/slices/files/files-slice';
import type {
  FileContentEntry,
  PreviewOnly,
  RestorableSnapshot,
} from '$store/renderer/slices/files/files-types';
import { editableText, fileSnapshot } from './file-content';

declare const client: FilesClient;
declare const live: LiveFilesClient;
declare const preview: PreviewOnly;
declare const entry: FileContentEntry;
declare const binary: RestorableSnapshot;

function typecheckFileMutations(): void {
  const empty = editableText('');
  void saveFileContentRequested('ws', 'file', '/repo/file', empty);
  void updateFileContent('ws', 'file', empty);
  void client.write('ws', 'file', empty);
  void live.write('ws', 'file', binary);
  void restoreFileContentRequested('ws', 'file', '/repo/file', binary);
  void loadFileContentSucceeded('ws', 'file', '/repo/file', preview);

  // @ts-expect-error preview-only contents cannot cross the client write boundary
  void client.write('ws', 'file', preview);
  // @ts-expect-error the concrete production client also rejects preview-only contents
  void live.write('ws', 'file', preview);
  // @ts-expect-error Save requires editable text, never a preview placeholder
  void saveFileContentRequested('ws', 'file', '/repo/file', preview);
  // @ts-expect-error Undo requires a restorable snapshot, never a preview placeholder
  void restoreFileContentRequested('ws', 'file', '/repo/file', preview);
  // @ts-expect-error a readable binary snapshot is not editable text
  void saveFileContentRequested('ws', 'file', '/repo/file', binary);
  // @ts-expect-error a binary snapshot cannot become an editor update
  void updateFileContent('ws', 'file', binary);
  // @ts-expect-error raw nullable cache contents are not a snapshot
  void restoreFileContentRequested('ws', 'file', '/repo/file', entry.localContent);
  // @ts-expect-error a cache entry has not been narrowed to writable content
  void client.write('ws', 'file', entry);
  // @ts-expect-error a caller must explicitly capture a snapshot before deleting
  void deleteFileRequested('ws', 'file', { absolutePath: '/repo/file', snapshot: preview });

  const snapshot = fileSnapshot(entry);
  // @ts-expect-error a missing snapshot must be ruled out before Undo
  void restoreFileContentRequested('ws', 'file', '/repo/file', snapshot);
  if (snapshot) void restoreFileContentRequested('ws', 'file', '/repo/file', snapshot);
  if (entry.kind === 'editable-text') {
    void saveFileContentRequested('ws', 'file', '/repo/file', editableText(entry.localContent));
  }
  if (entry.kind === 'preview-only') {
    // @ts-expect-error a preview has no actual text to admit as an edit
    void editableText(entry.localContent);
  }
}

void typecheckFileMutations;
