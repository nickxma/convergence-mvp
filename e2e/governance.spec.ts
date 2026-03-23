/**
 * E2E tests: Knowledge Commons governance proposals.
 *
 * Covers:
 *   1. Unauthenticated user — proposals list visible, vote prompt shown
 *   2. Token holder — casts yes vote, tallies update optimistically
 *   3. Duplicate vote — 409 handled gracefully (no crash, error message shown)
 *   4. Voting on closed proposal — rejected with appropriate message
 *   5. Admin creates a proposal — appears in list
 *   6. Token weight display — non-zero weight shown for token holder
 *
 * All /api/governance/* calls are intercepted via page.route() so no live
 * database is needed. Auth state is injected via window.__PRIVY_MOCK using
 * the same MockAuthBridge pattern as community.spec.ts.
 *
 * Depends on OLU-600 (governance proposal page) and OLU-601 (proposal API)
 * being implemented. Tests will fail until those routes and pages exist.
 */

import { test, expect, type Page } from '@playwright/test';

// ── Test wallets ──────────────────────────────────────────────────────────────

const ADMIN_WALLET = '0xADMINADMINADMINADMINADMINADMINADMINADMIN';
const TOKEN_HOLDER_WALLET = '0x1111111111111111111111111111111111111111';
const NON_HOLDER_WALLET = '0x3333333333333333333333333333333333333333';

// ── Stable test data ──────────────────────────────────────────────────────────

const OPEN_PROPOSAL_ID = 'prop-open-001';
const CLOSED_PROPOSAL_ID = 'prop-closed-002';

const OPEN_PROPOSAL = {
  id: OPEN_PROPOSAL_ID,
  title: 'E2E test: Expand Q&A corpus to include non-English transcripts',
  description: 'Proposal to include translated transcripts in the retrieval corpus.',
  status: 'open' as const,
  yesVotes: 42,
  noVotes: 8,
  userVote: null as 'yes' | 'no' | null,
  createdAt: new Date(Date.now() - 86_400_000).toISOString(),
  createdBy: ADMIN_WALLET,
  closesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
};

const CLOSED_PROPOSAL = {
  id: CLOSED_PROPOSAL_ID,
  title: 'E2E test: Remove deprecated community topics from navigation',
  description: 'Clean up navigation by removing topics with fewer than 5 posts.',
  status: 'closed' as const,
  yesVotes: 100,
  noVotes: 20,
  userVote: null as 'yes' | 'no' | null,
  createdAt: new Date(Date.now() - 14 * 86_400_000).toISOString(),
  createdBy: ADMIN_WALLET,
  closesAt: new Date(Date.now() - 7 * 86_400_000).toISOString(),
};

// ── Auth injection ─────────────────────────────────────────────────────────────

function injectAuth(page: Page, wallet: string | null, isAdmin = false) {
  if (wallet) {
    const userId = `test-user-${wallet}`;
    return page.addInitScript(`
      window.__PRIVY_MOCK = {
        ready: true,
        authenticated: true,
        user: {
          id: '${userId}',
          wallet: { address: '${wallet}' },
          isAdmin: ${isAdmin}
        },
        getAccessToken: function() { return Promise.resolve('test-token-${wallet}'); }
      };
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

// ── Shared route helpers ───────────────────────────────────────────────────────

function mockProposalsList(
  page: Page,
  proposals = [OPEN_PROPOSAL, CLOSED_PROPOSAL],
) {
  return page.route('**/api/governance/proposals*', async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    const isBase = !url.replace(/.*\/api\/governance\/proposals/, '').replace(/\?.*/, '').match(/\/[^/]+/);

    if (method === 'GET' && isBase) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ proposals, total: proposals.length }),
      });
    } else {
      await route.continue();
    }
  });
}

function mockTokenWeight(page: Page, weight: number) {
  return page.route('**/api/governance/weight*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ weight }),
    });
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Governance proposals', () => {

  // ── 1. Unauthenticated: proposals list visible, connect wallet prompt ────────
  test('1. Unauthenticated — proposals list loads, vote button prompts sign-in', async ({ page }) => {
    await injectAuth(page, null);
    await mockProposalsList(page);

    await page.goto('/governance/proposals');

    // Page heading
    await expect(page.getByRole('heading', { name: /proposals/i })).toBeVisible();

    // Both proposals render
    await expect(page.getByText(OPEN_PROPOSAL.title)).toBeVisible();
    await expect(page.getByText(CLOSED_PROPOSAL.title)).toBeVisible();

    // Open proposal shows tally counts
    await expect(page.getByText(String(OPEN_PROPOSAL.yesVotes))).toBeVisible();

    // Clicking vote triggers sign-in prompt, not an error
    const voteBtn = page.getByRole('button', { name: /vote/i }).first();
    await voteBtn.click();
    await expect(page.getByText(/sign in/i)).toBeVisible();
    await expect(page.getByRole('alert')).not.toBeVisible();
  });

  // ── 2. Token holder casts yes vote — tallies update optimistically ───────────
  test('2. Token holder casts yes vote and tallies update', async ({ page }) => {
    await injectAuth(page, TOKEN_HOLDER_WALLET);
    await mockProposalsList(page);
    await mockTokenWeight(page, 150);

    await page.route(`**/api/governance/proposals/${OPEN_PROPOSAL_ID}/vote*`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          yesVotes: OPEN_PROPOSAL.yesVotes + 1,
          noVotes: OPEN_PROPOSAL.noVotes,
          userVote: 'yes',
        }),
      });
    });

    await page.goto('/governance/proposals');

    // Current tally visible
    await expect(page.getByText(String(OPEN_PROPOSAL.yesVotes))).toBeVisible();

    // Click "Yes" vote button on open proposal
    const yesBtn = page.getByRole('button', { name: /yes/i }).first();
    await expect(yesBtn).toBeEnabled();
    await yesBtn.click();

    // Optimistic update: yes count increments
    await expect(page.getByText(String(OPEN_PROPOSAL.yesVotes + 1))).toBeVisible();

    // Button shows voted state (aria-pressed or disabled)
    await expect(yesBtn).toHaveAttribute('aria-pressed', 'true');
  });

  // ── 3. Duplicate vote — 409 handled gracefully ──────────────────────────────
  test('3. Duplicate vote returns 409 — error message shown without crash', async ({ page }) => {
    await injectAuth(page, TOKEN_HOLDER_WALLET);

    // Proposal already voted
    const votedProposal = { ...OPEN_PROPOSAL, userVote: 'yes' as const };
    await mockProposalsList(page, [votedProposal]);
    await mockTokenWeight(page, 150);

    await page.route(`**/api/governance/proposals/${OPEN_PROPOSAL_ID}/vote*`, async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'already_voted' }),
      });
    });

    await page.goto('/governance/proposals');

    // Try to vote again — button may be disabled or still clickable (implementation decides)
    const yesBtn = page.getByRole('button', { name: /yes/i }).first();

    if (await yesBtn.isEnabled()) {
      await yesBtn.click();
      // Error message should appear
      await expect(page.getByText(/already voted/i)).toBeVisible();
    } else {
      // Already disabled — that's also valid handling
      await expect(yesBtn).toBeDisabled();
    }

    // No uncaught error modal / crash
    await expect(page.getByRole('alert').filter({ hasText: /unexpected error/i })).not.toBeVisible();
  });

  // ── 4. Voting on closed proposal is rejected ─────────────────────────────────
  test('4. Closed proposal vote button is disabled', async ({ page }) => {
    await injectAuth(page, TOKEN_HOLDER_WALLET);
    await mockProposalsList(page);
    await mockTokenWeight(page, 150);

    await page.goto('/governance/proposals');

    // Locate closed proposal card
    const closedCard = page.locator('[data-proposal-id="' + CLOSED_PROPOSAL_ID + '"]');
    await expect(closedCard).toBeVisible();

    // Vote buttons within closed proposal card should be disabled
    const closedVoteBtn = closedCard.getByRole('button', { name: /yes|no|vote/i }).first();
    await expect(closedVoteBtn).toBeDisabled();

    // Closed badge visible
    await expect(closedCard.getByText(/closed/i)).toBeVisible();
  });

  // ── 5. Admin creates a proposal — appears in list ────────────────────────────
  test('5. Admin creates a proposal and it appears in the list', async ({ page }) => {
    const newTitle = 'E2E admin: Add community Q&A digest to weekly newsletter';
    const newDescription = 'Weekly digest of top community Q&A to be sent via Resend.';
    let proposals = [OPEN_PROPOSAL, CLOSED_PROPOSAL];

    await injectAuth(page, ADMIN_WALLET, true);

    await page.route('**/api/governance/proposals*', async (route) => {
      const method = route.request().method();
      const url = route.request().url();
      const isBase = !url.replace(/.*\/api\/governance\/proposals/, '').replace(/\?.*/, '').match(/\/[^/]+/);

      if (method === 'GET' && isBase) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ proposals, total: proposals.length }),
        });
      } else if (method === 'POST' && isBase) {
        const body = await route.request().postDataJSON();
        const created = {
          id: 'prop-new-003',
          title: body.title as string,
          description: body.description as string,
          status: 'open' as const,
          yesVotes: 0,
          noVotes: 0,
          userVote: null,
          createdAt: new Date().toISOString(),
          createdBy: ADMIN_WALLET,
          closesAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        };
        proposals = [created, ...proposals];
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify(created),
        });
      } else {
        await route.continue();
      }
    });

    await mockTokenWeight(page, 500);

    await page.goto('/governance/proposals');

    // Admin sees "Create proposal" button
    const createBtn = page.getByRole('button', { name: /create proposal/i });
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // Form appears
    const titleInput = page.getByLabel(/title/i);
    await expect(titleInput).toBeVisible();
    await titleInput.fill(newTitle);

    const descInput = page.getByLabel(/description/i);
    await descInput.fill(newDescription);

    // Submit
    await page.getByRole('button', { name: /submit|create/i }).click();

    // New proposal appears in list
    await expect(page.getByText(newTitle)).toBeVisible();
  });

  // ── 6. Token weight display ──────────────────────────────────────────────────
  test('6. Token holder sees non-zero voting weight preview', async ({ page }) => {
    const TOKEN_WEIGHT = 250;

    await injectAuth(page, TOKEN_HOLDER_WALLET);
    await mockProposalsList(page);
    await mockTokenWeight(page, TOKEN_WEIGHT);

    await page.goto('/governance/proposals');

    // Weight preview should be visible and non-zero
    await expect(page.getByText(new RegExp(`${TOKEN_WEIGHT}`))).toBeVisible();
  });

});
