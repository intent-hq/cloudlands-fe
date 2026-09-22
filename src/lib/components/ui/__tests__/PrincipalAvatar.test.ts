/**
 * @vitest-environment jsdom
 *
 * PrincipalAvatar: the shared principal-avatar tile that falls back to the
 * label's initial when the image is missing or fails to load, and retries the
 * image whenever the avatar URL changes
 * (https://github.com/intent-hq/cloudlands-fe/pull/2774#discussion_r4068058882).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';

afterEach(() => cleanup());

const image = (container: HTMLElement) => container.querySelector<HTMLImageElement>('img');
const initial = (container: HTMLElement) => container.querySelector<HTMLSpanElement>('span');

describe('PrincipalAvatar', () => {
  it('renders the avatar image when a URL is given', () => {
    const { container } = render(PrincipalAvatar, {
      props: { avatarUrl: 'https://example.test/octo.png', label: 'octo' },
    });

    const img = image(container);
    expect(img).not.toBeNull();
    expect(img!.src).toBe('https://example.test/octo.png');
    expect(img!.getAttribute('alt')).toBe('');
    expect(img!.getAttribute('aria-hidden')).toBe('true');
    expect(img!.getAttribute('loading')).toBe('lazy');
    expect(initial(container)).toBeNull();
  });

  it('renders the uppercased initial when the URL is missing', async () => {
    const { container, rerender } = render(PrincipalAvatar, {
      props: { avatarUrl: null, label: 'octo' },
    });

    expect(image(container)).toBeNull();
    expect(initial(container)!.textContent).toBe('O');
    expect(initial(container)!.getAttribute('aria-hidden')).toBe('true');

    await rerender({ avatarUrl: undefined, label: '' });
    expect(initial(container)!.textContent).toBe('?');
  });

  it('falls back to the initial once the image fails to load', async () => {
    const { container } = render(PrincipalAvatar, {
      props: { avatarUrl: 'https://example.test/octo.png', label: 'octo' },
    });

    await fireEvent.error(image(container)!);

    expect(image(container)).toBeNull();
    expect(initial(container)!.textContent).toBe('O');
  });

  it('retries the image when the URL changes after a failure', async () => {
    const { container, rerender } = render(PrincipalAvatar, {
      props: { avatarUrl: 'https://example.test/octo.png', label: 'octo' },
    });

    await fireEvent.error(image(container)!);
    expect(image(container)).toBeNull();

    await rerender({ avatarUrl: 'https://example.test/other.png', label: 'other' });

    const next = image(container);
    expect(next).not.toBeNull();
    expect(next!.src).toBe('https://example.test/other.png');
    await fireEvent.load(next!);
    expect(image(container)).toBe(next);
  });

  it('keeps a loaded image across a same-URL rerender', async () => {
    const { container, rerender } = render(PrincipalAvatar, {
      props: { avatarUrl: 'https://example.test/octo.png', label: 'octo' },
    });

    const img = image(container)!;
    await fireEvent.load(img);
    await rerender({ avatarUrl: 'https://example.test/octo.png', label: 'Octo Cat' });

    expect(image(container)).toBe(img);
    expect(initial(container)).toBeNull();
  });

  it('exposes the test id on the image and its -fallback suffix on the initial', async () => {
    const { container, queryByTestId } = render(PrincipalAvatar, {
      props: { avatarUrl: 'https://example.test/octo.png', label: 'octo', testid: 'roster-avatar' },
    });

    expect(queryByTestId('roster-avatar')).toBe(image(container));
    expect(queryByTestId('roster-avatar-fallback')).toBeNull();

    await fireEvent.error(image(container)!);

    expect(queryByTestId('roster-avatar')).toBeNull();
    expect(queryByTestId('roster-avatar-fallback')).toBe(initial(container));
  });

  it('omits test ids when none is given', async () => {
    const { container } = render(PrincipalAvatar, {
      props: { avatarUrl: 'https://example.test/octo.png', label: 'octo' },
    });

    expect(image(container)!.hasAttribute('data-testid')).toBe(false);
    await fireEvent.error(image(container)!);
    expect(initial(container)!.hasAttribute('data-testid')).toBe(false);
  });

  it('sizes the tile from the size prop and forwards class and referrerpolicy', async () => {
    const { container } = render(PrincipalAvatar, {
      props: {
        avatarUrl: 'https://example.test/octo.png',
        label: 'octo',
        size: 16,
        class: 'ring-1',
        referrerpolicy: 'no-referrer',
      },
    });

    const img = image(container)!;
    expect(img.style.width).toBe('16px');
    expect(img.style.height).toBe('16px');
    expect(img.classList.contains('ring-1')).toBe(true);
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');

    await fireEvent.error(img);
    const span = initial(container)!;
    expect(span.style.width).toBe('16px');
    expect(span.style.height).toBe('16px');
    expect(span.classList.contains('ring-1')).toBe(true);
  });

  it('leaves sizing to the parent tile in fill mode', async () => {
    const { container } = render(PrincipalAvatar, {
      props: { avatarUrl: 'https://example.test/octo.png', label: 'octo', fill: true },
    });

    expect(image(container)!.style.width).toBe('');
    await fireEvent.error(image(container)!);
    expect(initial(container)!.style.width).toBe('');
    expect(initial(container)!.textContent).toBe('O');
  });
});
