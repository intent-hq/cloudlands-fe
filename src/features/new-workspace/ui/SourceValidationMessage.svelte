<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import type { NewFolderNameError } from '../utils/source-validation';

  interface Props {
    error?: NewFolderNameError;
    class?: string;
  }

  let { error, class: className = '' }: Props = $props();

  function errorLabel(value: NewFolderNameError): string {
    switch (value) {
      case 'required':
        return m.workspaceValidation_projectNameRequired_error();
      case 'path-separator':
        return m.workspaceCreation_projectPicker_pathSeparators_error();
      case 'dot-name':
        return m.workspaceCreation_projectPicker_dotName_error();
      case 'null-character':
        return m.workspaceCreation_projectPicker_nullChars_error();
      case 'invalid-character':
        return m.workspaceCreation_projectPicker_invalidChars_error();
      case 'too-long':
        return m.workspaceCreation_projectPicker_nameTooLong_error();
    }
  }
</script>

{#if error}
  <p class="type-caption text-danger {className}" role="alert">{errorLabel(error)}</p>
{/if}
