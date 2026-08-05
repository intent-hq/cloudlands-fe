import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import ChatCliBlock from '../ChatCliBlock.svelte';
import { warmImport } from '../../../../test/warm-import';

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../../ui/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faTerminal: { iconName: 'terminal' },
  faCopy: { iconName: 'copy' },
  faCheck: { iconName: 'check' },
}));

const toastError = vi.fn();
vi.mock('svelte-sonner', () => ({
  toast: {
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
warmImport(() => import('../../ui/__tests__/mocks/Fa.svelte'));

describe('ChatCliBlock', () => {
  it('renders the command text', () => {
    const command = 'pnpm run check';
    const { container } = render(ChatCliBlock, { props: { command } });
    expect(container.querySelector('code')?.textContent).toContain(command);
  });

  it('copies the command to the clipboard and shows feedback on click', async () => {
    const command = 'git status --short';
    const { getByTestId } = render(ChatCliBlock, { props: { command } });

    const copyButton = getByTestId('chat-cli-copy');
    expect(copyButton.getAttribute('aria-label')).toBe('Copy command');
    expect(copyButton.getAttribute('title')).toBe('Copy command');

    await fireEvent.click(copyButton);
    expect(clipboardWriteText).toHaveBeenCalledWith(command);

    await vi.waitFor(() => {
      expect(copyButton.getAttribute('title')).toBe('Copied');
    });
  });
});
