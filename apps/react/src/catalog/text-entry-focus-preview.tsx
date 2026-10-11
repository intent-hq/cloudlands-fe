// Source: src/lib/components/ui/text-entry-focus.preview.svelte (default).
// i18n-ignore (reference named scene content)
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SettingsTextarea } from '@/components/patterns/settings';

export function TextEntryFocusPreview() {
  const [input, setInput] = useState('Workspace');
  const [notes, setNotes] = useState('Draft notes');
  return (
    <section className="grid gap-3 bg-sidebar p-4" data-testid="text-entry-focus-fixture">
      <Button>Start keyboard navigation</Button>
      <Input
        aria-label="Workspace name"
        value={input}
        onChange={(event) => setInput(event.target.value)}
      />
      <Textarea
        aria-label="Workspace notes"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        rows={2}
      />
      <Input aria-label="Invalid name" error="A name is required" />
      <Textarea aria-label="Invalid notes" error="Notes are required" rows={2} />
      <Input aria-label="Disabled name" disabled value="Unavailable" />
      <Textarea aria-label="Read-only notes" readOnly value="Managed notes" rows={2} />
      <SettingsTextarea aria-label="Settings notes" defaultValue="Setting draft" rows={2} />
      <Input aria-label="Composite field" noFocusStyle defaultValue="Quiet composite" />
      <Input aria-label="Choose file" type="file" />
      <output className="sr-only" data-testid="text-entry-values">
        {JSON.stringify({ input, notes })}
      </output>
    </section>
  );
}
