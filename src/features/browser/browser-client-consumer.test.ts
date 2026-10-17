import { beforeEach, expect, it, vi } from 'vitest';
const { dispatch } = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock('$store/renderer/store', () => ({ store: { dispatch } }));
import { browserClientConsumer } from './browser-client-consumer';

beforeEach(() => dispatch.mockClear());

it('owns independent leases, releases on Home, and reacquires when shown again', () => {
  const node = document.createElement('div');
  const first = browserClientConsumer(node, 'a');
  const second = browserClientConsumer(node, 'a');
  const firstId = dispatch.mock.calls[0][0].payload[1];
  const secondId = dispatch.mock.calls[1][0].payload[1];
  expect(firstId).not.toBe(secondId);
  first.update('a');
  expect(dispatch).toHaveBeenCalledTimes(2);
  first.update(undefined);
  second.destroy();
  first.update('b');
  first.destroy();
  expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
    { type: 'browserClients/consumerMounted', payload: ['a', firstId] },
    { type: 'browserClients/consumerMounted', payload: ['a', secondId] },
    { type: 'browserClients/consumerUnmounted', payload: ['a', firstId] },
    { type: 'browserClients/consumerUnmounted', payload: ['a', secondId] },
    { type: 'browserClients/consumerMounted', payload: ['b', firstId] },
    { type: 'browserClients/consumerUnmounted', payload: ['b', firstId] },
  ]);
});
