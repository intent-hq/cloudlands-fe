<script lang="ts">
  import { page } from '$app/state';
  import WorkspaceTabStripGeometryPreview from './workspace-tab-strip-geometry.preview.svelte';

  // CT aliases $app/state to a writable route stub. Match the application's
  // workspace route so the real titlebar renders the neighboring tab as active.
  Object.assign(page, {
    url: new URL('http://localhost/workspace/geometry-beta'),
    params: { id: 'geometry-beta' },
  });
</script>

<WorkspaceTabStripGeometryPreview activeWorkspaceId="geometry-beta" fullTitlebar />
