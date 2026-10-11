// Source: DiagramActionsMenu.svelte. Export algorithms remain shared with the reference.
import * as Menu from '@/components/ui/menu';
import { toast } from '@/components/ui/toast';
import { writeTextToClipboard } from '@/lib/clipboard';
import { createDiagramExport } from '$lib/components/diagrams/diagram-export-core';
import { m } from '$shared/paraglide/messages.js';

const { copyDiagramImage, copyDiagramSvg, downloadDiagramSvg } =
  createDiagramExport(writeTextToClipboard);
export interface DiagramActionsMenuProps {
  container?: HTMLElement;
  fileName?: string;
  compactTrigger?: boolean;
}
export function DiagramActionsMenu({
  container,
  fileName = 'diagram',
  compactTrigger = false,
}: DiagramActionsMenuProps) {
  async function perform(action: 'image' | 'svg' | 'download') {
    try {
      if (!container) throw new Error('Diagram container is unavailable');
      if (action === 'image') await copyDiagramImage(container);
      else if (action === 'svg') await copyDiagramSvg(container);
      else await downloadDiagramSvg(container, fileName);
      toast.success(
        action === 'image'
          ? m.diagram_actions_imageCopied_label()
          : action === 'svg'
            ? m.diagram_actions_svgCopied_label()
            : m.diagram_actions_svgDownloaded_label(),
      );
    } catch {
      toast.error(
        action === 'download'
          ? m.diagram_actions_downloadFailed_error()
          : m.diagram_actions_copyFailed_error(),
      );
    }
  }
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={m.diagram_actions_menu_ariaLabel()}
        className={compactTrigger ? 'size-(--control-height-compact) p-0' : undefined}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="size-3.5"
          aria-hidden="true"
        >
          <path d="M8 2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM8 6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM9.5 12.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0Z" />
        </svg>
      </Menu.Trigger>
      <Menu.Content align="end">
        <Menu.Item onSelect={() => void perform('image')}>
          {m.diagram_actions_copyImage_label()}
        </Menu.Item>
        <Menu.Item onSelect={() => void perform('svg')}>
          {m.diagram_actions_copySvg_label()}
        </Menu.Item>
        <Menu.Item onSelect={() => void perform('download')}>
          {m.diagram_actions_downloadSvg_label()}
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}
export default DiagramActionsMenu;
