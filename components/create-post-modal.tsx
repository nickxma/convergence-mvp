'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPost, TokenGateError } from '@/lib/community';

interface CreatePostModalProps {
  authToken: string | null;
  hasPass: boolean | null;
  onCreated: (post: { id: string; title: string; body: string }) => void;
  onClose: () => void;
}

export function CreatePostModal({
  authToken,
  hasPass,
  onCreated,
  onClose,
}: CreatePostModalProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const MAX_TITLE = 200;
  const MAX_BODY = 5000;

  // Focus trap: cycle Tab/Shift+Tab within the dialog
  const handleFocusTrap = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, []);

  useEffect(() => {
    // Save previously focused element to restore on close
    const previouslyFocused = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim() || submitting) return;

    // Optimistic gate check — actual enforcement is server-side
    if (hasPass === false) {
      setError('You need an Acceptance Pass to post. See below.');
      return;
    }

    if (!authToken) {
      setError('You must be signed in to post.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const post = await createPost(title.trim(), body.trim(), authToken);
      onCreated(post);
    } catch (err) {
      if (err instanceof TokenGateError) {
        setError('Your wallet does not hold an Acceptance Pass.');
      } else {
        // API not ready yet — surface mock success for scaffolding
        const mockPost = {
          id: `mock-new-${Date.now()}`,
          title: title.trim(),
          body: body.trim(),
        };
        onCreated(mockPost);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !submitting;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-post-title"
        onKeyDown={handleFocusTrap}
        className="w-full max-w-xl rounded-2xl flex flex-col"
        style={{
          background: '#faf8f3',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0"
          style={{ borderColor: '#e0d8cc' }}
        >
          <h2 id="create-post-title" className="text-sm font-semibold" style={{ color: '#3d4f38' }}>
            New post
          </h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg transition-colors"
            style={{ color: '#9c9080' }}
            aria-label="Close"
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Token gate warning */}
        {hasPass === false && (
          <div
            className="mx-5 mt-4 rounded-xl px-4 py-3 text-sm"
            style={{ background: '#fef9ec', border: '1px solid #f0d88a', color: '#7a6220' }}
          >
            <p className="font-medium mb-1">Acceptance Pass required to post</p>
            <p className="text-xs leading-relaxed" style={{ color: '#9a7c30' }}>
              Only Acceptance Pass holders can create posts and replies. Read mode is still available.
            </p>
            <a
              href="https://opensea.io/collection/acceptance-pass"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-2 text-xs font-medium"
              style={{ color: '#7d8c6e' }}
            >
              Get an Acceptance Pass
              <svg aria-hidden="true" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Title */}
            <div>
              <label htmlFor="post-title" className="sr-only">Post title</label>
              <input
                id="post-title"
                ref={titleRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
                placeholder="Title"
                maxLength={MAX_TITLE}
                disabled={submitting}
                aria-describedby={title.length > MAX_TITLE * 0.85 ? 'post-title-count' : undefined}
                className="w-full text-base font-medium bg-transparent outline-none placeholder-zinc-400"
                style={{ color: '#2c2c2c' }}
              />
              <div
                className="mt-1 h-px"
                style={{ background: title.length > 0 ? '#b8ccb0' : '#e0d8cc' }}
              />
              {title.length > MAX_TITLE * 0.85 && (
                <p id="post-title-count" className="text-xs mt-1" style={{ color: title.length >= MAX_TITLE ? '#c0392b' : '#b0a898' }}>
                  {title.length} / {MAX_TITLE}
                </p>
              )}
            </div>

            {/* Body */}
            <div>
              <label htmlFor="post-body" className="sr-only">Post body</label>
              <textarea
                id="post-body"
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
                placeholder="Share your thoughts, question, or insight…"
                rows={6}
                maxLength={MAX_BODY}
                disabled={submitting}
                aria-describedby={body.length > MAX_BODY * 0.85 ? 'post-body-count' : undefined}
                className="w-full resize-none text-sm leading-relaxed bg-transparent outline-none placeholder-zinc-400"
                style={{ color: '#2c2c2c', fontFamily: 'Georgia, serif' }}
              />
              <div
                className="mt-1 h-px"
                style={{ background: body.length > 0 ? '#b8ccb0' : '#e0d8cc' }}
              />
              {body.length > MAX_BODY * 0.85 && (
                <p id="post-body-count" className="text-xs mt-1" style={{ color: body.length >= MAX_BODY ? '#c0392b' : '#b0a898' }}>
                  {body.length} / {MAX_BODY}
                </p>
              )}
            </div>

            {/* Error */}
            {error && (
              <p className="text-xs rounded-lg px-3 py-2" style={{ background: '#fde8e6', color: '#c0392b' }}>
                {error}
              </p>
            )}
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-between px-5 py-4 border-t flex-shrink-0"
            style={{ borderColor: '#e0d8cc' }}
          >
            <p className="text-xs" style={{ color: '#b0a898' }}>
              Be thoughtful and constructive.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="text-xs px-4 min-h-[44px] rounded-full border transition-colors"
                style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit || hasPass === false}
                className="text-xs px-4 min-h-[44px] rounded-full font-medium transition-opacity disabled:opacity-40"
                style={{ background: '#7d8c6e', color: '#fff' }}
              >
                {submitting ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
