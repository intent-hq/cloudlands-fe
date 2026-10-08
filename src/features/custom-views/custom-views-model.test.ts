import { describe, expect, it } from 'vitest';
import type { CustomView } from '$shared/types/custom-views';
import { customViewFrameUrl, validCustomViewInput } from './custom-views-model';

const view: CustomView = {
  id: 'one',
  name: 'Dashboard',
  directory: '/tmp/app',
  command: 'npm start',
  port: 3000,
  icon: 'chart',
};
describe('custom view inputs and navigation', () => {
  it.each([1024, 3000, 65535])('accepts valid fixed port %s', (port) => {
    expect(validCustomViewInput({ ...view, port })).toBe(true);
  });
  it.each([0, 1023, 65536, 3000.5, NaN])('rejects invalid fixed port %s', (port) => {
    expect(validCustomViewInput({ ...view, port })).toBe(false);
  });
  it.each(['name', 'directory', 'command'])('rejects blank %s', (field) => {
    expect(validCustomViewInput({ ...view, [field]: '  ' })).toBe(false);
  });
  it('only embeds the running server at the registered loopback port', () => {
    expect(
      customViewFrameUrl(view, {
        id: view.id,
        status: 'running',
        url: 'http://127.0.0.1:3000/',
        logs: '',
      }),
    ).toBe('http://127.0.0.1:3000/');
    expect(
      customViewFrameUrl(view, {
        id: view.id,
        status: 'starting',
        url: 'http://127.0.0.1:3000/',
        logs: '',
      }),
    ).toBeNull();
    for (const url of [
      'https://example.com/',
      'http://127.0.0.1:3001/',
      'javascript:alert(1)',
      'http://127.0.0.1:3000@evil.test/',
      'file:///tmp/index.html',
    ]) {
      expect(
        customViewFrameUrl(view, { id: view.id, status: 'running', url, logs: '' }),
      ).toBeNull();
    }
  });
});
