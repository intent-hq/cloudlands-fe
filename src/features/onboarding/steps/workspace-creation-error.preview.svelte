<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { BaseRefreshCategory } from '$shared/types/base-refresh-failure';

  interface Props {
    category?: BaseRefreshCategory | 'generic';
    toast?: boolean;
  }

  const category = (value: Props['category']) => ({ props: { category: value } });

  export const preview = definePreview<Props>({
    id: 'workspace-creation-error',
    title: 'Workspace creation error',
    defaultState: 'auth-required-ssh',
    captureReadiness: {
      selector:
        '[data-workspace-creation-error-preview] [role="alert"], [data-workspace-creation-error-preview] [data-sonner-toast]',
    },
    states: {
      'auth-required-ssh': category('auth-required'),
      'ssh-host-key': category('ssh-host-key'),
      network: category('network'),
      timeout: category('timeout'),
      'repo-not-found': category('repo-not-found'),
      'access-denied': category('access-denied'),
      other: category('other'),
      generic: category('generic'),
      'continue-toast': { props: { toast: true } },
    },
  });
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { notify } from '$lib/components/patterns/notify';
  import { Toast } from '$lib/components/ui/toast';
  import { m } from '$shared/paraglide/messages.js';
  import WorkspaceCreationError from './WorkspaceCreationError.svelte';

  let { category = 'auth-required', toast = false }: Props = $props();

  // i18n-ignore (sample git output supplied as fixture content)
  const details: Record<BaseRefreshCategory, string> = {
    'auth-required':
      'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
    'ssh-host-key':
      'No ED25519 host key is known for github.com and you have requested strict checking.\nHost key verification failed.\nfatal: Could not read from remote repository.',
    network:
      "fatal: unable to access 'https://github.com/acme/app.git/': Could not resolve host: github.com",
    timeout: 'git fetch origin main did not finish within 100s and was stopped',
    'repo-not-found': "fatal: '/srv/git/app.git' does not appear to be a git repository",
    'access-denied':
      "remote: Permission to acme/app.git denied to dev.\nfatal: unable to access 'https://github.com/acme/app.git/': The requested URL returned error: 403",
    other: 'fatal: bad object refs/remotes/origin/main',
  };

  onMount(() => {
    if (!toast) return;
    const id = notify.warning(
      m.workspace_create_staleBase_toast({ base: 'main', remote: 'origin' }),
      {
        toasterId: 'workspace-creation-error-preview',
        duration: Number.POSITIVE_INFINITY,
      },
    );
    return () => notify.dismiss(id);
  });
</script>

<div class="max-w-xl p-6" data-workspace-creation-error-preview>
  {#if toast}
    <Toast
      regionId="workspace-creation-error-region"
      toasterId="workspace-creation-error-preview"
      staticPosition
    />
  {:else if category === 'generic'}
    <!-- i18n-ignore (sample daemon error supplied as fixture content) -->
    <WorkspaceCreationError
      message="Internal error: git worktree add failed: fatal: invalid reference: feature/x"
      onRetry={() => undefined}
      onContinue={() => undefined}
    />
  {:else}
    <WorkspaceCreationError
      message={`Couldn't update main from origin: ${details[category].split('\n')[0]}`}
      errorCode="base-refresh-failed"
      baseRefreshFailure={{
        category,
        detail: details[category],
        baseRef: 'main',
        remote: 'origin',
      }}
      onRetry={() => undefined}
      onContinue={() => undefined}
    />
  {/if}
</div>
