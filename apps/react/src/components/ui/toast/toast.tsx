import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Toaster as Sonner, toast, type ToasterProps } from 'sonner';
import { XIcon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import {
  clampSurface,
  SurfaceProvider,
  surfaceClasses,
  useSurface,
} from '@/components/ui/surface-context';
import { m } from '$shared/paraglide/messages.js';
import { ToastGlyph } from './toast-glyph';
import './toast.css';

export interface ToastProps {
  regionId?: string;
  toasterId?: string;
  position?: ToasterProps['position'];
  staticPosition?: boolean;
  staticToastCount?: number;
  onClearAll?: () => void;
  containerAriaLabel?: string;
}

/** Official shadcn Sonner composition with the source region and layout policy. */
export function Toast({
  regionId = 'app-toast-region',
  toasterId,
  position = 'bottom-left',
  staticPosition = false,
  staticToastCount,
  onClearAll,
  containerAriaLabel = m.ui_toast_notifications_ariaLabel(),
}: ToastProps) {
  const regionRef = useRef<HTMLDivElement>(null);
  const surface = clampSurface(useSurface() + 2);
  const [dark, setDark] = useState(false);
  const [activeToastCount, setActiveToastCount] = useState(0);
  const [visibleToastLimit, setVisibleToastLimit] = useState(3);
  const toastCount = staticToastCount ?? activeToastCount;
  const showClearAll = toastCount >= 2;
  const offset = {
    bottom: showClearAll ? 'calc(1rem + var(--control-height-large) + 0.5rem)' : 16,
    left: 16,
  };

  useEffect(() => {
    const updateTheme = () => setDark(document.documentElement.classList.contains('dark'));
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    updateTheme();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const regionElement = regionRef.current;
    if (!regionElement) return;

    const observedElements = new Set<HTMLElement>();
    const resizeObserver = new ResizeObserver(() => updateToasts());
    const updateToasts = () => {
      for (const card of regionElement.querySelectorAll<HTMLElement>('[data-sonner-toast]')) {
        card.inert =
          card.dataset.removed === 'true' ||
          card.dataset.visible === 'false' ||
          (card.dataset.front === 'false' && card.dataset.expanded === 'false');
      }
      const activeToasts = Array.from(
        regionElement.querySelectorAll<HTMLElement>(
          '[data-sonner-toast]:not([data-removed="true"])',
        ),
      );
      setActiveToastCount(activeToasts.length);

      const elements = activeToasts.flatMap((card) => [
        card,
        ...card.querySelectorAll<HTMLElement>(
          ':scope > *, [data-title], [data-description], [data-toast-title], [data-toast-description]',
        ),
      ]);
      for (const element of observedElements) {
        if (!elements.includes(element)) {
          resizeObserver.unobserve(element);
          observedElements.delete(element);
        }
      }
      for (const element of elements) {
        if (!observedElements.has(element)) {
          resizeObserver.observe(element);
          observedElements.add(element);
        }
      }

      for (const toastElement of activeToasts) {
        const closeButton = toastElement.querySelector<HTMLElement>(':scope > [data-close-button]');
        // Sonner renders close first. Preserve the source action-before-close tab order.
        if (closeButton && toastElement.lastElementChild !== closeButton) {
          toastElement.append(closeButton);
        }
        const title =
          toastElement.dataset.styled === 'true'
            ? toastElement.querySelector<HTMLElement>('[data-title]')
            : null;
        if (title) {
          const actions = Array.from(
            toastElement.querySelectorAll<HTMLElement>(
              ':scope > [data-button], .toast-undo-action',
            ),
          );
          const style = getComputedStyle(toastElement);
          const controlsWidth = actions.reduce(
            (width, action) => width + Math.max(action.scrollWidth, action.offsetWidth) + 10,
            0,
          );
          const requiredWidth =
            controlsWidth +
            (toastElement.querySelector('[data-icon]') ? 26 : 0) +
            (closeButton ? 32 : 0) +
            Number.parseFloat(style.paddingLeft) +
            Number.parseFloat(style.paddingRight) +
            Math.min(96, title.scrollWidth);
          toastElement.toggleAttribute(
            'data-toast-footer',
            requiredWidth > toastElement.clientWidth,
          );
        }
        for (const text of toastElement.querySelectorAll<HTMLElement>(
          '[data-title], [data-description], [data-toast-title], [data-toast-description]',
        )) {
          if (text.matches('[data-title]') && toastElement.dataset.styled === 'false') continue;
          if (text.textContent) text.title = text.textContent.trim();
        }
      }

      for (const toaster of regionElement.querySelectorAll<HTMLElement>('[data-sonner-toaster]')) {
        const style = getComputedStyle(toaster);
        const availableHeight = `calc(100dvh - ${style.getPropertyValue('--offset-top')} - ${style.getPropertyValue('--offset-bottom')})`;
        if (toaster.style.getPropertyValue('--toast-available-height') !== availableHeight) {
          toaster.style.setProperty('--toast-available-height', availableHeight);
        }
      }

      const heights = new Map<HTMLElement, number>();
      for (const card of activeToasts) {
        card.setAttribute('data-toast-measuring', '');
        for (let level = 0; level <= 3; level += 1) {
          card.dataset.toastCompact = String(level);
          if (
            card.scrollHeight <= card.clientHeight + 1 &&
            card.scrollWidth <= card.clientWidth + 1
          ) {
            break;
          }
        }
        heights.set(card, card.offsetHeight);
        card.removeAttribute('data-toast-measuring');
      }

      let limit = 3;
      for (const toaster of regionElement.querySelectorAll<HTMLElement>('[data-sonner-toaster]')) {
        const cards = activeToasts
          .filter((card) => card.parentElement === toaster)
          .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));
        let stackHeight = 0;
        for (const card of cards) {
          const stackOffset = `${stackHeight}px`;
          if (card.style.getPropertyValue('--toast-stack-offset') !== stackOffset) {
            card.style.setProperty('--toast-stack-offset', stackOffset);
          }
          stackHeight += (heights.get(card) ?? 0) + 8;
        }
        const frontHeight = `${cards[0] ? heights.get(cards[0]) : 0}px`;
        if (toaster.style.getPropertyValue('--toast-front-height') !== frontHeight) {
          toaster.style.setProperty('--toast-front-height', frontHeight);
        }
        toaster.toggleAttribute('data-toast-sized', cards.length > 0);
        if (!staticPosition) {
          const style = getComputedStyle(toaster);
          const edge = toaster.dataset.yPosition === 'top' ? style.top : style.bottom;
          const availableHeight = window.innerHeight - (Number.parseFloat(edge) || 0) - 16;
          let height = 0;
          let count = 0;
          for (const card of cards.slice(0, 3)) {
            height += (heights.get(card) ?? 0) + (count ? 8 : 0);
            if (height > availableHeight && count) break;
            count += 1;
          }
          limit = Math.min(limit, Math.max(1, count));
        }
      }
      setVisibleToastLimit(limit);
    };
    const observer = new MutationObserver(updateToasts);
    observer.observe(regionElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-visible',
        'data-removed',
        'data-front',
        'data-expanded',
        'style',
        'open',
      ],
    });
    window.addEventListener('resize', updateToasts);
    updateToasts();
    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateToasts);
    };
  }, [staticPosition]);

  function clearVisibleToasts() {
    if (onClearAll) onClearAll();
    else toast.dismiss();
    setActiveToastCount(0);
  }

  return (
    <SurfaceProvider level={surface}>
      <div
        ref={regionRef}
        id={regionId}
        className={staticPosition ? 'toast-static' : undefined}
        data-surface-level={surface}
        style={{ '--toast-surface': `var(--surface-${surface})` } as CSSProperties}
      >
        <Sonner
          id={toasterId}
          theme={dark ? 'dark' : 'light'}
          className="toaster group"
          style={
            {
              '--app-toast-width': 'min(22rem, calc(100vw - clamp(2rem, 8vw, 4rem)))',
            } as CSSProperties
          }
          offset={offset}
          mobileOffset={offset}
          containerAriaLabel={containerAriaLabel}
          toastOptions={{
            closeButtonAriaLabel: m.ui_toast_close_ariaLabel(),
            classNames: {
              toast: `group toast w-full min-w-0 max-w-full group-[.toaster]:text-foreground ${surfaceClasses(surface)}`,
              description: 'group-[.toast]:text-subtle',
              actionButton: 'toast-action-button font-medium',
              cancelButton:
                'group-[.toast]:bg-transparent group-[.toast]:text-foreground group-[.toast]:border group-[.toast]:border-border group-[.toast]:hover:bg-muted',
            },
          }}
          position={position}
          closeButton
          duration={10000}
          gap={8}
          visibleToasts={visibleToastLimit}
          icons={{
            success: <ToastGlyph variant="success" />,
            error: <ToastGlyph variant="error" />,
            warning: <ToastGlyph variant="warning" />,
            info: <ToastGlyph variant="info" />,
            loading: <ToastGlyph variant="loading" />,
            close: <XIcon size={16} aria-hidden="true" />,
          }}
        />
      </div>
      {showClearAll && (
        <Button
          variant="secondary"
          size="lg"
          className={staticPosition ? 'toast-clear-all toast-clear-all-static' : 'toast-clear-all'}
          onClick={clearVisibleToasts}
          aria-controls={regionId}
          aria-label={m.ui_toast_clearAll_ariaLabel({ count: toastCount })}
        >
          {m.ui_toast_clearAll_label()}
        </Button>
      )}
    </SurfaceProvider>
  );
}
