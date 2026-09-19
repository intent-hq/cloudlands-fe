<script lang="ts">
  import Fa from 'svelte-fa';
  import { faEllipsis } from '@fortawesome/free-solid-svg-icons';
  import * as Menu from '$lib/components/ui/menu';
  import { toast } from '$lib/components/ui/toast';
  import { m } from '$shared/paraglide/messages.js';
  import { copyDiagramImage, copyDiagramSvg, downloadDiagramSvg } from './diagram-export';

  interface Props {
    container?: HTMLElement;
    fileName?: string;
  }

  let { container, fileName = 'diagram' }: Props = $props();

  async function copyImage() {
    if (!container) return toast.error(m.diagram_actions_copyFailed_error());
    try {
      // eslint-disable-next-line intent/no-component-async-data-fetch -- exports rendered pixels and font assets to the clipboard, not domain data
      await copyDiagramImage(container);
      toast.success(m.diagram_actions_imageCopied_label());
    } catch {
      toast.error(m.diagram_actions_copyFailed_error());
    }
  }

  async function copySvg() {
    if (!container) return toast.error(m.diagram_actions_copyFailed_error());
    try {
      // eslint-disable-next-line intent/no-component-async-data-fetch -- serializes the rendered graph with font assets for a local copy action
      await copyDiagramSvg(container);
      toast.success(m.diagram_actions_svgCopied_label());
    } catch {
      toast.error(m.diagram_actions_copyFailed_error());
    }
  }

  async function downloadSvg() {
    if (!container) return toast.error(m.diagram_actions_downloadFailed_error());
    try {
      // eslint-disable-next-line intent/no-component-async-data-fetch -- reads font assets for a user-triggered rendered SVG download, not domain data
      await downloadDiagramSvg(container, fileName);
      toast.success(m.diagram_actions_svgDownloaded_label());
    } catch {
      toast.error(m.diagram_actions_downloadFailed_error());
    }
  }
</script>

<Menu.Root>
  <Menu.Trigger aria-label={m.diagram_actions_menu_ariaLabel()}>
    <Fa icon={faEllipsis} size="sm" />
  </Menu.Trigger>
  <Menu.Content align="end">
    <Menu.Item onSelect={() => void copyImage()}>{m.diagram_actions_copyImage_label()}</Menu.Item>
    <Menu.Item onSelect={() => void copySvg()}>{m.diagram_actions_copySvg_label()}</Menu.Item>
    <Menu.Item onSelect={() => void downloadSvg()}
      >{m.diagram_actions_downloadSvg_label()}</Menu.Item
    >
  </Menu.Content>
</Menu.Root>
