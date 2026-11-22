/**
 * @vitest-environment jsdom
 *
 * Start On locked to the host (a new repository or a plain folder): the
 * submission sends no placement (''), and the row shows the host's own row
 * even when a runner comes first in the host's order.
 */
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import {
  START_ON_BACKEND,
  START_ON_HOST,
  type StartOnOption,
} from '$features/remote-machines/start-on';
import StartOnPicker from './StartOnPicker.svelte';

const RUNNER: StartOnOption = { id: 'd-pc', label: 'Gaming PC', platform: null, disabled: false };
const HOST: StartOnOption = {
  id: START_ON_HOST,
  label: 'Build box',
  platform: null,
  disabled: false,
};

afterEach(cleanup);

describe('StartOnPicker locked to the host', () => {
  it('shows the host row for no placement while a runner comes first', () => {
    render(StartOnPicker, {
      props: {
        value: START_ON_BACKEND,
        options: [RUNNER, HOST],
        onChange: () => {},
        lockedReason: 'A new repository starts on Build box.',
      },
    });
    const row = screen.getByTestId('start-on-picker');
    expect(row.textContent).toContain('Build box');
    expect(row.textContent).not.toContain('Gaming PC');
  });
});
