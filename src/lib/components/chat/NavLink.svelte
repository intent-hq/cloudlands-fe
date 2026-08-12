<script lang="ts">
  import { goto } from '$app/navigation';
  import { store as appStore } from '$store/renderer/store';
  import { requestUiHighlight } from '$store/renderer/slices/ui-highlight/ui-highlight-slice';
  import { isResolvableNavTarget, resolveHashToTarget } from '$shared/app-ui-targets';
  import { handleLink } from '$features/navigation/link-handler';
  import { WorkspaceId } from '$shared/types/branded-ids';

  interface Props {
    target: string;
    label?: string;
    workspaceId?: string;
  }

  let { target, label, workspaceId }: Props = $props();
  // Drop the clickable affordance when the target does not point at a real
  // app surface. The assistant occasionally hallucinates routes (e.g.
  // /specialists, /workspaces/foo); rendering those as plain text keeps the
  // surrounding prose readable without exposing a dead click target.
  const resolvable = $derived(isResolvableNavTarget(target));

  function getHighlightIdFromTarget(value: string): string | null {
    try {
      const url = new URL(value, window.location.origin);
      const hash = decodeURIComponent(url.hash.replace(/^#/, '')).trim();
      return resolveHashToTarget(hash)?.id ?? (hash || null);
    } catch {
      const hashIndex = value.indexOf('#');
      const hash = hashIndex >= 0 ? value.slice(hashIndex + 1).trim() : '';
      return resolveHashToTarget(hash)?.id ?? (hash || null);
    }
  }

  async function handleClick(event: MouseEvent) {
    event.preventDefault();
    if (!target) return;

    // intent:// URLs are not SvelteKit routes; route them through the
    // workspaces link handler (same path note links in notes use).
    if (target.trim().startsWith('intent://')) {
      await handleLink(target.trim(), {
        workspaceId: workspaceId ? WorkspaceId(workspaceId) : undefined,
        event,
      });
      return;
    }

    await goto(target);
    const highlightId = getHighlightIdFromTarget(target);
    if (highlightId) {
      requestAnimationFrame(() => appStore.dispatch(requestUiHighlight(highlightId)));
    }
  }
</script>

{#if resolvable}
  <a
    href={target}
    onclick={handleClick}
    class="ws-block-widget type-body my-2 inline-flex min-h-9 w-fit items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 font-medium text-foreground shadow-(--elevation-raised) transition-[background-color,border-color,color] hover:border-input hover:bg-accent focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none"
  >
    <span>{label || target}</span>
    <span aria-hidden="true" class="text-muted-foreground">→</span>
  </a>
{:else if label || target}
  <span data-nav-link-unresolved class="type-body text-foreground">{label || target}</span>
{/if}
