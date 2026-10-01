import type { UIChatMessage } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { preparePdfVisionMessages, renderPdfVisionPages } from './pdfVision';

const mocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  destroy: vi.fn(),
  getDocument: vi.fn(),
  render: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }));
vi.mock('@napi-rs/canvas', () => ({
  createCanvas: () => ({ getContext: () => ({}), toBuffer: () => Buffer.from('png') }),
  DOMMatrix: class {},
  ImageData: class {},
  Path2D: class {},
}));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument: mocks.getDocument }));

const scannedMessage = () =>
  ({
    content: 'Read the scanned document',
    fileList: [
      {
        content: '<page pageNumber="1"></page>',
        fileType: 'application/pdf',
        id: 'pdf1',
        name: 'scan.pdf',
        size: 100,
        url: 'https://storage/scan.pdf',
      },
    ],
    id: 'msg1',
    role: 'user',
  }) as UIChatMessage;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readFile.mockResolvedValue(Buffer.from('pdf'));
  mocks.render.mockReturnValue({ promise: Promise.resolve() });
  mocks.getDocument.mockReturnValue({
    promise: Promise.resolve({
      destroy: mocks.destroy,
      getPage: async () => ({
        cleanup: mocks.cleanup,
        getViewport: ({ scale }: { scale: number }) => ({
          width: 600 * scale,
          height: 800 * scale,
        }),
        render: mocks.render,
      }),
      numPages: 1,
    }),
  });
});

describe('scanned PDF native vision context', () => {
  it('adds rendered pages even when the PDF has no extracted text, without mutating persisted messages', async () => {
    const message = scannedMessage();
    const cleanup = vi.fn();
    const downloadFileToLocal = vi.fn().mockResolvedValue({ cleanup, filePath: '/tmp/pdf' });
    const [result] = await preparePdfVisionMessages([message], { downloadFileToLocal });
    expect(result.imageList).toEqual([
      { alt: 'scan.pdf, page 1', id: 'pdf1:page:1', url: 'data:image/png;base64,cG5n' },
    ]);
    expect(message.imageList).toBeUndefined();
    expect(result.fileList).toBe(message.fileList);
    expect(downloadFileToLocal).toHaveBeenCalledWith('pdf1');
    expect(cleanup).toHaveBeenCalledOnce();
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it('reuses rendering for an attachment appearing in multiple history messages', async () => {
    const downloadFileToLocal = vi
      .fn()
      .mockResolvedValue({ cleanup: vi.fn(), filePath: '/tmp/pdf' });
    await preparePdfVisionMessages([scannedMessage(), scannedMessage()], { downloadFileToLocal });
    expect(downloadFileToLocal).toHaveBeenCalledOnce();
  });

  it('does not download inaccessible attachments or attachment URLs supplied by the model', async () => {
    const message = scannedMessage();
    message.fileList![0].inaccessible = true;
    const downloadFileToLocal = vi.fn();
    expect(await preparePdfVisionMessages([message], { downloadFileToLocal })).toEqual([message]);
    expect(downloadFileToLocal).not.toHaveBeenCalled();
  });

  it('preserves the existing text path for PDFs with extracted text', async () => {
    const message = scannedMessage();
    message.fileList![0].content = '<page pageNumber="1">Text content</page>';
    const downloadFileToLocal = vi.fn();
    expect(await preparePdfVisionMessages([message], { downloadFileToLocal })).toEqual([message]);
    expect(downloadFileToLocal).not.toHaveBeenCalled();
  });

  it('rejects oversized PDFs before downloading them', async () => {
    const message = scannedMessage();
    message.fileList![0].size = 31 * 1024 * 1024;
    const downloadFileToLocal = vi.fn();
    await expect(preparePdfVisionMessages([message], { downloadFileToLocal })).rejects.toThrow(
      '30 MB',
    );
    expect(downloadFileToLocal).not.toHaveBeenCalled();
  });

  it('destroys the document when its page count exceeds the bound', async () => {
    mocks.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 21, destroy: mocks.destroy }),
    });
    await expect(renderPdfVisionPages('/tmp/pdf')).rejects.toThrow('20-page');
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it('cleans up both page and document after a render failure', async () => {
    mocks.render.mockImplementation(() => ({
      promise: Promise.reject(new Error('render failed')),
    }));
    const cleanup = vi.fn();
    await expect(
      preparePdfVisionMessages([scannedMessage()], {
        downloadFileToLocal: vi.fn().mockResolvedValue({ cleanup, filePath: '/tmp/pdf' }),
      }),
    ).rejects.toThrow('render failed');
    expect(cleanup).toHaveBeenCalledOnce();
    expect(mocks.cleanup).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});
