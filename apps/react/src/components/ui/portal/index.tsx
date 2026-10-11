import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface PortalProps {
  target?: string | HTMLElement;
  zIndex?: number | string;
  children: ReactNode;
}

/** Source: Portal.svelte. The mount target and stacking level are captured at mount. */
export function Portal({ target = 'body', zIndex = 10, children }: PortalProps) {
  const [initial] = useState(() => ({ target, zIndex }));
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const parent =
      (typeof initial.target === 'string'
        ? document.querySelector(initial.target)
        : initial.target) ?? document.body;
    const element = document.createElement('div');
    element.className = 'portal-container';
    element.style.zIndex = String(initial.zIndex);
    element.style.position = 'relative';
    parent.appendChild(element);
    // oxlint-disable-next-line react/set-state-in-effect -- Publish the external DOM container only after attaching it, so child layout effects run in the document.
    setContainer(element);
    return () => element.remove();
  }, [initial]);

  return container ? createPortal(<div>{children}</div>, container) : null;
}
