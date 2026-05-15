<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import {
  faDownload,
  faSearchPlus,
  faSearchMinus,
  faArrowsRotate,
  faCopy,
  faCheck,
} from '@fortawesome/free-solid-svg-icons';
  import CodeEditor from './CodeEditor.svelte';
  import { createLogger } from '$lib/utils/client-logger';

  const logger = createLogger('FileViewer');

  interface Props {
    filePath: string;
    fileContent: string | ArrayBuffer;
    language?: string;
    isBinary?: boolean;
  }

  let { filePath, fileContent, language, isBinary }: Props = $props();

  // Determine file type from extension
  const getFileType = (path: string): string => {
    const ext = path.split('.').pop()?.toLowerCase() || '';

    // Image formats
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif'].includes(ext)) {
      return 'image';
    }
    if (ext === 'svg') {
      return 'svg';
    }

    // Video formats
    if (['mp4', 'webm', 'ogg', 'mov', 'avi'].includes(ext)) {
      return 'video';
    }

    // Audio formats
    if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) {
      return 'audio';
    }

    // Document formats
    if (ext === 'pdf') {
      return 'pdf';
    }
    if (['md', 'markdown'].includes(ext)) {
      return 'markdown';
    }

    // Data formats
    if (ext === 'json') {
      return 'json';
    }
    if (ext === 'csv') {
      return 'csv';
    }
    if (['yaml', 'yml'].includes(ext)) {
      return 'yaml';
    }
    if (ext === 'xml') {
      return 'xml';
    }

    // Archive formats (show info only)
    if (['zip', 'tar', 'gz', 'rar', '7z', 'bz2'].includes(ext)) {
      return 'archive';
    }

    // Binary formats
    if (['exe', 'dll', 'so', 'dylib', 'wasm'].includes(ext)) {
      return 'binary';
    }

    // Default to text/code
    return 'text';
  };

  const fileType = $derived(getFileType(filePath));
  const fileName = $derived(filePath.split('/').pop() || 'Unknown');

  // Image viewer state
  let imageZoom = $state(100);
  let imageRotation = $state(0);
  let copied = $state(false);

  // Convert content to appropriate format
  const getImageSrc = (): string => {
    if (typeof fileContent === 'string') {
      // If it's already a base64 string or URL
      if (fileContent.startsWith('data:') || fileContent.startsWith('http')) {
        return fileContent;
      }
      // If isBinary is true, the content is already base64 encoded
      if (isBinary) {
        const ext = filePath.split('.').pop()?.toLowerCase();
        return `data:image/${ext};base64,${fileContent}`;
      }
      // Otherwise, assume it's raw content that needs encoding
      const ext = filePath.split('.').pop()?.toLowerCase();
      return `data:image/${ext};base64,${fileContent}`;
    }
    // Handle ArrayBuffer
    if (fileContent instanceof ArrayBuffer) {
      const bytes = new Uint8Array(fileContent);
      const binary = bytes.reduce((acc, byte) => acc + String.fromCharCode(byte), '');
      const base64 = btoa(binary);
      const ext = filePath.split('.').pop()?.toLowerCase();
      return `data:image/${ext};base64,${base64}`;
    }
    return '';
  };

  const handleZoomIn = () => {
    imageZoom = Math.min(imageZoom + 25, 500);
  };

  const handleZoomOut = () => {
    imageZoom = Math.max(imageZoom - 25, 25);
  };

  const handleRotate = () => {
    imageRotation = (imageRotation + 90) % 360;
  };

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = getImageSrc();
    link.download = fileName;
    link.click();
  };

  const handleCopyImage = async () => {
    try {
      const src = getImageSrc();

      // Use canvas to convert image to PNG blob (required format for clipboard)
      const img = new Image();
      img.crossOrigin = 'anonymous';

      const blob = await new Promise<Blob>((resolve, reject) => {
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }
          ctx.drawImage(img, 0, 0);
          canvas.toBlob(
            (b) => {
              if (b) resolve(b);
              else reject(new Error('Failed to create blob from canvas'));
            },
            'image/png',
            1.0,
          );
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = src;
      });

      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch (err) {
      logger.error('Failed to copy image:', err);
    }
  };

  // Format JSON with syntax highlighting
  const formatJson = (content: string): string => {
    try {
      const parsed = JSON.parse(content);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return content;
    }
  };

  // Parse CSV to table
  const parseCSV = (content: string): string[][] => {
    const lines = content.split('\n');
    return lines.map((line) => {
      // Simple CSV parsing (doesn't handle quoted commas)
      return line.split(',').map((cell) => cell.trim());
    });
  };
</script>

<div class="h-full flex flex-col">
  {#if fileType === 'image'}
    <!-- Image Viewer -->
    <div class="flex-1 flex flex-col">
      <!-- Image Controls -->
      <div class="flex items-center gap-2 p-2 border-b border-border/50 bg-muted/30">
        <Button
          size="icon"
          variant="ghost"
          class="h-7 w-7"
          onclick={handleZoomOut}
          title="Zoom out"
        >
          <Fa icon={faSearchMinus} size="sm" />
        </Button>
        <span class="text-xs text-subtle min-w-[50px] text-center">{imageZoom}%</span>
        <Button size="icon" variant="ghost" class="h-7 w-7" onclick={handleZoomIn} title="Zoom in">
          <Fa icon={faSearchPlus} size="sm" />
        </Button>
        <div class="w-px h-5 bg-border mx-1"></div>
        <Button size="icon" variant="ghost" class="h-7 w-7" onclick={handleRotate} title="Rotate">
          <Fa icon={faArrowsRotate} size="sm" />
        </Button>
        <div class="w-px h-5 bg-border mx-1"></div>
        <Button
          size="icon"
          variant="ghost"
          class="h-7 w-7"
          onclick={handleCopyImage}
          title="Copy image"
        >
          {#if copied}
            <Fa icon={faCheck} size="sm" class="text-green-500" />
          {:else}
            <Fa icon={faCopy} size="sm" />
          {/if}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          class="h-7 w-7"
          onclick={handleDownload}
          title="Download"
        >
          <Fa icon={faDownload} size="sm" />
        </Button>
        <div class="ml-auto text-xs text-subtle">
          {fileName}
        </div>
      </div>

      <!-- Image Display -->
      <div class="flex-1 overflow-auto bg-checkered flex items-center justify-center p-4">
        <img
          src={getImageSrc()}
          alt={fileName}
          style="transform: scale({imageZoom /
            100}) rotate({imageRotation}deg); transition: transform 0.2s;"
          class="max-w-full max-h-full object-contain"
        />
      </div>
    </div>
  {:else if fileType === 'svg'}
    <!-- SVG Viewer with code toggle -->
    <div class="flex-1 flex flex-col">
      <div class="flex items-center gap-2 p-2 border-b border-border/50 bg-muted/30">
        <Button
          size="icon"
          variant="ghost"
          class="h-7 w-7"
          onclick={handleDownload}
          title="Download"
        >
          <Fa icon={faDownload} size="sm" />
        </Button>
        <div class="ml-auto text-xs text-subtle">
          {fileName}
        </div>
      </div>
      <div class="flex-1 overflow-auto bg-checkered flex items-center justify-center p-4">
        {@html fileContent}
      </div>
    </div>
  {:else if fileType === 'video'}
    <!-- Video Player -->
    <div class="flex-1 flex items-center justify-center bg-black">
      <!-- svelte-ignore a11y_media_has_caption -->
      <video controls class="max-w-full max-h-full">
        <source src={getImageSrc()} />
        Your browser does not support the video tag.
      </video>
    </div>
  {:else if fileType === 'audio'}
    <!-- Audio Player -->
    <div class="flex-1 flex flex-col items-center justify-center p-8">
      <div class="text-subtle mb-4">
        <svg class="w-24 h-24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
          />
        </svg>
      </div>
      <div class="text-sm text-subtle mb-4">{fileName}</div>
      <audio controls class="w-full max-w-md">
        <source src={getImageSrc()} />
        Your browser does not support the audio tag.
      </audio>
    </div>
  {:else if fileType === 'pdf'}
    <!-- PDF Notice -->
    <div class="flex-1 flex flex-col items-center justify-center p-8">
      <div class="text-subtle mb-4">
        <svg class="w-24 h-24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
          />
        </svg>
      </div>
      <p class="text-sm text-subtle mb-4">PDF Preview not available</p>
      <Button size="sm" variant="secondary" onclick={handleDownload}>
        <Fa icon={faDownload} size="sm" class="mr-2" />
        Download PDF
      </Button>
    </div>
  {:else if fileType === 'json'}
    <!-- JSON Viewer -->
    <CodeEditor
      value={formatJson(fileContent.toString())}
      language="json"
      fileName={filePath}
      lineNumbers={true}
      readOnly={true}
    />
  {:else if fileType === 'csv'}
    {@const rows = parseCSV(fileContent.toString())}
    <!-- CSV Table Viewer -->
    <div class="flex-1 overflow-auto p-4">
      <table class="w-full border-collapse">
        <thead>
          <tr>
            {#each rows[0] || [] as header, headerIndex (`header-${headerIndex}-${header}`)}
              <th class="border border-border px-2 py-1 text-left text-xs font-medium bg-muted">
                {header}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each rows.slice(1) as row, rowIndex (`row-${rowIndex}`)}
            <tr>
              {#each row as cell, cellIndex (`cell-${rowIndex}-${cellIndex}`)}
                <td class="border border-border px-2 py-1 text-xs">
                  {cell}
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if fileType === 'archive'}
    <!-- Archive Info -->
    <div class="flex-1 flex flex-col items-center justify-center p-8">
      <div class="text-subtle mb-4">
        <svg class="w-24 h-24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
          />
        </svg>
      </div>
      <p class="text-sm text-subtle mb-2">{fileName}</p>
      <p class="text-xs text-subtle">Archive file - extract to view contents</p>
    </div>
  {:else if fileType === 'binary'}
    <!-- Binary File Notice -->
    <div class="flex-1 flex flex-col items-center justify-center p-8">
      <div class="text-subtle mb-4">
        <svg class="w-24 h-24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
          />
        </svg>
      </div>
      <p class="text-sm text-subtle mb-2">{fileName}</p>
      <p class="text-xs text-subtle">Binary file - cannot be displayed</p>
    </div>
  {:else}
    <!-- Default: Code Editor -->
    <CodeEditor
      value={fileContent.toString()}
      {language}
      fileName={filePath}
      lineNumbers={true}
      highlightActiveLine={true}
    />
  {/if}
</div>

<style>
  .bg-checkered {
    background-image:
      linear-gradient(45deg, hsl(var(--muted)) 25%, transparent 25%),
      linear-gradient(-45deg, hsl(var(--muted)) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, hsl(var(--muted)) 75%),
      linear-gradient(-45deg, transparent 75%, hsl(var(--muted)) 75%);
    background-size: 20px 20px;
    background-position:
      0 0,
      0 10px,
      10px -10px,
      -10px 0px;
  }
</style>
