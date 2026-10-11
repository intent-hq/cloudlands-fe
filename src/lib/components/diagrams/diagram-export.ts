import { writeTextToClipboard } from '$lib/utils/clipboard';
import { createDiagramExport } from './diagram-export-core';

export {
  prepareDiagramSvgForExport,
  serializeDiagramSvg,
  copyDiagramImage,
  downloadDiagramSvg,
} from './diagram-export-core';
export const { copyDiagramSvg } = createDiagramExport(writeTextToClipboard);
