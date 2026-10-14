import { Link } from '@tanstack/react-router';
import { useLayoutEffect, useRef } from 'react';
import { CodeBlock } from '@/components/editor/code-block';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/patterns/screen';
import { store } from '@/store';
import { selectFileContentEntry } from '@/store/files/files-selectors';
import { selectAdmittedWorkspaceReadContext } from '@/store/workspace-lifecycle/workspace-lifecycle-selectors';
import { loadFileContentRequested } from '../../../../../src/store/renderer/slices/files/files-slice';
import { getLanguageFromPath } from '$lib/utils/file-utils';
import { m } from '$shared/paraglide/messages.js';
import { parseWorkspaceFileTarget } from './workspace-file-target';

export function WorkspaceFile({
  workspaceId,
  path,
  line,
  noteId,
  query,
  fileQuery,
}: {
  workspaceId: string;
  path: string;
  line?: number;
  noteId?: string;
  query?: string;
  fileQuery?: string;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const code = useRef<HTMLDivElement>(null);
  const authority = selectAdmittedWorkspaceReadContext(workspaceId);
  const entry = selectFileContentEntry(workspaceId, path);
  const target = parseWorkspaceFileTarget(path);
  const current = authority.value ? entry.value : undefined;
  const settled = current && !current.loading;
  useLayoutEffect(() => {
    title.current?.focus();
  }, [path]);
  useLayoutEffect(() => {
    if (settled) (current.error ? retry.current : title.current)?.focus();
  }, [settled, current?.error]);
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
        search={{ note: noteId, q: query || undefined, fileQuery: fileQuery || undefined }}
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
      ) : current.error ? (
        <>
          <p role="alert">{current.error}</p>
          <Button
            ref={retry}
            variant="outline"
            className="w-fit"
            onClick={() => store.dispatch(loadFileContentRequested(workspaceId, path, ''))}
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
      ) : current.kind !== 'editable-text' ? (
        <p>{m.editor_fileViewer_binary_label()}</p>
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
