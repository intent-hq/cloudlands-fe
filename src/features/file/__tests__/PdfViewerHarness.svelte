<script lang="ts">
  import { onDestroy } from 'svelte';
  import { store } from '$store/renderer/store';
  import { pdfPreviewSaga } from '$store/renderer/slices/pdf-preview/sagas/pdf-preview-saga';
  import PdfViewer from '../components/PdfViewer.svelte';
  let { workspaceId, filePath }: { workspaceId: string; filePath: string } = $props();
  onDestroy(store.runSaga(pdfPreviewSaga));
</script>

<PdfViewer {workspaceId} {filePath} />
