// Source fixture: settings-textarea.preview.svelte, controls state only.
// The consumers state requires the separately owned AutoSaveTextarea and McpJsonImport ports.
// i18n-ignore (Reference fixture text; not product copy.)
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea as OrdinaryTextarea } from '@/components/ui/textarea';
import { SettingsTextarea } from './settings-textarea';

export function SettingsTextareaPreview() {
  const [draft, setDraft] = useState('Settings draft');
  const editor = useRef<HTMLTextAreaElement>(null);
  const [inputCount, setInputCount] = useState(0);
  const [focusCount, setFocusCount] = useState(0);
  const [blurCount, setBlurCount] = useState(0);
  return (
    <section
      className="grid w-full gap-4 bg-muted p-4 text-foreground"
      data-testid="settings-textarea-preview"
    >
      <SettingsTextarea
        ref={editor}
        value={draft}
        aria-label="Editable setting"
        rows={3}
        className="bg-background"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onInput={() => setInputCount((value) => value + 1)}
        onFocus={() => setFocusCount((value) => value + 1)}
        onBlur={() => setBlurCount((value) => value + 1)}
      />
      <SettingsTextarea
        aria-label="Empty setting"
        placeholder="Describe your preferences"
        rows={3}
      />
      <SettingsTextarea
        aria-label="Read-only setting"
        value="Managed by your organization"
        readOnly
        rows={3}
      />
      <SettingsTextarea
        aria-label="Disabled setting"
        value="Unavailable setting"
        disabled
        rows={3}
      />
      <OrdinaryTextarea aria-label="Ordinary textarea" defaultValue="Unrelated editor" rows={3} />
      <div className="flex gap-2">
        <Button onClick={() => editor.current?.focus()}>Focus setting</Button>
        <Button onClick={() => editor.current?.blur()}>Blur setting</Button>
      </div>
      <output
        data-testid="textarea-events"
        data-inputs={inputCount}
        data-focuses={focusCount}
        data-blurs={blurCount}
      >
        {draft}
      </output>
    </section>
  );
}
