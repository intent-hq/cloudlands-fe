// i18n-ignore (deterministic internal catalog example content)
import { useCallback, useState } from 'react';
import { SettingsFieldRow } from '@/components/patterns/settings';
import { useHighlightTarget } from '@/components/patterns/settings/highlight-target';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { store } from '@/store';
import { selectUiHighlightToken } from '@/store/ui-highlight/ui-highlight-selectors';
import { requestUiHighlight } from '../../../../src/store/renderer/slices/ui-highlight/ui-highlight-slice';

const highlightId = 'catalog-example-setting';

export function SettingsHighlightExample() {
  const [visible, setVisible] = useState(true);
  const [events, setEvents] = useState<string[]>([]);
  const highlight = useHighlightTarget(highlightId);
  const token = selectUiHighlightToken(highlightId);
  const target = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const record = (event: AnimationEvent) => {
        if (event.target === node) setEvents((current) => [...current, event.type]);
      };
      node.addEventListener('animationstart', record);
      node.addEventListener('animationend', record);
      node.addEventListener('animationcancel', record);
      const cleanup = highlight(node);
      return () => {
        cleanup?.();
        node.removeEventListener('animationstart', record);
        node.removeEventListener('animationend', record);
        node.removeEventListener('animationcancel', record);
      };
    },
    [highlight],
  );
  return (
    <section
      className="grid gap-4"
      data-functional-example="settings-highlight"
      aria-label="Settings highlight example"
    >
      <h2>Settings highlight</h2>
      <Button onClick={() => store.dispatch(requestUiHighlight(highlightId))}>
        Highlight example setting
      </Button>
      <Switch aria-label="Show highlight target" checked={visible} onCheckedChange={setVisible} />
      {visible && (
        <div ref={target} data-testid="example-highlight-target" data-highlight-id={highlightId}>
          <SettingsFieldRow
            id="catalog-example-setting-row"
            label="Example setting"
            htmlFor="catalog-example-setting-input"
          >
            <Input id="catalog-example-setting-input" defaultValue="Local example" />
          </SettingsFieldRow>
        </div>
      )}
      <SettingsFieldRow
        id="catalog-unrelated-setting"
        label="Unrelated setting"
        htmlFor="catalog-unrelated-setting-input"
      >
        <Input id="catalog-unrelated-setting-input" defaultValue="Other local example" />
      </SettingsFieldRow>
      <output aria-label="Highlight request token">{token.value}</output>
      <output aria-label="Highlight animation events">{JSON.stringify(events)}</output>
    </section>
  );
}
