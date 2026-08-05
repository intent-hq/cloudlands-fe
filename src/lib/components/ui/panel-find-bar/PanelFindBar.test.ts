import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/svelte';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import PanelFindBarTestHarness from './__tests__/PanelFindBarTestHarness.svelte';
import { warmImport } from '../../../../test/warm-import';

vi.mock('svelte-fa', async () => ({
  default: (await import('../__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faSearch: { iconName: 'search' },
  faXmark: { iconName: 'xmark' },
  faChevronUp: { iconName: 'chevron-up' },
  faChevronDown: { iconName: 'chevron-down' },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function getFindInput() {
  return screen.getByRole('textbox', { name: 'Test find' }) as HTMLInputElement;
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../__tests__/mocks/Fa.svelte'));

describe('PanelFindBar', () => {
  it('updates the bound query and calls input callbacks for each input event', async () => {
    const onQueryChange = vi.fn();
    const onInput = vi.fn();
    render(PanelFindBarTestHarness, { props: { onQueryChange, onInput } });

    await fireEvent.input(getFindInput(), { target: { value: 'needle' } });

    expect(getFindInput().value).toBe('needle');
    expect(onQueryChange).toHaveBeenCalledWith('needle', expect.any(Event));
    expect(onInput).toHaveBeenCalledWith(expect.any(Event));
    await waitFor(() => expect(screen.getByTestId('bound-query').textContent).toBe('needle'));
  });

  it('calls onClose from Escape and the close button', async () => {
    const onClose = vi.fn();
    render(PanelFindBarTestHarness, { props: { initialQuery: 'needle', onClose } });

    await fireEvent.keyDown(getFindInput(), { key: 'Escape' });
    await fireEvent.click(screen.getByRole('button', { name: 'Close find' }));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('navigates with Enter shortcuts and previous/next buttons using the current query', async () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(PanelFindBarTestHarness, { props: { initialQuery: 'needle', onPrevious, onNext } });

    await fireEvent.keyDown(getFindInput(), { key: 'Enter' });
    await fireEvent.keyDown(getFindInput(), { key: 'Enter', shiftKey: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));

    expect(onNext).toHaveBeenCalledTimes(2);
    expect(onNext).toHaveBeenCalledWith('needle', expect.any(Event));
    expect(onPrevious).toHaveBeenCalledTimes(2);
    expect(onPrevious).toHaveBeenCalledWith('needle', expect.any(Event));
  });

  it('renders default, custom, and no-match result text', () => {
    const { rerender } = render(PanelFindBarTestHarness, {
      props: { initialQuery: 'needle', currentMatchIndex: 1, totalMatches: 5 },
    });
    expect(screen.getByText('2 / 5')).toBeTruthy();

    rerender({ initialQuery: 'needle', currentMatchIndex: 1, totalMatches: 5, resultFormat: 'of' });
    expect(screen.getByText('2 of 5')).toBeTruthy();

    rerender({ initialQuery: 'needle', totalMatches: 5, resultText: 'custom status' });
    expect(screen.getByText('custom status')).toBeTruthy();

    cleanup();
    render(PanelFindBarTestHarness, { props: { initialQuery: 'missing', totalMatches: 0 } });
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('disables navigation when there is no query, no matches, or navigation is disabled', async () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const { rerender } = render(PanelFindBarTestHarness, { props: { onPrevious, onNext } });

    const previous = screen.getByRole('button', { name: 'Previous match' }) as HTMLButtonElement;
    const next = screen.getByRole('button', { name: 'Next match' }) as HTMLButtonElement;
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(true);

    rerender({ initialQuery: 'missing', totalMatches: 0, onPrevious, onNext });
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(true);
    await fireEvent.keyDown(getFindInput(), { key: 'Enter' });
    await fireEvent.keyDown(getFindInput(), { key: 'Enter', shiftKey: true });
    expect(onNext).not.toHaveBeenCalled();
    expect(onPrevious).not.toHaveBeenCalled();

    rerender({ initialQuery: 'needle', totalMatches: 2, navigationDisabled: true, onPrevious, onNext });
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(true);
  });
});