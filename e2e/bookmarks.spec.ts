/**
 * E2E smoke test: Bookmarks flow.
 *
 * Covers:
 *   1. Authenticated user asks a question, bookmarks the answer, navigates to
 *      /bookmarks, and sees the Q&A pair listed there.
 *
 * Auth strategy: window.__PRIVY_MOCK is injected via page.addInitScript().
 * Bookmarks are stored in localStorage keyed by userId, so they persist
 * across the navigation from /qa → /bookmarks within the same browser context.
 */

import { test, expect, type Page } from '@playwright/test';

const WALLET = '0x5555555555555555555555555555555555555555';
const USER_ID = `test-user-${WALLET}`;

const QUESTION = 'What does it mean to be fully present?';
const ANSWER =
  'Being fully present means resting in open awareness, without being lost in thought or future planning.';
const ANSWER_ID = 'bookmark-answer-1';

function injectAuth(page: Page) {
  return page.addInitScript(`
    window.__PRIVY_MOCK = {
      ready: true,
      authenticated: true,
      user: { id: '${USER_ID}', wallet: { address: '${WALLET}' } },
      getAccessToken: function() { return Promise.resolve('test-token'); }
    };
    // Pre-dismiss first-time onboarding modal and celebration banner
    try { localStorage.setItem('convergence_onboarding_${USER_ID}', 'true'); } catch(e) {}
    try { localStorage.setItem('wu_onboarding_seen', '1'); } catch(e) {}
  `);
}

test.describe('Bookmarks flow', () => {
  test('1. User bookmarks an answer and it appears on /bookmarks', async ({ page }) => {
    await injectAuth(page);

    await page.route('**/api/questions/suggest*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: [] }) })
    );

    await page.route('**/api/ask*', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: ANSWER,
          sources: [],
          conversationId: 'server-conv-bookmark',
          answerId: ANSWER_ID,
        }),
      });
    });

    await page.goto('/qa');

    // Ask a question
    const textarea = page.getByPlaceholder('Ask a question…');
    await expect(textarea).toBeVisible();
    await textarea.fill(QUESTION);
    await page.keyboard.press('Enter');

    // Wait for the answer to appear
    await expect(page.getByText(ANSWER)).toBeVisible();

    // Bookmark the answer — button renders once answerId + question are available
    await page.getByRole('button', { name: 'Bookmark answer' }).click();

    // Button label updates to "Saved" after toggle
    await expect(page.getByText('Saved')).toBeVisible();

    // Navigate to bookmarks page
    await page.goto('/bookmarks');

    // The bookmarked question is listed
    await expect(page.getByText(QUESTION)).toBeVisible();

    // The answer excerpt is listed (first 200 chars of ANSWER)
    await expect(page.getByText(ANSWER.slice(0, 40), { exact: false })).toBeVisible();
  });
});
