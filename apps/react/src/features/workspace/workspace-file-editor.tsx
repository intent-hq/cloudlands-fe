import { CodeEditor } from '@/components/editor/code-editor';
import { CodeBlock } from '@/components/editor/code-block';
import { Button } from '@/components/ui/button';
import { store } from '@/store';
import { selectIsDarkTheme } from '@/store/theme/theme-selectors';
import { selectCodeFontFamilyCSS } from '@/store/user-preferences/user-preferences-selectors';
import { selectFileSaveState } from '@/store/files/files-selectors';
import { selectGitWriteContext } from '@/store/git/git-write-selectors';
import {
  updateFileContent,
  saveFileContentRequested,
} from '../../../../../src/store/renderer/slices/files/files-slice';
import type { FileContentEntry } from '../../../../../src/store/renderer/slices/files/files-types';
import { getLanguageFromPath } from '$lib/utils/file-utils';
import { m } from '$shared/paraglide/messages.js';
import { captureFileSaveAuthority } from './file-save-runtime';
import { canEditWorkspaceText } from './workspace-file-edit-policy';

export function WorkspaceFileEditor({
  workspaceId,
  path,
  entry,
  line,
}: {
  workspaceId: string;
  path: string;
  entry: Extract<FileContentEntry, { kind: 'editable-text' }>;
  line?: number;
}) {
  const dark = selectIsDarkTheme().value;
  const fontFamily = selectCodeFontFamilyCSS().value;
  const saveState = selectFileSaveState(workspaceId, path).value;
  const context = selectGitWriteContext(workspaceId).value;
  const authority = context
    ? captureFileSaveAuthority(workspaceId, path, entry.absolutePath ?? '')
    : null;
  const dirty = entry.localContent !== entry.originalContent;
  const editable = !!authority && !entry.truncated && canEditWorkspaceText(entry.originalContent);
  const bounded = canEditWorkspaceText(entry.localContent);
  const canSave = editable && bounded && dirty && !saveState.pending && !saveState.uncertain;
  const save = () => {
    if (
      !canSave ||
      captureFileSaveAuthority(workspaceId, path, entry.absolutePath ?? '') !== authority
    )
      return;
    store.dispatch(
      saveFileContentRequested(
        workspaceId,
        path,
        entry.absolutePath ?? '',
        { kind: 'editable-text', content: entry.localContent },
        { requestId: crypto.randomUUID(), authority: authority! },
      ),
    );
  };
  if (!editable)
    return (
      <div className="min-w-0" data-testid="workspace-file-content">
        <output>{m.workspace_fileEdit_readOnly_description()}</output>
        <CodeBlock
          code={entry.originalContent}
          language={getLanguageFromPath(path)}
          showLineNumbers
          noMargin
        />
      </div>
    );
  return (
    <div
      className="grid min-w-0 gap-3"
      data-testid="workspace-file-content"
      data-file-dirty={dirty}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={!canSave} data-testid="workspace-file-save">
          {saveState.pending
            ? m.workspace_fileEdit_saving_label()
            : m.workspace_fileEdit_save_label()}
        </Button>
        <output>
          {dirty
            ? m.workspace_fileEdit_unsaved_label()
            : saveState.saved
              ? m.workspace_fileEdit_saved_label()
              : ''}
        </output>
      </div>
      <p className="type-caption text-muted-foreground">
        {m.workspace_fileEdit_explicit_description()}
      </p>
      {saveState.uncertain && <p role="alert">{m.workspace_fileEdit_uncertain_error()}</p>}
      {saveState.error && <p role="alert">{saveState.error}</p>}
      {!bounded && <p role="alert">{m.workspace_fileEdit_readOnly_description()}</p>}
      <CodeEditor
        value={entry.localContent}
        path={`${workspaceId}/${path}`}
        language={getLanguageFromPath(path)}
        dark={dark}
        fontFamily={fontFamily}
        readOnly={!authority}
        line={line}
        onSave={save}
        onChange={(content) => {
          if (captureFileSaveAuthority(workspaceId, path, entry.absolutePath ?? '') === authority)
            store.dispatch(
              updateFileContent(
                workspaceId,
                path,
                { kind: 'editable-text', content },
                { autoSave: false },
              ),
            );
        }}
      />
    </div>
  );
}
