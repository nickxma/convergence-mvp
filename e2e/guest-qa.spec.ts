/**
 * E2E smoke test: Guest Q&A flow.
 *
 * Covers:
 *   1. Unauthenticated visitor asks a question, sees answer + citation panel + remaining count
 *   2. After 3 free questions, 4th question triggers guest-limit 402 → Connect wallet CTA
 *
 * Auth strategy: window.__PRIVY_MOCK is injected with authenticated: false so
 * MockAuthBridge treats the user as a guest. All /api/ask calls are intercepted
 * so no live backend is needed.
 */

import { test, expect, type Page } from '@playwright/test';

function injectNoAuth(page: Page) {
  return page.addInitScript(`
    window.__PRIVY_MOCK = {
      ready: true,
      authenticated: false,
      user: null,
      getAccessToken: function() { return Promise.resolve(null); }
    };
    // Pre-dismiss the onboarding so it doesn't obscure UI
    try { localStorage.setItem('wu_onboarding_seen', '1'); } catch(e) {}
  `);
}

/** Fulfills /api/questions/suggest with an empty list so suggestions never interfere. */
async function stubSuggestions(page: Page) {
  await page.route('**/api/questions/suggest*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: [] }) })
  );
}

test.describe('Guest Q&A flow', () => {
  test('1. Guest asks a question and sees answer with citations and remaining count', async ({ page }) => {
    await injectNoAuth(page);
    await stubSuggestions(page);

    await page.route('**/api/ask*', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'Mindfulness is the practice of present-moment awareness without judgment.',
          sources: [
            { text: 'The present moment is all we have.', speaker: 'Thich Nhat Hanh', source: 'The Miracle of Mindfulness' },
            { text: 'Awareness is not a thing but a process.', speaker: 'Jon Kabat-Zinn', source: 'Wherever You Go, There You Are' },
          ],
          guestQueriesRemaining: 2,
          answerId: 'guest-answer-1',
        }),
      });
    });

    await page.goto('/qa');

    // Guest mode banner shows default "3 free questions" copy
    await expect(page.getByText(/3 free questions/)).toBeVisible();

    // Type a question and submit
    const textarea = page.getByPlaceholder('Ask a question…');
    await expect(textarea).toBeVisible();
    await textarea.fill('What is mindfulness?');
    await page.keyboard.press('Enter');

    // Answer text appears
    await expect(page.getByText('Mindfulness is the practice of present-moment awareness without judgment.')).toBeVisible();

    // Citation panel button visible (2 sources → "2 citations")
    await expect(page.getByText(/2 citations/)).toBeVisible();

    // Remaining count decrements from "3 free" to "2 remaining"
    await expect(page.getByText(/2 questions remaining/)).toBeVisible();
  });

  test('2. After 3 questions, 4th question shows Connect wallet CTA', async ({ page }) => {
    await injectNoAuth(page);
    await stubSuggestions(page);

    let questionCount = 0;

    await page.route('**/api/ask*', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      questionCount++;
      if (questionCount <= 3) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            answer: `Answer number ${questionCount}.`,
            sources: [],
            guestQueriesRemaining: Math.max(0, 3 - questionCount),
          }),
        });
      } else {
        // 402 signals guest limit reached
        await route.fulfill({ status: 402, body: '' });
      }
    });

    await page.goto('/qa');

    const textarea = page.getByPlaceholder('Ask a question…');

    // Ask 3 questions — each gets a 200 response
    for (let i = 1; i <= 3; i++) {
      await textarea.fill(`Question ${i}`);
      await page.keyboard.press('Enter');
      await expect(page.getByText(`Answer number ${i}.`)).toBeVisible();
    }

    // 4th question hits the guest limit (402 response)
    await textarea.fill('Question 4');
    await page.keyboard.press('Enter');

    // Wallet-connect CTA appears
    await expect(page.getByText("You've used all 3 free questions")).toBeVisible();
    await expect(page.getByRole('button', { name: /Connect wallet/i })).toBeVisible();

    // Submit button is disabled after limit is reached
    await expect(textarea).toBeDisabled();
  });
});
