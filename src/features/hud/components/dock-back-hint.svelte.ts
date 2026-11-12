import { onMount, onDestroy, untrack } from 'svelte';

export function useDockBackHint(button: () => HTMLButtonElement | null, scope: () => string) {
  let reason = $state<'pointer' | 'keyboard' | null>(null);
  let open = $state(false);
  let keyboard = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let point: { x: number; y: number } | null = null;
  function close() {
    clearTimeout(timer);
    timer = undefined;
    reason = null;
    open = false;
  }
  function inside(x: number, y: number) {
    const target = button();
    if (!target || target.closest('[inert], [hidden]')) return false;
    const b = target.getBoundingClientRect();
    return x >= b.left && x < b.right && y >= b.top && y < b.bottom;
  }
  $effect(() => {
    scope();
    untrack(() => {
      keyboard = false;
      close();
    });
  });
  onMount(() => {
    const move = (event: PointerEvent) => {
      const moved = point
        ? point.x !== event.clientX || point.y !== event.clientY
        : event.movementX !== 0 || event.movementY !== 0;
      point = { x: event.clientX, y: event.clientY };
      if (!moved) return;
      keyboard = false;
      if (!inside(point.x, point.y)) {
        if (reason === 'pointer') close();
        return;
      }
      if (reason === 'pointer') return;
      reason = 'pointer';
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        if (point && inside(point.x, point.y)) open = true;
      }, 200);
    };
    const key = (event: KeyboardEvent) => {
      keyboard =
        !event.isComposing &&
        ['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key);
    };
    const pointer = () => {
      keyboard = false;
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', pointer, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('pointerdown', pointer, true);
      window.removeEventListener('blur', close);
    };
  });
  onDestroy(close);
  return {
    get open() {
      return open;
    },
    get allowed() {
      return reason !== null;
    },
    change(next: boolean) {
      open = next && reason !== null;
    },
    focus() {
      if (keyboard && button()?.matches(':focus-visible')) {
        reason = 'keyboard';
        open = true;
      }
    },
    blur() {
      if (reason === 'keyboard') close();
    },
    leave() {
      if (reason === 'pointer') close();
    },
  };
}
