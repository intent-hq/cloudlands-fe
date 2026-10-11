// Source: src/lib/components/settings/mcp/McpJsonImport.svelte.
import { useState, type KeyboardEvent } from 'react';
import { Button, Textarea } from '@/components/patterns/settings/custom-controls';
import { m } from '$shared/paraglide/messages.js';

export interface McpJsonImportProps {
  onImport: (json: string) => Promise<void>;
  onCancel: () => void;
}

export function McpJsonImport({ onImport, onCancel }: McpJsonImportProps) {
  const [jsonContent, setJsonContent] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);

  function handleKeydown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void handleImport();
    }
  }

  async function handleImport() {
    setError('');

    if (!jsonContent.trim()) {
      setError(m.settings_mcp_import_emptyError());
      return;
    }

    try {
      const parsed: unknown = JSON.parse(jsonContent);

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setError(m.settings_mcp_import_structureError());
        return;
      }

      if (Object.keys(parsed).length === 0) {
        setError(m.settings_mcp_import_noServersError());
        return;
      }
    } catch {
      setError(m.settings_mcp_import_invalidJsonError());
      return;
    }

    setImporting(true);
    try {
      await onImport(jsonContent);
    } catch (error) {
      setError(error instanceof Error ? error.message : m.settings_mcp_import_failedError());
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <span className="block type-body font-medium mb-1.5">{m.settings_mcp_import_title()}</span>
        <Textarea
          value={jsonContent}
          onChange={(event) => setJsonContent(event.currentTarget.value)}
          onKeyDown={handleKeydown}
          // i18n-ignore (JSON config example)
          placeholder={'{"my-server": {"command": "npx", "args": ["-y", "@some/mcp-server"]}}'}
          rows={12}
          className="w-full px-3 py-2 type-body font-mono rounded-md border border-border bg-background resize-none"
        />
        <p className="type-body text-subtle mt-1">{m.settings_mcp_import_formatHint()}</p>
      </div>

      {error && <div className="type-body text-danger">{error}</div>}

      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel} className="flex-1">
          {m.settings_mcp_import_cancel()}
        </Button>
        <Button onClick={handleImport} disabled={importing} className="flex-1">
          {importing ? m.settings_mcp_import_importing() : m.settings_mcp_import_importServers()}
        </Button>
      </div>
    </div>
  );
}
