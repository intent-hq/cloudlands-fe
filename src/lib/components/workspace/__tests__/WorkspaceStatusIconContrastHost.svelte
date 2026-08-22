<script lang="ts">
  import WorkspaceStatusIcon from '../WorkspaceStatusIcon.svelte';

  let { theme = 'light', zoom = 1 }: { theme?: 'light' | 'dark'; zoom?: number } = $props();

  $effect(() => {
    const root = document.documentElement;
    const hadLight = root.classList.contains('light');
    const hadDark = root.classList.contains('dark');
    root.classList.toggle('light', theme === 'light');
    root.classList.toggle('dark', theme === 'dark');
    return () => {
      root.classList.toggle('light', hadLight);
      root.classList.toggle('dark', hadDark);
    };
  });
</script>

<section class="bg-background p-4" style:zoom data-theme={theme} data-testid="status-host">
  {#each ['active', 'inactive'] as tab}
    <div class={tab === 'active' ? 'bg-sidebar' : 'bg-sidebar/50'} data-workspace-tab-kind={tab}>
      <span data-status="in_progress">
        <WorkspaceStatusIcon status="in_progress" size={14} decorative />
      </span>
      <span data-status="idle">
        <WorkspaceStatusIcon status="idle" size={14} decorative />
      </span>
    </div>
  {/each}
</section>
