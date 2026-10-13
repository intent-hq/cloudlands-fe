import { Skeleton } from '@/components/ui/skeleton';

export function SidebarSkeleton() {
  return (
    <div
      className="flex h-full w-full flex-col bg-sidebar text-sidebar-foreground"
      data-workspace-sidebar-skeleton=""
    >
      <div className="flex-none space-y-4 px-6 pb-2 pt-5" data-loading-workspace-header="">
        <Skeleton className="h-5 w-3/4 rounded-full bg-sidebar-foreground/10" />
        <div className="flex gap-3">
          <Skeleton className="h-3 w-2/5 rounded-full bg-sidebar-foreground/10" />
          <Skeleton className="h-3 w-1/3 rounded-full bg-sidebar-foreground/10" />
        </div>
        <Skeleton className="h-10 w-full rounded-md bg-sidebar-foreground/10" />
      </div>

      <div
        className="min-h-0 flex-1 space-y-4 overflow-hidden px-6 py-5"
        data-loading-workspace-activity=""
      >
        <Skeleton className="h-3 w-4/5 rounded-full bg-sidebar-foreground/10" />
        <Skeleton className="h-3 w-3/5 rounded-full bg-sidebar-foreground/10" />
        <div className="space-y-4 pt-4">
          {['78%', '64%', '72%'].map((width) => (
            <div key={width} className="flex items-center gap-3">
              <Skeleton className="size-3 shrink-0 rounded-full bg-sidebar-foreground/10" />
              <Skeleton
                className="h-3 flex-1 rounded-full bg-sidebar-foreground/10"
                style={{ maxWidth: width }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex-none space-y-3 px-6 pb-3" data-loading-sidebar-launchers="">
        <div className="grid h-56 grid-cols-2 gap-3">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="flex min-h-0 flex-col justify-between rounded-lg border border-border bg-card p-3"
              data-loading-sidebar-card=""
            >
              <Skeleton className="size-4 rounded-full bg-sidebar-foreground/10" />
              <Skeleton className="h-3 w-3/5 rounded-full bg-sidebar-foreground/10" />
            </div>
          ))}
        </div>
        <div className="grid h-20 grid-cols-2 gap-3">
          {Array.from({ length: 2 }, (_, index) => (
            <div
              key={index}
              className="flex items-center justify-between rounded-lg border border-border bg-card p-3"
              data-loading-sidebar-card=""
            >
              <Skeleton className="h-3 w-2/5 rounded-full bg-sidebar-foreground/10" />
              <Skeleton className="size-3 rounded-full bg-sidebar-foreground/10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
