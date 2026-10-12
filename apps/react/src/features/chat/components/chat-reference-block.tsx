// Source: src/lib/components/chat/ChatReferenceBlock.svelte.
import type { MouseEvent } from 'react';
import { ArrowRightIcon, CodeIcon } from '@phosphor-icons/react';
import { CodeBlock } from '@/components/editor/code-block';
import { Button } from '@/components/ui/button';
import { parseSemanticId } from '$shared/types/notes-primitives';
import { m } from '$shared/paraglide/messages.js';

export interface ReferenceData {
  semanticId?: string;
  filePath?: string;
  description?: string;
  snapshot?: { code: string; filePath: string; languageId?: string };
}

export interface ChatReferenceBlockProps {
  reference: ReferenceData;
  /** Opens the current reference, optionally adjacent to the originating panel. */
  onOpenFile?: (detail: {
    path: string;
    line?: number;
    openInAdjacentPanel?: boolean;
    sourcePanelId?: string;
  }) => void;
}

export function ChatReferenceBlock({ reference, onOpenFile }: ChatReferenceBlockProps) {
  const parsedId = reference.semanticId ? parseSemanticId(reference.semanticId) : null;
  // An unrestricted filePath only interprets a trailing line anchor. Literal
  // hashes and symbol fragments remain part of the path, unlike semanticId.
  const lineMatch = reference.filePath?.match(/^(.+)#L(\d+)(?:-(\d+))?$/);
  const parsedFilePath = lineMatch
    ? { filePath: lineMatch[1], startLine: parseInt(lineMatch[2], 10) }
    : null;
  const filePath = parsedFilePath?.filePath || reference.filePath || parsedId?.filePath || '';
  const fileName =
    filePath.split('/').pop() || reference.semanticId || m.chat_messageContent_reference_fallback();
  // The explicit path's anchor wins. Clamp zero-based targets to a usable line.
  const startLine = parsedFilePath?.startLine ?? parsedId?.startLine;
  const line = startLine !== undefined ? Math.max(1, startLine) : undefined;
  const clickable = Boolean(filePath && onOpenFile);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (!filePath || !onOpenFile) return;
    const openInAdjacentPanel = event.metaKey || event.ctrlKey;
    const panelElement = (event.target as Element).closest('[data-panel-id]');
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    onOpenFile({ path: filePath, line, openInAdjacentPanel, sourcePanelId });
  }

  const header = (
    <>
      <CodeIcon
        size="0.75em"
        weight="regular"
        className="shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="type-body truncate font-medium">{fileName}</span>
      {filePath && filePath !== fileName && (
        <span className="type-caption min-w-0 flex-1 truncate text-muted-foreground">
          {filePath}
        </span>
      )}
    </>
  );

  return (
    <div className="ws-block-widget type-body my-2 overflow-hidden rounded-md border border-border bg-card text-foreground shadow-(--elevation-raised)">
      {clickable ? (
        <Button
          type="button"
          variant="plain"
          className="group flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset"
          onClick={handleClick}
          title={m.notes_referenceBlock_goToFile_tooltip()}
        >
          {header}
          <ArrowRightIcon
            size="0.75em"
            weight="regular"
            className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
            aria-hidden="true"
          />
        </Button>
      ) : (
        <div className="flex min-h-9 items-center gap-2 px-3 py-1.5">{header}</div>
      )}
      {reference.snapshot?.code && (
        <div className="border-t border-border">
          <CodeBlock
            code={reference.snapshot.code}
            language={reference.snapshot.languageId || 'plaintext'}
            showLineNumbers
            noBorder
            noMargin
          />
        </div>
      )}
    </div>
  );
}

export default ChatReferenceBlock;
