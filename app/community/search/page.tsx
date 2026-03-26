'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { searchPosts, type SearchResult, truncateWallet } from '@/lib/community';

const PAGE_SIZE = 20;

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <strong key={i} style={{ color: '#3d4f38', fontWeight: 600 }}>
        {part}
      </strong>
    ) : (
      part
    ),
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchPageSkeleton />}>
      <SearchPageInner />
    </Suspense>
  );
}

function SearchPageSkeleton() {
  return (
    <div className="flex flex-col min-h-full" style={{ background: '#faf8f3' }}>
      <header className="flex items-center gap-3 px-5 py-3 border-b" style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}>
        <span className="text-sm font-semibold" style={{ color: '#3d4f38' }}>Search</span>
      </header>
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-6">
        <div className="h-10 rounded-xl mb-6 animate-pulse" style={{ background: '#e8e0d5' }} />
      </main>
    </div>
  );
}

function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQ = searchParams.get('q') ?? '';

  const [inputValue, setInputValue] = useState(initialQ);
  const [query, setQuery] = useState(initialQ);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(false);
    searchPosts(query, 1, PAGE_SIZE)
      .then((res) => {
        setResults(res.results);
        setTotal(res.total);
        setPage(1);
        setHasMore(res.results.length < res.total);
        setSearched(true);
      })
      .catch(() => {
        setResults([]);
        setTotal(0);
        setSearched(true);
      })
      .finally(() => setLoading(false));
  }, [query]);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setInputValue(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const trimmed = val.trim();
      if (trimmed) {
        setQuery(trimmed);
        router.replace(`/community/search?q=${encodeURIComponent(trimmed)}`, { scroll: false });
      }
    }, 300);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && inputValue.trim()) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const trimmed = inputValue.trim();
      setQuery(trimmed);
      router.replace(`/community/search?q=${encodeURIComponent(trimmed)}`, { scroll: false });
    }
  }

  async function loadMore() {
    const nextPage = page + 1;
    setLoading(true);
    try {
      const res = await searchPosts(query, nextPage, PAGE_SIZE);
      setResults((prev) => [...prev, ...res.results]);
      setPage(nextPage);
      setHasMore(results.length + res.results.length < res.total);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col min-h-full" style={{ background: '#faf8f3' }}>
      {/* Header */}
      <header
        className="flex items-center gap-3 px-5 py-3 border-b sticky top-0 z-10"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <a href="/community" className="flex items-center gap-1.5 text-xs" style={{ color: '#7d8c6e' }}>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Community
        </a>
        <span className="text-xs" style={{ color: '#e0d8cc' }}>·</span>
        <h1 className="text-sm font-semibold" style={{ color: '#3d4f38' }}>Search</h1>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-6">
        {/* Search input */}
        <div
          className="flex items-center gap-2 px-3 py-2.5 rounded-xl mb-6"
          style={{ border: '1px solid #b8ccb0', background: '#fff' }}
        >
          <svg
            className="w-4 h-4 flex-shrink-0"
            style={{ color: '#b0a898' }}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            autoFocus
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Search posts…"
            className="flex-1 outline-none bg-transparent text-sm"
            style={{ color: '#3d4f38' }}
          />
          {loading && (
            <svg
              className="w-4 h-4 animate-spin flex-shrink-0"
              style={{ color: '#b0a898' }}
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
        </div>

        {/* Results */}
        {!query.trim() && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
              style={{ background: '#e8e0d5' }}
            >
              <svg className="w-6 h-6" style={{ color: '#7d8c6e' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </div>
            <p className="text-sm font-medium" style={{ color: '#5c5248' }}>Search the Knowledge Commons</p>
            <p className="text-xs mt-1 max-w-xs leading-relaxed" style={{ color: '#9c9080' }}>
              Find posts and discussions on mindfulness, meditation, and practice.
            </p>
          </div>
        )}

        {query.trim() && loading && results.length === 0 && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <SearchResultSkeleton key={i} />
            ))}
          </div>
        )}

        {searched && results.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mb-4"
              style={{ background: '#e8e0d5' }}
            >
              <svg className="w-6 h-6" style={{ color: '#7d8c6e' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: '#5c5248' }}>No results found</p>
            <p className="text-xs max-w-xs leading-relaxed" style={{ color: '#9c9080' }}>
              No posts matched &ldquo;{query}&rdquo;. Try different keywords.
            </p>
          </div>
        )}

        {results.length > 0 && (
          <>
            <p className="text-xs mb-4" style={{ color: '#9c9080' }}>
              {total} result{total !== 1 ? 's' : ''} for &ldquo;{query}&rdquo;
            </p>
            <div className="space-y-3">
              {results.map((r) => (
                <SearchResultCard key={r.id} result={r} query={query} />
              ))}
            </div>

            {hasMore && (
              <div className="flex justify-center mt-6">
                <button
                  onClick={loadMore}
                  disabled={loading}
                  className="text-xs px-5 py-2 rounded-full border transition-colors disabled:opacity-50"
                  style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
                >
                  {loading ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </main>

      <footer
        className="flex items-center justify-center px-5 py-2.5 border-t"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <span className="text-xs" style={{ color: '#b0a898' }}>
          Convergence · Paradox of Acceptance
        </span>
      </footer>
    </div>
  );
}

function SearchResultCard({ result, query }: { result: SearchResult; query: string }) {
  return (
    <a
      href={`/community/${result.id}`}
      className="block rounded-2xl px-4 py-4 transition-colors"
      style={{ background: '#fff', border: '1px solid #e0d8cc', textDecoration: 'none' }}
      onMouseOver={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#b8ccb0')}
      onMouseOut={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#e0d8cc')}
    >
      <h2
        className="text-sm font-semibold leading-snug mb-1.5"
        style={{ color: '#3d4f38' }}
      >
        {highlightMatch(result.title, query)}
      </h2>
      <p
        className="text-xs leading-relaxed line-clamp-2 mb-3"
        style={{ color: '#7d8c6e', fontFamily: 'Georgia, serif' }}
      >
        {highlightMatch(result.excerpt, query)}
      </p>
      <div className="flex items-center gap-3 text-xs" style={{ color: '#b0a898' }}>
        <span>{truncateWallet(result.authorWallet)}</span>
        <span>·</span>
        <span>{result.votes} vote{result.votes !== 1 ? 's' : ''}</span>
      </div>
    </a>
  );
}

function SearchResultSkeleton() {
  return (
    <div
      className="rounded-2xl px-4 py-4 animate-pulse"
      style={{ background: '#fff', border: '1px solid #e0d8cc' }}
    >
      <div className="h-4 rounded mb-2" style={{ background: '#e8e0d5', width: '60%' }} />
      <div className="h-3 rounded mb-1" style={{ background: '#f0ece3', width: '100%' }} />
      <div className="h-3 rounded mb-3" style={{ background: '#f0ece3', width: '80%' }} />
      <div className="flex gap-3">
        <div className="h-3 rounded" style={{ background: '#e8e0d5', width: 80 }} />
        <div className="h-3 rounded" style={{ background: '#e8e0d5', width: 50 }} />
      </div>
    </div>
  );
}
