import { beforeEach, describe, expect, it } from 'vitest';
import { clearMockSeeders, getRegisteredMockSeeders } from '../mock-bootstrap';

describe('files-git-seeder', () => {
  beforeEach(() => clearMockSeeders());

  it('leaves files and git hydration to root-owned sagas', async () => {
    await import('./index');

    expect(getRegisteredMockSeeders()).not.toContain('files-git');
  });
});
