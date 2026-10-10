import {
  createNoteParagraphEditAuthority,
  noteParagraphEditContextSteps,
} from './note-paragraph-edit-authority';
import { reserveNoteEditContext } from './note-edit-context-lease';
import type { SourceProjection } from '../projection/source-projection';
import type { Node as PMNode } from '@tiptap/pm/model';

/** Resolve once under actual DATA admission. The caller must attach each borrow
 * to the native view's final disposal, including composition-deferred disposal.
 * Cancelling the offer revokes edits; it does not retire an exposed view borrow. */
export function prepareNoteParagraphContext(...args: Parameters<typeof reserveNoteEditContext>) {
  const [port, window, panel, signal, now] = args;
  const lease = reserveNoteEditContext(port, window, panel, signal, now);
  let closing = false,
    resolved = false,
    borrowers = 0;
  let finishBorrow: (() => void) | undefined;
  let releasePromise: Promise<void> | undefined;
  const retire = () => {
    if (releasePromise) return releasePromise;
    closing = true;
    // Undelivered preparation cannot survive navigation. A sealed, borrowed
    // authority may finish its current native composition under the same identity.
    if (!resolved) lease.cancel();
    releasePromise = (async () => {
      if (borrowers)
        await new Promise<void>((resolve) => {
          finishBorrow = resolve;
        });
      await lease.release();
    })();
    return releasePromise;
  };
  const release = () => {
    lease.cancel();
    return retire();
  };
  const ready = (async () => {
    const admitted = await lease.ready;
    const steps = noteParagraphEditContextSteps(
      window,
      admitted.grant.identity,
      admitted.current,
      admitted.grant,
      now,
    );
    try {
      let step = steps.next();
      while (!step.done) step = steps.next(await admitted.read(step.value));
      const receipt = step.value;
      admitted.seal();
      resolved = true;
      return {
        current: () => admitted.current(),
        borrow() {
          if (closing || !admitted.current() || borrowers >= 2)
            throw new Error('Paragraph context borrow unavailable');
          borrowers++;
          let released = false,
            constructed = false;
          return {
            create(projection: SourceProjection, doc: PMNode) {
              if (released || constructed || !admitted.current())
                throw new Error('Paragraph context borrow superseded');
              constructed = true;
              return createNoteParagraphEditAuthority(window, projection, receipt, doc);
            },
            release() {
              if (released) return;
              released = true;
              borrowers--;
              if (!borrowers) finishBorrow?.();
            },
          };
        },
        release,
      };
    } catch (error) {
      await release();
      throw error;
    } finally {
      steps.return(undefined as never);
    }
  })();
  return { ready, cancel: lease.cancel, release, retire };
}
