<script lang="ts">
  import { page } from '$app/state';
  import SandboxLayout from '../../routes/sandbox/+layout.svelte';
  import DiffViewer from '$features/file-tracking/components/diff/DiffViewer.svelte';

  // CT's page stub omits route params; this fixture supplies the sandbox route context.
  Object.assign(page, { params: {} });
  const patch = [
    'diff --git a/greeting.txt b/greeting.txt',
    '--- a/greeting.txt',
    '+++ b/greeting.txt',
    '@@ -12,3 +12,3 @@ Greeting',
    ' first line',
    '-Hello',
    '+Welcome',
    ' last line',
    '',
  ].join('\n');
</script>

<SandboxLayout>
  <div style="width: 390px" data-testid="catalog-diff">
    <DiffViewer {patch} fileName="greeting.txt" viewMode="unified" />
  </div>
</SandboxLayout>
