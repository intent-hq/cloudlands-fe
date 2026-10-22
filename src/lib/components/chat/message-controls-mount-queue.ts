// Transient renderer work only. A forced history prepend can create hundreds of
// message shells in one flush; their action/tooltip trees must not share it.
const pending = new Map<() => void, boolean>();
let frame: number | null = null;

function schedule() {
  if (frame !== null || pending.size === 0) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    const next = [...pending].sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 4);
    for (const [mount] of next) {
      if (!pending.delete(mount)) continue;
      mount();
    }
    schedule();
  });
}

function remove(mount: () => void) {
  const removed = pending.delete(mount);
  if (pending.size === 0 && frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
  return removed;
}

export function queueMessageControls(mount: () => void) {
  pending.set(mount, false);
  schedule();
  return {
    prioritize() {
      if (pending.has(mount)) pending.set(mount, true);
    },
    // Direct user interaction must not wait behind offscreen history work.
    mountNow() {
      if (remove(mount)) mount();
    },
    cancel() {
      remove(mount);
    },
  };
}
