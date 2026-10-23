import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { previewKind } from '../lib/document-preview';
import { Button, Dialog, useToast } from './ui';

interface PreviewDocument {
  id: string;
  name: string;
  title: string | null;
  versions: { fileName: string; mimeType: string }[];
}

export function DocumentPreview({ document, onClose, onDelete }: {
  document: PreviewDocument;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const worker = useRef<Worker | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout>>();
  const version = document.versions[0];
  const kind = previewKind(version?.fileName ?? document.name, version?.mimeType);

  const startTimeout = () => {
    clearTimeout(timeout.current);
    timeout.current = setTimeout(() => {
      worker.current?.terminate();
      worker.current = null;
      setLoading(false);
      setError('documents.previewFailed');
    }, 20_000);
  };

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    let disposed = false;
    setLoading(true);
    setError(null);
    setUrl(null);
    setPage(0);
    setPageCount(0);

    const fail = () => {
      if (disposed) return;
      clearTimeout(timeout.current);
      setError('documents.previewFailed');
      setLoading(false);
    };
    const load = async () => {
      if (!kind) {
        setError('documents.previewUnsupported');
        setLoading(false);
        return;
      }
      const blob = await api.blob(`/documents/${document.id}/preview`, controller.signal);
      if (disposed) return;
      if (kind !== 'tiff') {
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        setLoading(false);
        return;
      }
      const buffer = await blob.arrayBuffer();
      if (disposed) return;
      const decoder = new Worker(new URL('../lib/tiff-preview.worker.ts', import.meta.url), { type: 'module' });
      worker.current = decoder;
      decoder.onmessage = ({ data }: MessageEvent<{
        error?: string; width: number; height: number; pixels: Uint8Array; page: number; pageCount: number;
      }>) => {
        if (disposed) return;
        clearTimeout(timeout.current);
        if (data.error) { fail(); return; }
        const surface = canvas.current;
        const context = surface?.getContext('2d');
        if (!surface || !context) { fail(); return; }
        surface.width = data.width;
        surface.height = data.height;
        context.putImageData(new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height), 0, 0);
        setPage(data.page);
        setPageCount(data.pageCount);
        setLoading(false);
      };
      decoder.onerror = fail;
      startTimeout();
      decoder.postMessage({ buffer, page: 0 }, [buffer]);
    };
    void load().catch(fail);
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timeout.current);
      worker.current?.terminate();
      worker.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [document.id, version?.fileName, version?.mimeType, kind]);

  const changePage = (next: number) => {
    if (!worker.current || loading || next < 0 || next >= pageCount) return;
    setLoading(true);
    startTimeout();
    worker.current.postMessage({ page: next });
  };

  return (
    <Dialog open onClose={onClose} title={document.title || document.name} width="max-w-6xl">
      <div className="space-y-3">
        {document.title && <p className="break-all text-xs text-muted-foreground">{document.name}</p>}
        <div className="flex items-center justify-between gap-3">
          {kind === 'tiff' && pageCount > 1 ? (
            <div className="flex items-center gap-2">
              <Button variant="secondary" disabled={loading || page === 0} onClick={() => changePage(page - 1)} aria-label={t('documents.previousPage')}>
                <ChevronLeft size={14} />
              </Button>
              <span className="text-sm">{t('documents.pageOf', { page: page + 1, total: pageCount })}</span>
              <Button variant="secondary" disabled={loading || page + 1 >= pageCount} onClick={() => changePage(page + 1)} aria-label={t('documents.nextPage')}>
                <ChevronRight size={14} />
              </Button>
            </div>
          ) : <span className="text-sm text-muted-foreground">{t('documents.preview')}</span>}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void api.download(`/documents/${document.id}/download`, document.name).catch((err: Error) => toast(err.message, 'error'))}>
              <Download size={14} />{t('documents.download')}
            </Button>
            {onDelete && <Button variant="destructive" onClick={onDelete}>
              <Trash2 size={14} />{t('documents.deleteFile')}
            </Button>}
          </div>
        </div>
        <div className="relative h-[65vh] overflow-auto rounded-lg border border-border bg-muted/40" aria-busy={loading}>
          {loading && <p role="status" className="p-6 text-center text-sm text-muted-foreground">{t('common.loading')}</p>}
          {error && <p role="alert" className="p-6 text-center text-sm text-destructive">{t(error)}</p>}
          {kind === 'tiff' && <canvas ref={canvas} hidden={loading || !!error} className="mx-auto max-w-full" aria-label={document.name} />}
          {url && !error && kind === 'pdf' && <iframe src={url} title={document.name} className="h-full w-full border-0" onError={() => setError('documents.previewFailed')} />}
          {url && !error && kind === 'image' && <img src={url} alt={document.name} className="mx-auto max-w-full" onError={() => setError('documents.previewFailed')} />}
        </div>
      </div>
    </Dialog>
  );
}
