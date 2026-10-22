import { lstat, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Own only an exclusively created fixture root, never a shared home or fixed path. */
export async function createSpecialistTestRoot() {
  const path = await mkdtemp(join(tmpdir(), 'intent-specialist-test-'));
  const identity = await lstat(path);

  async function assertOwned() {
    const current = await lstat(path);
    if (
      !current.isDirectory() ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino ||
      current.uid !== identity.uid
    ) {
      throw new Error('Specialist fixture root identity changed');
    }
  }

  console.info('Specialist fixture acquired', {
    path,
    dev: identity.dev,
    ino: identity.ino,
    uid: identity.uid,
  });

  return {
    path,
    async reset() {
      await assertOwned();
      await rm(join(path, '.intent'), { recursive: true, force: true });
    },
    async dispose() {
      await assertOwned();
      await rm(path, { recursive: true });
      console.info('Specialist fixture released', { path, ino: identity.ino });
    },
  };
}
