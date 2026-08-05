<script lang="ts">
  import DirectoryPickerView from '$features/onboarding/messages/DirectoryPickerView.svelte';
  import { m } from '$shared/paraglide/messages.js';

  import { getMockDirectoryListing, MOCK_HOME } from './mock-filesystem';

  let currentPath = $state(MOCK_HOME);
  let open = $state(true);
  let showFiles = $state(true);
  let fakeLoading = $state(false);
  let fakeListingError = $state(false);
  let fakePathError = $state(false);
  let navigationPathError = $state<string | null>(null);
  let lastAction = $state(m.sandbox_directoryPicker_ready_label());

  const listing = $derived(getMockDirectoryListing(currentPath));
  const listingError = $derived(
    fakeListingError ? m.sandbox_directoryPicker_mockReadFailed_error() : null,
  );
  const pathError = $derived(
    fakePathError ? m.sandbox_directoryPicker_mockPathOpenFailed_error() : navigationPathError,
  );

  function navigate(path?: string) {
    const target = path ?? MOCK_HOME;
    if (!getMockDirectoryListing(target)) {
      navigationPathError = m.sandbox_directoryPicker_missingDirectory_error({ path: target });
      return;
    }

    currentPath = target;
    navigationPathError = null;
    lastAction = m.sandbox_directoryPicker_navigated_description({ path: target });
  }

  function clearPathError() {
    fakePathError = false;
    navigationPathError = null;
  }

  function selectPath(path: string) {
    lastAction = m.sandbox_directoryPicker_selected_description({ path });
  }

  function cancelPicker() {
    open = false;
    lastAction = m.sandbox_directoryPicker_selectionCancelled_description();
  }

  function openPicker() {
    open = true;
    lastAction = m.sandbox_directoryPicker_opened_description();
  }
</script>

<svelte:head>
  <title>{m.sandbox_directoryPicker_page_title()}</title>
</svelte:head>

<section class="mx-auto max-w-5xl space-y-6 p-6 lg:p-10">
  <div class="space-y-2">
    <p class="text-xs font-medium uppercase tracking-wide text-subtle">
      {m.sandbox_directoryPicker_componentSandbox_label()}
    </p>
    <h1 class="text-2xl font-semibold tracking-tight">{m.sandbox_directoryPicker_title()}</h1>
    <p class="max-w-2xl text-sm leading-relaxed text-subtle">
      {m.sandbox_directoryPicker_description()}
    </p>
  </div>

  <div
    class="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-border bg-background p-4"
  >
    <label class="flex cursor-pointer items-center gap-2 text-sm">
      <input bind:checked={showFiles} type="checkbox" class="accent-primary" />
      {m.sandbox_directoryPicker_showFiles_label()}
    </label>
    <label class="flex cursor-pointer items-center gap-2 text-sm">
      <input bind:checked={fakeLoading} type="checkbox" class="accent-primary" />
      {m.sandbox_directoryPicker_fakeLoading_label()}
    </label>
    <label class="flex cursor-pointer items-center gap-2 text-sm">
      <input bind:checked={fakeListingError} type="checkbox" class="accent-primary" />
      {m.sandbox_directoryPicker_fakeListingError_label()}
    </label>
    <label class="flex cursor-pointer items-center gap-2 text-sm">
      <input bind:checked={fakePathError} type="checkbox" class="accent-primary" />
      {m.sandbox_directoryPicker_fakePathError_label()}
    </label>
    {#if !open}
      <button
        type="button"
        class="ml-auto rounded-md bg-foreground px-3 py-1.5 text-sm text-background"
        onclick={openPicker}
      >
        {m.sandbox_directoryPicker_open_label()}
      </button>
    {/if}
  </div>

  <div class="rounded-lg border border-border/70 bg-muted/20 px-4 py-3 text-sm">
    <span class="font-medium">{m.sandbox_directoryPicker_lastAction_label()}</span>
    <span class="ml-1 break-all text-subtle">{lastAction}</span>
  </div>

  <div class="flex min-h-[32rem] items-start justify-center">
    <DirectoryPickerView
      {open}
      title={m.sandbox_directoryPicker_pickerTitle_title()}
      selectLabel={m.onboarding_dirPicker_selectFolder_label()}
      {listing}
      loading={fakeLoading}
      error={listingError}
      {pathError}
      {showFiles}
      onClose={cancelPicker}
      onSelect={selectPath}
      onNavigate={navigate}
      onNavigateToPath={navigate}
      onClearPathError={clearPathError}
    />
  </div>
</section>
