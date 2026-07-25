<script lang="ts">
  /**
   * ResourceNotFound - terminal load-failure state for a routed resource.
   *
   * Presentation-only: renders a "not found" or "failed to load" panel for a
   * resource (Workspace / Agent / Note) with an optional detail message and a
   * "Go to Home" action. Navigation is delegated to the `onGoHome` callback so
   * the component stays reusable across routes.
   */

  import Fa from 'svelte-fa';
  import { faCircleQuestion, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';

  interface Props {
    /** Failure kind: `not_found` renders "<label> not found", `error` renders "Failed to load <label>". */
    kind: 'not_found' | 'error';
    /** Resource label, e.g. "Workspace", "Agent", "Note". */
    resourceLabel: string;
    /** Identifier of the resource that failed to load, shown under the title. */
    resourceId?: string;
    /** Optional detail message (e.g. the underlying error). */
    detail?: string;
    /** Heading level for the title; defaults to 1 since this typically renders as full-page content. */
    headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
    /** Invoked when the user clicks "Go to Home". */
    onGoHome: () => void;
  }

  let { kind, resourceLabel, resourceId, detail, headingLevel = 1, onGoHome }: Props = $props();

  const title = $derived(
    kind === 'not_found'
      ? `${resourceLabel} not found`
      : `Failed to load ${resourceLabel.toLowerCase()}`,
  );
</script>

<div class="min-h-full flex items-center justify-center p-6 bg-background">
  <div class="w-full max-w-md" role="status">
    <div class="flex flex-col items-center text-center space-y-6 p-8">
      <span aria-hidden="true">
        <Fa
          icon={kind === 'not_found' ? faCircleQuestion : faTriangleExclamation}
          size="2.5x"
          class="text-subtle"
        />
      </span>

      <div class="space-y-3">
        <svelte:element this={`h${headingLevel}`} class="text-2xl font-semibold text-foreground">
          {title}
        </svelte:element>
        {#if resourceId}
          <p class="text-sm text-subtle font-mono break-all">{resourceId}</p>
        {/if}
        {#if detail}
          <p class="text-base text-subtle leading-relaxed max-w-sm mx-auto break-words">
            {detail}
          </p>
        {/if}
      </div>

      <Button variant="default" size="default" onclick={onGoHome}>Go to Home</Button>
    </div>
  </div>
</div>
