<script lang="ts">
  import { onDestroy } from 'svelte';
  import { put, takeEvery } from 'redux-saga/effects';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import {
    loadFileContentRequested,
    loadFileContentSucceeded,
  } from '$store/renderer/slices/files/files-slice';
  import { editableText } from '$features/file/utils/file-content';
  import FileTabHarness from './mocks/MockFileTabTypeHarness.svelte';

  let { content }: { content: string } = $props();
  const workspaceId = 'markdown-file-test';
  const filePath = 'diagram.md';
  const stop = startRootStoreLifecycle(store, {
    startSagas: () => [
      store.runSaga(function* fileReadFixture() {
        yield takeEvery(loadFileContentRequested.type, function* () {
          yield put(
            loadFileContentSucceeded(workspaceId, filePath, filePath, editableText(content)),
          );
        });
      }),
    ],
  });
  onDestroy(stop);

  $effect(() => {
    store.dispatch(
      loadFileContentSucceeded(workspaceId, filePath, filePath, editableText(content)),
    );
  });
</script>

<div class="h-[700px] w-full">
  <FileTabHarness
    {workspaceId}
    tab={{ id: 'markdown-file-tab', type: 'file', title: filePath, filePath, closable: true }}
  />
</div>
