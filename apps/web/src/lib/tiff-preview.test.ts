import { describe, expect, it } from 'vitest';
import UTIF, { type IFD } from 'utif';
import { tiffFixture } from '../../tests/tiff-fixture';
import { decodeTiffPage } from './tiff-preview';
import { previewKind } from './document-preview';

describe('document previews', () => {
  it.each([['scan.PDF', 'pdf'], ['photo.JPEG', 'image'], ['scan.TIF', 'tiff'], ['scan.tiff', 'tiff']] as const)('recognizes %s even when the upload MIME type is generic', (name, kind) => {
    expect(previewKind(name, 'application/octet-stream')).toBe(kind);
  });
  it('does not preview arbitrary HTML or office documents', () => {
    expect(previewKind('page.html', 'text/html')).toBeNull();
    expect(previewKind('notes.docx')).toBeNull();
  });
  it('decodes both TIFF pages and can return to the first page', () => {
    const buffer = tiffFixture();
    const first = decodeTiffPage(buffer, 0);
    expect(first).toMatchObject({ width: 1, height: 1, pageCount: 2 });
    expect([...first.pixels]).toEqual([255, 0, 0, 255]);
    expect([...decodeTiffPage(buffer, 1).pixels]).toEqual([0, 255, 0, 255]);
    expect([...decodeTiffPage(buffer, 0).pixels]).toEqual([255, 0, 0, 255]);
  });
  it('rejects an invalid TIFF header or an out-of-range page', () => {
    expect(() => decodeTiffPage(new ArrayBuffer(8), 0)).toThrow('Invalid or unsupported TIFF');
    expect(() => decodeTiffPage(tiffFixture(), 2)).toThrow('Invalid TIFF page');
  });
  it('rejects huge dimensions before pixel decompression', () => {
    const buffer = UTIF.encode([{ t256: [100_000], t257: [100_000] }] as unknown as IFD[]);
    expect(() => decodeTiffPage(buffer, 0)).toThrow('too large to preview');
  });
});
