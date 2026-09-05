<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import SettingsPage from './SettingsPage.svelte';
  import { defineSettings } from './schema';
  import type { SettingsTab } from './types';

  let { searchQuery = '' }: { searchQuery?: string } = $props();
  let enabled = $state(true);
  let choice = $state('one');
  let text = $state('hello');
  let count = $state(2);
  let path = $state('/tmp');
  let keybinding = $state('Cmd+K');
  let showConditional = $state(false);
  let activeTab = $state<SettingsTab>('display');

  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'general',
          title: 'General settings',
          entries: [
            {
              kind: 'switch',
              id: 'enabled',
              label: 'Enable feature',
              description: 'Controls the feature.',
              featureCode: 'feature.flag',
              get: () => enabled,
              set: (value: boolean) => {
                enabled = value;
              },
            },
            {
              kind: 'select',
              id: 'choice',
              label: 'Choice',
              options: [
                { value: 'one', label: 'One' },
                { value: 'two', label: 'Two' },
              ],
              get: () => choice,
              set: (value: string) => {
                choice = value;
              },
            },
            {
              kind: 'input',
              id: 'text',
              label: 'Text value',
              get: () => text,
              set: (value: string) => {
                text = value;
              },
            },
            {
              kind: 'number',
              id: 'count',
              label: 'Count',
              get: () => count,
              set: (value: number) => {
                count = value;
              },
            },
            {
              kind: 'path',
              id: 'path',
              label: 'Path',
              get: () => path,
              set: (value: string) => {
                path = value;
              },
            },
            {
              kind: 'keybinding',
              id: 'keybinding',
              label: 'Shortcut',
              get: () => keybinding,
              set: (value: string) => {
                keybinding = value;
              },
            },
            {
              kind: 'action',
              id: 'reset',
              label: 'Reset values',
              actionLabel: 'Reset',
              action: () => {
                count = 0;
              },
            },
            { kind: 'custom', id: 'servers', label: 'Server integrations' },
            {
              kind: 'switch',
              id: 'conditional',
              label: 'Conditional feature',
              when: () => showConditional,
              get: () => false,
              set: () => undefined,
            },
          ],
        },
      ],
    }),
  );
</script>

<Button onclick={() => (showConditional = true)}>Reveal condition</Button>

{#snippet serversControl()}
  <div data-testid="complex-custom">Embedded server manager</div>
{/snippet}

{#snippet agentsNavigation()}<button type="button">Example specialist</button>{/snippet}

<SettingsPage
  title="Application settings"
  {schema}
  {searchQuery}
  custom={{ servers: serversControl }}
  {activeTab}
  onSelect={(tab) => (activeTab = tab)}
  {agentsNavigation}
/>
