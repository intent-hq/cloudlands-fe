<!-- Marker stand-in for WorkspaceSetupCard: renders a stable testid so
     ChatPanel branch tests can assert the card's presence/absence without
     the real card's dependency tree. The received setup-script props are
     mirrored onto data attributes so tests can assert what the card is
     handed to render. -->
<script lang="ts">
  let { setupScriptContent, setupScriptStatus }: Record<string, unknown> = $props();
</script>

<div
  data-testid="mock-workspace-setup-card"
  data-setup-script-content={typeof setupScriptContent === 'string'
    ? setupScriptContent
    : setupScriptContent === undefined
      ? undefined
      : `non-string:${typeof setupScriptContent}`}
  data-setup-script-status={setupScriptStatus}
></div>
