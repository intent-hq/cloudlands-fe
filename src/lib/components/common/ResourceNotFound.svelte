<script lang="ts">
  /**
   * ResourceNotFound - terminal load-failure state for a routed resource.
   *
   * Presentation-only: renders a "not found" or "failed to load" panel for a
   * resource (Workspace / Agent / Note) with an optional detail message and a
   * navigation action. Navigation is delegated to the `onNavigateAway` callback so
   * the component stays reusable across routes.
   */

  import Fa from 'svelte-fa';
  import { faCircleQuestion, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';

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
    onNavigateAway: () => void;
  }

  let {
    kind,
    resourceLabel,
    resourceId,
    detail,
    headingLevel = 1,
    onNavigateAway,
  }: Props = $props();

  const title = $derived(
    kind === 'not_found'
      ? m.common_resourceNotFound_notFound_title({ resourceLabel })
      : m.common_resourceNotFound_loadFailed_title({ resourceLabel: resourceLabel.toLowerCase() }),
  );
</script>

<div class="h-full min-h-0 w-full overflow-auto bg-background" data-resource-not-found={kind}>
  <div class="flex min-h-full w-full items-center justify-center p-2 sm:p-6">
    <div class="w-full max-w-md" role="status">
      <div class="flex flex-col items-center space-y-3 p-2 text-center sm:space-y-6 sm:p-8">
        <span class="max-[479px]:hidden" aria-hidden="true">
          <Fa
            icon={kind === 'not_found' ? faCircleQuestion : faTriangleExclamation}
            size="2.5x"
            class="text-subtle"
          />
        </span>

        <div class="w-full space-y-2 sm:space-y-3">
          <svelte:element
            this={`h${headingLevel}`}
            class="break-words text-lg font-semibold text-foreground max-[479px]:text-base sm:text-2xl"
          >
            {title}
          </svelte:element>
          {#if resourceId}
            <p class="break-all font-mono text-xs text-subtle max-[479px]:hidden sm:text-sm">
              {resourceId}
            </p>
          {/if}
          {#if detail}
            <p
              class="mx-auto max-w-sm break-words text-sm leading-relaxed text-subtle sm:text-base"
            >
              {detail}
            </p>
          {/if}
        </div>

        <Button
          variant="default"
          size="default"
          class="h-auto max-w-full whitespace-normal break-words text-center max-[479px]:text-xs"
          onclick={onNavigateAway}>{m.layout_sidebarNav_allWorkspaces_title()}</Button
        >
      </div>
    </div>
  </div>
</div>
