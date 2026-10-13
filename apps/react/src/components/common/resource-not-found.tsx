import { Button } from '@/components/ui/button';
import { IconDefinitionIcon } from '@/components/icons/icon-definition';
import { faCircleQuestion, faTriangleExclamation } from '$lib/icons/phosphor-icon-definitions';
import { m } from '$shared/paraglide/messages.js';

export interface ResourceNotFoundProps {
  kind: 'not_found' | 'error';
  resourceLabel: string;
  resourceId?: string;
  detail?: string;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  onNavigateAway: () => void;
}

export function ResourceNotFound({
  kind,
  resourceLabel,
  resourceId,
  detail,
  headingLevel = 1,
  onNavigateAway,
}: ResourceNotFoundProps) {
  const title =
    kind === 'not_found'
      ? m.common_resourceNotFound_notFound_title({ resourceLabel })
      : m.common_resourceNotFound_loadFailed_title({ resourceLabel: resourceLabel.toLowerCase() });
  const Heading = `h${headingLevel}` as const;

  return (
    <div
      className="h-full min-h-0 w-full overflow-auto bg-background"
      data-resource-not-found={kind}
    >
      <div className="flex min-h-full w-full items-center justify-center p-2 sm:p-6">
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source block status region; this load failure is not a calculation output. */}
        <div className="w-full max-w-md" role="status">
          <div className="flex flex-col items-center space-y-3 p-2 text-center sm:space-y-6 sm:p-8">
            <span className="max-[479px]:hidden" aria-hidden="true">
              <IconDefinitionIcon
                icon={kind === 'not_found' ? faCircleQuestion : faTriangleExclamation}
                size="2.5em"
                className="text-subtle"
              />
            </span>
            <div className="w-full space-y-2 sm:space-y-3">
              <Heading className="break-words text-lg font-semibold text-foreground max-[479px]:text-base sm:text-2xl">
                {title}
              </Heading>
              {resourceId && (
                <p className="break-all font-mono text-xs text-subtle max-[479px]:hidden sm:text-sm">
                  {resourceId}
                </p>
              )}
              {detail && (
                <p className="mx-auto max-w-sm break-words text-sm leading-relaxed text-subtle sm:text-base">
                  {detail}
                </p>
              )}
            </div>
            <Button
              variant="default"
              size="default"
              className="h-auto max-w-full whitespace-normal break-words text-center max-[479px]:text-xs"
              onClick={onNavigateAway}
            >
              {m.layout_sidebarNav_allWorkspaces_title()}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
