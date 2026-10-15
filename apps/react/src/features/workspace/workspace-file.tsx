import { WorkspaceFileEditor } from './workspace-file-editor';
import { workspaceFileBackSearch, type ConversationFileOrigin } from './workspace-file-origin';
import { Link } from '@tanstack/react-router';
import { useLayoutEffect, useRef } from 'react';
import { CodeBlock } from '@/components/editor/code-block';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/patterns/screen';
import { store } from '@/store';
import {
  selectFileContentEntry,
  selectFileReadContext,
  selectFileAbsolutePath,
} from '@/store/files/files-selectors';
import { loadFileContentRequested } from '../../../../../src/store/renderer/slices/files/files-slice';
import { getLanguageFromPath } from '$lib/utils/file-utils';
import { formatBytesBinary } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';
import { parseWorkspaceFileTarget } from './workspace-file-target';

export function WorkspaceFile({
  workspaceId,
  path,
  origin,
  line,
  noteId,
  query,
  fileQuery,
  attachmentId,
  attachmentAgentId,
}: {
  workspaceId: string;
  path: string;
  origin?: ConversationFileOrigin;
  line?: number;
  noteId?: string;
  query?: string;
  fileQuery?: string;
  attachmentId?: string;
  attachmentAgentId?: string;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const code = useRef<HTMLDivElement>(null);
  const authority = selectFileReadContext(
    workspaceId,
    attachmentId ? (attachmentAgentId ?? '') : undefined,
  );
  const absolutePath = selectFileAbsolutePath(workspaceId, path).value;
  const entry = selectFileContentEntry(workspaceId, path);
  const target = parseWorkspaceFileTarget(path);
  const current = authority.value ? entry.value : undefined;
  const settled = current && !current.loading;
  useLayoutEffect(() => {
    title.current?.focus();
  }, [path]);
  useLayoutEffect(() => {
    if (settled)
      (current.error && current.kind !== 'editable-text' ? retry.current : title.current)?.focus();
  }, [settled, current?.error, current?.kind]);
  useLayoutEffect(() => {
    if (settled && line) {
      code.current?.querySelectorAll('.code-line')[line - 1]?.scrollIntoView({ block: 'center' });
    }
  }, [settled, line]);
  return (
    <section className="grid min-w-0 gap-4" data-testid="workspace-file" data-file-path={path}>
      <Link
        to="/workspaces/$workspaceId"
        params={{ workspaceId }}
        search={workspaceFileBackSearch(workspaceId, origin, {
          note: noteId,
          q: query || undefined,
          fileQuery: fileQuery || undefined,
        })}
        className="w-fit text-muted-foreground hover:text-foreground"
      >
        {m.workspace_transfer_back_label()}
      </Link>
      <h2 ref={title} tabIndex={-1} className="type-heading-sm min-w-0 break-all">
        {path}
      </h2>
      {!target.valid ? (
        <p role="alert">{target.error}</p>
      ) : !authority.value ? (
        <p role="alert">{m.fileExplorer_layout_loadFailed_error()}</p>
      ) : !current || current.loading ? (
        <LoadingState label={m.workspace_noteVersionHistory_loading_label()} />
      ) : current.error && current.kind !== 'editable-text' ? (
        <>
          <p role="alert">{current.error}</p>
          <Button
            ref={retry}
            variant="outline"
            className="w-fit"
            onClick={() =>
              store.dispatch(
                loadFileContentRequested(
                  workspaceId,
                  path,
                  absolutePath,
                  attachmentId
                    ? {
                        readOnlyPreview: true,
                        attachment: { id: attachmentId, agentId: attachmentAgentId ?? '' },
                      }
                    : undefined,
                ),
              )
            }
          >
            {m.ui_combobox_retry_label()}
          </Button>
          {current.notFoundCandidates?.map((candidate) => (
            <Link
              key={candidate}
              to="/workspaces/$workspaceId"
              params={{ workspaceId }}
              search={{
                file: candidate,
                fileOrigin: origin ? JSON.stringify(origin) : undefined,
                note: noteId,
                q: query || undefined,
                line,
                fileQuery: fileQuery || undefined,
              }}
              className="break-all underline"
            >
              {candidate}
            </Link>
          ))}
        </>
      ) : current.kind === 'read-only-text' ? (
        <div
          className="min-w-0"
          data-testid="workspace-file-content"
          data-preview-bytes={current.bytesRead}
          data-total-bytes={current.totalBytes}
          data-truncated={current.truncated}
        >
          <output className="block">
            {current.truncated
              ? m.files_read_partialPreview_label({
                  shown: formatBytesBinary(current.bytesRead),
                  total: formatBytesBinary(current.totalBytes),
                })
              : m.files_read_previewReadOnly_error()}
          </output>
          <pre
            className="type-code max-h-96 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-muted/50 p-3"
            data-testid="workspace-file-prefix"
          >
            {current.originalContent}
          </pre>
        </div>
      ) : current.kind !== 'editable-text' ? (
        <p>{m.editor_fileViewer_binary_label()}</p>
      ) : !attachmentId ? (
        <WorkspaceFileEditor workspaceId={workspaceId} path={path} entry={current} line={line} />
      ) : (
        <div ref={code} className="min-w-0" data-testid="workspace-file-content">
          <CodeBlock
            code={current.originalContent}
            language={getLanguageFromPath(path)}
            showLineNumbers
            noMargin
            highlightLines={line ? [line] : []}
          />
        </div>
      )}
    </section>
  );
}
