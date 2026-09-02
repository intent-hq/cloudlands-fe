<script lang="ts">
  /**
   * AttachmentPreview stand-in that exposes its identifying props as data
   * attributes so tests can assert which items are staged as pills.
   */
  let {
    id = '',
    name = '',
    type = '',
  }: { id?: string; name?: string; type?: string; [key: string]: unknown } = $props();
</script>

<div data-testid="attachment-pill" data-id={id} data-name={name} data-type={type}></div>
