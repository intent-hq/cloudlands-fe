import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Vite emits these as local, hashed assets, including in the packaged app.
// No PDF content or font request goes to a third-party CDN.
const assets = import.meta.glob<string>(
  '/node_modules/pdfjs-dist/{cmaps,standard_fonts,wasm}/*.{bcmap,pfb,ttf,wasm}',
  { eager: true, query: '?url', import: 'default' },
);
const directories: Record<string, string> = {
  cMapUrl: 'cmaps',
  standardFontDataUrl: 'standard_fonts',
  wasmUrl: 'wasm',
};

class BundledPdfData {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = assets[`/node_modules/pdfjs-dist/${directories[kind]}/${filename}`];
    if (!url) throw new Error('Unsupported PDF resource');
    const response = await fetch(url);
    if (!response.ok) throw new Error('Could not load PDF resource');
    return new Uint8Array(await response.arrayBuffer());
  }
}

export function loadPdfDocument(data: Uint8Array<ArrayBuffer>) {
  GlobalWorkerOptions.workerSrc = workerUrl;
  return getDocument({
    data,
    BinaryDataFactory: BundledPdfData,
    useWorkerFetch: false,
    stopAtErrors: true,
  });
}
