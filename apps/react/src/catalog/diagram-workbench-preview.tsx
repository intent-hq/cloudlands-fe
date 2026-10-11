// Source: src/lib/components/diagrams/diagram-workbench.preview.svelte.
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Preserve the reference loading fixture's status DIV and layout. */
import { useEffect, useRef, useState } from 'react';
import { DiagramRenderer } from '@/components/diagrams/diagram-renderer';
import { MermaidRenderer } from '@/components/markdown/mermaid-renderer';
import {
  DIAGRAM_WORKBENCH_CASE_GROUPS,
  DIAGRAM_WORKBENCH_CASE_IDS,
  DIAGRAM_WORKBENCH_CASES,
  type DiagramWorkbenchCase,
  type DiagramWorkbenchCaseId,
} from '$lib/components/diagrams/diagram-workbench.preview-fixtures';
import { m } from '$shared/paraglide/messages.js';
import './diagram-workbench-preview.css';

export const diagramWorkbenchStates = DIAGRAM_WORKBENCH_CASE_IDS;
export const diagramWorkbenchCaptureReadiness = {
  selector: '[data-diagram-workbench-ready="true"]',
  count: 1,
  generationAttribute: 'data-diagram-workbench-generation',
  readinessTimeoutMs: 45_000,
} as const;

const caseCount = DIAGRAM_WORKBENCH_CASE_IDS.length;
const mermaidCaseCount = Object.values(DIAGRAM_WORKBENCH_CASES).filter(
  ({ kind }) => kind === 'mermaid',
).length;
const customCaseCount = Object.values(DIAGRAM_WORKBENCH_CASES).filter(
  ({ kind }) => kind === 'custom',
).length;

function groupTitle(group: (typeof DIAGRAM_WORKBENCH_CASE_GROUPS)[number]['id']) {
  if (group === 'mermaid') return m.sandbox_diagramWorkbench_mermaidCases_title();
  if (group === 'custom') return m.sandbox_diagramWorkbench_customCases_title();
  if (group === 'stress') return m.sandbox_diagramWorkbench_stressCases_title();
  if (group === 'interaction') return m.sandbox_diagramWorkbench_interactionCases_title();
  return m.sandbox_diagramWorkbench_statusCases_title();
}

function Workbench({ caseId }: { caseId: DiagramWorkbenchCaseId }) {
  const element = useRef<HTMLElement>(null);
  const [settlement, setSettlement] = useState({ ready: false, generation: 0 });
  const [bindingTargets, setBindingTargets] = useState<
    Partial<Record<DiagramWorkbenchCaseId, string>>
  >({});
  const fixture = DIAGRAM_WORKBENCH_CASES[caseId];

  useEffect(() => {
    const workbench = element.current;
    if (!workbench) return;
    let ready = false;
    let scrolledToTarget = false;
    let scrollFrame: number | undefined;
    const markReady = () => {
      const cases = workbench.querySelectorAll('[data-diagram-case]');
      const mermaid = [...workbench.querySelectorAll<HTMLElement>('.mermaid-renderer')];
      const custom = [...workbench.querySelectorAll<HTMLElement>('.diagram-renderer')];
      const mermaidReady = mermaid.every((renderer) => {
        const generation = renderer.dataset.renderGeneration;
        const svg = renderer.querySelector<SVGSVGElement>('.mermaid-svg svg');
        return (
          renderer.dataset.renderSettled === 'true' &&
          (Boolean(renderer.querySelector('.mermaid-error, .mermaid-empty')) ||
            (svg?.dataset.layoutSettled === 'true' && svg.dataset.layoutGeneration === generation))
        );
      });
      const customReady = custom.every((renderer) => renderer.dataset.diagramSettled === 'true');
      const next =
        cases.length === caseCount &&
        mermaid.length === mermaidCaseCount &&
        custom.length === customCaseCount &&
        mermaidReady &&
        customReady;
      if (ready === next) return;
      ready = next;
      setSettlement((previous) =>
        previous.ready === next
          ? previous
          : { ready: next, generation: previous.generation + (next ? 1 : 0) },
      );
      if (next && !scrolledToTarget) {
        scrolledToTarget = true;
        scrollFrame = requestAnimationFrame(() => {
          workbench
            .querySelector<HTMLElement>(`#${CSS.escape(caseId)}`)
            ?.scrollIntoView({ block: 'start' });
        });
      }
    };
    const observer = new MutationObserver(markReady);
    observer.observe(workbench, {
      attributes: true,
      attributeFilter: [
        'data-render-generation',
        'data-render-settled',
        'data-layout-generation',
        'data-layout-settled',
        'data-diagram-settled',
      ],
      childList: true,
      subtree: true,
    });
    markReady();
    return () => {
      observer.disconnect();
      if (scrollFrame !== undefined) cancelAnimationFrame(scrollFrame);
    };
  }, [caseId]);

  function diagram(id: DiagramWorkbenchCaseId, target: DiagramWorkbenchCase) {
    if (target.kind === 'mermaid') return <MermaidRenderer code={target.source} />;
    if (target.kind === 'custom')
      return (
        <DiagramRenderer
          diagram={target.diagram}
          viewResetKey={caseId}
          onBindingClick={(_event, binding) =>
            setBindingTargets((previous) => ({
              ...previous,
              [id]: `${binding.type}: ${binding.target}`,
            }))
          }
        />
      );
    return (
      <div
        className="loading-state"
        role="status"
        aria-label={m.sandbox_diagramWorkbench_loading_ariaLabel()}
      >
        <p>{m.sandbox_diagramWorkbench_loading_label()}</p>
      </div>
    );
  }

  return (
    <article
      ref={element}
      className="diagram-workbench react-diagram-workbench"
      data-diagram-workbench=""
      data-target-case={caseId}
      data-target-kind={fixture.kind}
      data-diagram-workbench-ready={String(settlement.ready)}
      data-diagram-workbench-generation={settlement.generation}
    >
      <header className="page-header">
        <h1>{m.sandbox_diagramWorkbench_title()}</h1>
        <p>{m.sandbox_diagramWorkbench_description()}</p>
      </header>
      {DIAGRAM_WORKBENCH_CASE_GROUPS.map((group) => (
        <section
          key={group.id}
          className="case-group"
          aria-labelledby={`diagram-group-${group.id}`}
        >
          <header className="group-header">
            <h2 id={`diagram-group-${group.id}`}>{groupTitle(group.id)}</h2>
          </header>
          {group.caseIds.map((id) => {
            const target = DIAGRAM_WORKBENCH_CASES[id];
            return (
              <section
                key={id}
                id={id}
                className={`diagram-case${id === caseId ? ' is-targeted' : ''}`}
                data-diagram-case={id}
                data-diagram-kind={target.kind}
                data-targeted={String(id === caseId)}
              >
                <header className="case-header">
                  <h3>{target.title}</h3>
                  <p>{target.description}</p>
                  {'visualContract' in target && target.visualContract && (
                    <p className="visual-contract" data-visual-contract="">
                      {target.visualContract}
                    </p>
                  )}
                </header>
                <div
                  className="diagram-stage"
                  data-diagram-case-stage={id}
                  aria-label={m.sandbox_diagramWorkbench_stage_ariaLabel()}
                >
                  {diagram(id, target)}
                </div>
                {bindingTargets[id] && (
                  <output className="binding-output" data-binding-target="">
                    {bindingTargets[id]}
                  </output>
                )}
              </section>
            );
          })}
        </section>
      ))}
    </article>
  );
}

export function DiagramWorkbenchPreview({ state }: { state: DiagramWorkbenchCaseId }) {
  return <Workbench key={state} caseId={state} />;
}
