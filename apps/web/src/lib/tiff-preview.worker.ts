import { decodeTiffPage } from './tiff-preview';

const workerScope = self as unknown as {
  onmessage: (event: MessageEvent<{ buffer?: ArrayBuffer; page: number }>) => void;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};
let buffer: ArrayBuffer | undefined;

workerScope.onmessage = ({ data }) => {
  try {
    if (data.buffer) buffer = data.buffer;
    if (!buffer) throw new Error('TIFF file has not been loaded');
    const result = decodeTiffPage(buffer, data.page);
    workerScope.postMessage(result, [result.pixels.buffer]);
  } catch (error) {
    workerScope.postMessage({ error: error instanceof Error ? error.message : 'Could not decode TIFF' });
  }
};
