// i18n-ignore (internal native persistence exercise)
import { useState } from 'react';
import { FolderIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { CollapsiblePanel } from '@/components/ui/collapsible-panel';
import { Input } from '@/components/ui/input';

export function CollapsiblePanelExample() {
  const [mounted, setMounted] = useState(true);
  const [draft, setDraft] = useState('Panel draft');
  return (
    <section
      className="grid gap-4"
      data-functional-example="collapsible-panel"
      aria-label="Collapsible panel persistence example"
    >
      <h2>Collapsible panel persistence</h2>
      <p>
        The two saved panels share the catalog-native-panel preference through the production Store
        and persistence saga. Toggle either panel, remount, or reload to observe the stored choice.
        The draft below is local to this example.
      </p>
      <Button variant="outline" onClick={() => setMounted((value) => !value)}>
        {mounted ? 'Unmount panels' : 'Mount panels'}
      </Button>
      {mounted && (
        <div className="grid gap-4">
          <CollapsiblePanel
            title="Saved panel"
            storageKey="catalog-native-panel"
            icon={FolderIcon}
            showChevronOnHover={false}
            headerActions={<span>Local example</span>}
          >
            <Input
              aria-label="Panel draft"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </CollapsiblePanel>
          <CollapsiblePanel
            title="Shared preference panel"
            storageKey="catalog-native-panel"
            defaultCollapsed
            showGradient={false}
          >
            <p>Both saved panels observe the same canonical preference.</p>
          </CollapsiblePanel>
          <CollapsiblePanel title="Initially collapsed panel" defaultCollapsed>
            <Button variant="outline">Local panel action</Button>
          </CollapsiblePanel>
        </div>
      )}
      <output aria-label="Panel local draft">{draft}</output>
      <output aria-label="Panels mounted">{String(mounted)}</output>
    </section>
  );
}
