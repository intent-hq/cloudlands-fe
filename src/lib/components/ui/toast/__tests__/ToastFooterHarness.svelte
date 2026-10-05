<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Card } from '$lib/components/ui/card';
  import { AgentAttentionToast, Toast, toast } from '$lib/components/ui/toast';
  import { store as appStore } from '$store/renderer/store';
  import { setThemeName } from '$store/renderer/slices/theme/theme-slice';
  import type { ThemeName } from '$store/renderer/slices/theme/theme-types';

  let { staticPosition = false, theme = 'light' }: { staticPosition?: boolean; theme?: ThemeName } =
    $props();
  let shellOpens = $state(0);
  const toastIds = ['footer-saved', 'footer-blocker'];

  function showNotifications() {
    toast.success('Workspace saved', {
      id: toastIds[0],
      duration: Number.POSITIVE_INFINITY,
    });
    toast.custom(AgentAttentionToast, {
      id: toastIds[1],
      duration: Number.POSITIVE_INFINITY,
      componentProps: {
        title: 'Implementor is blocked',
        reason: 'The test runner is unavailable. Choose another runner to continue.',
        kind: 'blocker',
        onSwitchTo: () => undefined,
        onClose: () => toast.dismiss(toastIds[1]),
      },
    });
  }

  onMount(() => {
    const root = document.documentElement;
    const previousTheme = appStore.state.theme.name;
    const previousDark = root.classList.contains('dark');
    const previousLight = root.classList.contains('light');
    appStore.dispatch(setThemeName(theme));
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('light', theme === 'light');
    showNotifications();
    return () => {
      toastIds.forEach((id) => toast.dismiss(id));
      appStore.dispatch(setThemeName(previousTheme));
      root.classList.toggle('dark', previousDark);
      root.classList.toggle('light', previousLight);
    };
  });
</script>

<!-- i18n-ignore (isolated component-test fixture with fake workspace data) -->
<div class="min-h-screen bg-background text-foreground">
  <aside
    aria-label="Workspace sidebar"
    class="fixed inset-y-0 left-0 flex w-96 max-w-full flex-col justify-between bg-sidebar p-4 text-sidebar-foreground"
  >
    <div class="grid justify-items-start gap-3">
      <h2 class="type-title">Workspace</h2>
      <Button variant="secondary" onclick={showNotifications}>Show notifications</Button>
    </div>
    <Card class="p-4" data-testid="shells-card">
      <h3 class="type-title">Shells</h3>
      <p class="type-caption text-muted-foreground">Local development shell</p>
      <Button variant="ghost" onclick={() => shellOpens++}>Open shell</Button>
      <output aria-label="Shell opens">{shellOpens}</output>
    </Card>
  </aside>
  {#if staticPosition}
    <section class="absolute left-4 top-24 grid w-96 gap-2" aria-label="Static notifications">
      <Toast {staticPosition} />
    </section>
  {:else}
    <Toast />
  {/if}
</div>
