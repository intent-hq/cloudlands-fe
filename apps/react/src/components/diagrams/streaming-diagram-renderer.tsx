import { useState } from 'react';
import type { DiagramPrimitive } from '$shared/types/notes-primitives';
import { m } from '$shared/paraglide/messages.js';
import { DiagramRenderer } from './diagram-renderer';
import './streaming-diagram-renderer.css';
export interface StreamingDiagramRendererProps {
  diagram: DiagramPrimitive | null;
  isStreaming?: boolean;
  source: string;
  sourceError?: string;
  viewResetKey?: string;
  onBindingClick?: (event: MouseEvent, binding: { type: string; target: string }) => void;
}
export function StreamingDiagramRenderer({
  diagram,
  isStreaming = false,
  source,
  sourceError,
  viewResetKey,
  onBindingClick,
}: StreamingDiagramRendererProps) {
  const [history, setHistory] = useState({
    source,
    key: viewResetKey,
    diagram,
    streaming: isStreaming,
    error: sourceError,
    lastGood: sourceError ? null : diagram,
    revision: 0,
  });
  let state = history;
  if (
    history.source !== source ||
    history.key !== viewResetKey ||
    history.diagram !== diagram ||
    history.streaming !== isStreaming ||
    history.error !== sourceError
  ) {
    const replaced = history.key !== viewResetKey || !source.startsWith(history.source);
    state = {
      source,
      key: viewResetKey,
      diagram,
      streaming: isStreaming,
      error: sourceError,
      lastGood:
        sourceError || (!isStreaming && !diagram)
          ? null
          : (diagram ?? (replaced ? null : history.lastGood)),
      revision: history.revision + (replaced ? 1 : 0),
    };
    setHistory(state);
  }
  const displayed = sourceError ? null : (diagram ?? (isStreaming ? state.lastGood : null));
  const failed = Boolean(sourceError) || (!isStreaming && !diagram);
  return (
    <div className="streaming-diagram" aria-busy={isStreaming} data-diagram-streaming={isStreaming}>
      {failed ? (
        <>
          <div className="diagram-feedback" role="alert">
            <strong>{m.markdown_mermaid_renderFailed_error()}</strong>
            <span>{m.diagram_renderer_error_description()}</span>
          </div>
          <pre className="diagram-source" aria-label={m.markdown_mermaid_viewSource_label()}>
            {source}
          </pre>
        </>
      ) : displayed ? (
        <DiagramRenderer
          key={state.revision}
          diagram={displayed}
          editable={false}
          viewResetKey={viewResetKey}
          onBindingClick={onBindingClick}
        />
      ) : (
        <output className="diagram-feedback">{m.ui_spinner_loading_ariaLabel()}</output>
      )}
    </div>
  );
}
export default StreamingDiagramRenderer;
