/**
 * @vitest-environment jsdom
 *
 * The avatar stack's per-person buttons rendered through the real `Button`,
 * so the class merge against the button base variant is the one production
 * runs — the sidebar row test mocks `Button` and cannot see that merge.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { buttonVariants } from '$lib/components/ui/button/button.variants';
import PresenceAvatarStack from './PresenceAvatarStack.svelte';
import type { PresenceCircle, PresenceCircleAction } from './presence-person';

const person = (principalId: string, online: boolean): PresenceCircle => ({
  principalId,
  login: principalId,
  displayName: null,
  avatarUrl: null,
  online,
});

const personButton = (principalId: string) =>
  document.querySelector<HTMLButtonElement>(`[data-presence-person-button="${principalId}"]`)!;

describe('PresenceAvatarStack person buttons', () => {
  it('keeps an inert avatar solid: the opacity override survives the real button class merge', async () => {
    // The base variant is what dims an aria-disabled button; without it the
    // override below would have nothing to beat and this test would prove nothing.
    expect(buttonVariants({ variant: 'plain' }).split(/\s+/)).toContain('aria-disabled:opacity-50');

    const onSelect = vi.fn();
    const action = (p: PresenceCircle): PresenceCircleAction =>
      p.principalId === 'cy'
        ? { label: 'cy · offline', onSelect: null }
        : { label: 'ada · on Coordinator', onSelect };
    render(PresenceAvatarStack, {
      props: { people: [person('ada', true), person('cy', false)], action },
    });

    const cy = personButton('cy');
    expect(cy).toBe(screen.getByRole('button', { name: 'cy · offline' }));
    expect(cy.getAttribute('aria-disabled')).toBe('true');
    const classes = Array.from(cy.classList);
    expect(classes).toContain('aria-disabled:opacity-100');
    expect(classes).not.toContain('aria-disabled:opacity-50');
    await fireEvent.click(cy);
    expect(onSelect).not.toHaveBeenCalled();

    const ada = personButton('ada');
    expect(ada.hasAttribute('aria-disabled')).toBe(false);
    await fireEvent.click(ada);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
