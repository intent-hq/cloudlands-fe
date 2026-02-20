<script lang="ts">
  /**
   * Activity Log Changes Panel
   *
   * Shows changes from activity log items in the main panel.
   * Uses PanelWrapper for consistent styling with other main panel views.
   */

  import type { WorkspaceEvent } from '$features/events/types';
  import MainPanelChangesView from '$lib/components/file-tracking/MainPanelChangesView.svelte';
  import PanelWrapper from '$lib/components/ui/PanelWrapper.svelte';
  import { eventToTrackedChange } from '$features/file-tracking/change-converters';
  import { formatDistanceToNow } from 'date-fns';
  import { createLogger } from '$lib/utils/client-logger';
  import {
    faFileEdit,
    faFileCirclePlus,
    faFileCircleXmark,
    faTimeline,
  } from '@fortawesome/free-solid-svg-icons';

  const logger = createLogger('ActivityLogChangesPanel');

  interface Props {
    event: WorkspaceEvent;
    workspaceId: string;
    canGoBack?: boolean;
    canGoForward?: boolean;
    onNavigateBack?: () => void;
    onNavigateForward?: () => void;
    onClose?: () => void;
    onShowFile?: (path: string) => void;
  }

  let {
    event,
    workspaceId,
    canGoBack = false,
    canGoForward = false,
    onNavigateBack,
    onNavigateForward,
    onClose,
    onShowFile,
  }: Props = $props();

  // Convert event to TrackedChange format
  let changes = $derived.by(() => {
    const converted = eventToTrackedChange(event);
    logger.info('[ActivityLogChangesPanel] Converted event to changes', {
      eventType: event.type,
      eventId: event.id,
      changesCount: converted.length,
      event,
      changes: converted,
    });
    return converted;
  });

  // Extract event metadata
  let eventType = $derived(event.type);
  let eventWithData = $derived(event as any);
  let eventData = $derived(eventWithData.data || {});
  let timestamp = $derived(event.timestamp);
  let actor = $derived(event.actor);

  // Get file path from either location
  let filePath = $derived(
    eventData.path ||
      eventWithData.filePath ||
      eventWithData.codeChange?.filePath ||
      eventData.file,
  );

  // Generate title and subtitle
  let eventTitle = $derived(
    eventType === 'file:changed' || eventType === 'file:created' || eventType === 'file:deleted'
      ? `File ${eventType.split(':')[1]}: ${filePath?.split('/').pop() || filePath || 'Unknown'}`
      : eventType === 'agent:completed'
        ? `Agent Turn ${eventData.turnNumber || ''}`
        : eventType.replace(/:/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
  );

  let eventSubtitle = $derived(
    `${formatDistanceToNow(new Date(timestamp), { addSuffix: true })} • ${actor?.name || actor?.id || 'System'}`,
  );

  // Get agent data if this is an agent event
  let agentData = $derived.by(() => {
    if (
      eventType === 'agent:completed' ||
      (eventType.startsWith('agent:') && eventData.turnNumber)
    ) {
      return {
        agentId: eventData.agentId,
        agentName: eventData.agentName || 'Agent',
        sessionId: eventData.sessionId,
        turnNumber: eventData.turnNumber || 0,
      };
    }
    return null;
  });

  // Get folder path for display
  let folderPath = $derived.by(() => {
    if (!filePath) return '';
    const parts = filePath.split('/');
    parts.pop(); // Remove filename
    return parts.length > 0 ? parts.join('/') : '';
  });

  // Get breadcrumb icon based on event type
  let breadcrumbIcon = $derived.by(() => {
    if (eventType === 'file:created') return faFileCirclePlus;
    if (eventType === 'file:deleted') return faFileCircleXmark;
    if (eventType.startsWith('file:')) return faFileEdit;
    return faTimeline;
  });

  // For single file events, auto-select the change and show diff directly
  let isSingleFileEvent = $derived(
    eventType.startsWith('file:') && changes.length === 1,
  );
</script>

<!-- Use PanelWrapper for consistent styling with other main panel views -->
<PanelWrapper
  title={eventTitle}
  subtitle={folderPath || eventSubtitle}
  breadcrumbs={[{ label: 'Activity', icon: breadcrumbIcon }]}
  {canGoBack}
  {canGoForward}
  {onNavigateBack}
  {onNavigateForward}
  {onClose}
  showClose={!!onClose}
>
  <MainPanelChangesView
    viewType="activity"
    {changes}
    title={eventTitle}
    {workspaceId}
    agentId={agentData?.agentId}
    agentName={agentData?.agentName}
    turnNumber={agentData?.turnNumber}
    {event}
    showSummaryCard={agentData !== null}
    showGrouping={false}
    showFiltering={false}
    showHeader={false}
    autoSelectSingle={isSingleFileEvent}
    onNavigateToFile={onShowFile}
  />
</PanelWrapper>
