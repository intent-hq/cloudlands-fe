<script lang="ts">
  import SetupScriptModal from '$lib/components/modals/SetupScriptModal.svelte';
  import {
    resolveSetupScriptParam,
    REPO_CONFIG_SCRIPT_NAME,
    type SetupScriptNameSource,
  } from '$features/setup-scripts';
  let { untouched = false }: { untouched?: boolean } = $props();
  let open = $state(true);
  let value = $state(untouched ? '' : 'echo committed setup');
  let name = $state(untouched ? 'Custom' : REPO_CONFIG_SCRIPT_NAME);
  let source = $state<SetupScriptNameSource>(untouched ? 'custom' : 'repo-config');
  let custom = $state(false);
  let explicit = false;
  let request = $state<string | undefined>();
</script>

<SetupScriptModal
  bind:open
  bind:value
  bind:scriptName={name}
  bind:scriptNameSource={source}
  bind:isCustomScript={custom}
  repoConfigScript="echo committed setup"
  onCommit={() => {
    explicit = true;
  }}
/>
<button
  onclick={() => {
    open = true;
  }}>Reopen setup</button
>
<button
  onclick={() => {
    request = resolveSetupScriptParam({
      setupScript: value,
      setupScriptName: name,
      setupScriptNameSource: source,
      explicitChoice: explicit,
      repoPath: '/selected',
      repoConfigScriptRepo: '/selected',
      repoConfigScript: 'echo committed setup',
    });
  }}>Create</button
>
<output aria-label="committed script">{JSON.stringify(value)}</output>
<output aria-label="committed source">{source}</output>
<output aria-label="create override">{request ?? 'omitted'}</output>
