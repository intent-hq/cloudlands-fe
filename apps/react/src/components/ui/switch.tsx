// Based on shadcn/ui switch; track/thumb sizes mirror switch.svelte.
import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react';
import { Spring } from '@/lib/motion/springs';
import { onReducedMotionChange } from '@/lib/motion/environment';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

const sizes = {
  xs: [24, 14, 10],
  sm: [28, 16, 12],
  compact: [28, 16, 12],
  md: [34, 20, 16],
  default: [34, 20, 16],
  lg: [38, 22, 18],
} as const;
export type SwitchProps = ComponentProps<typeof SwitchPrimitive.Root> & {
  invalid?: boolean;
  size?: keyof typeof sizes;
  ariaLabel?: string;
  ariaLabelledby?: string;
  ariaDescribedby?: string;
};
export function Switch({
  className,
  size = 'md',
  invalid = false,
  ariaLabel,
  ariaLabelledby,
  ariaDescribedby,
  style,
  checked,
  defaultChecked = false,
  onCheckedChange,
  ...props
}: SwitchProps) {
  const [width, height, thumb] = sizes[size];
  const [localChecked, setLocalChecked] = useState(defaultChecked);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const motion = useRef<Spring<number> | null>(null);
  const resolvedChecked = checked ?? localChecked;
  const targetPosition = resolvedChecked ? width - thumb - 2 : 2;
  useLayoutEffect(() => {
    const position = new Spring(2, 'fast');
    motion.current = position;
    const write = () => {
      if (thumbRef.current)
        thumbRef.current.style.transform = `translateX(${position.current}px) translateY(-50%)`;
    };
    const stop = position.subscribe(write);
    const stopReducedMotion = onReducedMotionChange((reduced) => {
      if (reduced) void position.set(position.target, { instant: true });
    });
    write();
    return () => {
      stop();
      stopReducedMotion();
      position.destroy();
      motion.current = null;
    };
  }, []);
  useLayoutEffect(() => {
    void motion.current?.set(targetPosition);
  }, [targetPosition]);
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      {...props}
      checked={resolvedChecked}
      onCheckedChange={(next) => {
        setLocalChecked(next);
        onCheckedChange?.(next);
      }}
      type="button"
      aria-label={ariaLabel ?? props['aria-label']}
      aria-labelledby={ariaLabelledby ?? props['aria-labelledby']}
      aria-describedby={ariaDescribedby ?? props['aria-describedby']}
      aria-invalid={invalid || props['aria-invalid']}
      className={cn(
        "border-border peer relative inline-flex shrink-0 cursor-pointer items-center rounded-full border bg-muted shadow-(--elevation-raised) transition-[background-color,box-shadow,opacity] duration-spring-fast ease-spring-fast after:absolute after:-inset-y-2 after:-inset-x-1 after:content-[''] motion-reduce:transition-none",
        'hover:bg-hover active:bg-active disabled:cursor-not-allowed disabled:opacity-60',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:hover:bg-primary data-[state=checked]:active:bg-primary',
        invalid && 'border-danger ring-1 ring-danger/25',
        className,
      )}
      style={{ width, height, ...style }}
    >
      <SwitchPrimitive.Thumb
        ref={thumbRef}
        data-slot="switch-thumb"
        className="bg-card pointer-events-none absolute top-1/2 left-0 block rounded-full shadow-(--elevation-raised) ring-0 data-[state=checked]:bg-primary-foreground motion-reduce:transition-none"
        style={{ width: thumb, height: thumb, transform: 'translateX(2px) translateY(-50%)' }}
      />
    </SwitchPrimitive.Root>
  );
}
