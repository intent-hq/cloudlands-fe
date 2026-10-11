// Source: src/lib/components/markdown/MermaidRenderer.svelte.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type Ref,
} from 'react';
import { CornersOutIcon, CodeIcon, UserIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { MediaLightbox } from '@/components/ui/media-lightbox';
import { ZoomPanViewport, type ZoomPanViewportHandle } from '@/components/ui/zoom-pan-viewport';
import { DiagramActionsMenu } from '@/components/diagrams/diagram-actions-menu';
import { applyMermaidTerminalGaps } from '$lib/components/markdown/mermaid-path-geometry';
import { m } from '$shared/paraglide/messages.js';
import {
  createMermaidRendererRuntime,
  initialMermaidSnapshot,
  type MermaidRendererRuntime,
} from './mermaid-renderer-runtime';
import { decodeMermaidSource } from './mermaid-source';
import './mermaid-renderer.css';

export type MermaidRenderState = 'pending' | 'empty' | 'rendered' | 'error';

export interface MermaidRendererProps {
  code: string;
  isStreaming?: boolean;
  className?: string;
  showExpandButton?: boolean;
  showSourceButton?: boolean;
  showExportButton?: boolean;
  showSource?: boolean;
  /** React counterpart of the source's bind:showSource. */
  onShowSourceChange?: (showSource: boolean) => void;
  onRenderStateChange?: (state: MermaidRenderState) => void;
  ref?: Ref<HTMLDivElement>;
}

const fontStyle = { '--mermaid-font-family': 'var(--font-ui)' } as CSSProperties;

export function MermaidRenderer({
  code,
  isStreaming = false,
  className = '',
  showExpandButton = true,
  showSourceButton = true,
  showExportButton = false,
  showSource = false,
  onShowSourceChange,
  onRenderStateChange,
  ref,
}: MermaidRendererProps) {
  const rendererElement = useRef<HTMLDivElement>(null);
  const actorIconTemplateElement = useRef<HTMLSpanElement>(null);
  const fullscreenDiagramElement = useRef<HTMLDivElement>(null);
  const zoomPanViewport = useRef<ZoomPanViewportHandle>(null);
  const runtime = useRef<MermaidRendererRuntime | null>(null);
  const [snapshot, setSnapshot] = useState(initialMermaidSnapshot);
  const [isFullscreen, setFullscreen] = useState(false);
  const [fullscreenSvg, setFullscreenSvg] = useState('');
  const [fullscreenOpenerElement, setFullscreenOpenerElement] = useState<HTMLElement | null>(null);
  const [exportContainer, setExportContainer] = useState<HTMLDivElement | null>(null);
  const terminalGapFrame = useRef<number | undefined>(undefined);
  const [sourceVisibility, setSourceVisibility] = useState({ prop: showSource, value: showSource });
  if (sourceVisibility.prop !== showSource) {
    setSourceVisibility({ prop: showSource, value: showSource });
  }
  const sourceVisible = sourceVisibility.prop !== showSource ? showSource : sourceVisibility.value;
  const { renderedSvg, error, activeGeneration, settledGeneration } = snapshot;
  const decodedSource = useMemo(() => decodeMermaidSource(code), [code]);
  // Postprocessing mutates the live SVG. Keep the HTML prop stable during state,
  // source-disclosure and fullscreen updates so React never replaces those repairs.
  const renderedHtml = useMemo(() => ({ __html: renderedSvg }), [renderedSvg]);
  const fullscreenHtml = useMemo(() => ({ __html: fullscreenSvg }), [fullscreenSvg]);

  const setRendererElement = useCallback(
    (element: HTMLDivElement | null) => {
      rendererElement.current = element;
      setExportContainer(element);
      if (typeof ref === 'function') return ref(element);
      if (ref) ref.current = element;
    },
    [ref],
  );

  useLayoutEffect(() => {
    const renderer = rendererElement.current;
    const icon = actorIconTemplateElement.current;
    if (!renderer || !icon) return;
    const mountedRuntime = createMermaidRendererRuntime(renderer, icon, setSnapshot);
    runtime.current = mountedRuntime;
    return () => {
      mountedRuntime.dispose();
      if (runtime.current === mountedRuntime) runtime.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    runtime.current?.update(code, isStreaming);
  }, [code, isStreaming]);
  useLayoutEffect(() => {
    runtime.current?.committed(snapshot.revision);
  }, [snapshot]);
  useEffect(
    () => () => {
      if (terminalGapFrame.current !== undefined) cancelAnimationFrame(terminalGapFrame.current);
    },
    [],
  );

  const renderState: MermaidRenderState = error
    ? 'error'
    : renderedSvg
      ? 'rendered'
      : !code?.trim() && !isStreaming
        ? 'empty'
        : 'pending';
  useEffect(() => {
    onRenderStateChange?.(renderState);
  }, [onRenderStateChange, renderState]);

  function openFullscreen(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    event.preventDefault();
    setFullscreenOpenerElement(event.currentTarget);
    // Avoid preserving an editor DOM selection across the portaled lightbox.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setFullscreenSvg(
      rendererElement.current?.querySelector<SVGSVGElement>('.mermaid-svg svg')?.outerHTML ??
        renderedSvg,
    );
    setFullscreen(true);
  }
  function toggleSource(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    event.preventDefault();
    const next = !sourceVisible;
    setSourceVisibility({ prop: showSource, value: next });
    onShowSourceChange?.(next);
  }
  function closeFullscreen() {
    setFullscreen(false);
    setFullscreenSvg('');
  }
  function handleFullscreenKeydown(event: KeyboardEvent) {
    // The viewport may already have consumed a bubbling zoom key.
    if (!event.defaultPrevented) zoomPanViewport.current?.handleKeydown(event);
  }
  const refreshFullscreenTerminalGaps = useCallback(() => {
    if (terminalGapFrame.current !== undefined) cancelAnimationFrame(terminalGapFrame.current);
    terminalGapFrame.current = requestAnimationFrame(() => {
      terminalGapFrame.current = undefined;
      const svg = fullscreenDiagramElement.current?.querySelector<SVGSVGElement>('svg');
      if (svg) applyMermaidTerminalGaps(svg);
    });
  }, []);

  return (
    <>
      <div
        ref={setRendererElement}
        className={`mermaid-renderer mermaid-react ${renderedSvg ? 'has-diagram' : ''} ${className}`}
        data-render-generation={activeGeneration}
        data-render-settled-generation={settledGeneration}
        data-render-settled={activeGeneration > 0 && settledGeneration === activeGeneration}
        style={fontStyle}
      >
        <span
          className="mermaid-actor-icon-template mermaid-react"
          ref={actorIconTemplateElement}
          aria-hidden="true"
        >
          <UserIcon size={30} weight="light" />
        </span>
        {error ? (
          <div className="mermaid-error mermaid-react">
            <div className="error-feedback mermaid-react" role="alert">
              <strong className="mermaid-react">{m.markdown_mermaid_renderFailed_error()}</strong>
              <p className="mermaid-react">{m.markdown_mermaid_invalid_description()}</p>
            </div>
            <details className="error-details mermaid-react">
              <summary className="mermaid-react">{m.markdown_mermaid_errorDetails_label()}</summary>
              <pre className="error-message mermaid-react">{error}</pre>
              <strong className="mermaid-react">{m.markdown_mermaid_viewSource_label()}</strong>
              <pre className="error-source-code mermaid-react">{decodedSource}</pre>
            </details>
          </div>
        ) : renderedSvg ? (
          <>
            <div className="mermaid-svg-container mermaid-react">
              <div
                className={`mermaid-svg-viewport mermaid-react ${!showSourceButton && !showExpandButton && !showExportButton ? 'without-actions' : ''}`}
              >
                <div
                  className="mermaid-svg mermaid-presentation mermaid-react"
                  dangerouslySetInnerHTML={renderedHtml}
                />
              </div>
              {(showSourceButton || showExpandButton || showExportButton) && (
                <div
                  className={`mermaid-actions mermaid-react ${showExportButton ? 'with-export' : ''}`}
                  role="toolbar"
                  aria-label={m.markdown_mermaid_actions_ariaLabel()}
                >
                  {showSourceButton && (
                    <Button
                      variant="ghost"
                      size="icon-compact"
                      iconOnly
                      className="mermaid-action-button"
                      onClick={toggleSource}
                      aria-pressed={sourceVisible}
                      aria-label={m.markdown_mermaid_viewSource_label()}
                      tooltip={m.markdown_mermaid_viewSource_label()}
                    >
                      <CodeIcon size="0.875em" aria-hidden="true" />
                    </Button>
                  )}
                  {showExpandButton && (
                    <Button
                      variant="ghost"
                      size="icon-compact"
                      iconOnly
                      className="mermaid-action-button expand-button"
                      onClick={openFullscreen}
                      aria-label={m.markdown_mermaid_expand_ariaLabel()}
                      tooltip={m.markdown_mermaid_expand_tooltip()}
                    >
                      <CornersOutIcon size="0.875em" aria-hidden="true" />
                    </Button>
                  )}
                  {showExportButton && (
                    <DiagramActionsMenu container={exportContainer ?? undefined} compactTrigger />
                  )}
                </div>
              )}
            </div>
            {sourceVisible && (
              <section
                className="mermaid-source mermaid-react"
                aria-label={m.markdown_mermaid_viewSource_label()}
              >
                <pre className="mermaid-react">{decodedSource}</pre>
              </section>
            )}
          </>
        ) : !code?.trim() && !isStreaming ? (
          <output className="mermaid-empty mermaid-react">
            <strong className="mermaid-react">{m.markdown_mermaid_noCode_label()}</strong>
            <span className="mermaid-react">{m.markdown_mermaid_noCode_description()}</span>
          </output>
        ) : (
          <output className="mermaid-loading mermaid-react">
            {m.ui_spinner_loading_ariaLabel()}
          </output>
        )}
      </div>
      <MediaLightbox
        open={isFullscreen}
        onOpenChange={setFullscreen}
        ariaLabel={m.markdown_mermaid_fullscreenView_ariaLabel()}
        closeLabel={m.markdown_mermaid_closeFullscreen_ariaLabel()}
        onClose={closeFullscreen}
        openerElement={fullscreenOpenerElement}
        onKeydown={handleFullscreenKeydown}
      >
        <div
          className="fullscreen-surface mermaid-react h-[90vh] w-[90vw] overflow-hidden rounded-lg shadow-2xl"
          data-media-lightbox-content=""
        >
          <ZoomPanViewport ref={zoomPanViewport} onScaleChange={refreshFullscreenTerminalGaps}>
            <div
              ref={fullscreenDiagramElement}
              className="fullscreen-diagram mermaid-presentation mermaid-react"
              style={fontStyle}
              dangerouslySetInnerHTML={fullscreenHtml}
            />
          </ZoomPanViewport>
        </div>
      </MediaLightbox>
    </>
  );
}

export default MermaidRenderer;
