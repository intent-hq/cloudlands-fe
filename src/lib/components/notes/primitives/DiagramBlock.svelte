<script lang="ts">
  import { NodeViewWrapper } from 'svelte-tiptap';
  import type { NodeViewProps } from '@tiptap/core';
  import type { DiagramPrimitive } from '$shared/types/notes-primitives';
  import Fa from 'svelte-fa';
  import {
    faChevronDown,
    faImage,
    faCode,
    faCopy,
    faFloppyDisk,
    faCheck,
  } from '@fortawesome/free-solid-svg-icons';
  import { slide } from 'svelte/transition';
  import DiagramRenderer from '$lib/components/diagrams/DiagramRenderer.svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import DropdownMenu from '$lib/components/ui/dropdown-menu.svelte';
  import { Tooltip } from '$lib/components/ui/tooltip';
  import { toast } from '$lib/components/ui/toast';
  import { dialog, invoke } from '$lib/electron-bridge';
  import { selectActiveWorkspace } from '$lib/store/slices/workspace/workspace-selectors';

  const activeWorkspace = selectActiveWorkspace();

  // TipTap NodeViewProps
  let { node, updateAttributes }: NodeViewProps = $props();

  // Extract primitive data
  let primitive = $derived<DiagramPrimitive | null>(node.attrs.data);

  // Expanded state
  let expanded = $state(true);

  function toggleExpanded() {
    expanded = !expanded;
  }

  // Handle diagram updates
  function handleDiagramUpdate(updates: Partial<DiagramPrimitive>) {
    if (!primitive || !updateAttributes) return;

    updateAttributes({
      data: {
        ...primitive,
        ...updates,
      },
    });
  }

  function toSentenceCase(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  // Display name
  let displayName = $derived(
    toSentenceCase(primitive?.label || `${primitive?.grammar} diagram` || 'Diagram'),
  );

  // Handle binding clicks - dispatch custom event for parent to handle
  function handleBindingClick(e: MouseEvent, binding: { type: string; target: string }) {
    const openInAdjacentPanel = e.metaKey || e.ctrlKey;
    const panelElement = (e.target as HTMLElement)?.closest('[data-panel-id]');
    const sourcePanelId = panelElement?.getAttribute('data-panel-id') ?? undefined;
    window.dispatchEvent(
      new CustomEvent('diagram:binding-click', {
        detail: { ...binding, openInAdjacentPanel, sourcePanelId },
      }),
    );
  }

  // Diagram container ref for copying
  let diagramContainer: HTMLDivElement | undefined = $state();

  // Inline all computed styles for an element
  function inlineStyles(source: Element, target: Element) {
    const computed = getComputedStyle(source);
    const importantStyles = [
      'background-color',
      'background',
      'border',
      'border-color',
      'border-width',
      'border-style',
      'border-radius',
      'color',
      'fill',
      'stroke',
      'stroke-width',
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'letter-spacing',
      'text-align',
      'text-transform',
      'padding',
      'margin',
      'display',
      'flex-direction',
      'align-items',
      'justify-content',
      'gap',
      'width',
      'height',
      'box-sizing',
      'opacity',
    ];

    let styleString = '';
    for (const prop of importantStyles) {
      const value = computed.getPropertyValue(prop);
      if (value && value !== 'none' && value !== 'normal' && value !== '0px') {
        styleString += `${prop}: ${value}; `;
      }
    }

    if (target instanceof HTMLElement || target instanceof SVGElement) {
      const existingStyle = target.getAttribute('style') || '';
      target.setAttribute('style', existingStyle + styleString);
    }
  }

  // Prepare SVG for export by inlining all styles
  function prepareSvgForExport(svg: SVGSVGElement): SVGSVGElement {
    const clone = svg.cloneNode(true) as SVGSVGElement;

    // Add required namespaces
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

    // Get all elements in both original and clone
    const origElements = svg.querySelectorAll('*');
    const cloneElements = clone.querySelectorAll('*');

    // Inline styles for each element
    origElements.forEach((origEl, i) => {
      const cloneEl = cloneElements[i];
      if (cloneEl) {
        inlineStyles(origEl, cloneEl);
      }
    });

    // Fix marker references - inline the arrow marker with resolved colors
    const markers = clone.querySelectorAll('marker');
    markers.forEach((marker) => {
      const paths = marker.querySelectorAll('path');
      paths.forEach((path) => {
        // Resolve the stroke color from CSS variable
        const origMarker = svg.querySelector(`#${marker.id}`);
        if (origMarker) {
          const origPath = origMarker.querySelector('path');
          if (origPath) {
            const strokeColor = getComputedStyle(origPath).stroke;
            path.setAttribute('stroke', strokeColor);
          }
        }
      });
    });

    // Fix edge paths
    const edgePaths = clone.querySelectorAll('.edge-path, path[class*="edge"]');
    const origEdgePaths = svg.querySelectorAll('.edge-path, path[class*="edge"]');
    edgePaths.forEach((path, i) => {
      const origPath = origEdgePaths[i];
      if (origPath) {
        const strokeColor = getComputedStyle(origPath).stroke;
        path.setAttribute('stroke', strokeColor);
        path.setAttribute('fill', 'none');
      }
    });

    // Convert foreignObject HTML nodes to native SVG elements
    // This ensures the SVG works standalone (foreignObject with HTML doesn't export well)
    const foreignObjects = Array.from(clone.querySelectorAll('foreignObject'));
    const origForeignObjects = Array.from(svg.querySelectorAll('foreignObject'));

    foreignObjects.forEach((fo, i) => {
      const origFo = origForeignObjects[i];
      if (!origFo) return;

      const x = parseFloat(fo.getAttribute('x') || '0');
      const y = parseFloat(fo.getAttribute('y') || '0');
      const width = parseFloat(fo.getAttribute('width') || '0');
      const height = parseFloat(fo.getAttribute('height') || '0');

      // Find the node content in the original
      const nodeDiv = origFo.querySelector('.diagram-node-html');
      if (nodeDiv) {
        // Get computed styles from the original
        const computed = getComputedStyle(nodeDiv);
        const bgColor = computed.backgroundColor;
        const borderColor = computed.borderColor;

        // Create SVG group to replace foreignObject
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

        // Create rect for the node background
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(x));
        rect.setAttribute('y', String(y));
        rect.setAttribute('width', String(width));
        rect.setAttribute('height', String(height));
        rect.setAttribute('fill', bgColor || '#ffffff');
        rect.setAttribute('stroke', borderColor || '#e5e5e5');
        rect.setAttribute('stroke-width', '1');
        g.appendChild(rect);

        // Get text content
        const labelEl = origFo.querySelector('.node-label');
        const kindEl = origFo.querySelector('.node-kind-label');

        if (labelEl) {
          const labelText = labelEl.textContent || '';
          const labelComputed = getComputedStyle(labelEl);

          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', String(x + width / 2));
          text.setAttribute('y', String(y + height / 2 + (kindEl ? -4 : 0)));
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('dominant-baseline', 'middle');
          text.setAttribute('fill', labelComputed.color || '#000000');
          text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
          text.setAttribute('font-size', labelComputed.fontSize || '11px');
          text.setAttribute('font-weight', labelComputed.fontWeight || '500');
          text.textContent = labelText;
          g.appendChild(text);
        }

        if (kindEl) {
          const kindText = kindEl.textContent || '';
          const kindComputed = getComputedStyle(kindEl);

          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', String(x + width / 2));
          text.setAttribute('y', String(y + height / 2 + 10));
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('dominant-baseline', 'middle');
          text.setAttribute('fill', kindComputed.color || '#888888');
          text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
          text.setAttribute('font-size', kindComputed.fontSize || '8px');
          text.setAttribute('font-weight', '500');
          text.setAttribute('text-transform', 'uppercase');
          text.setAttribute('opacity', '0.6');
          text.textContent = kindText;
          g.appendChild(text);
        }

        // Replace foreignObject with native SVG group
        fo.parentNode?.replaceChild(g, fo);
      } else {
        // For edge labels or other foreignObject content
        const labelDiv = origFo.querySelector('.edge-label-html');
        if (labelDiv) {
          const labelText = labelDiv.textContent || '';
          const computed = getComputedStyle(labelDiv);

          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('x', String(x + width / 2));
          text.setAttribute('y', String(y + height / 2));
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('dominant-baseline', 'middle');
          text.setAttribute('fill', computed.color || '#666666');
          text.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
          text.setAttribute('font-size', computed.fontSize || '10px');
          text.setAttribute('font-weight', '500');
          text.textContent = labelText;

          fo.parentNode?.replaceChild(text, fo);
        }
      }
    });

    return clone;
  }

  // Copy diagram as SVG
  async function copyAsSvg() {
    if (!diagramContainer) return;
    const svg = diagramContainer.querySelector('svg');
    if (!svg) return;

    const clone = prepareSvgForExport(svg);

    // Serialize to string
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clone);

    try {
      await navigator.clipboard.writeText(svgString);
    } catch {
      // Fallback for older browsers
      const blob = new Blob([svgString], { type: 'image/svg+xml' });
      const item = new ClipboardItem({ 'image/svg+xml': blob });
      await navigator.clipboard.write([item]);
    }
  }

  // Copy diagram as PNG
  async function copyAsPng() {
    if (!diagramContainer) return;
    const svg = diagramContainer.querySelector('svg');
    if (!svg) return;

    const clone = prepareSvgForExport(svg);

    // Get the visual dimensions of the SVG as displayed on screen
    const rect = svg.getBoundingClientRect();
    const visualWidth = rect.width;
    const visualHeight = rect.height;

    // Use 2x for retina quality - this is the standard for crisp images
    // The output will be 2x pixels but displays at 1x visual size in retina-aware apps
    const scale = 2;
    const pixelWidth = Math.round(visualWidth * scale);
    const pixelHeight = Math.round(visualHeight * scale);

    // Get the SVG's internal coordinate system
    const svgWidth = parseFloat(svg.getAttribute('width') || String(visualWidth));
    const svgHeight = parseFloat(svg.getAttribute('height') || String(visualHeight));

    // Set viewBox to match the SVG's coordinate system
    clone.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);

    // Set output dimensions
    clone.setAttribute('width', String(pixelWidth));
    clone.setAttribute('height', String(pixelHeight));

    // Add rendering hints for crisp output
    clone.style.setProperty('text-rendering', 'optimizeLegibility');
    clone.style.setProperty('shape-rendering', 'crispEdges');

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(clone);

    // Use base64 data URL to avoid tainted canvas issues
    const encoder = new TextEncoder();
    const bytes = encoder.encode(svgString);
    const base64 = btoa(String.fromCharCode(...bytes));
    const dataUrl = `data:image/svg+xml;base64,${base64}`;

    // Create image and canvas
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Disable smoothing for crisp pixels
      ctx.imageSmoothingEnabled = false;

      // Fill with white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, pixelWidth, pixelHeight);

      // Draw the SVG at full size
      ctx.drawImage(img, 0, 0, pixelWidth, pixelHeight);

      // Copy to clipboard
      canvas.toBlob(
        async (blob) => {
          if (!blob) return;
          try {
            const item = new ClipboardItem({ 'image/png': blob });
            await navigator.clipboard.write([item]);
          } catch {
            // Fallback: download the image
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${displayName || 'diagram'}.png`;
            a.click();
          }
        },
        'image/png',
        1.0,
      );
    };
    img.src = dataUrl;
  }

  // State for copy feedback
  let copiedSvg = $state(false);
  let copiedPng = $state(false);
  let saved = $state(false);

  async function handleCopyAsSvg() {
    await copyAsSvg();
    copiedSvg = true;
    toast.success('SVG copied to clipboard');
    setTimeout(() => (copiedSvg = false), 2000);
  }

  async function handleCopyAsPng() {
    await copyAsPng();
    copiedPng = true;
    toast.success('PNG copied to clipboard');
    setTimeout(() => (copiedPng = false), 2000);
  }

  // Save diagram to workspace
  async function saveDiagram(format: 'svg' | 'png') {
    if (!diagramContainer) return;
    const svg = diagramContainer.querySelector('svg');
    if (!svg) return;

    const workspace = $activeWorkspace;
    const defaultDir = workspace?.worktreePath || workspace?.repositoryPath || '';
    const safeName = (displayName || 'diagram').replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
    const defaultPath = defaultDir
      ? `${defaultDir}/${safeName}.${format}`
      : `${safeName}.${format}`;

    const filePath = await dialog.save({
      title: `Save diagram as ${format.toUpperCase()}`,
      defaultPath,
      filters: [
        format === 'svg'
          ? { name: 'SVG Files', extensions: ['svg'] }
          : { name: 'PNG Files', extensions: ['png'] },
      ],
    });

    if (!filePath) return;

    const wsId = workspace?.id;

    try {
      if (format === 'svg') {
        const clone = prepareSvgForExport(svg);
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(clone);
        await invoke('file:write', {
          path: filePath,
          content: svgString,
          workspaceId: wsId,
        });
      } else {
        // For PNG, we need to create the image data and save it
        const clone = prepareSvgForExport(svg);
        const rect = svg.getBoundingClientRect();
        const scale = 2;
        const pixelWidth = Math.round(rect.width * scale);
        const pixelHeight = Math.round(rect.height * scale);
        const svgWidth = parseFloat(svg.getAttribute('width') || String(rect.width));
        const svgHeight = parseFloat(svg.getAttribute('height') || String(rect.height));

        clone.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
        clone.setAttribute('width', String(pixelWidth));
        clone.setAttribute('height', String(pixelHeight));

        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(clone);
        const encoder = new TextEncoder();
        const bytes = encoder.encode(svgString);
        const base64 = btoa(String.fromCharCode(...bytes));
        const dataUrl = `data:image/svg+xml;base64,${base64}`;

        // Create image and canvas to convert to PNG
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = async () => {
            const canvas = document.createElement('canvas');
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              reject(new Error('Could not get canvas context'));
              return;
            }
            ctx.imageSmoothingEnabled = false;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, pixelWidth, pixelHeight);
            ctx.drawImage(img, 0, 0, pixelWidth, pixelHeight);

            canvas.toBlob(
              async (blob) => {
                if (!blob) {
                  reject(new Error('Could not create PNG blob'));
                  return;
                }
                // Convert blob to base64 for file writing
                const reader = new FileReader();
                reader.onload = async () => {
                  const base64Data = (reader.result as string).split(',')[1];
                  await invoke('file:write', {
                    path: filePath,
                    content: base64Data,
                    encoding: 'base64',
                    workspaceId: wsId,
                  });
                  resolve();
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              },
              'image/png',
              1.0,
            );
          };
          img.onerror = reject;
          img.src = dataUrl;
        });
      }

      // Emit file:changed event to trigger file tree refresh
      if (wsId) {
        window.dispatchEvent(
          new CustomEvent('file:changed', {
            detail: {
              workspaceId: wsId,
              files: [filePath],
              type: 'create',
            },
          }),
        );
      }

      // Open the saved file in a new tab
      window.dispatchEvent(
        new CustomEvent('workspace:open-file', {
          detail: { path: filePath, workspaceId: wsId },
          bubbles: true,
        }),
      );

      saved = true;
      toast.success(`Saved ${format.toUpperCase()} to ${filePath.split('/').pop()}`);
      setTimeout(() => (saved = false), 2000);
    } catch (error) {
      toast.error(`Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
</script>

<NodeViewWrapper>
  {#if primitive}
    {@const linkedAgentId = primitive.createdByAgentId}
    <div class="mt-6 pb-16">
      <!-- Header row -->
      <div class="flex items-center gap-2 mb-2">
        {#if linkedAgentId}
          <!-- Show agent avatar that opens the agent panel -->
          <button
            type="button"
            class="flex-none hover:opacity-80 transition-opacity cursor-pointer"
            onclick={() =>
              window.dispatchEvent(
                new CustomEvent('workspace:open-agent', { detail: { agentId: linkedAgentId } }),
              )}
            title="View agent"
          >
            <AuggieAvatar faceSeed={linkedAgentId} colorSeed={linkedAgentId} size={16} />
          </button>
        {/if}
        <button
          type="button"
          class="flex items-center gap-1.5 text-subtle transition-colors flex-1 min-w-0 cursor-pointer"
          onclick={toggleExpanded}
        >
          <Fa
            icon={faChevronDown}
            size="sm"
            class="flex-none text-ghost transition-transform {expanded
              ? ''
              : '-rotate-90'}"
          />
          <span class="text-sm truncate">{displayName}</span>
          {#if primitive.states && primitive.states.length > 0}
            <span class="text-xs text-subtle">
              ({primitive.states.length} states)
            </span>
          {/if}
        </button>

        <!-- Copy dropdown -->
        <DropdownMenu align="end">
          {#snippet trigger({ toggle }: { toggle: () => void })}
            <Tooltip content="Copy diagram" side="top" delayDuration={300}>
              <button
                type="button"
                class="flex-none p-1 rounded hover:bg-muted/50 transition-colors text-muted-foreground hover:text-muted-foreground cursor-pointer"
                onclick={(e) => {
                  e.stopPropagation();
                  toggle();
                }}
              >
                {#if copiedSvg || copiedPng}
                  <Fa icon={faCheck} size="sm" class="text-green-500" />
                {:else}
                  <Fa icon={faCopy} size="sm" />
                {/if}
              </button>
            </Tooltip>
          {/snippet}
          {#snippet content({ close }: { close: () => void })}
            <div class="min-w-36">
              <button
                type="button"
                class="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-muted/50 transition-colors cursor-pointer"
                onclick={() => {
                  handleCopyAsSvg();
                  close();
                }}
              >
                <Fa icon={faCode} size="xs" class="text-ghost" />
                Copy as SVG
              </button>
              <button
                type="button"
                class="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-muted/50 transition-colors cursor-pointer"
                onclick={() => {
                  handleCopyAsPng();
                  close();
                }}
              >
                <Fa icon={faImage} size="xs" class="text-ghost" />
                Copy as PNG
              </button>
            </div>
          {/snippet}
        </DropdownMenu>

        <!-- Save dropdown -->
        <DropdownMenu align="end">
          {#snippet trigger({ toggle }: { toggle: () => void })}
            <Tooltip content="Save to codebase" side="top" delayDuration={300}>
              <button
                type="button"
                class="flex-none p-1 rounded hover:bg-muted/50 transition-colors text-muted-foreground hover:text-muted-foreground cursor-pointer"
                onclick={(e) => {
                  e.stopPropagation();
                  toggle();
                }}
              >
                {#if saved}
                  <Fa icon={faCheck} size="sm" class="text-green-500" />
                {:else}
                  <Fa icon={faFloppyDisk} size="sm" />
                {/if}
              </button>
            </Tooltip>
          {/snippet}
          {#snippet content({ close }: { close: () => void })}
            <div class="min-w-36">
              <button
                type="button"
                class="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-muted/50 transition-colors cursor-pointer"
                onclick={() => {
                  saveDiagram('svg');
                  close();
                }}
              >
                <Fa icon={faCode} size="xs" class="text-ghost" />
                Save as SVG
              </button>
              <button
                type="button"
                class="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-muted/50 transition-colors cursor-pointer"
                onclick={() => {
                  saveDiagram('png');
                  close();
                }}
              >
                <Fa icon={faImage} size="xs" class="text-ghost" />
                Save as PNG
              </button>
            </div>
          {/snippet}
        </DropdownMenu>
      </div>

      <!-- Expanded content -->
      {#if expanded}
        <div bind:this={diagramContainer} transition:slide={{ duration: 150 }}>
          <DiagramRenderer
            diagram={primitive}
            onUpdate={handleDiagramUpdate}
            editable={false}
            onBindingClick={handleBindingClick}
          />
        </div>
      {/if}
    </div>
  {:else}
    <div class="my-2 text-sm text-subtle">Invalid diagram block</div>
  {/if}
</NodeViewWrapper>
