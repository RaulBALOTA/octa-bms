import { RecordActions } from '../components/RecordActions';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Eye, Pencil, Plus, Send } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, Paged } from '../lib/api';
import { StatusBadge } from '../components/ListPage';
import {
  Button,
  Dialog,
  Drawer,
  Field,
  SelectInput,
  Skeleton,
  TextArea,
  TextInput,
  useToast,
} from '../components/ui';
import { hasPermission, useAuthStore } from '../stores/auth';

interface ArticleSummary {
  id: string;
  type: string;
  title: string;
  language: string;
  status: string;
  publishedAt: string | null;
  viewCount: number;
  updatedAt: string;
}

interface Article extends ArticleSummary {
  content: string;
}

const TYPES = ['ARTICLE', 'STANDARD', 'PROCEDURE', 'TEMPLATE', 'LESSON_LEARNED', 'FAQ'];

function EditorDialog({
  open,
  onClose,
  article,
}: {
  open: boolean;
  onClose: () => void;
  article: Article | null;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: article?.title ?? '',
    type: article?.type ?? 'ARTICLE',
    content: article?.content ?? '',
  });

  const save = useMutation({
    mutationFn: () =>
      article
        ? api.patch(`/knowledge/articles/${article.id}`, form)
        : api.post('/knowledge/articles', form),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['articles'] });
      if (article) {
        void queryClient.invalidateQueries({ queryKey: ['article', article.id] });
      }
      toast(t('common.saved'));
      onClose();
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={article ? t('knowledge.editArticle') : t('knowledge.newArticle')}
      width="max-w-2xl"
    >
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('contracts.contractTitle')} required className="col-span-2">
            <TextInput
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
              autoFocus
            />
          </Field>
          <Field label={t('crm.type')}>
            <SelectInput
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            >
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`knowledge.type.${type}`)}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <Field label={t('knowledge.content')} required>
          <TextArea
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            rows={14}
            className="font-mono !text-xs"
            placeholder={t('knowledge.markdownHint')}
            required
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={save.isPending || !form.title.trim() || !form.content.trim()}
          >
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ReaderDrawer({
  id,
  onClose,
  onEdit,
}: {
  id: string;
  onClose: () => void;
  onEdit: (article: Article) => void;
}) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.me);

  const { data: article } = useQuery({
    queryKey: ['article', id],
    queryFn: () => api.get<Article>(`/knowledge/articles/${id}`),
  });

  const publish = useMutation({
    mutationFn: () => api.post(`/knowledge/articles/${id}/publish`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['articles'] });
      void queryClient.invalidateQueries({ queryKey: ['article', id] });
      toast(t('knowledge.published'));
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  return (
    <Drawer open onClose={onClose} width="w-[680px]">
      {!article ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <>
          <div className="border-b border-border p-5 pb-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold leading-snug">{article.title}</h2>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{t(`knowledge.type.${article.type}`)}</span>
                  <StatusBadge value={article.status} />
                  <span className="flex items-center gap-1">
                    <Eye size={11} />
                    {article.viewCount}
                  </span>
                  <span>
                    {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
                      new Date(article.updatedAt),
                    )}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                {hasPermission(me, 'knowledge.articles.update') && (
                  <Button size="sm" variant="secondary" onClick={() => onEdit(article)}>
                    <Pencil size={13} />
                  </Button>
                )}
                {article.status !== 'PUBLISHED' &&
                  hasPermission(me, 'knowledge.articles.approve') && (
                    <Button size="sm" disabled={publish.isPending} onClick={() => publish.mutate()}>
                      <Send size={13} />
                      {t('knowledge.publish')}
                    </Button>
                  )}
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            <article className="whitespace-pre-wrap text-sm leading-relaxed">
              {article.content}
            </article>
          </div>
        </>
      )}
    </Drawer>
  );
}

export function KnowledgePage() {
  const { t, i18n } = useTranslation();
  const me = useAuthStore((s) => s.me);
  const [q, setQ] = useState('');
  const [readerId, setReaderId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Article | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['articles', q],
    queryFn: () =>
      api.get<Paged<ArticleSummary>>(
        `/knowledge/articles?pageSize=50&q=${encodeURIComponent(q)}`,
      ),
  });

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-bold">{t('knowledge.title')}</h1>
        <div className="flex-1" />
        <TextInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('common.searchShort')}
          className="!w-56"
        />
        {hasPermission(me, 'knowledge.articles.create') && (
          <Button
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus size={14} />
            {t('common.new')}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : data?.data.length ? (
        <ul className="space-y-2">
          {data.data.map((article) => (
            <li key={article.id}>
              <button
                onClick={() => setReaderId(article.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
                  <BookOpen size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{article.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {t(`knowledge.type.${article.type}`)} ·{' '}
                    {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
                      new Date(article.updatedAt),
                    )}{' '}
                    · {article.viewCount} {t('knowledge.views')}
                  </span>
                </span>
                <StatusBadge value={article.status} />
              </button>
              <RecordActions resource="articles" id={article.id} label={article.title} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">
          {t('common.noResults')}
        </p>
      )}

      {readerId && (
        <ReaderDrawer
          id={readerId}
          onClose={() => setReaderId(null)}
          onEdit={(article) => {
            setEditing(article);
            setReaderId(null);
            setEditorOpen(true);
          }}
        />
      )}
      {editorOpen && (
        <EditorDialog
          open={editorOpen}
          onClose={() => setEditorOpen(false)}
          article={editing}
        />
      )}
    </div>
  );
}
