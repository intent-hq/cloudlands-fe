import type { Action } from 'svelte/action';

export const observeOverflow: Action<HTMLElement, (overflow: boolean) => void> = (
  node,
  onChange,
) => {
  const measure = () => {
    onChange(
      node.clientWidth > 0 &&
        node.clientHeight > 0 &&
        (node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight),
    );
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
