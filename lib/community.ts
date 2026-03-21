/**
 * Community discussion types and API helpers.
 * API shape mirrors OLU-127 (community discussion API).
 */

export interface Post {
  id: string;
  authorWallet: string;
  title: string;
  body: string;
  createdAt: string;
  votes: number;
  replyCount: number;
  userVote: 'up' | 'down' | null;
}

export interface Reply {
  id: string;
  postId: string;
  authorWallet: string;
  body: string;
  createdAt: string;
  votes: number;
  userVote: 'up' | 'down' | null;
}

export interface PostDetail extends Post {
  replies: Reply[];
}

export interface PostsResponse {
  posts: Post[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ── Formatting helpers ──────────────────────────────────────────────────────

export function truncateWallet(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Mock data (scaffolding while API is in development) ─────────────────────

export const MOCK_POSTS: Post[] = [
  {
    id: 'mock-1',
    authorWallet: '0x742d35Cc6634C0532925a3b8D4C9C9bFd31b8b7a',
    title: 'How does mindfulness relate to the concept of "no-self"?',
    body: "I've been practicing for about 6 months and keep running into this question in Sam's teachings. When he talks about the illusion of the self, is he saying there's literally nothing there, or just that our ordinary sense of being a subject is distorted?",
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    votes: 47,
    replyCount: 12,
    userVote: null,
  },
  {
    id: 'mock-2',
    authorWallet: '0x1234567890abcdef1234567890abcdef12345678',
    title: 'Advice for establishing a consistent daily practice',
    body: "Struggling with consistency. I start strong then fall off after 2–3 weeks. Has anyone found a reliable anchor for keeping meditation going? Looking for strategies that have worked.",
    createdAt: new Date(Date.now() - 18000000).toISOString(),
    votes: 31,
    replyCount: 8,
    userVote: null,
  },
  {
    id: 'mock-3',
    authorWallet: '0xabcdef1234567890abcdef1234567890abcdef12',
    title: 'Comparing the noting technique vs. open awareness',
    body: "I've been using noting for a year but recently switched to open awareness practice. The transition was disorienting at first but now I prefer it. Curious what others think about switching methods.",
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    votes: 24,
    replyCount: 15,
    userVote: null,
  },
  {
    id: 'mock-4',
    authorWallet: '0xdeadbeef12345678deadbeef12345678deadbeef',
    title: 'What is the significance of the "pointing out" instruction?',
    body: "Sam often mentions pointing-out instructions from the Dzogchen tradition. I've heard about this but haven't experienced it directly. What has been your experience with these types of direct transmissions?",
    createdAt: new Date(Date.now() - 172800000).toISOString(),
    votes: 19,
    replyCount: 6,
    userVote: null,
  },
  {
    id: 'mock-5',
    authorWallet: '0xfeed1234567890abcdefffeed1234567890abcde',
    title: 'Waking Up app vs. standalone practice — differences?',
    body: "For those who've been using the Waking Up app alongside their own practice, do you find the guided sessions help or do they create a dependency? I'm wondering if I'm using the guided format as a crutch.",
    createdAt: new Date(Date.now() - 259200000).toISOString(),
    votes: 14,
    replyCount: 9,
    userVote: null,
  },
];

export const MOCK_REPLIES: Reply[] = [
  {
    id: 'mock-r1',
    postId: 'mock-1',
    authorWallet: '0xfeed1234567890abcdefffeed1234567890abcdef',
    body: "The \"no-self\" in Sam's teaching isn't a metaphysical claim about non-existence — it's more of a phenomenological observation. When you look carefully for the subject, you find there's just experience arising and passing, with no separate \"experiencer\" behind it.",
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    votes: 15,
    userVote: null,
  },
  {
    id: 'mock-r2',
    postId: 'mock-1',
    authorWallet: '0x999abc1234567890999abc1234567890999abc12',
    body: "I had the same question. The key distinction for me was between the self as a narrative construct (the story you tell about yourself over time) vs. the felt sense of being a subject right now. Sam is mostly pointing at the latter as an illusion.",
    createdAt: new Date(Date.now() - 1800000).toISOString(),
    votes: 11,
    userVote: null,
  },
  {
    id: 'mock-r3',
    postId: 'mock-1',
    authorWallet: '0x112233445566778899aabbccddeeff0011223344',
    body: "Advaita Vedanta calls this the witness — the sense that there's a self watching experience. The pointing-out instruction is meant to collapse that division, showing that the witness and what's being witnessed aren't separate. Sam's secular framing is essentially the same insight.",
    createdAt: new Date(Date.now() - 900000).toISOString(),
    votes: 8,
    userVote: null,
  },
];

// ── API client ───────────────────────────────────────────────────────────────

export async function fetchPosts(page = 1, pageSize = 20): Promise<PostsResponse> {
  const res = await fetch(`/api/community/posts?page=${page}&pageSize=${pageSize}`);
  if (!res.ok) throw new Error(`fetchPosts failed: ${res.status}`);
  return res.json();
}

export async function fetchPost(id: string): Promise<PostDetail> {
  const res = await fetch(`/api/community/posts/${id}`);
  if (!res.ok) throw new Error(`fetchPost failed: ${res.status}`);
  return res.json();
}

export async function createPost(
  title: string,
  body: string,
  authToken: string,
): Promise<Post> {
  const res = await fetch('/api/community/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ title, body }),
  });
  if (res.status === 403) throw new TokenGateError();
  if (!res.ok) throw new Error(`createPost failed: ${res.status}`);
  return res.json();
}

export async function createReply(
  postId: string,
  body: string,
  authToken: string,
): Promise<Reply> {
  const res = await fetch(`/api/community/posts/${postId}/replies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ body }),
  });
  if (res.status === 403) throw new TokenGateError();
  if (!res.ok) throw new Error(`createReply failed: ${res.status}`);
  return res.json();
}

export async function voteOnPost(
  postId: string,
  direction: 'up' | 'down',
  authToken: string,
): Promise<{ votes: number; userVote: 'up' | 'down' | null }> {
  const res = await fetch(`/api/community/posts/${postId}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ direction }),
  });
  if (res.status === 403) throw new TokenGateError();
  if (!res.ok) throw new Error(`vote failed: ${res.status}`);
  return res.json();
}

export async function voteOnReply(
  postId: string,
  replyId: string,
  direction: 'up' | 'down',
  authToken: string,
): Promise<{ votes: number; userVote: 'up' | 'down' | null }> {
  const res = await fetch(`/api/community/posts/${postId}/replies/${replyId}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({ direction }),
  });
  if (res.status === 403) throw new TokenGateError();
  if (!res.ok) throw new Error(`voteReply failed: ${res.status}`);
  return res.json();
}

export async function checkTokenGate(wallet: string): Promise<boolean> {
  const res = await fetch(`/api/community/token-check?wallet=${encodeURIComponent(wallet)}`);
  if (!res.ok) return false;
  const data = await res.json();
  return data.hasPass === true;
}

export class TokenGateError extends Error {
  constructor() {
    super('Acceptance Pass required');
    this.name = 'TokenGateError';
  }
}

// ── Governance types ─────────────────────────────────────────────────────────

export interface GovernancePost {
  id: string;
  authorWallet: string;
  title: string;
  votes: number;
  weeklyVotes?: number;
}

export interface GovernanceContributor {
  authorWallet: string;
  totalVotes: number;
  postCount: number;
}

export interface GovernanceStats {
  totalPosts: number;
  totalReplies: number;
  totalVoters: number;
}

export interface GovernanceData {
  stats: GovernanceStats;
  topPosts: GovernancePost[];
  topContributors: GovernanceContributor[];
  trendingThisWeek: GovernancePost[];
}

// ── Governance mock data ─────────────────────────────────────────────────────

export const MOCK_GOVERNANCE_DATA: GovernanceData = {
  stats: { totalPosts: 127, totalReplies: 843, totalVoters: 64 },
  topPosts: [
    { id: 'mock-1', authorWallet: '0x742d35Cc6634C0532925a3b8D4C9C9bFd31b8b7a', title: 'How does mindfulness relate to the concept of "no-self"?', votes: 47 },
    { id: 'mock-2', authorWallet: '0x1234567890abcdef1234567890abcdef12345678', title: 'Advice for establishing a consistent daily practice', votes: 31 },
    { id: 'mock-3', authorWallet: '0xabcdef1234567890abcdef1234567890abcdef12', title: 'Comparing the noting technique vs. open awareness', votes: 24 },
    { id: 'mock-4', authorWallet: '0xdeadbeef12345678deadbeef12345678deadbeef', title: 'What is the significance of the "pointing out" instruction?', votes: 19 },
    { id: 'mock-5', authorWallet: '0xfeed1234567890abcdefffeed1234567890abcde', title: 'Waking Up app vs. standalone practice — differences?', votes: 14 },
    { id: 'mock-6', authorWallet: '0x999abc1234567890999abc1234567890999abc12', title: 'Resources for understanding the default mode network', votes: 11 },
    { id: 'mock-7', authorWallet: '0x112233445566778899aabbccddeeff0011223344', title: 'Sam on psychedelics vs. meditation — comparing insights', votes: 9 },
    { id: 'mock-8', authorWallet: '0x742d35Cc6634C0532925a3b8D4C9C9bFd31b8b7a', title: 'The role of retreat in deepening practice', votes: 7 },
    { id: 'mock-9', authorWallet: '0x1234567890abcdef1234567890abcdef12345678', title: 'How to work with physical pain during meditation', votes: 5 },
    { id: 'mock-10', authorWallet: '0xabcdef1234567890abcdef1234567890abcdef12', title: 'Contemplating death as a meditation object', votes: 4 },
  ],
  topContributors: [
    { authorWallet: '0x742d35Cc6634C0532925a3b8D4C9C9bFd31b8b7a', totalVotes: 54, postCount: 12 },
    { authorWallet: '0x1234567890abcdef1234567890abcdef12345678', totalVotes: 36, postCount: 8 },
    { authorWallet: '0xabcdef1234567890abcdef1234567890abcdef12', totalVotes: 28, postCount: 7 },
    { authorWallet: '0xdeadbeef12345678deadbeef12345678deadbeef', totalVotes: 19, postCount: 4 },
    { authorWallet: '0xfeed1234567890abcdefffeed1234567890abcde', totalVotes: 14, postCount: 5 },
    { authorWallet: '0x999abc1234567890999abc1234567890999abc12', totalVotes: 11, postCount: 3 },
    { authorWallet: '0x112233445566778899aabbccddeeff0011223344', totalVotes: 9, postCount: 2 },
    { authorWallet: '0xaabb1234567890aabb1234567890aabb12345678', totalVotes: 6, postCount: 2 },
    { authorWallet: '0xccdd1234567890ccdd1234567890ccdd12345678', totalVotes: 4, postCount: 1 },
    { authorWallet: '0xeeff1234567890eeff1234567890eeff12345678', totalVotes: 2, postCount: 1 },
  ],
  trendingThisWeek: [
    { id: 'mock-1', authorWallet: '0x742d35Cc6634C0532925a3b8D4C9C9bFd31b8b7a', title: 'How does mindfulness relate to the concept of "no-self"?', votes: 47, weeklyVotes: 23 },
    { id: 'mock-3', authorWallet: '0xabcdef1234567890abcdef1234567890abcdef12', title: 'Comparing the noting technique vs. open awareness', votes: 24, weeklyVotes: 18 },
    { id: 'mock-7', authorWallet: '0x112233445566778899aabbccddeeff0011223344', title: 'Sam on psychedelics vs. meditation — comparing insights', votes: 9, weeklyVotes: 9 },
    { id: 'mock-2', authorWallet: '0x1234567890abcdef1234567890abcdef12345678', title: 'Advice for establishing a consistent daily practice', votes: 31, weeklyVotes: 7 },
    { id: 'mock-6', authorWallet: '0x999abc1234567890999abc1234567890999abc12', title: 'Resources for understanding the default mode network', votes: 11, weeklyVotes: 5 },
  ],
};

// ── Governance API client ────────────────────────────────────────────────────

export async function fetchGovernanceData(): Promise<GovernanceData> {
  const res = await fetch('/api/community/governance');
  if (!res.ok) throw new Error(`fetchGovernanceData failed: ${res.status}`);
  return res.json();
}
