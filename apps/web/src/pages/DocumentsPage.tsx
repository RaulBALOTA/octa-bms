import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  Eye,
  File,
  FileUp,
  Folder,
  FolderInput,
  FolderPlus,
  Home,
  Pencil,
  Trash2,
} from 'lucide-react';
import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { api, Paged } from '../lib/api';
import { Button, Dialog, Field, SelectInput, TextInput, useToast } from '../components/ui';
import { hasPermission, useAuthStore } from '../stores/auth';
import { DocumentPreview } from '../components/DocumentPreview';
import { previewKind } from '../lib/document-preview';

interface FolderNode {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  _count: { documents: number; children: number };
}

interface DocumentRow {
  id: string;
  name: string;
  title: string | null;
  currentVersion: number;
  updatedAt: string;
  folder?: { id: string; name: string } | null;
  versions: {
    version: number;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: string;
  }[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DocumentsPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useAuthStore((state) => state.me);
  const canMoveFolders = hasPermission(me, 'documents.folders.update');
  const canDeleteFolders = hasPermission(me, 'documents.folders.delete');
  const canEditFiles = hasPermission(me, 'documents.documents.update');
  const canMoveFiles = canEditFiles;
  const canDeleteFiles = hasPermission(me, 'documents.documents.delete');
  const canUpload = hasPermission(me, 'documents.documents.create');
  const canSelectFiles = canMoveFiles || canDeleteFiles;
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [movingFolder, setMovingFolder] = useState<FolderNode | null>(null);
  const [destinationId, setDestinationId] = useState('');
  const [deletingFolder, setDeletingFolder] = useState<FolderNode | null>(null);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [movingFiles, setMovingFiles] = useState<string[] | null>(null);
  const [fileDestinationId, setFileDestinationId] = useState('');
  const [deletingFiles, setDeletingFiles] = useState<DocumentRow[] | null>(null);
  const [previewDocument, setPreviewDocument] = useState<DocumentRow | null>(null);
  const [editingTitle, setEditingTitle] = useState<DocumentRow | null>(null);
  const [fileTitle, setFileTitle] = useState('');
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });
  const [uploadIssues, setUploadIssues] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: folders } = useQuery({
    queryKey: ['folders'],
    queryFn: () => api.get<FolderNode[]>('/documents/folders'),
  });

  const { data: documents, isLoading: documentsLoading, error: documentsError } = useQuery({
    queryKey: ['documents', activeFolder, page],
    queryFn: () =>
      api.get<Paged<DocumentRow>>(
        `/documents?pageSize=100&page=${page}${activeFolder ? `&folderId=${activeFolder}` : ''}`,
      ),
  });

  useEffect(() => {
    setSelectedIds(new Set());
    setPage(1);
  }, [activeFolder]);

  const selectedFiles = documents?.data.filter((doc) => selectedIds.has(doc.id)) ?? [];
  const allSelected = !!documents?.data.length && selectedFiles.length === documents.data.length;
  const toggleSelected = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['documents'] });
    void queryClient.invalidateQueries({ queryKey: ['folders'] });
  };

  const upload = useMutation({
    mutationFn: async ({ files, folderId }: { files: globalThis.File[]; folderId: string | null }) => {
      setUploadProgress({ done: 0, total: files.length });
      setUploadIssues([]);
      let uploaded = 0;
      const issues: string[] = [];
      for (const [index, file] of files.entries()) {
        try {
          if (file.size > 50 * 1024 * 1024) throw new Error(t('documents.fileTooLarge'));
          const formData = new FormData();
          formData.append('file', file);
          if (folderId) formData.append('folderId', folderId);
          await api.upload('/documents/upload', formData);
          uploaded++;
        } catch (err) {
          issues.push(`${file.name}: ${err instanceof Error ? err.message : t('documents.uploadFailed')}`);
        }
        setUploadProgress({ done: index + 1, total: files.length });
      }
      return { uploaded, issues };
    },
    onSuccess: ({ uploaded, issues }) => {
      refresh();
      setUploadIssues(issues);
      if (uploaded) toast(t('documents.filesUploaded', { count: uploaded }));
      if (issues.length) toast(t('documents.uploadFailures', { count: issues.length }), 'error');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const moveFiles = useMutation({
    mutationFn: ({ ids, folderId }: { ids: string[]; folderId: string | null }) =>
      api.post<{ moved: number }>('/documents/bulk-move', { ids, folderId }),
    onSuccess: ({ moved }) => {
      refresh();
      setSelectedIds(new Set());
      setMovingFiles(null);
      toast(t('documents.filesMoved', { count: moved }));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const deleteFiles = useMutation({
    mutationFn: (ids: string[]) => api.post<{ deleted: number }>('/documents/bulk-delete', { ids }),
    onSuccess: ({ deleted }) => {
      refresh();
      setSelectedIds(new Set());
      setDeletingFiles(null);
      // Return to the previous page when deleting the final files on a later page.
      if (deleted === documents?.data.length && page > 1) setPage(page - 1);
      toast(t('documents.filesDeleted', { count: deleted }));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const saveTitle = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string | null }) =>
      api.patch<{ id: string; title: string | null }>(`/documents/${id}/title`, { title }),
    onSuccess: (result) => {
      refresh();
      setPreviewDocument((current) => current?.id === result.id ? { ...current, title: result.title } : current);
      setEditingTitle(null);
      toast(t('documents.titleSaved'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const createFolder = useMutation({
    mutationFn: () =>
      api.post('/documents/folders', {
        name: newFolderName,
        parentId: activeFolder ?? undefined,
      }),
    onSuccess: () => {
      refresh();
      setNewFolderOpen(false);
      setNewFolderName('');
      toast(t('common.created'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const moveFolder = useMutation({
    mutationFn: ({ id, parentId }: { id: string; parentId: string | null }) =>
      api.patch(`/documents/folders/${id}`, { parentId }),
    onSuccess: () => {
      refresh();
      setMovingFolder(null);
      toast(t('documents.folderMoved'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const deleteFolder = useMutation({
    mutationFn: (id: string) =>
      api.delete<{ deleted: boolean; parentId: string | null; deletedFolderIds: string[] }>(`/documents/folders/${id}`),
    onSuccess: (result) => {
      setActiveFolder((current) =>
        current && result.deletedFolderIds.includes(current) ? result.parentId : current,
      );
      refresh();
      setDeletingFolder(null);
      toast(t('documents.folderDeleted'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const excludedDestinations = new Set<string>();
  if (movingFolder) {
    excludedDestinations.add(movingFolder.id);
    const queue = [movingFolder.id];
    for (let i = 0; i < queue.length; i++) {
      for (const folder of folders ?? []) {
        if (folder.parentId === queue[i] && !excludedDestinations.has(folder.id)) {
          excludedDestinations.add(folder.id);
          queue.push(folder.id);
        }
      }
    }
  }

  const onFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) upload.mutate({ files, folderId: activeFolder });
    e.target.value = '';
  };

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));

  return (
    <div className="flex h-full gap-4">
      {/* folder rail */}
      <aside className="w-64 shrink-0">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('documents.folders')}
          </h2>
          <button
            onClick={() => setNewFolderOpen(true)}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            title={t('documents.newFolder')}
          >
            <FolderPlus size={14} />
          </button>
        </div>
        <nav className="space-y-0.5">
          <button
            onClick={() => setActiveFolder(null)}
            className={clsx(
              'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm',
              activeFolder === null
                ? 'bg-accent font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            <Home size={14} />
            {t('documents.allDocuments')}
          </button>
          {folders?.map((folder) => (
            <div
              key={folder.id}
              className={clsx(
                'flex w-full items-center rounded-md pr-1 text-sm',
                activeFolder === folder.id
                  ? 'bg-accent font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <button
                onClick={() => setActiveFolder(folder.id)}
                className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left"
                style={{ paddingLeft: `${10 + (folder.path.split('/').length - 2) * 14}px` }}
                title={folder.path}
              >
                <Folder size={14} className="shrink-0" />
                <span className="truncate">{folder.name}</span>
                <span className="ml-auto text-[10px]">{folder._count.documents}</span>
              </button>
              {canMoveFolders && (
                <button
                  onClick={() => {
                    setMovingFolder(folder);
                    setDestinationId(folder.parentId ?? '');
                  }}
                  className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-primary"
                  title={t('documents.moveFolder')}
                  aria-label={t('documents.moveFolderNamed', { name: folder.name })}
                >
                  <FolderInput size={14} />
                </button>
              )}
              {canDeleteFolders && (
                <button
                  onClick={() => setDeletingFolder(folder)}
                  className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                  title={t('documents.deleteFolder')}
                  aria-label={t('documents.deleteFolderNamed', { name: folder.name })}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </nav>
      </aside>

      {/* documents */}
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex items-center gap-3">
          <h1 className="text-lg font-bold">{t('nav.documents')}</h1>
          <div className="flex-1" />
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={onFilePicked}
          />
          {canUpload && <Button onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
            <FileUp size={14} />
            {upload.isPending ? t('documents.uploadProgress', uploadProgress) : t('documents.upload')}
          </Button>}
        </div>

        {uploadIssues.length > 0 && (
          <ul role="alert" className="mb-3 max-h-32 overflow-auto rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
            {uploadIssues.map((issue, index) => <li key={index}>{issue}</li>)}
          </ul>
        )}

        {canSelectFiles && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-accent/40 p-2">
            <span className="mr-auto text-sm">{selectedFiles.length
              ? t('documents.filesSelected', { count: selectedFiles.length })
              : t('documents.selectFilesHint')}</span>
            {canMoveFiles && <Button variant="secondary" disabled={!selectedFiles.length} onClick={() => {
              setMovingFiles(selectedFiles.map((doc) => doc.id));
              setFileDestinationId(activeFolder ?? '');
            }}><FolderInput size={14} />{t('documents.moveSelected')}</Button>}
            {canDeleteFiles && <Button variant="destructive" disabled={!selectedFiles.length} onClick={() => setDeletingFiles(selectedFiles)}>
              <Trash2 size={14} />{t('documents.deleteSelected')}
            </Button>}
            {selectedFiles.length > 0 && <Button variant="ghost" onClick={() => setSelectedIds(new Set())}>{t('documents.clearSelection')}</Button>}
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                {canSelectFiles && <th className="w-10 px-3 py-2.5">
                  <input type="checkbox" aria-label={t('documents.selectAll')} checked={allSelected}
                    ref={(element) => { if (element) element.indeterminate = selectedFiles.length > 0 && !allSelected; }}
                    disabled={!documents?.data.length}
                    onChange={() => setSelectedIds(allSelected ? new Set() : new Set(documents?.data.map((doc) => doc.id)))} />
                </th>}
                <th className="px-4 py-2.5 font-medium">{t('documents.fileName')}</th>
                <th className="px-4 py-2.5 font-medium">{t('documents.title')}</th>
                <th className="px-4 py-2.5 font-medium">{t('documents.folder')}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t('documents.version')}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t('documents.size')}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t('documents.modified')}</th>
                <th className="sticky right-0 z-10 bg-card px-4 py-2.5 text-right font-medium">{t('documents.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {documents?.data.length ? (
                documents.data.map((doc) => (
                  <tr
                    key={doc.id}
                    className={clsx('border-b border-border last:border-0 hover:bg-muted/50', selectedIds.has(doc.id) && 'bg-accent/40')}
                  >
                    {canSelectFiles && <td className="px-3 py-2">
                      <input type="checkbox" checked={selectedIds.has(doc.id)} onChange={() => toggleSelected(doc.id)}
                        aria-label={t('documents.selectFile', { name: doc.name })} />
                    </td>}
                    <td className="px-4 py-2">
                      <span className="flex items-center gap-2 font-medium">
                        <File size={14} className="shrink-0 text-muted-foreground" />
                        {previewKind(doc.versions[0]?.fileName ?? doc.name, doc.versions[0]?.mimeType)
                          ? <button className="text-left hover:text-primary hover:underline" onClick={() => setPreviewDocument(doc)}>{doc.name}</button>
                          : doc.name}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {canEditFiles ? (
                        <button
                          className="flex items-center gap-1.5 text-left text-sm hover:text-primary"
                          aria-label={t('documents.editTitleFile', { name: doc.name })}
                          onClick={() => { setEditingTitle(doc); setFileTitle(doc.title ?? ''); }}
                        >
                          <span className={clsx(!doc.title && 'text-muted-foreground')}>{doc.title || t('documents.addTitle')}</span>
                          <Pencil size={12} className="shrink-0 text-muted-foreground" />
                        </button>
                      ) : <span className="text-muted-foreground">{doc.title || '—'}</span>}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {doc.folder?.name ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-right">v{doc.currentVersion}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">
                      {doc.versions[0] ? formatBytes(doc.versions[0].sizeBytes) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-muted-foreground">
                      {fmtDate(doc.updatedAt)}
                    </td>
                    <td className={clsx('sticky right-0 whitespace-nowrap px-4 py-2 text-right', selectedIds.has(doc.id) ? 'bg-accent' : 'bg-card')}>
                      {previewKind(doc.versions[0]?.fileName ?? doc.name, doc.versions[0]?.mimeType) && <button
                        onClick={() => setPreviewDocument(doc)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-primary"
                        title={t('documents.preview')} aria-label={t('documents.previewFile', { name: doc.name })}>
                        <Eye size={14} />
                      </button>}
                      <button
                        onClick={() =>
                          void api
                            .download(`/documents/${doc.id}/download`, doc.name)
                            .catch((err: Error) => toast(err.message, 'error'))
                        }
                        className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-primary"
                        title={t('documents.download')}
                      >
                        <Download size={14} />
                      </button>
                      {canDeleteFiles && <button
                        onClick={() => setDeletingFiles([doc])}
                        className="rounded p-1.5 text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                        title={t('documents.deleteFile')}
                        aria-label={t('documents.deleteFileNamed', { name: doc.name })}
                      >
                        <Trash2 size={14} />
                      </button>}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={canSelectFiles ? 8 : 7} className="px-4 py-10 text-center text-muted-foreground">
                    {documentsLoading ? t('common.loading') : documentsError ? documentsError.message : t('documents.empty')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {!!documents?.meta.totalPages && documents.meta.totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>{t('documents.pageOf', { page, total: documents.meta.totalPages })}</span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={page <= 1} onClick={() => { setSelectedIds(new Set()); setPage(page - 1); }}>{t('documents.previousPage')}</Button>
              <Button variant="secondary" disabled={page >= documents.meta.totalPages} onClick={() => { setSelectedIds(new Set()); setPage(page + 1); }}>{t('documents.nextPage')}</Button>
            </div>
          </div>
        )}
      </div>

      {previewDocument && <DocumentPreview
        key={previewDocument.id}
        document={previewDocument}
        onClose={() => setPreviewDocument(null)}
        onDelete={canDeleteFiles ? () => {
          setDeletingFiles([previewDocument]);
          setPreviewDocument(null);
        } : undefined}
      />}

      <Dialog open={editingTitle !== null} onClose={() => { if (!saveTitle.isPending) setEditingTitle(null); }} title={t('documents.editTitle')}>
        <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          if (editingTitle && !saveTitle.isPending) saveTitle.mutate({ id: editingTitle.id, title: fileTitle.trim() || null });
        }}>
          <p className="break-all text-sm text-muted-foreground">{editingTitle?.name}</p>
          <Field label={t('documents.titleOptional')}>
            <TextInput value={fileTitle} onChange={(event) => setFileTitle(event.target.value)} maxLength={250} disabled={saveTitle.isPending} autoFocus />
          </Field>
          <p className="text-xs text-muted-foreground">{t('documents.titleHint')}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={saveTitle.isPending} onClick={() => setEditingTitle(null)}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={saveTitle.isPending}>{saveTitle.isPending ? t('common.loading') : t('common.save')}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={movingFiles !== null} onClose={() => { if (!moveFiles.isPending) setMovingFiles(null); }} title={t('documents.moveSelected')}>
        <form className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          if (movingFiles && !moveFiles.isPending) moveFiles.mutate({ ids: movingFiles, folderId: fileDestinationId || null });
        }}>
          <p className="text-sm">{t('documents.filesSelected', { count: movingFiles?.length ?? 0 })}</p>
          <Field label={t('documents.destinationFolder')}>
            <SelectInput value={fileDestinationId} onChange={(event) => setFileDestinationId(event.target.value)} disabled={moveFiles.isPending} autoFocus>
              <option value="">{t('documents.rootFolder')}</option>
              {folders?.map((folder) => <option key={folder.id} value={folder.id}>{folder.path}</option>)}
            </SelectInput>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" disabled={moveFiles.isPending} onClick={() => setMovingFiles(null)}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={moveFiles.isPending}>{moveFiles.isPending ? t('common.loading') : t('documents.moveSelected')}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={deletingFiles !== null} onClose={() => { if (!deleteFiles.isPending) setDeletingFiles(null); }}
        title={t(deletingFiles?.length === 1 ? 'documents.deleteFile' : 'documents.deleteSelected')}>
        <div className="space-y-3">
          <p className="break-all text-sm">{deletingFiles?.length === 1
            ? t('documents.deleteFileConfirm', { name: deletingFiles[0].name })
            : t('documents.deleteFilesConfirm', { count: deletingFiles?.length ?? 0 })}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={deleteFiles.isPending} onClick={() => setDeletingFiles(null)}>{t('common.cancel')}</Button>
            <Button variant="destructive" disabled={deleteFiles.isPending} onClick={() => { if (deletingFiles) deleteFiles.mutate(deletingFiles.map((doc) => doc.id)); }}>
              {deleteFiles.isPending ? t('common.loading') : t(deletingFiles?.length === 1 ? 'documents.deleteFile' : 'documents.deleteSelected')}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={movingFolder !== null}
        onClose={() => { if (!moveFolder.isPending) setMovingFolder(null); }}
        title={t('documents.moveFolder')}
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (movingFolder && !moveFolder.isPending) {
              moveFolder.mutate({ id: movingFolder.id, parentId: destinationId || null });
            }
          }}
        >
          <p className="break-all text-sm font-medium">{movingFolder?.path}</p>
          <Field label={t('documents.destinationFolder')}>
            <SelectInput
              value={destinationId}
              onChange={(event) => setDestinationId(event.target.value)}
              disabled={moveFolder.isPending}
              autoFocus
            >
              <option value="">{t('documents.rootFolder')}</option>
              {folders?.filter((folder) => !excludedDestinations.has(folder.id)).map((folder) => (
                <option key={folder.id} value={folder.id}>{folder.path}</option>
              ))}
            </SelectInput>
          </Field>
          <p className="text-xs text-muted-foreground">{t('documents.moveFolderHint')}</p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={moveFolder.isPending}
              onClick={() => setMovingFolder(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={moveFolder.isPending || destinationId === (movingFolder?.parentId ?? '')}
            >
              {moveFolder.isPending ? t('common.loading') : t('documents.moveFolder')}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={deletingFolder !== null}
        onClose={() => { if (!deleteFolder.isPending) setDeletingFolder(null); }}
        title={t('documents.deleteFolder')}
      >
        <div className="space-y-3">
          <p className="break-all text-sm">{t('documents.deleteFolderConfirm', { name: deletingFolder?.name })}</p>
          <p className="text-sm text-muted-foreground">{t('documents.deleteFolderHint')}</p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={deleteFolder.isPending}
              onClick={() => setDeletingFolder(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={deleteFolder.isPending}
              onClick={() => { if (deletingFolder) deleteFolder.mutate(deletingFolder.id); }}
            >
              {deleteFolder.isPending ? t('common.loading') : t('documents.deleteFolder')}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        title={t('documents.newFolder')}
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (newFolderName.trim()) createFolder.mutate();
          }}
        >
          <Field label={t('crm.name')} required>
            <TextInput
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setNewFolderOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={createFolder.isPending || !newFolderName.trim()}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
