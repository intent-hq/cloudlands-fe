// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import CatalogControls from './CatalogControls.svelte';

describe('CatalogControls', () => {
  afterEach(() => cleanup());

  it('renders color themes in a dropdown and appearance modes as separate choices', async () => {
    render(CatalogControls, { props: { theme: 'system' } });

    const trigger = screen.getByRole('button', { name: 'Color theme' });
    expect(trigger.textContent).toContain('Default');
    expect(screen.getByText('System theme selected, currently light')).not.toBeNull();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('option', { name: 'Default' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    for (const name of [
      'Dracula',
      'Nord',
      'Rosé Pine',
      'Tokyo Night',
      'Solarized',
      'GitHub',
      'High Contrast',
    ]) {
      expect(screen.getByRole('option', { name })).not.toBeNull();
    }

    await fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    await waitFor(() => expect(trigger.textContent).toContain('Dracula'));
    expect(screen.queryByRole('listbox')).toBeNull();

    const system = screen.getByRole('radio', { name: 'System' });
    expect(system.getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(screen.getByText('Dark theme selected')).not.toBeNull();
  });
});
