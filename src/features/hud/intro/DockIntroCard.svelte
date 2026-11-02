<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { requestDockLabEnabled } from '$lib/dock-lab';
  import { m } from '$shared/paraglide/messages.js';
  import { dismissDockIntro } from './dock-intro.svelte';

  /**
   * "Meet the notch": the dock's own first-run card, above the workspace rows.
   * Its height is fixed (DOCK_INTRO_HEIGHT in dock-shell-geometry.ts) so the shell
   * can size the open notch before it renders. "Got it" retires it; "Turn off"
   * retires it only once main confirms the dock is off (main then closes the dock).
   */
  let turningOff = $state(false);
  async function turnOff(): Promise<void> {
    if (turningOff) return;
    turningOff = true;
    // eslint-disable-next-line intent/no-component-async-data-fetch -- writes the main-owned dock setting (as Settings › Appearance does); nothing is loaded
    const disabled = await requestDockLabEnabled(false);
    turningOff = false;
    if (disabled) dismissDockIntro();
  }
</script>

<section class="dock-intro" aria-labelledby="dock-intro-title" data-testid="dock-intro">
  <h2 id="dock-intro-title" class="intro-title">{m.dock_intro_title()}</h2>
  <p class="intro-copy type-caption">{m.dock_intro_description()}</p>
  <div class="intro-actions">
    <Button variant="plain" size="sm" class="intro-primary" onclick={dismissDockIntro}>
      {m.dock_intro_gotIt_label()}
    </Button>
    <Button variant="ghost" size="sm" disabled={turningOff} onclick={turnOff}>
      {m.dock_intro_turnOff_label()}
    </Button>
  </div>
</section>

<style>
  /* Fixed height: keep in step with DOCK_INTRO_HEIGHT (122 + 8 gap). */
  .dock-intro {
    flex: none;
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: 6px;
    height: 122px;
    margin-bottom: 8px;
    padding: 12px 14px;
    border-radius: 14px;
    background: hsl(var(--dock-raised));
    color: hsl(var(--foreground));
  }
  .intro-title {
    margin: 0;
    font-size: 15px;
    line-height: 20px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .intro-copy {
    margin: 0;
    color: hsl(var(--muted-foreground));
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }
  .intro-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .intro-actions :global(.intro-primary) {
    height: 28px;
    padding-inline: 12px;
    border-radius: 999px;
    background: hsl(var(--primary));
    color: hsl(var(--primary-foreground));
    font-weight: 500;
  }
  .intro-actions :global(.intro-primary:hover) {
    background: hsl(var(--primary) / 0.9);
  }
</style>
