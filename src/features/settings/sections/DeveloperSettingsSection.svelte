<script lang="ts">
  import Button from '$lib/components/ui/button/button.svelte';
  import { highlightTarget } from '$lib/components/ui/highlight/highlight-target';
  import { simulateSetState } from '$store/renderer/slices/auto-update/auto-update-slice';
  import { store as appStore } from '$store/renderer/store';
</script>

<!-- Dev-only UI is not translated. -->
<div id="developer" data-highlight-id="developer" use:highlightTarget>
  <h2 class="type-title mb-3 text-foreground">
    <!-- i18n-ignore (dev-only) -->
    Developer
  </h2>
  <div class="flex flex-col bg-card rounded-xl divide-y divide-border">
    <section data-slot="settings-section-body" class="px-6 py-4">
      <div class="flex flex-col gap-2">
        <!-- i18n-ignore (dev-only) -->
        <span class="type-body font-medium">Update Toast Simulation</span>
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onclick={() =>
              appStore.dispatch(
                simulateSetState({
                  toastVisible: true,
                  status: 'downloading',
                  updateInfo: {
                    version: '99.0.0',
                    releaseDate: new Date().toISOString(),
                    releaseNotes: 'Simulated',
                  },
                  progress: {
                    percent: 50,
                    bytesPerSecond: 2500000,
                    transferred: 25000000,
                    total: 50000000,
                  },
                  error: null,
                }),
              )}
          >
            <!-- i18n-ignore (dev-only) -->
            Simulate Update Flow
          </Button>
          <Button
            variant="outline"
            size="sm"
            onclick={() =>
              appStore.dispatch(
                simulateSetState({
                  toastVisible: true,
                  status: 'not-available',
                  currentVersion: '1.0.0-dev',
                }),
              )}
          >
            <!-- i18n-ignore (dev-only) -->
            Simulate No Update
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onclick={() =>
              appStore.dispatch(
                simulateSetState({
                  toastVisible: false,
                  status: 'idle',
                  currentVersion: '1.0.0-dev',
                  updateInfo: null,
                  progress: null,
                  error: null,
                  channel: 'stable',
                }),
              )}
          >
            <!-- i18n-ignore (dev-only) -->
            Reset
          </Button>
        </div>
      </div>
    </section>
  </div>
</div>
