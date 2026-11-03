/**
 * @vitest-environment jsdom
 *
 * The real sidebar, panel header and composer for a remote agent: the machine
 * is named by the sidebar badge and the model button, never by a header pill.
 */
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { store } from '$store/renderer/store';
import RemoteAgentLocationPreview from './remote-agent-location.preview.svelte';

afterEach(() => cleanup());

describe('remote agent location scene', () => {
  it('names the machine in the sidebar and model button but not in the panel header', async () => {
    store.init();
    const { container } = render(RemoteAgentLocationPreview, { scene: 'remote-running' });
    await waitFor(() =>
      expect(
        container.querySelector('[data-remote-agent-location-scene][data-ready]'),
      ).not.toBeNull(),
    );

    const sidebar = container.querySelector('aside')!;
    await waitFor(() =>
      expect(
        Array.from(sidebar.querySelectorAll('[data-agent-machine-badge]')).map((b) =>
          b.getAttribute('title'),
        ),
      ).toContain('Runs on Mac mini · macOS arm64'),
    );

    await waitFor(() =>
      expect(container.querySelector('[data-remote-model-machine]')?.textContent).toContain(
        'Mac mini',
      ),
    );

    const header = container.querySelector('[data-panel-tabless-header]');
    expect(header).not.toBeNull();
    expect(header!.querySelector('[data-agent-machine-badge]')).toBeNull();
    expect(header!.textContent).not.toContain('Mac mini');
  });
});
