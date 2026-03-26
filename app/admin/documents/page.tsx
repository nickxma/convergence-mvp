'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Document {
  id: string;
  sourceId: string;
  title: string | null;
  url: string | null;
  author: string | null;
  publishedAt: string | null;
  chunkCount: number;
  status: 'pending' | 'processing' | 'done' | 'error';
  errorMessage: string | null;
  indexedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  authorityScore: number;
  citationCount: number;
  positiveRatioWhenCited: number | null;
  qualityUpdatedAt: string | null;
}

type ModalMode = 'url' | 'file';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function StatusBadge({ status, errorMessage }: { status: Document['status']; errorMessage: string | null }) {
  const styles: Record<Document['status'], { bg: string; color: string; label: string }> = {
    done: { bg: '#e8f0e5', color: '#3d6b30', label: 'Indexed' },
    processing: { bg: '#fef6e0', color: '#a07020', label: 'Processing' },
    pending: { bg: '#f0f0f5', color: '#6060a0', label: 'Pending' },
    error: { bg: '#fdf0f0', color: '#b44444', label: 'Error' },
  };
  const s = styles[status] ?? styles.pending;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: s.bg, color: s.color }}
      title={status === 'error' && errorMessage ? errorMessage : undefined}
    >
      {status === 'processing' && (
        <span className="w-2 h-2 rounded-full animate-pulse inline-block" style={{ background: s.color }} />
      )}
      {s.label}
    </span>
  );
}

// ── Add Document Modal ────────────────────────────────────────────────────────

interface AddDocModalProps {
  wallet: string;
  onClose: () => void;
  onAdded: () => void;
}

function AddDocModal({ wallet, onClose, onAdded }: AddDocModalProps) {
  const [mode, setMode] = useState<ModalMode>('url');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      let res: Response;
      if (mode === 'url') {
        if (!url.trim()) { setError('URL is required.'); setLoading(false); return; }
        res = await fetch('/api/admin/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${wallet}` },
          body: JSON.stringify({ url: url.trim(), title: title.trim() || undefined, author: author.trim() || undefined }),
        });
      } else {
        if (!file) { setError('Select a file to upload.'); setLoading(false); return; }
        const fd = new FormData();
        fd.append('file', file);
        if (title.trim()) fd.append('title', title.trim());
        if (author.trim()) fd.append('author', author.trim());
        res = await fetch('/api/admin/ingest', {
          method: 'POST',
          headers: { Authorization: `Bearer ${wallet}` },
          body: fd,
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Ingest failed (${res.status})`);
      } else {
        onAdded();
        onClose();
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [mode, url, title, author, file, wallet, onAdded, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative w-full max-w-md mx-4 rounded-2xl shadow-xl p-6"
        style={{ background: '#faf8f3', border: '1px solid #e0d8cc' }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-sm"
          style={{ color: '#9c9080' }}
          aria-label="Close"
        >
          ✕
        </button>
        <h2 className="text-base font-semibold mb-4" style={{ color: '#3d4f38' }}>
          Add Document
        </h2>

        {/* Mode toggle */}
        <div className="flex rounded-full mb-5 overflow-hidden" style={{ border: '1px solid #e0d8cc' }}>
          {(['url', 'file'] as ModalMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="flex-1 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: mode === m ? '#7d8c6e' : 'transparent',
                color: mode === m ? '#fff' : '#7d8c6e',
              }}
            >
              {m === 'url' ? 'URL' : 'File Upload'}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {mode === 'url' ? (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#5c5248' }}>
                URL *
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article"
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: '#fff', border: '1px solid #e0d8cc', color: '#3d4f38' }}
              />
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: '#5c5248' }}>
                File * (PDF, TXT, MD)
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.txt,.md,.markdown"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm"
                style={{ color: '#5c5248' }}
              />
              {file && (
                <p className="text-xs mt-1" style={{ color: '#9c9080' }}>
                  {file.name} ({(file.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: '#5c5248' }}>
              Title (optional)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Override detected title"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: '#fff', border: '1px solid #e0d8cc', color: '#3d4f38' }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: '#5c5248' }}>
              Author (optional)
            </label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="Author name"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ background: '#fff', border: '1px solid #e0d8cc', color: '#3d4f38' }}
            />
          </div>
        </div>

        {error && (
          <p className="mt-3 text-xs px-3 py-2 rounded-lg" style={{ background: '#fdf0f0', color: '#b44' }}>
            {error}
          </p>
        )}

        <div className="flex gap-2 mt-5 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-full text-sm border"
            style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={loading}
            className="px-4 py-1.5 rounded-full text-sm font-medium transition-colors disabled:opacity-50"
            style={{ background: '#7d8c6e', color: '#fff' }}
          >
            {loading ? 'Ingesting…' : 'Ingest'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inline Tag Editor ─────────────────────────────────────────────────────────

interface TagEditorProps {
  docId: string;
  tags: string[];
  wallet: string;
  onUpdated: (id: string, tags: string[]) => void;
}

function TagEditor({ docId, tags, wallet, onUpdated }: TagEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = useCallback(
    async (newTags: string[]) => {
      setSaving(true);
      try {
        const res = await fetch(`/api/admin/documents/${docId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${wallet}` },
          body: JSON.stringify({ tags: newTags }),
        });
        if (res.ok) {
          const data = await res.json();
          onUpdated(docId, data.tags);
        }
      } finally {
        setSaving(false);
        setEditing(false);
        setDraft('');
      }
    },
    [docId, wallet, onUpdated],
  );

  const removeTag = useCallback(
    (tag: string) => {
      save(tags.filter((t) => t !== tag));
    },
    [tags, save],
  );

  const addTag = useCallback(() => {
    const trimmed = draft.trim();
    if (!trimmed || tags.includes(trimmed)) {
      setDraft('');
      setEditing(false);
      return;
    }
    save([...tags, trimmed]);
  }, [draft, tags, save]);

  return (
    <div className="flex flex-wrap gap-1 items-center min-h-[24px]">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
          style={{ background: '#e8f0e5', color: '#3d6b30' }}
        >
          {tag}
          <button
            onClick={() => removeTag(tag)}
            disabled={saving}
            className="opacity-60 hover:opacity-100 leading-none"
            aria-label={`Remove tag ${tag}`}
          >
            ×
          </button>
        </span>
      ))}
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addTag();
            if (e.key === 'Escape') { setEditing(false); setDraft(''); }
          }}
          onBlur={addTag}
          placeholder="tag…"
          className="px-1.5 py-0.5 rounded text-xs outline-none"
          style={{ width: '72px', background: '#fff', border: '1px solid #c8c0b0' }}
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          disabled={saving}
          className="text-xs opacity-40 hover:opacity-80 transition-opacity"
          style={{ color: '#7d8c6e' }}
          aria-label="Add tag"
        >
          + tag
        </button>
      )}
    </div>
  );
}

// ── Authority Score Editor ────────────────────────────────────────────────────

interface AuthorityScoreEditorProps {
  docId: string;
  score: number;
  wallet: string;
  onUpdated: (id: string, score: number) => void;
}

function AuthorityScoreEditor({ docId, score, wallet, onUpdated }: AuthorityScoreEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) { setDraft(score.toFixed(2)); inputRef.current?.focus(); }
  }, [editing, score]);

  const save = useCallback(async () => {
    const val = parseFloat(draft);
    if (!Number.isFinite(val) || val < 0 || val > 1) { setEditing(false); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/documents/${docId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${wallet}` },
        body: JSON.stringify({ authorityScore: val }),
      });
      if (res.ok) {
        const data = await res.json();
        onUpdated(docId, data.authorityScore);
      }
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }, [docId, draft, wallet, onUpdated]);

  const scoreColor = score >= 0.7 ? '#3d6b30' : score >= 0.4 ? '#a07020' : '#9c9080';

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min="0"
        max="1"
        step="0.05"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
          if (e.key === 'Escape') setEditing(false);
        }}
        onBlur={() => void save()}
        disabled={saving}
        className="px-1.5 py-0.5 rounded text-xs outline-none w-16 text-right"
        style={{ background: '#fff', border: '1px solid #c8c0b0' }}
      />
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="text-xs font-mono tabular-nums hover:opacity-70 transition-opacity"
      style={{ color: scoreColor }}
      title="Click to edit authority score (0–1)"
    >
      {score.toFixed(2)}
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminDocumentsPage() {
  const { ready, authenticated, user } = usePrivy();
  const router = useRouter();
  const wallet = user?.wallet?.address ?? null;

  const [docs, setDocs] = useState<Document[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [reindexing, setReindexing] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<string>('');

  const fetchDocs = useCallback(
    async (w: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: '100' });
        if (statusFilter) params.set('status', statusFilter);
        const res = await fetch(`/api/admin/documents?${params}`, {
          headers: { Authorization: `Bearer ${w}` },
          cache: 'no-store',
        });
        if (res.status === 401) { setError('Admin access required.'); return; }
        if (!res.ok) { setError(`Failed to load documents (${res.status}).`); return; }
        const data = await res.json();
        setDocs(data.documents ?? []);
        setTotal(data.total ?? 0);
      } catch {
        setError('Network error. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [statusFilter],
  );

  // Redirect unauthenticated
  useEffect(() => {
    if (ready && !authenticated) router.replace('/');
  }, [ready, authenticated, router]);

  // Initial load
  useEffect(() => {
    if (wallet) fetchDocs(wallet);
  }, [wallet, fetchDocs]);

  // Auto-poll when any doc is processing
  useEffect(() => {
    if (!wallet) return;
    const hasProcessing = docs.some((d) => d.status === 'processing' || d.status === 'pending');
    if (!hasProcessing) return;
    const id = setInterval(() => fetchDocs(wallet), 3000);
    return () => clearInterval(id);
  }, [wallet, docs, fetchDocs]);

  const deleteDoc = useCallback(
    async (id: string, w: string) => {
      setDeleting((prev) => new Set([...prev, id]));
      try {
        await fetch(`/api/admin/documents/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${w}` },
        });
        setDocs((prev) => prev.filter((d) => d.id !== id));
        setTotal((prev) => prev - 1);
      } finally {
        setDeleting((prev) => { const n = new Set(prev); n.delete(id); return n; });
        setConfirmDeleteId(null);
      }
    },
    [],
  );

  const reindex = useCallback(
    async (id: string, w: string) => {
      setReindexing((prev) => new Set([...prev, id]));
      try {
        const res = await fetch(`/api/admin/documents/${id}/reindex`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${w}` },
        });
        if (res.ok) {
          // Optimistically set status to processing
          setDocs((prev) =>
            prev.map((d) => (d.id === id ? { ...d, status: 'processing' as const } : d)),
          );
        }
      } finally {
        setReindexing((prev) => { const n = new Set(prev); n.delete(id); return n; });
      }
    },
    [],
  );

  const handleTagsUpdated = useCallback((id: string, tags: string[]) => {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, tags } : d)));
  }, []);

  const handleAuthorityUpdated = useCallback((id: string, authorityScore: number) => {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, authorityScore } : d)));
  }, []);

  // ── Render states ─────────────────────────────────────────────────────────

  if (!ready || !authenticated) {
    return (
      <div className="flex flex-1 items-center justify-center" style={{ background: '#faf8f3' }}>
        <p className="text-sm" style={{ color: '#9c9080' }}>Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full" style={{ background: '#faf8f3' }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <a href="/admin" className="flex items-center gap-1.5 text-xs" style={{ color: '#7d8c6e' }}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
            Admin
          </a>
          <span className="text-sm font-semibold tracking-tight" style={{ color: '#3d4f38' }}>
            Document Sources
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: '#f0ede5', color: '#9c9080' }}>
            {total} total
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-xs px-2 py-1.5 rounded-lg outline-none"
            style={{ border: '1px solid #e0d8cc', background: '#f5f1e8', color: '#7d8c6e' }}
          >
            <option value="">All statuses</option>
            <option value="done">Indexed</option>
            <option value="processing">Processing</option>
            <option value="error">Error</option>
            <option value="pending">Pending</option>
          </select>
          <button
            onClick={() => wallet && fetchDocs(wallet)}
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded-full border transition-colors disabled:opacity-50"
            style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="text-xs px-3 py-1.5 rounded-full font-medium"
            style={{ background: '#7d8c6e', color: '#fff' }}
          >
            + Add Document
          </button>
        </div>
      </header>

      <main className="flex-1 px-5 py-6 max-w-6xl mx-auto w-full">
        {error ? (
          <div className="rounded-xl p-6 text-center" style={{ background: '#fdf0f0', border: '1px solid #f5c6c6' }}>
            <p className="text-sm font-medium" style={{ color: '#b44' }}>{error}</p>
          </div>
        ) : docs.length === 0 && !loading ? (
          <div className="rounded-xl p-12 text-center" style={{ background: '#f5f1e8', border: '1px solid #e0d8cc' }}>
            <p className="text-sm font-medium mb-1" style={{ color: '#5c5248' }}>No documents yet</p>
            <p className="text-xs" style={{ color: '#9c9080' }}>
              Add a URL or upload a file to ingest it into the RAG corpus.
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-4 text-xs px-4 py-2 rounded-full font-medium"
              style={{ background: '#7d8c6e', color: '#fff' }}
            >
              Add First Document
            </button>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #e0d8cc' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: '#f5f1e8', borderBottom: '1px solid #e0d8cc' }}>
                  <th className="text-left px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>
                    Title / Source
                  </th>
                  <th className="text-left px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>
                    Tags
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>
                    Chunks
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold" title="Admin-set authority weight [0–1]" style={{ color: '#7d8c6e' }}>
                    Auth.
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold" title="Times cited in answers" style={{ color: '#7d8c6e' }}>
                    Cited
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold" title="Positive rating rate when cited" style={{ color: '#7d8c6e' }}>
                    +Ratio
                  </th>
                  <th className="text-left px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>
                    Status
                  </th>
                  <th className="text-left px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>
                    Indexed
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold" style={{ color: '#7d8c6e' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc, i) => (
                  <tr
                    key={doc.id}
                    style={{
                      background: i % 2 === 0 ? '#faf8f3' : '#f5f1e8',
                      borderBottom: '1px solid #ede8e0',
                    }}
                  >
                    {/* Title / Source */}
                    <td className="px-4 py-3" style={{ maxWidth: '280px' }}>
                      <p
                        className="font-medium truncate"
                        style={{ color: '#3d4f38' }}
                        title={doc.title ?? doc.sourceId}
                      >
                        {doc.title ?? doc.sourceId}
                      </p>
                      {doc.url && (
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs truncate block mt-0.5 hover:underline"
                          style={{ color: '#9c9080', maxWidth: '260px' }}
                          title={doc.url}
                        >
                          {doc.url}
                        </a>
                      )}
                      {doc.sourceId.startsWith('file:') && (
                        <span className="text-xs mt-0.5 block" style={{ color: '#9c9080' }}>
                          {doc.sourceId.replace('file:', '')}
                        </span>
                      )}
                      {doc.status === 'error' && doc.errorMessage && (
                        <p className="text-xs mt-1 italic" style={{ color: '#b44444' }} title={doc.errorMessage}>
                          {doc.errorMessage.slice(0, 80)}{doc.errorMessage.length > 80 ? '…' : ''}
                        </p>
                      )}
                      {doc.status === 'processing' && (
                        <div
                          className="mt-1.5 h-1 rounded-full overflow-hidden"
                          style={{ background: '#e0d8cc' }}
                        >
                          <div
                            className="h-full rounded-full animate-pulse"
                            style={{ width: '60%', background: '#a07020' }}
                          />
                        </div>
                      )}
                    </td>

                    {/* Tags */}
                    <td className="px-4 py-3" style={{ minWidth: '140px', maxWidth: '200px' }}>
                      {wallet && (
                        <TagEditor
                          docId={doc.id}
                          tags={doc.tags}
                          wallet={wallet}
                          onUpdated={handleTagsUpdated}
                        />
                      )}
                    </td>

                    {/* Chunks */}
                    <td className="px-4 py-3 text-right font-mono" style={{ color: '#5c5248' }}>
                      {doc.status === 'done' ? doc.chunkCount : '—'}
                    </td>

                    {/* Authority score */}
                    <td className="px-4 py-3 text-right">
                      {wallet && (
                        <AuthorityScoreEditor
                          docId={doc.id}
                          score={doc.authorityScore}
                          wallet={wallet}
                          onUpdated={handleAuthorityUpdated}
                        />
                      )}
                    </td>

                    {/* Citation count */}
                    <td className="px-4 py-3 text-right font-mono" style={{ color: '#5c5248' }}>
                      {doc.citationCount > 0 ? doc.citationCount : <span style={{ color: '#c0b8b0' }}>—</span>}
                    </td>

                    {/* Positive ratio when cited */}
                    <td className="px-4 py-3 text-right font-mono" style={{ color: '#5c5248' }}>
                      {doc.positiveRatioWhenCited !== null && doc.positiveRatioWhenCited !== undefined
                        ? <span style={{ color: doc.positiveRatioWhenCited >= 0.6 ? '#3d6b30' : doc.positiveRatioWhenCited >= 0.4 ? '#a07020' : '#b44' }}>
                            {(doc.positiveRatioWhenCited * 100).toFixed(0)}%
                          </span>
                        : <span style={{ color: '#c0b8b0' }}>—</span>
                      }
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <StatusBadge status={doc.status} errorMessage={doc.errorMessage} />
                    </td>

                    {/* Indexed date */}
                    <td className="px-4 py-3" style={{ color: '#9c9080', whiteSpace: 'nowrap' }}>
                      {formatDate(doc.indexedAt)}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-1.5 justify-end">
                        {/* Re-index (URL only) */}
                        {!doc.sourceId.startsWith('file:') && (
                          <button
                            onClick={() => wallet && reindex(doc.id, wallet)}
                            disabled={reindexing.has(doc.id) || doc.status === 'processing'}
                            className="px-2.5 py-1 rounded-full text-xs border transition-colors disabled:opacity-40"
                            style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
                            title="Re-ingest this URL"
                          >
                            {reindexing.has(doc.id) ? 'Queuing…' : 'Re-index'}
                          </button>
                        )}

                        {/* Retry for errors */}
                        {doc.status === 'error' && doc.sourceId.startsWith('file:') && (
                          <span className="text-xs italic" style={{ color: '#9c9080' }}>
                            Re-upload to retry
                          </span>
                        )}

                        {/* Delete */}
                        {confirmDeleteId === doc.id ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs" style={{ color: '#b44' }}>Delete?</span>
                            <button
                              onClick={() => wallet && deleteDoc(doc.id, wallet)}
                              disabled={deleting.has(doc.id)}
                              className="px-2 py-1 rounded-full text-xs font-medium disabled:opacity-50"
                              style={{ background: '#fdf0f0', color: '#b44' }}
                            >
                              {deleting.has(doc.id) ? '…' : 'Yes'}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1 rounded-full text-xs border"
                              style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(doc.id)}
                            className="px-2.5 py-1 rounded-full text-xs border transition-colors"
                            style={{ borderColor: '#f5c6c6', color: '#b44' }}
                            title="Delete document and remove from vector store"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      <footer
        className="flex items-center justify-center px-5 py-2.5 border-t"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <span className="text-xs" style={{ color: '#b0a898' }}>
          Convergence · Admin · Document Sources · Auto-refreshes during processing
        </span>
      </footer>

      {showAddModal && wallet && (
        <AddDocModal
          wallet={wallet}
          onClose={() => setShowAddModal(false)}
          onAdded={() => wallet && fetchDocs(wallet)}
        />
      )}
    </div>
  );
}
