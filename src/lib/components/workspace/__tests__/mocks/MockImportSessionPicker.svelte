<script lang="ts">
  /**
   * ImportSessionPicker stand-in for CompactWorkspaceInitializer tests:
   * exposes the form's `onSelect` on `window` so a test can pick a session
   * without the daemon-backed list.
   */
  let {
    onSelect,
  }: {
    onSelect?: (session: Record<string, unknown> | null) => void;
    [key: string]: unknown;
  } = $props();

  $effect(() => {
    const registry = window as unknown as Record<string, unknown>;
    registry.__mockImportSessionPicker = { onSelect };
    return () => {
      if ((registry.__mockImportSessionPicker as { onSelect?: unknown })?.onSelect === onSelect)
        delete registry.__mockImportSessionPicker;
    };
  });
</script>
