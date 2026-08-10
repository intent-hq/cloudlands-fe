<script context="module" lang="ts">
  /** Known provider IDs that have icons - matches the real implementation */
  const KNOWN_PROVIDER_IDS = new Set([
    'auggie',
    'claude-code',
    'codex',
    'opencode',
    'droid',
    'grok',
    'unsloth',
    'cortex',
    'pi',
  ]);

  /**
   * Check if a provider ID has a known icon - matches the real implementation.
   * This mock exports the real logic so conditional rendering in the component works correctly.
   */
  export function hasProviderIcon(providerId: string | undefined): boolean {
    return providerId !== undefined && KNOWN_PROVIDER_IDS.has(providerId);
  }
</script>

<script lang="ts">
  export let providerId: string;
  let className = '';
  export { className as class };
</script>

<!--
  Mock always renders for testing purposes - even for unknown providers.
  This allows tests to verify the provider ID is passed correctly,
  even when the real component would conditionally hide the icon.
-->
<span class="inline-flex {className}" data-testid="provider-icon" data-provider-id={providerId}
></span>
