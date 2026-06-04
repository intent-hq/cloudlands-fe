<script lang="ts">
  import { goto } from '$app/navigation';
  import { store as appStore } from "$store/renderer/store";
  import { requestUiHighlight } from '$store/renderer/slices/ui-highlight/ui-highlight-slice';
  import { isResolvableNavTarget, resolveHashToTarget } from '$shared/app-ui-targets';

  interface Props {
    target: string;
    label?: string;
  }

  let { target, label }: Props = $props();
  // Lazy dispatch access to avoid Store.init() errors in tests
  const getDispatch = () => appStore.dispatch.bind(appStore);

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

    await goto(target);
    const highlightId = getHighlightIdFromTarget(target);
    if (highlightId) {
      requestAnimationFrame(() => getDispatch()(requestUiHighlight(highlightId)));
    }
  }
</script>

{#if resolvable}
  <a
    href={target}
    onclick={handleClick}
    class="my-1.5 inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
  >
    <span>{label || target}</span>
    <span aria-hidden="true" class="text-subtle">→</span>
  </a>
{:else if label || target}
  <span data-nav-link-unresolved class="text-sm text-foreground">{label || target}</span>
{/if}
