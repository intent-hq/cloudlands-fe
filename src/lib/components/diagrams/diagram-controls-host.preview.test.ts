/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preview } from './diagram-controls-host.preview.svelte';

vi.mock('$lib/components/workspace/NoteWithComments.svelte', async () => ({
  default: (await import('../workspace/initializer/__tests__/mocks/MockComponent.svelte')).default,
}));

afterEach(() => document.body.replaceChildren());

describe('diagram controls note-host capture readiness', () => {
  it('waits for every presentation as well as its child renderer', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const presentations = Array.from({ length: 4 }, () => {
      const parent = document.createElement('div');
      parent.dataset.diagramPresentationSettled = 'false';
      const child = document.createElement('div');
      child.dataset.diagramSettled = 'true';
      parent.append(child);
      root.append(parent);
      return parent;
    });
    const readiness = preview.captureReadiness!;
    const count = () => root.querySelectorAll(readiness.selector).length;
    expect(readiness.count).toBe(4);
    expect(count()).toBe(0);
    for (const parent of presentations.slice(0, 3))
      parent.dataset.diagramPresentationSettled = 'true';
    expect(count()).toBe(3);
    presentations[3].dataset.diagramPresentationSettled = 'true';
    expect(count()).toBe(readiness.count);
    (presentations[0].firstElementChild as HTMLElement).dataset.diagramSettled = 'false';
    expect(count()).toBe(3);
    (presentations[0].firstElementChild as HTMLElement).dataset.diagramSettled = 'true';
    presentations[2].dataset.diagramPresentationSettled = 'false';
    expect(count()).toBe(3);
  });
});
