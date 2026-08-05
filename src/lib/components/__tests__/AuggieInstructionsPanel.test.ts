import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import AuggieInstructionsPanel from '../AuggieInstructionsPanel.svelte';
import { warmImport } from '../../../test/warm-import';

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faPaste: { iconName: 'paste' },
  faXmark: { iconName: 'xmark' },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('svelte-sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const clipboardWriteText = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(navigator, {
    clipboard: { writeText: clipboardWriteText.mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../ui/__tests__/mocks/Fa.svelte'));

describe('AuggieInstructionsPanel', () => {
  it('renders every instruction as an ordered list item', () => {
    const instructions = [
      'Install Node.js 22+ from https://nodejs.org.',
      'Run `npm install -g @augmentcode/auggie` in your terminal.',
    ];
    const { container } = render(AuggieInstructionsPanel, {
      props: { instructions, command: 'npm install -g @augmentcode/auggie' },
    });

    const items = container.querySelectorAll('ol > li');
    expect(items.length).toBe(instructions.length);
    expect(items[0]?.textContent).toContain('Install Node.js 22+');
    expect(items[1]?.textContent).toContain('npm install -g @augmentcode/auggie');
  });

  it('renders the copyable command and copies to clipboard on click', async () => {
    const command = 'auggie login';
    const { getByTestId } = render(AuggieInstructionsPanel, {
      props: { instructions: ['Run `auggie login` in your terminal.'], command },
    });

    const copyButton = getByTestId('auggie-instructions-copy');
    expect(copyButton.textContent).toContain(command);

    await fireEvent.click(copyButton);
    expect(clipboardWriteText).toHaveBeenCalledWith(command);
    expect(toastSuccess).toHaveBeenCalledWith('Copied to clipboard');
  });

  it('invokes onRecheck when the user clicks "check again"', async () => {
    const onRecheck = vi.fn();
    const { getByTestId } = render(AuggieInstructionsPanel, {
      props: {
        instructions: ['Run `auggie login`.'],
        command: 'auggie login',
        onRecheck,
      },
    });

    await fireEvent.click(getByTestId('auggie-instructions-recheck'));
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  it('does not render the copy button when no command is provided', () => {
    const { queryByTestId } = render(AuggieInstructionsPanel, {
      props: { instructions: ['Some manual step.'] },
    });
    expect(queryByTestId('auggie-instructions-copy')).toBeNull();
  });

  it('invokes onDismiss when the close button is clicked', async () => {
    const onDismiss = vi.fn();
    const { container } = render(AuggieInstructionsPanel, {
      props: {
        instructions: ['Step 1'],
        command: 'auggie login',
        onDismiss,
      },
    });
    const dismissBtn = container.querySelector(
      'button[aria-label="Dismiss instructions"]',
    ) as HTMLButtonElement;
    expect(dismissBtn).toBeTruthy();
    await fireEvent.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
