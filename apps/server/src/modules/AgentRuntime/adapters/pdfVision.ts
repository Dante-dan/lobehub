import { readFile } from 'node:fs/promises';

import type { UIChatMessage } from '@lobechat/types';

import type { FileService } from '@/server/services/file';

const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_PAGES = 20;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_PAGE_EDGE = 1600;

/** Render only inside the backend; never fetch a model-provided attachment URL. */
export const renderPdfVisionPages = async (filePath: string): Promise<string[]> => {
  const { createCanvas, DOMMatrix, ImageData, Path2D } = await import('@napi-rs/canvas');
  // pdfjs accesses these browser primitives during module evaluation and rendering.
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = await readFile(filePath);
  if (data.byteLength > MAX_PDF_BYTES) throw new Error('PDF exceeds the 30 MB vision limit.');
  const document = await getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise;
  try {
    if (document.numPages > MAX_PAGES) throw new Error('PDF exceeds the 20-page vision limit.');
    const images: string[] = [];
    let imageBytes = 0;
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i);
      try {
        const original = page.getViewport({ scale: 1 });
        const scale = Math.min(2, MAX_PAGE_EDGE / Math.max(original.width, original.height));
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise;
        const png = canvas.toBuffer('image/png');
        imageBytes += png.byteLength;
        if (imageBytes > MAX_IMAGE_BYTES)
          throw new Error('Rendered PDF exceeds the 16 MB vision limit.');
        images.push(`data:image/png;base64,${png.toString('base64')}`);
      } finally {
        page.cleanup();
      }
    }
    return images;
  } finally {
    await document.destroy();
  }
};

/** Keep attachment rows unchanged; page images belong only to this model call. */
export const preparePdfVisionMessages = async (
  messages: UIChatMessage[],
  fileService: Pick<FileService, 'downloadFileToLocal'>,
): Promise<UIChatMessage[]> => {
  const rendered = new Map<string, Promise<string[]>>();
  const result: UIChatMessage[] = [];
  let totalPages = 0;
  let totalImageBytes = 0;
  for (const message of messages) {
    if (message.role !== 'user') {
      result.push(message);
      continue;
    }
    const pdfs = message.fileList?.filter(
      (file) =>
        !file.inaccessible &&
        file.fileType === 'application/pdf' &&
        file.id &&
        !(file.content ?? '').replaceAll(/<\/?page(?:\s[^>]*)?>/g, '').trim(),
    );
    if (!pdfs?.length) {
      result.push(message);
      continue;
    }
    const imageList = [...(message.imageList ?? [])];
    for (const file of pdfs) {
      if (!rendered.has(file.id)) {
        rendered.set(
          file.id,
          (async () => {
            if (file.size > MAX_PDF_BYTES) throw new Error('PDF exceeds the 30 MB vision limit.');
            const local = await fileService.downloadFileToLocal(file.id);
            try {
              return await renderPdfVisionPages(local.filePath);
            } finally {
              local.cleanup();
            }
          })(),
        );
      }
      // Fail the call explicitly instead of silently claiming an unreadable PDF was inspected.
      const pages = await rendered.get(file.id)!;
      totalPages += pages.length;
      totalImageBytes += pages.reduce((size, url) => size + url.length, 0);
      if (totalPages > MAX_PAGES || totalImageBytes > (MAX_IMAGE_BYTES * 4) / 3) {
        throw new Error('PDF attachments exceed the combined vision input limit.');
      }
      pages.forEach((url, index) =>
        imageList.push({
          alt: `${file.name}, page ${index + 1}`,
          id: `${file.id}:page:${index + 1}`,
          url,
        }),
      );
    }
    result.push({ ...message, imageList });
  }
  return result;
};
