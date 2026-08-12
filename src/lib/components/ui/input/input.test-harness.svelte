<script lang="ts">
  import Input from './input.svelte';

  let { value = $bindable('') }: { value?: string } = $props();
</script>

<label for="profile-name">Profile name</label>
<Input
  id="profile-name"
  bind:value
  aria-describedby="profile-name-description profile-name-error"
  aria-invalid="true"
  placeholder="Enter a profile name"
/>
<p id="profile-name-description">Shown to collaborators.</p>
<p id="profile-name-error">A profile name is required.</p>
<output data-testid="input-value">{value}</output>
