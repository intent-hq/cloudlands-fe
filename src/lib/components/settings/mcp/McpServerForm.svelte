<script lang="ts">
  import type { McpServerFormState, McpTransportType, McpAuthType } from './types';
  import {
  createEmptyFormState,
  formStateToServer,
} from './types';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import {
  faPlus,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { formatInteger } from '$lib/i18n/format';
  import {
  RESERVED_MCP_SERVER_NAMES,
  MCP_SERVER_NAME_REGEX,
  MCP_SERVER_NAME_MAX_LENGTH,
} from '$shared/config/mcp-constants';

  interface Props {
    /** Initial form values (for edit mode) */
    initialValues?: McpServerFormState;
    /** Whether this is for editing an existing server */
    editMode?: boolean;
    /** Names of existing servers (for duplicate checking) */
    existingServerNames?: string[];
    /** Called when form is submitted */
    onSubmit: (config: ReturnType<typeof formStateToServer>) => void | Promise<void>;
    /** Called when form is cancelled */
    onCancel: () => void;
  }

  let { initialValues, editMode = false, existingServerNames = [], onSubmit, onCancel }: Props = $props();



  // Form state - initialize once from props
  function getInitialForm(): McpServerFormState {
    return initialValues ? { ...initialValues } : createEmptyFormState();
  }

  let form = $state<McpServerFormState>(getInitialForm());
  let error = $state('');
  let isSubmitting = $state(false);

  // Transport type options
  const transportTypes: { value: McpTransportType; label: string }[] = [
    { value: 'stdio', label: m.settings_mcp_form_transport_stdio() },
    { value: 'http', label: m.settings_mcp_form_transport_http() },
    { value: 'sse', label: m.settings_mcp_form_transport_sse() },
  ];

  // Auth type options
  const authTypes: { value: McpAuthType; label: string }[] = [
    { value: 'none', label: m.settings_mcp_form_auth_none() },
    { value: 'oauth', label: m.settings_mcp_form_auth_oauth() },
    { value: 'header', label: m.settings_mcp_form_auth_header() },
  ];

  // Add a new env var pair
  function addEnvVar() {
    form.envPairs = [...form.envPairs, { id: crypto.randomUUID(), key: '', value: '' }];
  }

  // Remove an env var pair
  function removeEnvVar(id: string) {
    form.envPairs = form.envPairs.filter((p) => p.id !== id);
  }

  // Add a new header pair
  function addHeader() {
    form.headerPairs = [...form.headerPairs, { id: crypto.randomUUID(), key: '', value: '' }];
  }

  // Remove a header pair
  function removeHeader(id: string) {
    form.headerPairs = form.headerPairs.filter((p) => p.id !== id);
  }

  // Handle keyboard shortcuts
  function handleKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      handleSubmit();
    }
  }

  // Validate server name and return error message, or empty string if valid
  function validateName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) {
      return m.settings_mcp_form_nameRequired();
    }
    if (trimmed.length > MCP_SERVER_NAME_MAX_LENGTH) {
      return m.settings_mcp_form_nameTooLong({ max: formatInteger(MCP_SERVER_NAME_MAX_LENGTH) });
    }
    if (!MCP_SERVER_NAME_REGEX.test(trimmed)) {
      return m.settings_mcp_form_nameInvalidChars();
    }
    if ((RESERVED_MCP_SERVER_NAMES as readonly string[]).includes(trimmed)) {
      return m.settings_mcp_form_nameReserved({ name: trimmed });
    }
    if (!editMode && existingServerNames.includes(trimmed)) {
      return m.settings_mcp_form_nameExists({ name: trimmed });
    }
    return '';
  }

  // Reactive name error for inline display
  let nameError = $derived(form.name ? validateName(form.name) : '');

  // Validate and submit
  async function handleSubmit() {
    error = '';

    // Validate name
    const nameValidationError = validateName(form.name);
    if (nameValidationError) {
      error = nameValidationError;
      return;
    }

    // Validate based on type
    if (form.type === 'stdio') {
      if (!form.command.trim()) {
        error = m.settings_mcp_form_commandRequired();
        return;
      }
    } else {
      if (!form.url.trim()) {
        error = m.settings_mcp_form_urlRequired();
        return;
      }
      // Basic URL validation
      try {
        new URL(form.url);
      } catch {
        error = m.settings_mcp_form_urlInvalid();
        return;
      }
    }

    const config = formStateToServer(form);
    isSubmitting = true;
    try {
      await onSubmit(config);
    } finally {
      isSubmitting = false;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="space-y-4" onkeydown={handleKeydown}>
  <!-- Server Name -->
  <div>
    <span class="block text-sm font-medium mb-1.5">
      {m.settings_mcp_form_serverName_label()} <span class="text-destructive-foreground">*</span>
    </span>
    <Input
      bind:value={form.name}
      placeholder={m.settings_mcp_form_serverName_placeholder()}
      disabled={editMode}
      maxlength={MCP_SERVER_NAME_MAX_LENGTH}
    />
    {#if nameError && !editMode}
      <p class="text-xs text-destructive-foreground mt-1">{nameError}</p>
    {:else}
      <p class="text-xs text-subtle mt-1">{m.settings_mcp_form_serverName_hint()}</p>
    {/if}
  </div>

  <!-- Connection Type -->
  <div>
    <span class="block text-sm font-medium mb-1.5">
      {m.settings_mcp_form_connectionType_label()}
      <span class="text-destructive-foreground">*</span>
    </span>
    <div class="flex gap-1 p-1 bg-muted rounded-lg w-fit">
      {#each transportTypes as type (type.value)}
        <button
          type="button"
          class="px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer
                 {form.type === type.value
                   ? 'bg-background text-foreground shadow-sm'
                   : 'text-muted-foreground hover:text-foreground'}"
          onclick={() => (form.type = type.value)}
        >
          {type.label}
        </button>
      {/each}
    </div>
    <p class="text-xs text-subtle mt-1.5">
      {#if form.type === 'stdio'}
        {m.settings_mcp_form_transportHint_stdio()}
      {:else if form.type === 'http'}
        {m.settings_mcp_form_transportHint_http()}
      {:else}
        {m.settings_mcp_form_transportHint_sse()}
      {/if}
    </p>
  </div>

  <!-- stdio fields -->
  {#if form.type === 'stdio'}
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <span class="block text-sm font-medium mb-1.5">
          {m.settings_mcp_form_command_label()} <span class="text-destructive-foreground">*</span>
        </span>
        <!-- i18n-ignore (example command) -->
        <Input bind:value={form.command} placeholder="npx -y @some/mcp-server" />
        <p class="text-xs text-subtle mt-1">{m.settings_mcp_form_command_hint()}</p>
      </div>

      <div>
        <span class="block text-sm font-medium mb-1.5">{m.settings_mcp_form_arguments_label()}</span>
        <!-- i18n-ignore (example flags) -->
        <Input bind:value={form.args} placeholder="--port 3000 --verbose" />
        <p class="text-xs text-subtle mt-1">{m.settings_mcp_form_arguments_hint()}</p>
      </div>
    </div>

    <!-- Environment Variables -->
    <div>
      <div class="flex items-center justify-between mb-1.5">
        <span class="text-sm font-medium">{m.settings_mcp_form_envVars_label()}</span>
        <Button size="sm" variant="ghost" onclick={addEnvVar}>
          <Fa icon={faPlus} class="mr-1" size="xs" />
          {m.settings_mcp_form_add()}
        </Button>
      </div>
      <p class="text-xs text-subtle mb-2">{m.settings_mcp_form_envVars_hint()}</p>
      {#if form.envPairs.length === 0}
        <p class="text-xs text-subtle italic">{m.settings_mcp_form_envVars_empty()}</p>
      {:else}
        <div class="space-y-2">
          {#each form.envPairs as pair (pair.id)}
            <div class="flex gap-2 items-center">
              <!-- i18n-ignore (env var format examples) -->
              <Input bind:value={pair.key} placeholder="KEY" class="flex-1" />
              <span class="text-subtle">=</span>
              <!-- i18n-ignore (env var format examples) -->
              <Input bind:value={pair.value} placeholder="value" class="flex-1" />
              <Button size="sm" variant="ghost" onclick={() => removeEnvVar(pair.id)}>
                <Fa icon={faTrash} size="xs" class="text-destructive-foreground" />
              </Button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <!-- Remote fields (http/sse) -->
    <div>
      <span class="block text-sm font-medium mb-1.5">
        {m.settings_mcp_form_url_label()} <span class="text-destructive-foreground">*</span>
      </span>
      <!-- i18n-ignore (example URL) -->
      <Input bind:value={form.url} placeholder="https://example.com/mcp" />
      <p class="text-xs text-subtle mt-1">{m.settings_mcp_form_url_hint()}</p>
    </div>

    <!-- Auth Type -->
    <div>
      <span class="block text-sm font-medium mb-1.5">{m.settings_mcp_form_authentication_label()}</span>
      <div class="flex gap-1 p-1 bg-muted rounded-lg w-fit">
        {#each authTypes as auth (auth.value)}
          <button
            type="button"
            class="px-3 py-1.5 text-sm rounded-md transition-colors cursor-pointer
                   {form.authType === auth.value
                     ? 'bg-background text-foreground shadow-sm'
                     : 'text-muted-foreground hover:text-foreground'}"
            onclick={() => (form.authType = auth.value)}
          >
            {auth.label}
          </button>
        {/each}
      </div>
      <p class="text-xs text-subtle mt-1.5">
        {#if form.authType === 'none'}
          {m.settings_mcp_form_authHint_none()}
        {:else if form.authType === 'oauth'}
          {m.settings_mcp_form_authHint_oauth()}
        {:else}
          {m.settings_mcp_form_authHint_header()}
        {/if}
      </p>
    </div>

    <!-- Headers (for header auth) -->
    {#if form.authType === 'header'}
      <div>
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-sm font-medium">{m.settings_mcp_form_headers_label()}</span>
          <Button size="sm" variant="ghost" onclick={addHeader}>
            <Fa icon={faPlus} class="mr-1" size="xs" />
            {m.settings_mcp_form_add()}
          </Button>
        </div>
        <p class="text-xs text-subtle mb-2">{m.settings_mcp_form_headers_hint()}</p>
        {#if form.headerPairs.length === 0}
          <p class="text-xs text-subtle italic">{m.settings_mcp_form_headers_empty()}</p>
        {:else}
          <div class="space-y-2">
            {#each form.headerPairs as pair (pair.id)}
              <div class="flex gap-2 items-center">
                <!-- i18n-ignore (header format examples) -->
                <Input bind:value={pair.key} placeholder="Header-Name" class="flex-1" />
                <span class="text-subtle">:</span>
                <!-- i18n-ignore (header format examples) -->
                <Input bind:value={pair.value} placeholder="value" class="flex-1" />
                <Button size="sm" variant="ghost" onclick={() => removeHeader(pair.id)}>
                  <Fa icon={faTrash} size="xs" class="text-destructive-foreground" />
                </Button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if form.authType === 'oauth'}
      <div class="p-3 bg-muted/30 rounded-md border border-border">
        <p class="text-sm text-subtle">
          {m.settings_mcp_form_oauthNote()}
        </p>
      </div>
    {/if}
  {/if}

  <!-- Error message -->
  {#if error}
    <div class="text-sm text-destructive-foreground">{error}</div>
  {/if}

  <!-- Actions -->
  <div class="flex gap-2 pt-2">
    <Button variant="outline" onclick={onCancel} class="flex-1" disabled={isSubmitting}>
      {m.settings_mcp_form_cancel()}
    </Button>
    <Button onclick={handleSubmit} class="flex-1" disabled={isSubmitting}>
      {#if isSubmitting}
        {m.settings_mcp_form_adding()}
      {:else}
        {editMode ? m.settings_mcp_form_updateServer() : m.settings_mcp_form_addServer()}
      {/if}
    </Button>
  </div>
</div>
