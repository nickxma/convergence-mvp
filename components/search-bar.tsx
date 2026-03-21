'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { searchPosts, type SearchResult, truncateWallet } from '@/lib/community';

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

export function SearchBar() {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setExpanded(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setShowDropdown(false);
      return;
    }
    setLoading(true);
    try {
      const res = await searchPosts(q, 1, 5);
      setResults(res.results);
      setShowDropdown(true);
    } catch {
      setResults([]);
      setShowDropdown(false);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!val.trim()) {
      setResults([]);
      setShowDropdown(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && query.trim()) {
      setShowDropdown(false);
      router.push(`/community/search?q=${encodeURIComponent(query.trim())}`);
    }
    if (e.key === 'Escape') {
      setShowDropdown(false);
      setExpanded(false);
      inputRef.current?.blur();
    }
  }

  function handleResultClick(id: string) {
    setShowDropdown(false);
    setQuery('');
    router.push(`/community/${id}`);
  }

  function handleViewAll() {
    if (!query.trim()) return;
    setShowDropdown(false);
    router.push(`/community/search?q=${encodeURIComponent(query.trim())}`);
  }

  function handleIconClick() {
    setExpanded(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Mobile: icon only, expands on tap */}
      <div className="sm:hidden">
        {!expanded ? (
          <button
            onClick={handleIconClick}
            className="flex items-center justify-center w-7 h-7 rounded-full transition-colors"
            style={{ color: '#7d8c6e' }}
            aria-label="Search"
          >
            <SearchIcon />
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <div
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs"
              style={{ border: '1px solid #b8ccb0', background: '#fff', minWidth: 180 }}
            >
              <SearchIcon className="flex-shrink-0 text-gray-400" style={{ color: '#b0a898' }} />
              <input
                ref={inputRef}
                value={query}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder="Search posts…"
                className="flex-1 outline-none bg-transparent text-xs"
                style={{ color: '#3d4f38', minWidth: 0 }}
              />
              {loading && <Spinner />}
            </div>
          </div>
        )}
      </div>

      {/* Desktop: always visible */}
      <div className="hidden sm:flex items-center">
        <div
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs transition-colors focus-within:border-opacity-100"
          style={{ border: '1px solid #e0d8cc', background: '#fff', minWidth: 200 }}
          onFocus={() => {}}
        >
          <SearchIcon style={{ color: '#b0a898', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Search posts…"
            className="flex-1 outline-none bg-transparent text-xs"
            style={{ color: '#3d4f38', minWidth: 0 }}
          />
          {loading && <Spinner />}
        </div>
      </div>

      {/* Dropdown */}
      {showDropdown && (
        <div
          className="absolute right-0 top-full mt-1.5 rounded-xl shadow-lg z-50 overflow-hidden"
          style={{
            background: '#fff',
            border: '1px solid #e0d8cc',
            minWidth: 280,
            maxWidth: 360,
          }}
        >
          {results.length === 0 ? (
            <div className="px-4 py-3 text-xs" style={{ color: '#9c9080' }}>
              No results for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <>
              <ul>
                {results.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => handleResultClick(r.id)}
                      className="w-full text-left px-4 py-3 transition-colors text-xs"
                      style={{ borderBottom: '1px solid #f0ece3' }}
                      onMouseOver={(e) =>
                        ((e.currentTarget as HTMLElement).style.background = '#f5f1ea')
                      }
                      onMouseOut={(e) =>
                        ((e.currentTarget as HTMLElement).style.background = 'transparent')
                      }
                    >
                      <div
                        className="font-medium leading-snug mb-0.5"
                        style={{ color: '#3d4f38' }}
                      >
                        {highlightMatch(r.title, query)}
                      </div>
                      <div
                        className="line-clamp-1 leading-relaxed"
                        style={{ color: '#9c9080', fontFamily: 'Georgia, serif', fontSize: 11 }}
                      >
                        {highlightMatch(r.excerpt, query)}
                      </div>
                      <div className="flex items-center gap-2 mt-1" style={{ color: '#b0a898' }}>
                        <span>{truncateWallet(r.authorWallet)}</span>
                        <span>·</span>
                        <span>{r.votes} votes</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                onClick={handleViewAll}
                className="w-full px-4 py-2.5 text-xs text-left transition-colors"
                style={{ color: '#7d8c6e', fontWeight: 500 }}
                onMouseOver={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = '#f5f1ea')
                }
                onMouseOut={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = 'transparent')
                }
              >
                View all results for &ldquo;{query}&rdquo; →
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SearchIcon({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      className={`w-3.5 h-3.5 ${className ?? ''}`}
      style={style}
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
  );
}

function Spinner() {
  return (
    <svg
      className="w-3 h-3 animate-spin"
      style={{ color: '#b0a898', flexShrink: 0 }}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
