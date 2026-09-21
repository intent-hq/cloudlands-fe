<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  interface Props {
    state?: 'controls' | 'consumers';
  }
  export const preview = definePreview<Props>({
    id: 'settings-textarea',
    title: 'Settings textarea surfaces',
    defaultState: 'controls',
    states: {
      controls: { props: { state: 'controls' } },
      consumers: { props: { state: 'consumers' } },
    },
  });
</script>

<script lang="ts">
  import { Button, Textarea } from '$lib/components/patterns/settings/custom-controls';
  import { Textarea as OrdinaryTextarea } from '$lib/components/ui/textarea';
  import AutoSaveTextarea from '$lib/components/settings/AutoSaveTextarea.svelte';
  import McpJsonImport from '$lib/components/settings/mcp/McpJsonImport.svelte';

  let { state: scenario = 'controls' }: Props = $props();
  let draft = $state('Settings draft');
  let editor = $state<{ focus: () => void; blur: () => void }>();
  let nativeRef = $state<HTMLTextAreaElement | null>(null);
  let inputCount = $state(0);
  let focusCount = $state(0);
  let blurCount = $state(0);
  let saved = $state('');
  let imported = $state('');
</script>

<section
  class="grid w-full gap-4 bg-muted p-4 text-foreground"
  data-testid="settings-textarea-preview"
>
  {#if scenario === 'controls'}
    <Textarea
      bind:this={editor}
      bind:ref={nativeRef}
      bind:value={draft}
      aria-label="Editable setting"
      rows={3}
      class="bg-background"
      oninput={() => (inputCount += 1)}
      onfocus={() => (focusCount += 1)}
      onblur={() => (blurCount += 1)}
    />
    <Textarea aria-label="Empty setting" placeholder="Describe your preferences" rows={3} />
    <Textarea
      aria-label="Read-only setting"
      value="Managed by your organization"
      readonly
      rows={3}
    />
    <Textarea aria-label="Disabled setting" value="Unavailable setting" disabled rows={3} />
    <OrdinaryTextarea aria-label="Ordinary textarea" value="Unrelated editor" rows={3} />
    <div class="flex gap-2">
      <Button onclick={() => editor?.focus()}>Focus setting</Button>
      <Button onclick={() => editor?.blur()}>Blur setting</Button>
    </div>
    <output
      data-testid="textarea-events"
      data-native-ref={nativeRef?.tagName ?? ''}
      data-inputs={inputCount}
      data-focuses={focusCount}
      data-blurs={blurCount}>{draft}</output
    >
  {:else}
    <div data-testid="autosave-setting">
      <AutoSaveTextarea
        value="Original prompt"
        originalValue="Original prompt"
        minRows={3}
        onSave={(value) => {
          saved = value;
        }}
      />
    </div>
    <output data-testid="saved-setting">{saved}</output>
    <div data-testid="json-import-setting">
      <McpJsonImport
        onImport={async (value) => {
          imported = value;
        }}
        onCancel={() => {
          imported = 'cancelled';
        }}
      />
    </div>
    <output data-testid="imported-setting">{imported}</output>
  {/if}
</section>
