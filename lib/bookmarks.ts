export interface Bookmark {
  answerId: string;
  question: string;
  excerpt: string;
  createdAt: number;
}

const storageKey = (userId: string) => `wu_bookmarks_${userId}`;

export function loadBookmarks(userId: string): Bookmark[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as Bookmark[]) : [];
  } catch {
    return [];
  }
}

export function addBookmark(userId: string, bookmark: Bookmark): void {
  const existing = loadBookmarks(userId).filter((b) => b.answerId !== bookmark.answerId);
  localStorage.setItem(storageKey(userId), JSON.stringify([bookmark, ...existing]));
  window.dispatchEvent(new Event('bookmark-change'));
}

export function removeBookmark(userId: string, answerId: string): void {
  const updated = loadBookmarks(userId).filter((b) => b.answerId !== answerId);
  localStorage.setItem(storageKey(userId), JSON.stringify(updated));
  window.dispatchEvent(new Event('bookmark-change'));
}

export function isBookmarked(userId: string, answerId: string): boolean {
  return loadBookmarks(userId).some((b) => b.answerId === answerId);
}

export function countBookmarks(userId: string): number {
  return loadBookmarks(userId).length;
}
