import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Send, Sparkles, X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { api } from '../lib/api';
import { Button, TextArea } from './ui';

export function useAiStatus() {
  return useQuery({
    queryKey: ['ai-status'],
    queryFn: () => api.get<{ enabled: boolean; model: string }>('/ai/status'),
    staleTime: 300_000,
  });
}

/* --------------------------------------------------- per-record summary */

export function AiSummary({
  entityType,
  entityId,
}: {
  entityType: 'partner' | 'contract' | 'opportunity' | 'invoice' | 'meeting';
  entityId: string;
}) {
  const { t, i18n } = useTranslation();
  const { data: status } = useAiStatus();
  const [summary, setSummary] = useState<string | null>(null);

  const summarize = useMutation({
    mutationFn: () =>
      api.post<{ summary: string }>('/ai/summarize', {
        entityType,
        entityId,
        language: i18n.language.startsWith('de') ? 'de' : 'en',
      }),
    onSuccess: (result) => setSummary(result.summary),
  });

  if (!status?.enabled) return null;

  return (
    <div className="mt-1">
      {summary === null ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={summarize.isPending}
          onClick={() => summarize.mutate()}
        >
          {summarize.isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Sparkles size={13} className="text-primary" />
          )}
          {t('ai.summarize')}
        </Button>
      ) : (
        <div className="relative rounded-lg border border-primary/30 bg-accent/40 p-3 pr-8">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
            <Sparkles size={11} />
            {t('ai.summary')}
          </div>
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{summary}</div>
          <button
            onClick={() => setSummary(null)}
            className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground hover:bg-muted"
            aria-label={t('common.cancel')}
          >
            <X size={13} />
          </button>
        </div>
      )}
      {summarize.isError && (
        <p className="mt-1 text-xs text-destructive">
          {(summarize.error as Error).message}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------- global "Ask BMS" panel */

interface Exchange {
  question: string;
  answer: string;
}

export function AiPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { data: status } = useAiStatus();
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<Exchange[]>([]);

  const ask = useMutation({
    mutationFn: (q: string) =>
      api.post<{ answer: string }>('/ai/ask', {
        question: q,
        language: i18n.language.startsWith('de') ? 'de' : 'en',
      }),
    onSuccess: (result, q) => {
      setHistory((h) => [...h, { question: q, answer: result.answer }]);
      setQuestion('');
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <div
        className="absolute bottom-0 right-0 top-0 flex w-[460px] max-w-[92vw] flex-col border-l border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Sparkles size={16} className="text-primary" />
          <span className="flex-1 text-sm font-semibold">{t('ai.title')}</span>
          {status?.enabled && (
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              {status.model}
            </span>
          )}
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            aria-label={t('common.cancel')}
          >
            <X size={15} />
          </button>
        </div>

        {!status?.enabled ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <Sparkles size={28} className="text-muted-foreground" />
            <p className="text-sm font-medium">{t('ai.notConfigured')}</p>
            <p className="text-xs text-muted-foreground">{t('ai.notConfiguredHint')}</p>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {history.length === 0 && !ask.isPending && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{t('ai.examplesTitle')}</p>
                  {[t('ai.example1'), t('ai.example2'), t('ai.example3')].map(
                    (example) => (
                      <button
                        key={example}
                        onClick={() => ask.mutate(example)}
                        className="block w-full rounded-lg border border-border px-3 py-2 text-left text-sm hover:border-primary/40"
                      >
                        {example}
                      </button>
                    ),
                  )}
                </div>
              )}
              {history.map((exchange, index) => (
                <div key={index} className="space-y-2">
                  <div className="ml-8 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                    {exchange.question}
                  </div>
                  <div className="mr-4 whitespace-pre-wrap rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm leading-relaxed">
                    {exchange.answer}
                  </div>
                </div>
              ))}
              {ask.isPending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" />
                  {t('ai.thinking')}
                </div>
              )}
              {ask.isError && (
                <p className="text-xs text-destructive">
                  {(ask.error as Error).message}
                </p>
              )}
            </div>

            <form
              className="flex gap-2 border-t border-border p-3"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (question.trim()) ask.mutate(question.trim());
              }}
            >
              <TextArea
                rows={2}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (question.trim()) ask.mutate(question.trim());
                  }
                }}
                placeholder={t('ai.placeholder')}
                className="flex-1"
              />
              <Button
                type="submit"
                disabled={ask.isPending || !question.trim()}
                className={clsx('self-end')}
              >
                <Send size={14} />
              </Button>
            </form>
            <p className="px-3 pb-2 text-[10px] text-muted-foreground">
              {t('ai.disclaimer')}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
