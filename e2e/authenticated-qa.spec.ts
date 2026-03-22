/**
 * E2E smoke test: Authenticated Q&A flow.
 *
 * Covers:
 *   1. Authenticated user asks a question and the conversation appears in the sidebar
 *   2. User asks a follow-up and the conversation continues (both exchanges visible)
 *
 * Auth strategy: window.__PRIVY_MOCK is injected so MockAuthBridge treats the
 * user as authenticated with a wallet address. All /api/ask calls are
 * intercepted so no live backend is needed.
 */

import { test, expect, type Page } from '@playwright/test';

const WALLET = '0x4444444444444444444444444444444444444444';
const USER_ID = `test-user-${WALLET}`;

function injectAuth(page: Page) {
  return page.addInitScript(`
    window.__PRIVY_MOCK = {
      ready: true,
      authenticated: true,
      user: { id: '${USER_ID}', wallet: { address: '${WALLET}' } },
      getAccessToken: function() { return Promise.resolve('test-token'); }
    };
    // Pre-dismiss first-time onboarding modal
    try { localStorage.setItem('convergence_onboarding_${USER_ID}', 'true'); } catch(e) {}
    // Pre-dismiss first-answer celebration
    try { localStorage.setItem('wu_onboarding_seen', '1'); } catch(e) {}
  `);
}

async function stubSuggestions(page: Page) {
  await page.route('**/api/questions/suggest*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: [] }) })
  );
}

test.describe('Authenticated Q&A flow', () => {
  test('1. Authenticated user asks a question and conversation appears in sidebar', async ({ page }) => {
    await injectAuth(page);
    await stubSuggestions(page);

    await page.route('**/api/ask*', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Concentration meditation builds focused attention through sustained practice.',
          sources: [],
          conversationId: 'server-conv-1',
          answerId: 'answer-1',
        }),
      });
    });

    await page.goto('/qa');

    // Type a question and submit
    const textarea = page.getByPlaceholder('Ask a question…');
    await expect(textarea).toBeVisible();
    await textarea.fill('What is concentration meditation?');
    await page.keyboard.press('Enter');

    // Answer appears in the conversation
    await expect(
      page.getByText('Concentration meditation builds focused attention through sustained practice.')
    ).toBeVisible();

    // Conversation title appears in the sidebar (desktop sidebar is always visible for authenticated users)
    await expect(page.getByText('What is concentration meditation?')).toBeVisible();
  });

  test('2. Follow-up question continues the conversation', async ({ page }) => {
    await injectAuth(page);
    await stubSuggestions(page);

    let callCount = 0;

    await page.route('**/api/ask*', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      callCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer:
            callCount === 1
              ? 'Insight meditation develops clarity and equanimity through open observation.'
              : 'You can practice vipassana by observing breath and body sensations moment to moment.',
          sources: [],
          conversationId: 'server-conv-2',
          answerId: `answer-${callCount}`,
        }),
      });
    });

    await page.goto('/qa');

    const textarea = page.getByPlaceholder('Ask a question…');

    // First question
    await textarea.fill('What is insight meditation?');
    await page.keyboard.press('Enter');
    await expect(
      page.getByText('Insight meditation develops clarity and equanimity through open observation.')
    ).toBeVisible();

    // Follow-up question
    await textarea.fill('How can I practice vipassana?');
    await page.keyboard.press('Enter');
    await expect(
      page.getByText('You can practice vipassana by observing breath and body sensations moment to moment.')
    ).toBeVisible();

    // Both user questions are visible in the thread
    await expect(page.getByText('What is insight meditation?')).toBeVisible();
    await expect(page.getByText('How can I practice vipassana?')).toBeVisible();
  });
});
