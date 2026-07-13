import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
} from 'vitest';
import {
  render,
  fireEvent,
  waitFor,
} from '@testing-library/svelte';
import TestWrapper from './TestWrapper.svelte';

// Create mock logger outside describe block
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

// Mock the createLogger function at module level
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => mockLogger,
}));

// Mock svelte-fa component
vi.mock('svelte-fa', async () => {
  const MockFa = (await import('./mocks/Fa.svelte')).default;
  return { default: MockFa };
});

// Mock font awesome icons
vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faEllipsisVertical: { iconName: 'ellipsis-vertical' },
  faChevronDown: { iconName: 'chevron-down' },
  faArrowUpRightFromSquare: { iconName: 'arrow-up-right-from-square' },
}));

// Mock the dropdown menu component
vi.mock('$lib/components/ui/dropdown-menu.svelte', async () => {
  const MockDropdown = (await import('./mocks/dropdown-menu.svelte')).default;
  return { default: MockDropdown };
});

// Mock the button component
vi.mock('$lib/components/ui/button/button.svelte', async () => {
  const MockButton = (await import('./mocks/button.svelte')).default;
  return { default: MockButton };
});

// Mock the workspace actions menu
vi.mock('$lib/components/ui/WorkspaceActionsMenu.svelte', async () => {
  const MockMenu = (await import('./mocks/WorkspaceActionsMenu.svelte')).default;
  return { default: MockMenu };
});

describe('FileActionsDropdown', () => {
  beforeEach(() => {
    // Clear mock calls
    vi.clearAllMocks();
  });

  it('should render with default props', async () => {
    const { container } = render(TestWrapper, {
      props: {
        filePath: '/test/file.ts',
      },
    });

    await waitFor(() => {
      expect(container.querySelector('[data-testid="file-actions-wrapper"]')).toBeTruthy();
    });
  });

  it('should display button when file path is provided', async () => {
    const { container } = render(TestWrapper, {
      props: {
        filePath: '/test/file.ts',
        label: 'Open File',
      },
    });

    await waitFor(() => {
      const button = container.querySelector('button');
      expect(button).toBeTruthy();
      expect(button?.textContent).toContain('Open File');
    });
  });

  it('should handle dropdown toggle', async () => {
    const { container } = render(TestWrapper, {
      props: {
        filePath: '/test/file.ts',
      },
    });

    await waitFor(() => {
      const button = container.querySelector('button');
      expect(button).toBeTruthy();
    });

    const button = container.querySelector('button');
    if (button) {
      // Click to open dropdown
      await fireEvent.click(button);

      // Check that dropdown opens
      await waitFor(() => {
        const dropdown = container.querySelector('.dropdown-content');
        expect(dropdown).toBeTruthy();
      });
    }
  });

  it('should handle menu actions', async () => {
    const { container } = render(TestWrapper, {
      props: {
        filePath: '/test/file.ts',
        menuItems: [{ label: 'Custom Action', action: vi.fn() }],
      },
    });

    await waitFor(() => {
      const button = container.querySelector('button');
      expect(button).toBeTruthy();
    });

    const button = container.querySelector('button');
    if (button) {
      await fireEvent.click(button);

      // Wait for menu to open
      await waitFor(() => {
        const menuItem = container.querySelector('.menu-action');
        expect(menuItem).toBeTruthy();
      });
    }
  });

  it('should display correct icon', async () => {
    const { container } = render(TestWrapper, {
      props: {
        filePath: '/test/file.ts',
        isCompact: false,
      },
    });

    await waitFor(() => {
      // Check for button with label
      const button = container.querySelector('button');
      expect(button).toBeTruthy();
      expect(button?.textContent).toContain('Open');
    });
  });

  it('should handle disabled state when no file path', async () => {
    const { container } = render(TestWrapper, {
      props: {
        filePath: '', // Empty file path should disable the button
      },
    });

    await waitFor(() => {
      const button = container.querySelector('button');
      expect(button).toBeTruthy();
      expect(button?.hasAttribute('disabled')).toBe(true);
    });
  });

  it('should render with custom menu items', async () => {
    const customAction = vi.fn();
    const customItems = [
      { label: 'Custom Action 1', action: customAction },
      { label: 'Custom Action 2', action: vi.fn() },
    ];

    const { container } = render(TestWrapper, {
      props: {
        filePath: '/test/file.ts',
        menuItems: customItems,
      },
    });

    await waitFor(() => {
      const button = container.querySelector('button');
      expect(button).toBeTruthy();
    });

    const button = container.querySelector('button');
    if (button) {
      await fireEvent.click(button);

      // Check that menu opens with custom items
      await waitFor(() => {
        const menuActions = container.querySelectorAll('.menu-action');
        expect(menuActions.length).toBeGreaterThan(0);
      });
    }
  });

  it('should support compact mode', async () => {
    const { container } = render(TestWrapper, {
      props: {
        filePath: '/test/file.ts',
        isCompact: true,
      },
    });

    await waitFor(() => {
      const button = container.querySelector('button');
      expect(button).toBeTruthy();
      // In compact mode, button should not have text label
      expect(button?.querySelector('.fa-icon')).toBeTruthy();
    });
  });
});
