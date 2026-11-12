/**
 * @vitest-environment jsdom
 *
 * Add machine → Intent on this computer: every preview state renders, and the
 * form formats the code, only offers Connect for a complete code on an
 * Intent that accepts connections, and clears the code when told to.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalIntent, LocalRedeemError } from '$shared/types/local-pairing';
import LocalIntentAddPreview, {
  LOCAL_INTENT_ADD_PREVIEW_STATES,
} from './local-intent-add.preview.svelte';
import LocalIntentAddForm from './LocalIntentAddForm.svelte';

afterEach(() => cleanup());

const INTENTS: LocalIntent[] = [
  { instanceId: 'b', displayName: 'Intent Beta', dataDir: '/tmp/b', accepting: true },
  { instanceId: 'c', displayName: 'Intent (dev build)', dataDir: '/tmp/c', accepting: false },
];

const codeField = () => screen.getByTestId('local-intent-code') as HTMLInputElement;
const connect = () => screen.getByRole('button', { name: /Connect/ });

type FormProps = {
  phase: 'ready' | 'redeeming' | 'added';
  intents: LocalIntent[] | null;
  listFailed: boolean;
  selectedId: string | null;
  error: LocalRedeemError | null;
  addedName: string | null;
  codeResets?: number;
};

function form(overrides: Partial<FormProps> = {}) {
  const props = {
    phase: 'ready' as FormProps['phase'],
    intents: INTENTS as LocalIntent[] | null,
    listFailed: false,
    selectedId: 'b' as string | null,
    error: null as LocalRedeemError | null,
    addedName: null as string | null,
    onPick: vi.fn(),
    onSubmit: vi.fn(),
    onCodeEdited: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { props, ...render(LocalIntentAddForm, props) };
}

describe('local intent add preview', () => {
  it.each(LOCAL_INTENT_ADD_PREVIEW_STATES)('renders state %s', (state) => {
    const { container } = render(LocalIntentAddPreview, { state });
    expect(container.querySelector('[data-testid="local-intent-add"]')).not.toBeNull();
  });

  it('shows the matching error for each failure state', () => {
    for (const state of ['wrong-code', 'locked', 'remote-access-on', 'unknown'] as const) {
      const { container, unmount } = render(LocalIntentAddPreview, { state });
      const error = container.querySelector('[data-testid="local-intent-error"]');
      expect(error?.getAttribute('data-error-code')).toBe(state);
      unmount();
    }
  });

  it('explains how to find other Intents when none is running', () => {
    render(LocalIntentAddPreview, { state: 'empty' });
    expect(screen.getByTestId('local-intent-empty')).toBeTruthy();
    expect(screen.queryByTestId('local-intent-code')).toBeNull();
  });

  it('blocks Connect for an Intent that is not accepting connections', () => {
    render(LocalIntentAddPreview, { state: 'not-accepting' });
    expect(screen.getByTestId('local-intent-not-accepting-hint')).toBeTruthy();
    expect(connect().hasAttribute('disabled')).toBe(true);
  });
});

describe('LocalIntentAddForm', () => {
  it('formats the typed code and submits it once complete', async () => {
    const { props } = form();
    await fireEvent.input(codeField(), { target: { value: 'ktp82' } });
    expect(codeField().value).toBe('KTP-82');
    expect(connect().hasAttribute('disabled')).toBe(true);
    await fireEvent.input(codeField(), { target: { value: 'ktp82m' } });
    expect(codeField().value).toBe('KTP-82M');
    await fireEvent.click(connect());
    expect(props.onSubmit).toHaveBeenCalledWith('KTP-82M');
    expect(props.onCodeEdited).toHaveBeenCalled();
  });

  it('reports a picked Intent', async () => {
    const { props } = form({ selectedId: null });
    await fireEvent.click(screen.getByRole('radio', { name: /Intent \(dev build\)/ }));
    expect(props.onPick).toHaveBeenCalledWith('c');
  });

  it('clears the code when the store says it can never work again', async () => {
    const { rerender } = form();
    await fireEvent.input(codeField(), { target: { value: 'KTP82M' } });
    await rerender({ codeResets: 1, error: { code: 'wrong-code', attemptsRemaining: 4 } });
    expect(codeField().value).toBe('');
    expect(screen.getByTestId('local-intent-error').getAttribute('data-error-code')).toBe(
      'wrong-code',
    );
  });

  it('closes from Cancel and from Done', async () => {
    const { props } = form();
    await fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const added = form({ phase: 'added', addedName: 'Intent Beta' });
    await fireEvent.click(screen.getByRole('button', { name: /Done/ }));
    expect(added.props.onClose).toHaveBeenCalledTimes(1);
  });

  it('reports a list it could not read', () => {
    form({ intents: null, listFailed: true });
    expect(screen.getByTestId('local-intent-list-failed')).toBeTruthy();
  });
});
