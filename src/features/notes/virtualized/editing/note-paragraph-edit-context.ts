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
    borrowers = 0;
  let finishBorrow: (() => void) | undefined;
  let releasePromise: Promise<void> | undefined;
  const release = () => {
    if (releasePromise) return releasePromise;
    closing = true;
    lease.cancel();
    releasePromise = (async () => {
      if (borrowers)
        await new Promise<void>((resolve) => {
          finishBorrow = resolve;
        });
      await lease.release();
    })();
    return releasePromise;
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
      return {
        current: () => !closing && admitted.current(),
        borrow() {
          if (closing || !admitted.current() || borrowers >= 2)
            throw new Error('Paragraph context borrow unavailable');
          borrowers++;
          let released = false,
            constructed = false;
          return {
            create(projection: SourceProjection, doc: PMNode) {
              if (released || constructed || closing || !admitted.current())
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
  return { ready, cancel: lease.cancel, release };
}
