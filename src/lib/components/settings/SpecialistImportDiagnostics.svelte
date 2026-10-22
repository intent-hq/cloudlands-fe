<script lang="ts">
  import { selectSpecialistImportDiagnostics } from '$store/renderer/slices/specialists/specialists-selectors';
  import type { SpecialistImportDiagnostic } from '$lib/client/app-client';
  import OpenComboButton from '$features/external-editors/components/OpenComboButton.svelte';
  import { m } from '$shared/paraglide/messages.js';

  let { workspaceId }: { workspaceId?: string } = $props();
  const diagnostics = $derived(selectSpecialistImportDiagnostics(workspaceId));

  function reason(diagnostic: SpecialistImportDiagnostic): string {
    switch (diagnostic.code) {
      case 'invalid':
        return m.settings_aiBehavior_importInvalid();
      case 'unreadable':
        return m.settings_aiBehavior_importUnreadable();
      case 'broken-link':
        return m.settings_aiBehavior_importBrokenLink();
      case 'too-large':
        return m.settings_aiBehavior_importTooLarge();
      case 'shadowed':
        return m.settings_aiBehavior_importShadowed();
      case 'scan-limit':
        return m.settings_aiBehavior_importScanLimit();
      default:
        return diagnostic.message;
    }
  }
</script>

{#if $diagnostics.length}
  <section
    aria-label={m.settings_aiBehavior_importNotices()}
    class="mb-4 min-w-0 rounded border border-border p-3"
  >
    <h3 class="type-body font-medium text-foreground">{m.settings_aiBehavior_importNotices()}</h3>
    <ul class="mt-2 flex min-w-0 flex-col gap-3" aria-live="polite">
      {#each $diagnostics as diagnostic (JSON.stringify( [diagnostic.source, diagnostic.path, diagnostic.code] ))}
        <li class="min-w-0">
          <div class="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <span class="type-caption break-all text-foreground"
              >{diagnostic.path.split(/[\\/]/).pop()}</span
            >
            <OpenComboButton
              {workspaceId}
              filePath={diagnostic.path}
              isDirectory={diagnostic.isDirectory === true}
            />
          </div>
          <p class="type-caption mt-1 text-muted-foreground">{reason(diagnostic)}</p>
          {#if diagnostic.message && diagnostic.message !== reason(diagnostic)}
            <details class="mt-1 type-caption text-muted-foreground">
              <summary class="cursor-pointer">{m.settings_aiBehavior_importDetails()}</summary>
              <p class="mt-1 whitespace-pre-wrap break-words">{diagnostic.message}</p>
            </details>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}
