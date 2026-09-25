// @verify-changed-triggers: ../NewSpaceModal.svelte, ../../ui/dialog/dialog-overlay.svelte,
//   ../../ui/select/select-content.svelte

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import NewSpaceModal from '../NewSpaceModal.svelte';

vi.mock('$lib/components/workspace/CompactWorkspaceInitializer.svelte', async () => ({
  default: (await import('./mocks/MockCompactWorkspaceInitializer.svelte')).default,
}));

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('NewSpaceModal nested overlay layering', () => {
  it('marks <body> only while the modal is mounted so layering rules need no body :has() anchor', async () => {
    expect(document.body.hasAttribute('data-new-space-modal-open')).toBe(false);

    render(NewSpaceModal, { props: { open: true, onClose: vi.fn() } });
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'New Workspace' })).toBeTruthy();
    });
    expect(document.body.hasAttribute('data-new-space-modal-open')).toBe(true);

    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'New Workspace' })).toBeNull();
      expect(document.body.hasAttribute('data-new-space-modal-open')).toBe(false);
    });
  });

  it.each([
    ['first', 0],
    ['second', 1],
  ])(
    'keeps the <body> marker until the last overlapping modal unmounts (%s unmounts first)',
    async (_label, unmountFirst) => {
      const props = { open: true, onClose: vi.fn() };
      const first = render(NewSpaceModal, { props });
      const second = render(NewSpaceModal, { props });
      await waitFor(() =>
        expect(document.querySelectorAll('[data-new-space-modal]')).toHaveLength(2),
      );
      expect(document.body.hasAttribute('data-new-space-modal-open')).toBe(true);

      const [gone, survivor] = unmountFirst === 0 ? [first, second] : [second, first];
      gone.unmount();
      await waitFor(() =>
        expect(document.querySelectorAll('[data-new-space-modal]')).toHaveLength(1),
      );
      expect(document.body.hasAttribute('data-new-space-modal-open')).toBe(true);

      survivor.unmount();
      await waitFor(() =>
        expect(document.querySelectorAll('[data-new-space-modal]')).toHaveLength(0),
      );
      expect(document.body.hasAttribute('data-new-space-modal-open')).toBe(false);
    },
  );

  it('keeps the <body> marker through one modal closing (outro) while another stays open', async () => {
    const props = { open: true, onClose: vi.fn() };
    const first = render(NewSpaceModal, { props });
    const second = render(NewSpaceModal, { props });
    await waitFor(() =>
      expect(document.querySelectorAll('[data-new-space-modal]')).toHaveLength(2),
    );

    await first.rerender({ ...props, open: false });
    await waitFor(() =>
      expect(document.querySelectorAll('[data-new-space-modal]')).toHaveLength(1),
    );
    expect(document.body.hasAttribute('data-new-space-modal-open')).toBe(true);

    await second.rerender({ ...props, open: false });
    await waitFor(() =>
      expect(document.querySelectorAll('[data-new-space-modal]')).toHaveLength(0),
    );
    expect(document.body.hasAttribute('data-new-space-modal-open')).toBe(false);
  });

  it('raises nested selects, menus, and dialogs above the create modal', () => {
    const modal = source('src/lib/components/modals/NewSpaceModal.svelte');
    const selectContent = source('src/lib/components/ui/select/select-content.svelte');

    expect(modal).toContain('data-new-space-modal');
    expect(modal).toContain("[data-slot='select-content']");
    expect(modal).toContain("[data-slot='menu-content']");
    expect(modal).toContain("[data-slot='dialog-overlay']");
    expect(modal).toContain("[data-slot='dialog-content']");
    expect(selectContent).toContain('data-slot="select-content"');
  });

  it('has one modal semantic owner and a separate canonical backdrop', async () => {
    render(NewSpaceModal, { props: { open: true, onClose: vi.fn() } });
    await waitFor(() => expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay).toBeTruthy();
    expect(dialog.contains(overlay)).toBe(false);
  });
});
