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

it('keeps the complete diagnostic separately from a concise summary', () => {
  const diagnostic = `Codex: adapter exited before reporting models: exit status: 254\nnpm error ENOENT: ${'/Users/clement/.npm/_npx/'.repeat(30)}package.json`;
  const result = formatProviderLoadError('codex', new Error(diagnostic));
  expect(result.details).toBe(diagnostic);
  expect(result.message).toBe('Failed to load models');
  expect(result.hint).toBeUndefined();
});

it('keeps short unrelated errors readable without classifying their cause', () => {
  expect(formatProviderLoadError('codex', 'Transport disconnected')).toMatchObject({
    message: 'Transport disconnected',
    details: 'Transport disconnected',
    hint: undefined,
  });
});
