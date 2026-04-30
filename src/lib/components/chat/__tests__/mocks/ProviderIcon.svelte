<script lang="ts">
  export let providerId: string;
  let className = '';
  export { className as class };
</script>

<span class="inline-flex {className}" data-testid="provider-icon" data-provider-id={providerId}
></span>
