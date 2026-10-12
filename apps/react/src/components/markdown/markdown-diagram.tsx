import { useMemo } from 'react';
import { NotesPrimitivesSerializer } from '$lib/utils/notes-primitives-serializer';
import { parseIncrementalDiagramJson } from '$lib/utils/incrementalDiagramJson';
import { noteUrl } from '$shared/constants/intent-links';
import { WorkspaceId } from '$shared/types/branded-ids';
import { DiagramPresentation } from '../diagrams/diagram-presentation';
import { StreamingDiagramRenderer } from '../diagrams/streaming-diagram-renderer';
import { MermaidRenderer } from './mermaid-renderer';

interface OpenOptions {
  openInAdjacentPanel: boolean;
  sourcePanelId: string | undefined;
}

export interface MarkdownDiagramProps {
  kind: 'mermaid' | 'diagram';
  source: string;
  workspaceId?: string;
  /** The host owns file navigation; no navigation runtime is installed by this view. */
  onOpenFile: (workspaceId: string, filePath: string, options: OpenOptions) => void;
  /** Preserve the native event and workspace context for the host's link handler. */
  onOpenLink: (
    url: string,
    options: OpenOptions & { workspaceId: WorkspaceId; event: MouseEvent },
  ) => void | Promise<unknown>;
}

export function MarkdownDiagram({
  kind,
  source,
  workspaceId,
  onOpenFile,
  onOpenLink,
}: MarkdownDiagramProps) {
  const serializer = useMemo(() => new NotesPrimitivesSerializer(), []);
  const projection = useMemo(() => {
    if (kind === 'mermaid') return null;
    const parsed = serializer.parseMarkdown(`\`\`\`ws-block:diagram\n${source}\n\`\`\``)[0];
    const normalized =
      parsed?.primitive.type === 'diagram' ? JSON.stringify(parsed.primitive) : source;
    return parseIncrementalDiagramJson(normalized, true);
  }, [kind, source, serializer]);

  function handleBindingClick(event: MouseEvent, binding: { type: string; target: string }) {
    if (!workspaceId || !binding.target) return;
    const options = {
      openInAdjacentPanel: event.metaKey || event.ctrlKey,
      sourcePanelId:
        (event.target as Element)?.closest('[data-panel-id]')?.getAttribute('data-panel-id') ??
        undefined,
    };
    if (binding.type === 'file') onOpenFile(workspaceId, binding.target, options);
    else if (binding.type === 'note')
      void onOpenLink(noteUrl(binding.target, workspaceId), {
        ...options,
        workspaceId: WorkspaceId(workspaceId),
        event,
      });
  }

  return kind === 'mermaid' ? (
    <DiagramPresentation key="mermaid" kind="mermaid" rendererOwnsActions>
      <MermaidRenderer code={source} showExportButton />
    </DiagramPresentation>
  ) : (
    <DiagramPresentation key="diagram" kind="custom">
      <StreamingDiagramRenderer
        diagram={projection?.diagram ?? null}
        source={source}
        sourceError={projection?.error}
        onBindingClick={handleBindingClick}
      />
    </DiagramPresentation>
  );
}
