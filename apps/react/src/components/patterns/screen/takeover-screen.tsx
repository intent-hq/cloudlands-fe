import { useRef, type ComponentPropsWithRef, type ReactNode } from 'react';
import { Screen, ScreenHeader, ScreenBody } from '@/components/patterns/screen/screen';
import { ScreenFooter } from '@/components/patterns/screen/screen-footer';
import { useAnimatedHeight } from '@/lib/motion';
import { cn } from '@/lib/utils';

type DataAttributes = Record<`data-${string}`, string | number | boolean | undefined>;
export interface TakeoverScreenProps extends Omit<
  ComponentPropsWithRef<'section'>,
  'title' | 'children'
> {
  title: ReactNode;
  description?: ReactNode;
  counter?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  destructive?: ReactNode;
  secondary?: ReactNode;
  primary: ReactNode;
  hint?: string;
  headerClass?: string;
  bodyClass?: string;
  footerClass?: string;
  headerAttributes?: DataAttributes;
  bodyRegionAttributes?: DataAttributes;
  footerAttributes?: DataAttributes;
}

/** Source: TakeoverScreen.svelte; the body alone owns scrolling while content resizes. */
export function TakeoverScreen({
  title,
  description,
  counter,
  leading,
  actions,
  children,
  destructive,
  secondary,
  primary,
  hint,
  headerClass,
  bodyClass,
  footerClass,
  headerAttributes,
  bodyRegionAttributes,
  footerAttributes,
  className,
  ...props
}: TakeoverScreenProps) {
  const height = useRef<HTMLDivElement>(null);
  useAnimatedHeight(height);
  return (
    <div data-slot="takeover-screen" className="flex min-h-0 w-full min-w-0 flex-col">
      <Screen className={cn('min-h-0 flex-1 overflow-hidden', className)} {...props}>
        <ScreenHeader
          title={title}
          description={description}
          counter={counter}
          leading={leading}
          actions={actions}
          className={headerClass}
          {...headerAttributes}
        />
        <div
          className="min-h-0 flex-1 overflow-y-auto"
          data-slot="takeover-screen-body"
          {...bodyRegionAttributes}
        >
          <div ref={height}>
            <ScreenBody className={bodyClass}>{children}</ScreenBody>
          </div>
        </div>
        <ScreenFooter
          destructive={destructive}
          secondary={secondary}
          primary={primary}
          hint={hint}
          className={footerClass}
          {...footerAttributes}
        />
      </Screen>
    </div>
  );
}
