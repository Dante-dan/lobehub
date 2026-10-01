// @vitest-environment node
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { renderPdfVisionPages } from './pdfVision';

// Existing repository PDF fixture, not the issue author's scanned document.
const fixture = fileURLToPath(
  new URL(
    '../../../../../../packages/file-loaders/src/loaders/pdf/fixtures/test.pdf',
    import.meta.url,
  ),
);

describe('PDF vision native renderer', () => {
  it('renders the existing PDF fixture to bounded PNG page inputs', async () => {
    const pages = await renderPdfVisionPages(fixture);
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      const png = Buffer.from(page.slice('data:image/png;base64,'.length), 'base64');
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(png.readUInt32BE(16)).toBeLessThanOrEqual(1600);
      expect(png.readUInt32BE(20)).toBeLessThanOrEqual(1600);
    }
  }, 30_000);
});
