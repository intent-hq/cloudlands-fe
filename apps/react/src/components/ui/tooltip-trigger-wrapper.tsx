import * as React from 'react';

const interactiveSelector = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');
const forwardedAttributes = [
  'aria-describedby',
  'data-state',
  'data-delay-duration',
  'data-tooltip-trigger',
] as const;
type ForwardedAttribute = (typeof forwardedAttributes)[number];
type AttributeValue = string | number | boolean | null;
type AttributeRecord = { original: string | null; forwarded: string | null };

export type TooltipTriggerWrapperProps = React.ComponentProps<'span'> & {
  disabled?: boolean;
  type?: string;
  'data-state'?: AttributeValue;
  'data-disabled'?: AttributeValue;
  'data-delay-duration'?: AttributeValue;
  'data-tooltip-trigger'?: AttributeValue;
};

function setAttribute(target: HTMLElement, attribute: string, value: string | null) {
  if (target.getAttribute(attribute) === value) return;
  if (value === null) target.removeAttribute(attribute);
  else target.setAttribute(attribute, value);
}

function restoreAttributes(
  target: HTMLElement,
  attributes: Map<ForwardedAttribute, AttributeRecord>,
) {
  for (const [attribute, record] of attributes) {
    // A descendant may have updated its own state since our last render.
    if (target.getAttribute(attribute) === record.forwarded) {
      setAttribute(target, attribute, record.original);
    }
  }
}

/** A Radix asChild target that keeps the real descendants as the only controls. */
export function TooltipTriggerWrapper({
  ref,
  children,
  disabled,
  type: _type,
  tabIndex,
  role: _role,
  onFocus,
  onBlur,
  'aria-describedby': ariaDescribedby,
  'data-state': dataState,
  'data-disabled': dataDisabled,
  'data-delay-duration': dataDelayDuration,
  'data-tooltip-trigger': dataTooltipTrigger,
  ...props
}: TooltipTriggerWrapperProps) {
  const wrapper = React.useRef<HTMLSpanElement>(null);
  const targets = React.useRef(new Map<HTMLElement, Map<ForwardedAttribute, AttributeRecord>>());
  const [hasInteractiveChild, setHasInteractiveChild] = React.useState(false);
  const [inMenuContent, setInMenuContent] = React.useState(false);
  React.useImperativeHandle(ref, () => wrapper.current!, []);

  React.useLayoutEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const values = {
      'aria-describedby': ariaDescribedby,
      'data-state': dataState,
      'data-delay-duration': dataDelayDuration,
      'data-tooltip-trigger': dataTooltipTrigger,
    };
    const sync = () => {
      const descendants = new Set(element.querySelectorAll<HTMLElement>(interactiveSelector));
      setInMenuContent(element.closest('[role="menu"], [role="menuitem"]') !== null);
      setHasInteractiveChild(descendants.size > 0);
      for (const [target, attributes] of targets.current) {
        if (descendants.has(target)) continue;
        restoreAttributes(target, attributes);
        targets.current.delete(target);
      }
      for (const target of descendants) {
        let attributes = targets.current.get(target);
        if (!attributes) {
          attributes = new Map();
          targets.current.set(target, attributes);
        }
        for (const attribute of forwardedAttributes) {
          const current = target.getAttribute(attribute);
          let record = attributes.get(attribute);
          if (!record) {
            record = { original: current, forwarded: current };
            attributes.set(attribute, record);
          } else if (current !== record.forwarded) {
            record.original = current;
          }
          // Controls such as toggles own data-state even while the tooltip opens.
          if (attribute === 'data-state' && record.original !== null) {
            record.forwarded = current;
            continue;
          }
          const value = values[attribute];
          let next = record.original;
          if (value !== undefined && value !== null && value !== false) {
            const forwarded = value === true ? '' : String(value);
            next =
              attribute === 'aria-describedby' && record.original
                ? [...new Set(`${record.original} ${forwarded}`.split(/\s+/).filter(Boolean))].join(
                    ' ',
                  )
                : forwarded;
          }
          record.forwarded = next;
          setAttribute(target, attribute, next);
        }
      }
    };
    sync();
    // Descendants can be replaced or update their own accessibility state without
    // rendering this wrapper. Observe those changes without doing any layout reads.
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.target !== element || record.type === 'childList'))
        sync();
    });
    observer.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [...forwardedAttributes, 'href', 'role', 'tabindex', 'type'],
    });
    return () => observer.disconnect();
  }, [ariaDescribedby, dataState, dataDelayDuration, dataTooltipTrigger, children]);

  React.useLayoutEffect(() => {
    const forwardedTargets = targets.current;
    return () => {
      for (const [target, attributes] of forwardedTargets) restoreAttributes(target, attributes);
      forwardedTargets.clear();
    };
  }, []);

  return (
    <span
      {...props}
      ref={wrapper}
      role={hasInteractiveChild || inMenuContent ? undefined : 'button'}
      tabIndex={hasInteractiveChild ? -1 : inMenuContent ? undefined : tabIndex}
      aria-disabled={hasInteractiveChild || inMenuContent ? undefined : disabled || undefined}
      aria-describedby={hasInteractiveChild ? undefined : ariaDescribedby}
      data-state={hasInteractiveChild ? undefined : dataState}
      data-disabled={hasInteractiveChild ? undefined : dataDisabled}
      data-delay-duration={hasInteractiveChild ? undefined : dataDelayDuration}
      data-tooltip-trigger={hasInteractiveChild ? undefined : dataTooltipTrigger}
      onFocus={onFocus}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        onBlur?.(event);
      }}
    >
      {children}
    </span>
  );
}
