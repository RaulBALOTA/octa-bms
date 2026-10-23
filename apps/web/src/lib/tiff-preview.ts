import UTIF from 'utif';

export function decodeTiffPage(buffer: ArrayBuffer, page: number) {
  const signature = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  if (!((signature[0] === 73 && signature[1] === 73 && signature[2] === 42 && signature[3] === 0)
    || (signature[0] === 77 && signature[1] === 77 && signature[2] === 0 && signature[3] === 42))) {
    throw new Error('Invalid or unsupported TIFF file');
  }
  const pages = UTIF.decode(buffer);
  if (!Number.isInteger(page) || page < 0 || page >= pages.length || pages.length > 1000) {
    throw new Error('Invalid TIFF page');
  }
  const image = pages[page];
  const width = (image.t256 as number[] | undefined)?.[0] ?? 0;
  const height = (image.t257 as number[] | undefined)?.[0] ?? 0;
  // Bound pixel allocations before decompression; large scans remain downloadable.
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || width > 32767 || height > 32767 || width * height > 32_000_000) {
    throw new Error('TIFF page is too large to preview');
  }
  UTIF.decodeImage(buffer, image);
  const pixels = UTIF.toRGBA8(image);
  if (pixels.length !== width * height * 4) throw new Error('Could not decode TIFF page');
  return { width, height, pixels, page, pageCount: pages.length };
}
