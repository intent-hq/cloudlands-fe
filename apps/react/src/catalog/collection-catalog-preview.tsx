// Sources: CollectionHarness.svelte, CollectionStateHarness.svelte, CardInsetContractHarness.svelte.
// i18n-ignore (reference catalog fixture content)
import { useState } from 'react';
import { DotsThreeIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import * as Card from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ListRow, ListView, RowActions, type ListKey } from '@/components/patterns/collection';
import { EmptyState } from '@/components/patterns/screen';

const items = [
  { id: 'alpha', name: 'Alpha', description: 'First item' },
  { id: 'beta', name: 'Beta', description: 'Second item' },
  { id: 'bravo', name: 'Bravo', description: 'Third item' },
];
function CollectionHarness() {
  const [selected, setSelected] = useState<ListKey[]>(['beta', 'bravo']);
  const [actionCount, setActionCount] = useState(0);
  const [lastAction, setLastAction] = useState('none');
  return (
    <>
      <ListView
        items={items}
        getKey={(item) => item.id}
        getText={(item) => item.name}
        selectable="multi"
        selectedKeys={selected}
        onSelectedKeysChange={setSelected}
        ariaLabel="Test collection"
        row={({ item }) => (
          <ListRow
            title={item.name}
            description={item.description}
            trailing={
              <>
                <Input aria-label={`Edit ${item.name}`} />
                <RowActions
                  actions={[
                    { id: 'act', label: `Act on ${item.name}`, icon: PlusIcon },
                    {
                      id: 'details',
                      label: `More about ${item.name}`,
                      icon: DotsThreeIcon,
                      shortcut: '⌘I',
                      checked: true,
                    },
                    {
                      id: 'delete',
                      label: `Delete ${item.name}`,
                      icon: TrashIcon,
                      destructive: true,
                    },
                  ]}
                  visibleCount={1}
                  overflowLabel={`More actions for ${item.name}`}
                  onAction={(id) => {
                    setLastAction(id);
                    if (id === 'act') setActionCount((count) => count + 1);
                  }}
                />
              </>
            }
          />
        )}
      />
      <output aria-label="Action count">{actionCount}</output>
      <output aria-label="Last action">{lastAction}</output>
    </>
  );
}
export function CollectionCatalogState({ state }: { state: string }) {
  if (state === 'card-inset')
    return (
      <Card.Root aria-label="Workspace activity">
        <Card.Header>
          <Card.Title>Workspace activity</Card.Title>
        </Card.Header>
        <Card.Content flush>
          <ListView
            items={['Active workspace']}
            selectable="single"
            row={({ item }) => <ListRow inset title={item} />}
          />
          <EmptyState
            inset
            density="compact"
            description="No archived workspaces yet."
            className="justify-start border-t border-border"
            contentClass="max-w-none text-left"
          />
        </Card.Content>
      </Card.Root>
    );
  if (state === 'empty' || state === 'loading' || state === 'error')
    return (
      <ListView
        items={[]}
        getKey={(item: { id: number; label: string }) => item.id}
        getText={(item) => item.label}
        status={state === 'empty' ? 'ready' : state}
        className="h-48"
        row={({ item }) => <ListRow title={item.label} />}
      />
    );
  return <CollectionHarness />;
}
