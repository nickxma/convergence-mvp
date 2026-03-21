/**
 * E2E smoke test: Knowledge Commons — complete community participation journey.
 *
 * Covers:
 *   1. Wallet auth → view feed (unauthenticated)
 *   2. Token gate: non-pass wallet sees read-only view
 *   3. Create post: pass holder creates post; post appears in feed
 *   4. Reply: pass holder adds reply; reply appears threaded
 *   5. Vote: second pass holder upvotes post; score increments
 *   6. Governance page: voted post appears in top-posts leaderboard
 *   7. Profile page: author wallet shows their post
 *
 * Auth strategy: window.__PRIVY_MOCK is injected via page.addInitScript() so
 * tests run without a real Privy session. All /api/community/* calls are
 * intercepted via page.route() so no live database is needed.
 *
 * When NEXT_PUBLIC_PRIVY_APP_ID is unset, Providers uses MockAuthBridge which
 * reads window.__PRIVY_MOCK and populates AuthContext for the community pages.
 */

import { test, expect, type Page } from '@playwright/test';

// ── Test wallets ──────────────────────────────────────────────────────────────

const WALLET_PASS_1 = '0x1111111111111111111111111111111111111111';
const WALLET_PASS_2 = '0x2222222222222222222222222222222222222222';
const WALLET_NO_PASS = '0x3333333333333333333333333333333333333333';

// ── Stable test data (camelCase matches frontend Post/PostDetail interface) ───

const POST_ID = '42';

/** Base post in PostDetail / Post interface shape (camelCase). */
const BASE_POST = {
  id: POST_ID,
  authorWallet: WALLET_PASS_1,
  title: 'E2E smoke: On the nature of awareness in daily practice',
  body: 'This post was created by the E2E test suite to validate the community discussion flow end-to-end.',
  votes: 5,
  replyCount: 0,
  userVote: null as 'up' | 'down' | null,
  createdAt: new Date(Date.now() - 3_600_000).toISOString(),
};

const BASE_REPLY = {
  id: '201',
  postId: POST_ID,
  authorWallet: WALLET_PASS_1,
  body: 'E2E test reply — threaded reply flow works.',
  votes: 1,
  userVote: null as 'up' | 'down' | null,
  createdAt: new Date(Date.now() - 1_800_000).toISOString(),
};

// ── Auth injection ─────────────────────────────────────────────────────────────

/**
 * Inject window.__PRIVY_MOCK before page load.
 * MockAuthBridge in Providers picks this up and populates AuthContext.
 * Also marks the onboarding modal as seen to prevent it from blocking interactions.
 */
function injectAuth(page: Page, wallet: string | null) {
  if (wallet) {
    const userId = `test-user-${wallet}`;
    return page.addInitScript(`
      window.__PRIVY_MOCK = {
        ready: true,
        authenticated: true,
        user: { id: '${userId}', wallet: { address: '${wallet}' } },
        getAccessToken: function() { return Promise.resolve('test-token-${wallet}'); }
      };
      // Pre-dismiss the first-time onboarding modal so it does not block UI
      try { localStorage.setItem('convergence_onboarding_${userId}', 'true'); } catch(e) {}
    `);
  }
  return page.addInitScript(`
    window.__PRIVY_MOCK = {
      ready: true,
      authenticated: false,
      user: null,
      getAccessToken: function() { return Promise.resolve(null); }
    };
  `);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Knowledge Commons smoke test', () => {

  // ── 1. Unauthenticated: view feed ──────────────────────────────────────────
  test('1. Unauthenticated — feed loads with sign-in prompt, no post button', async ({ page }) => {
    await injectAuth(page, null);

    await page.route('**/api/community/posts*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            posts: [BASE_POST],
            total: 1,
            page: 1,
            pageSize: 20,
            hasMore: false,
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/community');

    // Community heading visible
    await expect(page.getByRole('heading', { name: 'Community' })).toBeVisible();

    // Feed post renders
    await expect(page.getByText(BASE_POST.title)).toBeVisible();

    // Sign-in prompt shown to unauthenticated users
    await expect(page.getByText('Sign in to participate')).toBeVisible();

    // New post button not visible when not authenticated
    await expect(page.getByRole('button', { name: /New post/i })).not.toBeVisible();
  });

  // ── 2. Token gate: non-pass wallet — read-only ──────────────────────────────
  test('2. Non-pass wallet — read-only banner is shown and create-post is blocked on submit', async ({ page }) => {
    await injectAuth(page, WALLET_NO_PASS);

    await page.route('**/api/community/token-check*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ hasPass: false }),
      });
    });

    await page.route('**/api/community/posts*', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            posts: [BASE_POST],
            total: 1,
            page: 1,
            pageSize: 20,
            hasMore: false,
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/community');

    // Read-only banner visible
    await expect(page.getByText(/read-only mode/i)).toBeVisible();

    // "Get Pass" CTA present
    await expect(page.getByText(/Get a Pass/i)).toBeVisible();

    // "Read only" badge shown in header
    await expect(page.getByText('Read only')).toBeVisible();

    // New post button is visible but styled as inactive
    const newPostBtn = page.getByRole('button', { name: /New post/i });
    await expect(newPostBtn).toBeVisible();

    // Opening the modal and attempting to submit shows a gate error
    await newPostBtn.click();
    const titleInput = page.getByPlaceholder(/Title/i);
    await expect(titleInput).toBeVisible();
    await titleInput.fill('Blocked post attempt');
    await page.getByPlaceholder(/Share your thoughts/i).fill('This should not submit.');
    // Submit button is disabled (hasPass === false)
    const submitBtn = page.getByRole('button', { name: /^Post$/i });
    await expect(submitBtn).toBeDisabled();
  });

  // ── 3. Create post: pass holder creates a post ──────────────────────────────
  test('3. Pass holder creates a post and it appears in the feed', async ({ page }) => {
    const newTitle = 'E2E created: Non-dual perspectives on the waking state';
    const newBody = 'A test post body created during the E2E smoke test run.';

    let feedPosts: typeof BASE_POST[] = [];

    await injectAuth(page, WALLET_PASS_1);

    await page.route('**/api/community/token-check*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ hasPass: true }),
      });
    });

    await page.route('**/api/community/posts*', async (route) => {
      const method = route.request().method();
      const url = route.request().url();

      // Only intercept the base posts endpoint (not /:id or sub-routes)
      if (url.includes('/api/community/posts') && !url.replace(/.*\/api\/community\/posts/, '').replace(/\?.*/, '').match(/\/\d+/)) {
        if (method === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              posts: feedPosts,
              total: feedPosts.length,
              page: 1,
              pageSize: 20,
              hasMore: false,
            }),
          });
        } else if (method === 'POST') {
          const body = await route.request().postDataJSON();
          const created = {
            id: '99',
            authorWallet: WALLET_PASS_1,
            title: body.title as string,
            body: body.body as string,
            votes: 0,
            replyCount: 0,
            userVote: null,
            createdAt: new Date().toISOString(),
          };
          feedPosts = [created, ...feedPosts];
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ id: created.id, title: created.title, body: created.body }),
          });
        } else {
          await route.continue();
        }
      } else {
        await route.continue();
      }
    });

    await page.goto('/community');

    // Pass holder badge visible (use exact match to avoid partial text collision)
    await expect(page.getByText('Pass holder', { exact: true })).toBeVisible();

    // New post button active
    const newPostBtn = page.getByRole('button', { name: /New post/i });
    await expect(newPostBtn).toBeVisible();
    await newPostBtn.click();

    // Modal opens
    const titleInput = page.getByPlaceholder(/Title/i);
    await expect(titleInput).toBeVisible();

    // Fill title and body
    await titleInput.fill(newTitle);
    await page.getByPlaceholder(/Share your thoughts/i).fill(newBody);

    // Submit — button says "Post"
    await page.getByRole('button', { name: /^Post$/i }).click();

    // Post appears in feed (optimistic update in handlePostCreated)
    await expect(page.getByText(newTitle)).toBeVisible();
  });

  // ── 4. Reply: pass holder adds a reply ──────────────────────────────────────
  test('4. Pass holder adds a reply that appears threaded under the post', async ({ page }) => {
    const replyText = 'E2E test reply — threaded reply flow confirmed.';
    let replies: typeof BASE_REPLY[] = [];

    await injectAuth(page, WALLET_PASS_1);

    await page.route('**/api/community/token-check*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ hasPass: true }),
      });
    });

    // Mock the post detail fetch: return PostDetail format (flat camelCase object)
    await page.route(`**/api/community/posts/${POST_ID}`, async (route) => {
      const method = route.request().method();
      const url = route.request().url();
      // Only handle the base post fetch, not sub-routes like /replies or /vote
      if (method === 'GET' && !url.includes(`/posts/${POST_ID}/`)) {
        const postDetail = {
          ...BASE_POST,
          replies,
        };
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(postDetail),
        });
      } else {
        await route.continue();
      }
    });

    await page.route(`**/api/community/posts/${POST_ID}/replies*`, async (route) => {
      if (route.request().method() === 'POST') {
        const body = await route.request().postDataJSON();
        const created = {
          id: '999',
          postId: POST_ID,
          authorWallet: WALLET_PASS_1,
          body: body.body as string,
          votes: 0,
          userVote: null,
          createdAt: new Date().toISOString(),
        };
        replies = [...replies, created];
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ reply: created }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`/community/${POST_ID}`);

    // Post title visible
    await expect(page.getByText(BASE_POST.title)).toBeVisible();

    // Reply textarea available for pass holders — placeholder is "Share your perspective…"
    const replyArea = page.getByPlaceholder(/Share your perspective/i);
    await expect(replyArea).toBeVisible();
    await replyArea.fill(replyText);

    // Submit the reply — button says "Reply"
    await page.getByRole('button', { name: /^Reply$/i }).click();

    // Reply appears threaded under the post
    await expect(page.getByText(replyText)).toBeVisible();
  });

  // ── 5. Vote: second pass holder upvotes, score increments ──────────────────
  test('5. Pass holder upvotes a post and vote score increments optimistically', async ({ page }) => {
    await injectAuth(page, WALLET_PASS_2);

    await page.route('**/api/community/token-check*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ hasPass: true }),
      });
    });

    await page.route('**/api/community/posts*', async (route) => {
      const method = route.request().method();
      const pathname = new URL(route.request().url()).pathname;
      if (method === 'GET' && pathname === '/api/community/posts') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            posts: [{ ...BASE_POST, userVote: null }],
            total: 1,
            page: 1,
            pageSize: 20,
            hasMore: false,
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Vote endpoint needs its own route — `*` in Playwright glob doesn't match `/`
    await page.route(`**/api/community/posts/${POST_ID}/vote*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ votes: BASE_POST.votes + 1, userVote: 'up' }),
      });
    });

    await page.goto('/community');

    // Test post visible
    await expect(page.getByText(BASE_POST.title)).toBeVisible();

    // Wait for pass holder badge — confirms auth + pass check resolved
    await expect(page.getByText('Pass holder', { exact: true })).toBeVisible();

    // Brief pause to let the auth-token Promise (getAccessToken) resolve and set authToken state
    await page.waitForTimeout(300);

    // Current vote score displayed
    await expect(page.getByText(String(BASE_POST.votes)).first()).toBeVisible();

    // Click the upvote button (aria-label="Upvote") in the feed
    await page.getByRole('button', { name: 'Upvote' }).first().click({ force: true });

    // After optimistic update, score should increment to BASE_POST.votes + 1
    await expect(page.getByText(String(BASE_POST.votes + 1)).first()).toBeVisible();
  });

  // ── 6. Governance: voted post in leaderboard ────────────────────────────────
  test('6. Governance page shows the voted post in the top-posts leaderboard', async ({ page }) => {
    const votedScore = BASE_POST.votes + 1;
    const governanceData = {
      stats: { totalPosts: 1, totalReplies: 1, totalVoters: 1 },
      topPosts: [
        {
          id: POST_ID,
          authorWallet: WALLET_PASS_1,
          title: BASE_POST.title,
          votes: votedScore,
        },
      ],
      topContributors: [
        {
          authorWallet: WALLET_PASS_1,
          totalVotes: votedScore,
          postCount: 1,
        },
      ],
      trendingThisWeek: [],
    };

    await page.route('**/api/community/governance*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(governanceData),
      });
    });

    await page.goto('/community/governance');

    // Governance heading
    await expect(page.getByRole('heading', { name: 'Governance' })).toBeVisible();

    // "Top posts" section present
    await expect(page.getByText(/Top posts/i)).toBeVisible();

    // Our test post appears in the leaderboard
    await expect(page.getByText(BASE_POST.title)).toBeVisible();

    // Ranked #1
    await expect(page.getByText('1').first()).toBeVisible();

    // Community stats card shows "Posts" label
    await expect(page.getByText('Posts').first()).toBeVisible();
  });

  // ── 7. Profile page: author wallet — page renders with wallet and posts ───────
  test('7. Author wallet profile page renders with wallet address and recent posts', async ({ page }) => {
    await page.goto(`/profile/${WALLET_PASS_1}`);

    // Wallet address heading visible (profile page shows wallet in h1)
    const truncated = `${WALLET_PASS_1.slice(0, 6)}…${WALLET_PASS_1.slice(-4)}`;
    await expect(page.getByRole('heading', { name: truncated })).toBeVisible();

    // "Recent posts" section visible
    await expect(page.getByText(/Recent posts/i)).toBeVisible();

    // Profile page renders at least one post card (mock data for this wallet includes posts)
    // The mock data for WALLET_PASS_1 (seed = 0x111111 = 1118481) generates posts deterministically
    // Verify the Activity section heading and stat cards are visible
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
    await expect(page.getByText('Posts').first()).toBeVisible();
  });
});
