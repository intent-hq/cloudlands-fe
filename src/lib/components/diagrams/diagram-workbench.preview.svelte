<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { m } from '$shared/paraglide/messages.js';
  import {
    DIAGRAM_WORKBENCH_CASE_GROUPS,
    DIAGRAM_WORKBENCH_CASES,
    type DiagramWorkbenchCase,
    type DiagramWorkbenchCaseId,
  } from './diagram-workbench.preview-fixtures';

  export interface DiagramWorkbenchPreviewProps {
    caseId: DiagramWorkbenchCaseId;
    fixture: DiagramWorkbenchCase;
  }

  export const preview = definePreview<DiagramWorkbenchPreviewProps>({
    id: 'diagram-workbench',
    get title() {
      return m.sandbox_diagramWorkbench_title();
    },
    defaultState: 'mermaid-flow',
    states: Object.fromEntries(
      Object.entries(DIAGRAM_WORKBENCH_CASES).map(([name, fixture]) => [
        name,
        { props: { caseId: name as DiagramWorkbenchCaseId, fixture } },
      ]),
    ),
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import MermaidRenderer from '$lib/components/markdown/MermaidRenderer.svelte';
  import DiagramRenderer from './DiagramRenderer.svelte';

  let { caseId, fixture }: DiagramWorkbenchPreviewProps = $props();
  let workbenchElement = $state<HTMLElement>();
  let allCasesReady = $state(false);
  let bindingTargets = $state<Partial<Record<DiagramWorkbenchCaseId, string>>>({});

  const caseCount = Object.keys(DIAGRAM_WORKBENCH_CASES).length;
  const mermaidCaseCount = Object.values(DIAGRAM_WORKBENCH_CASES).filter(
    ({ kind }) => kind === 'mermaid',
  ).length;

  function groupTitle(groupId: (typeof DIAGRAM_WORKBENCH_CASE_GROUPS)[number]['id']): string {
    if (groupId === 'mermaid') return m.sandbox_diagramWorkbench_mermaidCases_title();
    if (groupId === 'custom') return m.sandbox_diagramWorkbench_customCases_title();
    if (groupId === 'stress') return m.sandbox_diagramWorkbench_stressCases_title();
    if (groupId === 'interaction') return m.sandbox_diagramWorkbench_interactionCases_title();
    return m.sandbox_diagramWorkbench_statusCases_title();
  }

  onMount(() => {
    if (!workbenchElement) return;

    const markReady = () => {
      if (!workbenchElement) return;
      const cases = workbenchElement.querySelectorAll('[data-diagram-case]');
      const mermaidRenderers = [
        ...workbenchElement.querySelectorAll<HTMLElement>('.mermaid-renderer'),
      ];
      const mermaidReady = mermaidRenderers.every(
        (renderer) =>
          Boolean(renderer.querySelector('.mermaid-error, .mermaid-empty')) ||
          (renderer.dataset.renderSettled === 'true' &&
            Boolean(renderer.querySelector('.mermaid-svg svg[data-layout-settled="true"]'))),
      );

      if (
        cases.length !== caseCount ||
        mermaidRenderers.length !== mermaidCaseCount ||
        !mermaidReady
      ) {
        return;
      }

      allCasesReady = true;
      observer.disconnect();
      requestAnimationFrame(() => {
        workbenchElement
          ?.querySelector<HTMLElement>(`#${CSS.escape(caseId)}`)
          ?.scrollIntoView({ block: 'start' });
      });
    };

    const observer = new MutationObserver(markReady);
    observer.observe(workbenchElement, {
      attributes: true,
      attributeFilter: ['data-render-settled', 'data-layout-settled'],
      childList: true,
      subtree: true,
    });
    markReady();
    return () => observer.disconnect();
  });
</script>

{#snippet diagram(id: DiagramWorkbenchCaseId, target: DiagramWorkbenchCase)}
  {#if target.kind === 'mermaid'}
    <MermaidRenderer code={target.source} />
  {:else if target.kind === 'custom'}
    <DiagramRenderer
      diagram={target.diagram}
      viewResetKey={caseId}
      onBindingClick={(_event, binding) =>
        (bindingTargets[id] = `${binding.type}: ${binding.target}`)}
    />
  {:else}
    <div
      class="loading-state"
      role="status"
      aria-label={m.sandbox_diagramWorkbench_loading_ariaLabel()}
    >
      <p>{m.sandbox_diagramWorkbench_loading_label()}</p>
    </div>
  {/if}
{/snippet}

<article
  class="diagram-workbench"
  data-diagram-workbench
  data-target-case={caseId}
  data-target-kind={fixture.kind}
  data-diagram-workbench-ready={allCasesReady ? 'true' : 'false'}
  bind:this={workbenchElement}
>
  <header class="page-header">
    <h1>{m.sandbox_diagramWorkbench_title()}</h1>
    <p>{m.sandbox_diagramWorkbench_description()}</p>
  </header>

  {#each DIAGRAM_WORKBENCH_CASE_GROUPS as group (group.id)}
    <section class="case-group" aria-labelledby={`diagram-group-${group.id}`}>
      <header class="group-header">
        <h2 id={`diagram-group-${group.id}`}>{groupTitle(group.id)}</h2>
      </header>

      {#each group.caseIds as id (id)}
        {@const target = DIAGRAM_WORKBENCH_CASES[id]}
        <section
          {id}
          class="diagram-case"
          class:is-targeted={id === caseId}
          data-diagram-case={id}
          data-diagram-kind={target.kind}
          data-targeted={id === caseId ? 'true' : 'false'}
        >
          <header class="case-header">
            <h3>{target.title}</h3>
            <p>{target.description}</p>
          </header>
          <div
            class="diagram-stage"
            data-diagram-case-stage={id}
            aria-label={m.sandbox_diagramWorkbench_stage_ariaLabel()}
          >
            {@render diagram(id, target)}
          </div>
          {#if bindingTargets[id]}
            <output class="binding-output" data-binding-target>{bindingTargets[id]}</output>
          {/if}
        </section>
      {/each}
    </section>
  {/each}
</article>

<style>
  .diagram-workbench {
    display: grid;
    width: 100%;
    min-width: 0;
    gap: clamp(3.75rem, 8vw, 5.5rem);
  }
  .page-header {
    display: grid;
    gap: 0.75rem;
    max-width: 50rem;
    padding-bottom: 0.5rem;
  }
  .page-header h1 {
    font-family:
      'Source Serif 4 Variable', 'Source Serif 4', 'Source Serif Pro', 'Iowan Old Style',
      'Palatino Linotype', Palatino, Georgia, serif;
    font-optical-sizing: auto;
    font-size: clamp(2rem, 5vw, 3rem);
    font-weight: 560;
    line-height: 1.08;
    letter-spacing: -0.03em;
  }
  .page-header p,
  .case-header p {
    color: hsl(var(--muted-foreground));
    font-family:
      'Source Serif 4 Variable', 'Source Serif 4', 'Source Serif Pro', 'Iowan Old Style',
      'Palatino Linotype', Palatino, Georgia, serif;
    font-optical-sizing: auto;
    line-height: 1.6;
  }
  .page-header p {
    font-size: clamp(var(--text-body-size), 2vw, 1.125rem);
  }
  .case-group {
    display: grid;
    min-width: 0;
  }
  .group-header {
    margin-bottom: 0.5rem;
    border-bottom: 1px solid hsl(var(--border) / 0.72);
    padding-bottom: 0.875rem;
  }
  .group-header h2 {
    color: hsl(var(--muted-foreground));
    font-family:
      'Source Serif 4 Variable', 'Source Serif 4', 'Source Serif Pro', 'Iowan Old Style',
      'Palatino Linotype', Palatino, Georgia, serif;
    font-optical-sizing: auto;
    font-size: clamp(1.2rem, 2.5vw, 1.45rem);
    font-weight: 560;
    line-height: 1.2;
    letter-spacing: -0.015em;
  }
  .diagram-case {
    display: grid;
    min-width: 0;
    scroll-margin-top: 1rem;
    gap: 1.25rem;
    border-bottom: 1px solid hsl(var(--border) / 0.48);
    padding: 2rem 0 2.75rem;
  }
  .diagram-case.is-targeted {
    background: var(--diagram-host-surface);
    padding-left: clamp(0.75rem, 2vw, 1.25rem);
  }
  .case-header {
    display: grid;
    gap: 0.375rem;
    max-width: 48rem;
  }
  .case-header h3 {
    font-family:
      'Source Serif 4 Variable', 'Source Serif 4', 'Source Serif Pro', 'Iowan Old Style',
      'Palatino Linotype', Palatino, Georgia, serif;
    font-optical-sizing: auto;
    font-size: clamp(1.1rem, 2vw, 1.3rem);
    font-weight: 580;
    line-height: 1.22;
    letter-spacing: -0.012em;
  }
  .case-header p {
    font-size: var(--text-body-size);
  }
  .diagram-stage {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    overflow-x: auto;
    border-radius: var(--radius-medium);
    background: transparent;
    padding: clamp(0.75rem, 2vw, 1.25rem);
  }
  .loading-state {
    display: flex;
    min-height: 5.5rem;
    align-items: center;
    justify-content: center;
    color: hsl(var(--muted-foreground));
    font-family: var(--font-ui);
    font-size: var(--text-body-size);
    text-align: center;
  }
  .loading-state p {
    margin: 0;
  }
  .binding-output {
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-small);
    background: hsl(var(--muted) / 0.28);
    padding: 0.5rem 0.75rem;
    color: hsl(var(--muted-foreground));
    font-family: var(--font-ui);
    font-size: var(--text-caption-size);
    line-height: 1.45;
    overflow-wrap: anywhere;
  }
  @media (max-width: 30rem) {
    .diagram-case.is-targeted {
      padding-left: 0.625rem;
    }
    .diagram-stage {
      padding-inline: 0.625rem;
    }
  }
</style>
