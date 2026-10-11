import { useCallback, useLayoutEffect, useState, type CSSProperties } from 'react';
import { CornersInIcon, CornersOutIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { EDGE_LABEL_STYLE } from '$lib/components/diagrams/types';
import { m } from '$shared/paraglide/messages.js';
import { createDiagramRenderer, type DiagramRendererProps } from './diagram-renderer-model';
import { DiagramNodeHTML } from './diagram-node-html';
import { DiagramEdge } from './diagram-edge';
import { DiagramGroup } from './diagram-group';
import { DiagramControls } from './diagram-controls';
import { DiagramPaint, DiagramScenePresence } from './diagram-scene-presence';
import './diagram-renderer.css';
export type { DiagramRendererProps } from './diagram-renderer-model';

export function DiagramRenderer(props: DiagramRendererProps) {
  const [model] = useState(() => createDiagramRenderer(props));
  useLayoutEffect(() => {
    model.update(props);
  }, [model, props]);
  useLayoutEffect(() => model.mount(), [model]);
  const rendererRef = useCallback(
    (el: HTMLDivElement | null) => {
      model.setRenderer(el);
    },
    [model],
  );
  const scrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      model.setScrollContainer(el);
    },
    [model],
  );
  const view = {
    revision: model.revision.value,
    diagram: model.diagram.value,
    automaticallyFitState: model.automaticallyFitState.value,
    layout: model.layout.value,
    hoveredNodeId: model.hoveredNodeId.value,
    connectedEdgeIds: model.connectedEdgeIds.value,
    hoveredGroupId: model.hoveredGroupId.value,
    groupEdgeIds: model.groupEdgeIds.value,
    hasStateHighlighting: model.hasStateHighlighting.value,
    highlightedEdgeSet: model.highlightedEdgeSet.value,
    connectedNodeIds: model.connectedNodeIds.value,
    groupNodeIds: model.groupNodeIds.value,
    highlightedNodeSet: model.highlightedNodeSet.value,
    renderedEdges: model.renderedEdges.value,
    renderedLabelPositions: model.renderedLabelPositions.value,
    usesCompactPresentation: model.usesCompactPresentation.value,
    fitToWidth: model.fitToWidth.value,
    motionPhase: model.motionPhase.value,
    resizing: model.resizing.value,
    intrinsicWidth: model.intrinsicWidth.value,
    diagramSettled: model.diagramSettled.value,
    currentStateId: model.currentStateId.value,
    stepViewportActive: model.stepViewportActive.value,
    drawingOverflows: model.drawingOverflows.value,
    stateFrameHeight: model.stateFrameHeight.value,
    windowHeight: model.windowHeight.value,
    layoutError: model.layoutError.value,
    contentWidth: model.contentWidth.value,
    contentHeight: model.contentHeight.value,
    cameraZoom: model.cameraZoom.value,
    noteLaneWidth: model.noteLaneWidth.value,
    svgWidth: model.svgWidth.value,
    svgHeight: model.svgHeight.value,
    destinationFrameHeight: model.destinationFrameHeight.value,
    cameraTransformStyle: model.cameraTransformStyle.value,
    layoutResizeRevision: model.layoutResizeRevision.value,
    svgTransformAttribute: model.svgTransformAttribute.value,
    svgTransform: model.svgTransform.value,
    renderedGroups: model.renderedGroups.value,
    arrowTerminalGap: model.arrowTerminalGap.value,
    stateJustChanged: model.stateJustChanged.value,
    enteringEdgeIds: model.enteringEdgeIds.value,
    renderedNodes: model.renderedNodes.value,
    editable: model.editable.value,
    renderStyleConfig: model.renderStyleConfig.value,
    onBindingClick: model.onBindingClick.value,
  };
  useLayoutEffect(() => {
    if (view.layout) model.measureFitAfterCommit();
  }, [
    model,
    view.layout,
    view.svgWidth,
    view.svgHeight,
    view.cameraZoom,
    view.contentWidth,
    view.contentHeight,
    view.fitToWidth,
    view.automaticallyFitState,
    view.noteLaneWidth,
    view.renderStyleConfig,
  ]);
  void view.revision;
  const diagram = view.diagram;
  const autoFit = view.automaticallyFitState;
  const hasContent = Boolean(view.layout && diagram.model.nodes.length > 0);
  const edgeDimmed = (id: string) =>
    (view.hoveredNodeId !== null && !view.connectedEdgeIds.has(id)) ||
    (view.hoveredGroupId !== null && !view.groupEdgeIds.has(id)) ||
    (view.hasStateHighlighting &&
      view.highlightedEdgeSet !== null &&
      !view.highlightedEdgeSet.has(id));
  const nodeDimmed = (id: string) =>
    (view.hoveredNodeId !== null && !view.connectedNodeIds.has(id)) ||
    (view.hoveredGroupId !== null && !view.groupNodeIds.has(id)) ||
    (view.hasStateHighlighting &&
      view.highlightedNodeSet !== null &&
      !view.highlightedNodeSet.has(id));
  const enter = model.motionDuration(model.SCENE_ENTRY_MS),
    exit = model.motionDuration(model.EXIT_CONTENT_MS);
  const labelEdges = view.renderedEdges
    .filter((edge) => edge.label && view.renderedLabelPositions.has(edge.id))
    .map((edge) => ({ ...edge, position: view.renderedLabelPositions.get(edge.id)! }));
  return (
    <div
      ref={rendererRef}
      className={[
        'diagram-renderer',
        hasContent && 'has-content',
        view.usesCompactPresentation && 'compact-diagram',
        view.fitToWidth && 'fitted-diagram',
        diagram.states?.length && 'stateful-diagram',
        view.motionPhase === 'camera' && 'camera-stage',
        view.resizing && 'resizing',
      ]
        .filter(Boolean)
        .join(' ')}
      data-diagram-intrinsic-width={view.intrinsicWidth}
      style={
        {
          '--diagram-edge-label-font-size': `${EDGE_LABEL_STYLE.fontSize}px`,
          '--diagram-edge-label-line-height': EDGE_LABEL_STYLE.lineHeight,
          '--diagram-edge-label-padding-x': `${EDGE_LABEL_STYLE.paddingX}px`,
          '--diagram-edge-label-padding-y': `${EDGE_LABEL_STYLE.paddingY}px`,
          '--diagram-camera-duration': `${model.motionDuration(model.CAMERA_MOTION_MS)}ms`,
          '--diagram-camera-easing': model.CAMERA_MOTION_EASING,
          '--diagram-move-exit-duration': `${model.motionDuration(model.MOVE_EXIT_MS)}ms`,
          '--diagram-label-entry-delay': `${model.motionDuration(model.LABEL_ENTRY_DELAY_MS)}ms`,
          '--diagram-label-entry-duration': `${model.motionDuration(model.LABEL_ENTRY_MS)}ms`,
        } as CSSProperties
      }
      data-diagram-settled={view.diagramSettled}
      data-diagram-state={view.currentStateId}
      data-diagram-motion-phase={view.motionPhase}
    >
      {hasContent && (
        <div
          className="diagram-actions"
          role="toolbar"
          aria-label={m.diagram_renderer_actions_ariaLabel()}
        >
          <Button
            variant="ghost"
            size="icon-compact"
            iconOnly
            className="diagram-fit-button"
            onClick={model.toggleFitToWidth}
            aria-pressed={view.fitToWidth}
            aria-label={
              view.fitToWidth
                ? m.diagram_renderer_actualSize_ariaLabel()
                : m.diagram_renderer_fitToWidth_ariaLabel()
            }
            tooltip={
              view.fitToWidth
                ? m.diagram_renderer_actualSize_ariaLabel()
                : m.diagram_renderer_fitToWidth_ariaLabel()
            }
          >
            {view.fitToWidth ? (
              <CornersOutIcon size={14} aria-hidden="true" />
            ) : (
              <CornersInIcon size={14} aria-hidden="true" />
            )}
          </Button>
        </div>
      )}
      <div
        className={`diagram-scroll-container${view.stepViewportActive ? ' stepping-viewport' : ''}`}
        ref={scrollRef}
        role={autoFit ? 'region' : undefined}
        aria-label={autoFit ? m.diagram_controls_walkthrough_ariaLabel() : undefined}
        tabIndex={view.drawingOverflows ? 0 : undefined}
        style={{
          height: autoFit
            ? Math.min(view.stateFrameHeight, (view.windowHeight ?? Infinity) * 0.9)
            : undefined,
        }}
      >
        {view.layoutError ? (
          <div className="diagram-feedback" role="alert">
            <strong>{m.markdown_mermaid_renderFailed_error()}</strong>
            <span>{m.diagram_renderer_error_description()}</span>
          </div>
        ) : diagram.model.nodes.length === 0 ? (
          <output className="diagram-feedback">
            <strong>{m.diagram_validator_noNodes_warning()}</strong>
            <span>{m.diagram_renderer_empty_description()}</span>
          </output>
        ) : (
          <div
            className="diagram-content"
            style={{
              width: autoFit ? `max(100%, ${view.contentWidth + 16}px)` : view.contentWidth,
              height: autoFit ? `max(100%, ${view.stateFrameHeight}px)` : view.contentHeight,
            }}
          >
            <svg
              className="diagram-svg-layer"
              width={view.svgWidth}
              height={view.svgHeight + 6}
              style={{
                top: autoFit ? view.destinationFrameHeight / 2 : undefined,
                transform: view.cameraTransformStyle,
              }}
            >
              <defs>
                {[
                  '',
                  'danger-',
                  'success-',
                  'warning-',
                  'muted-',
                  'inactive-',
                  'highlighted-',
                  'active-',
                ].map((style) => (
                  <marker
                    key={style}
                    id={`arrowhead-${style}${diagram.id}`}
                    markerWidth="7"
                    markerHeight="7"
                    refX="6.5"
                    refY="3.5"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 3.5 0.5 L 6.5 3.5 L 3.5 6.5"
                      fill="none"
                      stroke="context-stroke"
                      strokeWidth="1"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </marker>
                ))}
              </defs>
              <g
                key={view.layoutResizeRevision}
                className="diagram-geometry-motion"
                transform={view.svgTransformAttribute}
                style={{ transform: view.svgTransform }}
              >
                <DiagramScenePresence items={view.renderedGroups}>
                  {(group, present, onExit) => (
                    <DiagramPaint
                      present={present}
                      onExit={onExit}
                      enterDuration={enter}
                      exitDuration={exit}
                    >
                      <DiagramGroup
                        group={group}
                        dimmed={view.hoveredGroupId !== null && view.hoveredGroupId !== group.id}
                        onHover={(id) => {
                          model.setHoveredGroup(id);
                        }}
                      />
                    </DiagramPaint>
                  )}
                </DiagramScenePresence>
                <DiagramScenePresence items={view.renderedEdges}>
                  {(edge, present, onExit) => (
                    <DiagramPaint
                      className="edge-reveal"
                      present={present}
                      onExit={onExit}
                      enterDuration={enter}
                      exitDuration={model.motionDuration(model.EXIT_CONNECTION_MS)}
                      reveal
                    >
                      <DiagramEdge
                        edge={edge}
                        dimmed={edgeDimmed(edge.id)}
                        highlighted={view.highlightedEdgeSet?.has(edge.id) ?? false}
                        markerScope={diagram.id}
                        terminalGap={view.arrowTerminalGap}
                        motionDelay={0}
                        onmotionchange={model.handleEdgeMotion}
                      />
                    </DiagramPaint>
                  )}
                </DiagramScenePresence>
                <DiagramScenePresence items={labelEdges}>
                  {(edge, present, onExit) => (
                    <DiagramPaint
                      as="foreignObject"
                      x={edge.position.x}
                      y={edge.position.y}
                      width={edge.position.width}
                      height={edge.position.height}
                      className={`edge-label-container diagram-geometry-motion${edgeDimmed(edge.id) ? ' edge-label-dimmed' : ''}${view.stateJustChanged && view.enteringEdgeIds.includes(edge.id) ? ' edge-label-entry' : ''}`}
                      data-edge-id={edge.id}
                      data-semantic-style={edge.semanticStyle ?? 'default'}
                      data-truncated={edge.position.truncated}
                      present={present}
                      onExit={onExit}
                      enterDuration={0}
                      exitDuration={exit / 2}
                    >
                      {edge.position.truncated ? (
                        <Tooltip
                          content={edge.label}
                          side="top"
                          className="edge-label-tooltip"
                          trigger={
                            <div className="edge-label-html" aria-label={edge.label}>
                              <span className="edge-label-text">{edge.label}</span>
                            </div>
                          }
                        />
                      ) : (
                        <div className="edge-label-html">
                          <span className="edge-label-text">{edge.label}</span>
                        </div>
                      )}
                    </DiagramPaint>
                  )}
                </DiagramScenePresence>
                <DiagramScenePresence items={view.renderedNodes}>
                  {(node, present, onExit) => (
                    <DiagramPaint
                      as="foreignObject"
                      easeEntry
                      data-node-id={node.id}
                      x={node.x}
                      y={node.y}
                      width={node.width}
                      height={node.height}
                      className="diagram-geometry-motion"
                      present={present}
                      onExit={onExit}
                      enterDuration={view.stateJustChanged ? enter : 0}
                      exitDuration={exit}
                    >
                      <DiagramNodeHTML
                        node={node}
                        editable={view.editable}
                        styleConfig={view.renderStyleConfig}
                        dimmed={nodeDimmed(node.id)}
                        highlighted={view.highlightedNodeSet?.has(node.id) ?? false}
                        onMove={(x, y) => model.handleNodeMove(node.id, x, y)}
                        onHover={(id) => {
                          model.setHoveredNode(id);
                        }}
                        onBindingClick={view.onBindingClick}
                      />
                    </DiagramPaint>
                  )}
                </DiagramScenePresence>
              </g>
            </svg>
          </div>
        )}
      </div>
      {!view.layoutError &&
        diagram.model.nodes.length > 0 &&
        diagram.states &&
        diagram.states.length > 0 && (
          <div className="diagram-footer">
            <DiagramControls
              states={diagram.states}
              currentStateId={view.currentStateId}
              onStateChange={model.changeState}
            />
          </div>
        )}
    </div>
  );
}
export default DiagramRenderer;
