<script lang="ts">
  import Tab from '$features/layout/components/panel-tabs/Tab.svelte';
  import CollapsiblePanel from '$lib/components/ui/CollapsiblePanel.svelte';
</script>

<section>
  <span data-testid="comment-highlight" class="comment-highlight">Comment</span>
  <div data-testid="tool-call" class="tool-call">Tool call</div>
  <span data-testid="mention-chip" class="mention-chip">Mention</span>

  <div data-testid="tab">
    <Tab id="style-probe" active onclose={() => {}}>Tab</Tab>
  </div>

  <div data-testid="collapsible">
    <CollapsiblePanel title="Panel" showChevronOnHover={false}>Content</CollapsiblePanel>
  </div>

  <button
    data-testid="paint-only-utility"
    class="transition-[background-color,box-shadow] duration-150"
    type="button"
  >
    Paint-only utility
  </button>
</section>
