<script lang="ts">
  import GlobeSimpleIcon from 'phosphor-svelte/lib/GlobeSimpleIcon';
  import AppWindowIcon from 'phosphor-svelte/lib/AppWindowIcon';
  import { m } from '$shared/paraglide/messages.js';
  import { selectDockLinkedContext } from '$store/renderer/slices/dock-conversation/dock-conversation-selectors';

  /**
   * The index top row names the current tab (favicon and domain) or app (icon and name)
   * from the admitted linked context, beside the Intent mark. Unknown or no context shows
   * nothing; the context held while the dock itself is focused stays named.
   */
  const context$ = selectDockLinkedContext();
  const context = $derived($context$);
  const shown = $derived(!!context && context.phase === 'ready' && !!context.label);
  let iconFailed = $state(false);
  $effect(() => {
    void context?.icon;
    iconFailed = false;
  });
</script>

{#if shown && context}
  <span
    class="dock-context-label type-caption"
    data-dock-context-label
    title={context.label}
    aria-label={m.dock_linkedTab_current_ariaLabel({ context: context.label })}
  >
    {#if context.icon && !iconFailed}
      <img
        class="context-icon"
        src={context.icon}
        alt=""
        width="12"
        height="12"
        onerror={() => (iconFailed = true)}
      />
    {:else if context.identityKind === 'app'}
      <AppWindowIcon size={12} aria-hidden="true" />
    {:else}
      <GlobeSimpleIcon size={12} aria-hidden="true" />
    {/if}
    <span class="context-name truncate">{context.label}</span>
  </span>
{/if}

<style>
  .dock-context-label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 100%;
    color: hsl(var(--muted-foreground));
    pointer-events: none;
  }
  .context-icon {
    flex: none;
    border-radius: 3px;
  }
  .context-name {
    min-width: 0;
  }
</style>
