/**
 * @vitest-environment jsdom
 *
 * GitHubAvatar: the shared owner-avatar image whose load-failure state resets
 * whenever the identity it renders changes, so a node that outlives an identity
 * switch shows the next owner's avatar again (intent-hq/intent#4644).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import GitHubAvatar from '$lib/components/ui/GitHubAvatar.svelte';

afterEach(() => cleanup());

const visibleImage = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLImageElement>('img')).find(
    (img) => img.style.display !== 'none',
  ) ?? null;

describe('GitHubAvatar', () => {
  it('shows the avatar again after an identity switch follows a failed load', async () => {
    const { container, rerender } = render(GitHubAvatar, { props: { identity: 'octo' } });

    const failed = visibleImage(container)!;
    expect(failed.src).toContain('/octo.png');
    await fireEvent.error(failed);
    expect(visibleImage(container)).toBeNull();

    await rerender({ identity: 'other' });

    const next = visibleImage(container);
    expect(next).not.toBeNull();
    expect(next!.src).toContain('/other.png');
    await fireEvent.load(next!);
    expect(visibleImage(container)).toBe(next);
  });

  it('retries an identity that failed earlier once it is rendered again', async () => {
    const { container, rerender } = render(GitHubAvatar, { props: { identity: 'octo' } });

    await fireEvent.error(visibleImage(container)!);
    await rerender({ identity: 'other' });
    await fireEvent.load(visibleImage(container)!);
    await rerender({ identity: 'octo' });

    const retried = visibleImage(container);
    expect(retried).not.toBeNull();
    expect(retried!.src).toContain('/octo.png');
    await fireEvent.load(retried!);
    expect(visibleImage(container)).toBe(retried);
  });

  it('keeps a successfully loaded avatar visible across a same-identity rerender', async () => {
    const { container, rerender } = render(GitHubAvatar, { props: { identity: 'octo' } });

    const img = visibleImage(container)!;
    await fireEvent.load(img);
    await rerender({ identity: 'octo', alt: 'octo' });

    expect(visibleImage(container)).not.toBeNull();
    expect(visibleImage(container)!.src).toContain('/octo.png');
  });

  it('renders the fallback while the image is failed and drops it on identity switch', async () => {
    const fallback = createRawSnippet(() => ({
      render: () => '<span data-testid="initials">AB</span>',
    }));
    const { container, rerender, queryByTestId } = render(GitHubAvatar, {
      props: { identity: 'octo', fallback },
    });

    expect(queryByTestId('initials')).toBeNull();
    await fireEvent.error(visibleImage(container)!);
    expect(queryByTestId('initials')).not.toBeNull();

    await rerender({ identity: 'other', fallback });
    expect(queryByTestId('initials')).toBeNull();
    expect(visibleImage(container)!.src).toContain('/other.png');
  });

  it('is decorative by default and announced only when alt text is given', async () => {
    const { container, rerender } = render(GitHubAvatar, { props: { identity: 'octo' } });

    const decorative = visibleImage(container)!;
    expect(decorative.getAttribute('alt')).toBe('');
    expect(decorative.getAttribute('aria-hidden')).toBe('true');

    await rerender({ identity: 'octo', alt: 'octo' });
    const announced = visibleImage(container)!;
    expect(announced.getAttribute('alt')).toBe('octo');
    expect(announced.hasAttribute('aria-hidden')).toBe(false);
  });

  it('requests a 2x image for the rendered size and forwards layout classes', () => {
    const { container } = render(GitHubAvatar, {
      props: { identity: 'octo', size: 24, class: 'size-6 rounded-full' },
    });

    const img = visibleImage(container)!;
    expect(new URL(img.src).searchParams.get('size')).toBe('48');
    expect(img.classList.contains('rounded-full')).toBe(true);
    expect(img.getAttribute('loading')).toBe('lazy');
  });
});
