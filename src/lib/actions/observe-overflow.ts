import type { Action } from 'svelte/action';
import { scheduleLayoutRead, scheduleLayoutWrite } from '$lib/utils/layout-phases';

export const observeOverflow: Action<HTMLElement, (overflow: boolean) => void> = (
  node,
  onChange,
) => {
  let cancelRead: (() => void) | undefined;
  let cancelWrite: (() => void) | undefined;
  const measure = () => {
    if (cancelRead) return;
    cancelRead = scheduleLayoutRead(() => {
      cancelRead = undefined;
      const visible = node.checkVisibility?.() ?? true;
      const width = visible ? node.clientWidth : 0;
      const height = visible ? node.clientHeight : 0;
      const overflow =
        width > 0 && height > 0 && (node.scrollWidth > width || node.scrollHeight > height);
      cancelWrite?.();
      cancelWrite = scheduleLayoutWrite(() => {
        cancelWrite = undefined;
        onChange(overflow);
      });
    });
  };
  const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
  const mutation = new MutationObserver(measure);
  resize?.observe(node);
  mutation.observe(node, { childList: true, characterData: true, subtree: true });
  document.fonts?.addEventListener('loadingdone', measure);
  measure();

  return {
    update(callback) {
      onChange = callback;
      measure();
    },
    destroy() {
      cancelRead?.();
      cancelWrite?.();
      resize?.disconnect();
      mutation.disconnect();
      document.fonts?.removeEventListener('loadingdone', measure);
    },
  };
};

export const truncatedTitle: Action<HTMLElement, string | undefined> = (node, text) => {
  let content = text;
  const updateTitle = (overflow: boolean) => {
    if (content && (overflow || content.trim() !== node.textContent?.trim())) node.title = content;
    else node.removeAttribute('title');
  };
  const observer = observeOverflow(node, updateTitle);

  return {
    update(value) {
      content = value;
      observer?.update?.(updateTitle);
    },
    destroy() {
      observer?.destroy?.();
      node.removeAttribute('title');
    },
  };
};
