<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    getTemplateContent,
    LAST_USED_SETUP_SCRIPTS_STORAGE_KEY,
    RECENT_SETUP_SCRIPTS_STORAGE_KEY,
    recordLastUsedSetupScript,
    SETUP_SCRIPT_TEMPLATES,
    type SetupScriptChoice,
  } from '$features/setup-scripts';
  import SetupScriptPicker from './SetupScriptPicker.svelte';

  const repositoryKey = '/fixture/setup-script-recency';
  const previous = new Map(
    [LAST_USED_SETUP_SCRIPTS_STORAGE_KEY, RECENT_SETUP_SCRIPTS_STORAGE_KEY].map((key) => [
      key,
      localStorage.getItem(key),
    ]),
  );
  const templates = ['rust', 'node-pnpm', 'generic'].map((id) =>
    SETUP_SCRIPT_TEMPLATES.find((template) => template.id === id)!,
  );
  for (const template of templates) {
    recordLastUsedSetupScript(repositoryKey, {
      name: template.name,
      content: getTemplateContent(template),
      nameSource: 'named',
    });
  }
  onDestroy(() => {
    for (const [key, value] of previous) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
  });
  let choice = $state<SetupScriptChoice>({
    name: templates[2].name,
    content: getTemplateContent(templates[2]),
    source: 'named',
  });
</script>

<section class="ml-auto w-full max-w-[320px] p-4">
  <SetupScriptPicker
    value={choice.content}
    scriptName={choice.name}
    scriptNameSource={choice.source}
    {repositoryKey}
    onSelect={(next) => (choice = next)}
    onEdit={() => {}}
    onCreate={() => {}}
  />
</section>
