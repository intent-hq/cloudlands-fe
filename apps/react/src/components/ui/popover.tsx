// Based on shadcn/ui popover; the shared menu recipe owns its surface.
import * as React from 'react';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';
import { clampSurface, SurfaceProvider, useSurface } from '@/components/ui/surface-context';
import { menuOverlayClass } from './overlay-recipes';
import './overlays.css';

const StaticPopover = React.createContext(false);
export function Popover({
  staticPosition = false,
  children,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root> & { staticPosition?: boolean }) {
  return (
    <StaticPopover value={staticPosition}>
      <PopoverPrimitive.Root {...props}>{children}</PopoverPrimitive.Root>
    </StaticPopover>
  );
}
export function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}
export function PopoverAnchor(props: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}
export function PopoverClose(props: React.ComponentProps<typeof PopoverPrimitive.Close>) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}
export function PopoverContent({
  className,
  portal = true,
  portalProps,
  staticPosition,
  sideOffset = 4,
  collisionPadding = 8,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  portal?: boolean;
  portalProps?: React.ComponentProps<typeof PopoverPrimitive.Portal>;
  staticPosition?: boolean;
}) {
  const rootStatic = React.useContext(StaticPopover);
  const isStatic = staticPosition ?? rootStatic;
  const surface = clampSurface(useSurface() + 2);
  const content = (
    <PopoverPrimitive.Content
      data-slot="popover-content"
      data-static-position={isStatic || undefined}
      data-surface-level={surface}
      className={cn(menuOverlayClass, className)}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      onOpenAutoFocus={(event) => {
        if (isStatic) event.preventDefault();
        else onOpenAutoFocus?.(event);
      }}
      onCloseAutoFocus={(event) => {
        if (isStatic) event.preventDefault();
        else onCloseAutoFocus?.(event);
      }}
      {...props}
    />
  );
  return (
    <SurfaceProvider level={surface}>
      {isStatic ? (
        <div data-static-position>{content}</div>
      ) : portal ? (
        <PopoverPrimitive.Portal {...portalProps}>{content}</PopoverPrimitive.Portal>
      ) : (
        content
      )}
    </SurfaceProvider>
  );
}
