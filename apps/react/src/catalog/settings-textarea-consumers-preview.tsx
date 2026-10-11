// Exact consumers branch of patterns/settings/settings-textarea.preview.svelte.
// i18n-ignore (reference named scene content)
import { useState } from 'react';
import { AutoSaveTextarea } from '@/components/settings/auto-save-textarea';
import { McpJsonImport } from '@/components/settings/mcp/mcp-json-import';

export function SettingsTextareaConsumersPreview() {
  const [saved, setSaved] = useState('');
  const [imported, setImported] = useState('');
  return (
    <section
      className="grid w-full gap-4 bg-muted p-4 text-foreground"
      data-testid="settings-textarea-preview"
    >
      <div data-testid="autosave-setting">
        <AutoSaveTextarea
          value="Original prompt"
          originalValue="Original prompt"
          minRows={3}
          onSave={(value) => setSaved(value)}
        />
      </div>
      <output data-testid="saved-setting">{saved}</output>
      <div data-testid="json-import-setting">
        <McpJsonImport
          onImport={async (value) => setImported(value)}
          onCancel={() => setImported('cancelled')}
        />
      </div>
      <output data-testid="imported-setting">{imported}</output>
    </section>
  );
}
