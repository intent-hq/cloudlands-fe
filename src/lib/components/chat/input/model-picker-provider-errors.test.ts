import { afterEach, beforeEach, expect, it } from 'vitest';
import { store } from '$store/renderer/store';
import { admitLegacyPrincipal } from '../../../../test/fixtures/principal-state';
import {
  admitHostExecutionFixture,
  HOST_EXECUTION_FIXTURE,
} from '../../../../test/fixtures/host-execution-state';
import { formatProviderLoadError } from './model-picker-provider-errors';

let dispose: () => void;
beforeEach(() => {
  dispose = store.init();
});
afterEach(() => dispose());

it('does not tell a member to install or log into a local provider when host discovery fails', () => {
  admitHostExecutionFixture('member', HOST_EXECUTION_FIXTURE);
  for (const error of ['not authenticated', 'CLI not found', 'not available']) {
    expect(formatProviderLoadError('codex', new Error(error))).toMatchObject({
      message: error,
      hint: undefined,
    });
  }
});

it('keeps ordinary owner setup guidance', () => {
  admitLegacyPrincipal();
  expect(formatProviderLoadError('codex', new Error('CLI not found')).hint).toBeTruthy();
});
