// Source fixture: src/lib/components/patterns/settings/SettingsHarness.svelte.
// i18n-ignore (Reference fixture text; not product copy.)
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { SettingsPage } from './settings-page';
import { SettingsForm } from './settings-form';
import { defineSettings } from './schema';
import type { SettingsTab } from './types';

export interface SettingsPreviewProps {
  searchQuery?: string;
  formOnly?: boolean;
  compact?: boolean;
  hiddenTabs?: readonly SettingsTab[];
  state?: string;
}
export function SettingsPreview({
  searchQuery = '',
  formOnly = false,
  compact = false,
  hiddenTabs = [],
  state = 'default',
}: SettingsPreviewProps) {
  const [enabled, setEnabled] = useState(true);
  const [choice, setChoice] = useState('one');
  const [text, setText] = useState('hello');
  const [count, setCount] = useState(2);
  const [path, setPath] = useState('/tmp');
  const [keybinding, setKeybinding] = useState('Cmd+K');
  const [showConditional, setShowConditional] = useState(state === 'conditional');
  const [activeTab, setActiveTab] = useState<SettingsTab>('display');
  const schema = defineSettings({
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
            set: setEnabled,
            experimental: state === 'experimental',
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
            set: setChoice,
          },
          { kind: 'input', id: 'text', label: 'Text value', get: () => text, set: setText },
          { kind: 'number', id: 'count', label: 'Count', get: () => count, set: setCount },
          { kind: 'path', id: 'path', label: 'Path', get: () => path, set: setPath },
          {
            kind: 'keybinding',
            id: 'keybinding',
            label: 'Shortcut',
            get: () => keybinding,
            set: setKeybinding,
          },
          {
            kind: 'action',
            id: 'reset',
            label: 'Reset values',
            actionLabel: 'Reset',
            action: () => setCount(0),
            danger: state === 'danger',
          },
          { kind: 'custom', id: 'servers', label: 'Server integrations' },
          {
            kind: 'custom',
            id: 'full-width-custom',
            label: 'Pattern-owned full-width label',
            layout: 'full-width',
          },
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
  });
  const shared = {
    schema,
    searchQuery: state === 'filtered' ? 'feature.flag' : searchQuery,
    custom: {
      servers: () => <div data-testid="complex-custom">Embedded server manager</div>,
      'full-width-custom': () => <div data-testid="full-width-custom">Self-owned custom label</div>,
    },
    descriptions: {
      enabled: (
        <>
          Controls the feature (for example, <code>enabled</code>).
        </>
      ),
    },
  };
  return (
    <div data-settings-preview className="flex h-full min-h-0 flex-col gap-3">
      <div>
        <Button onClick={() => setShowConditional(true)}>Reveal condition</Button>
      </div>
      {formOnly ? (
        <SettingsForm {...shared} compact={compact} />
      ) : (
        <SettingsPage
          title="Application settings"
          {...shared}
          activeTab={activeTab}
          onSelect={setActiveTab}
          hiddenTabs={hiddenTabs}
          agentsNavigation={<Button>Example specialist</Button>}
        />
      )}
    </div>
  );
}
