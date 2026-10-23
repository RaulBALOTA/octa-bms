import UTIF, { type IFD } from 'utif';

/** Tiny uncompressed TIFF with a red first page and a green second page. */
export function tiffFixture(pageCount = 2) {
  const directories = Array.from({ length: pageCount }, (_, index) => ({
    t256: [1], t257: [1], t258: [8, 8, 8, 8], t259: [1], t262: [2],
    t273: [1000 + index * 4], t277: [4], t278: [1], t279: [4], t284: [1], t338: [1],
  }));
  const data = new Uint8Array(1000 + pageCount * 4);
  data.set(new Uint8Array(UTIF.encode(directories as unknown as IFD[])));
  for (let index = 0; index < pageCount; index++) {
    data.set(index === 0 ? [255, 0, 0, 255] : [0, 255, 0, 255], 1000 + index * 4);
  }
  return data.buffer;
}
