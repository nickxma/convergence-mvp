/**
 * POST /api/webhooks/deploy
 *
 * Receives Vercel deployment event webhooks and sends a notification email
 * (via Resend) or Slack message when a production deploy completes or fails.
 *
 * Security: Validates x-vercel-signature HMAC-SHA1 using VERCEL_WEBHOOK_SECRET.
 * Unsigned requests are rejected with 401.
 *
 * Notification routing:
 *   - If SLACK_WEBHOOK_URL is set → post to Slack
 *   - Otherwise → send email via Resend to ADMIN_EMAIL
 *
 * Vercel webhook docs:
 *   https://vercel.com/docs/observability/webhooks-overview/webhooks-api
 *
 * Registration:
 *   Vercel dashboard → Settings → Webhooks → Add
 *   URL: https://convergence-mvp.vercel.app/api/webhooks/deploy
 *   Events: deployment.succeeded, deployment.error, deployment.canceled
 */
import { Resend } from 'resend';
import { NextRequest, NextResponse } from 'next/server';
import { verifyVercelSignature } from '@/lib/webhook-verify';

// ── Vercel webhook payload (partial) ─────────────────────────────────────────

interface VercelDeployment {
  id: string;
  name: string;
  url: string;
  inspectorUrl?: string;
  meta?: {
    githubCommitSha?: string;
    githubCommitMessage?: string;
    githubCommitRef?: string;
  };
}

interface VercelWebhookPayload {
  type: string;
  payload: {
    deployment: VercelDeployment;
    target?: string; // "production" | "preview" | undefined
    error?: { message?: string; code?: string };
  };
}

// ── Notification helpers ──────────────────────────────────────────────────────

async function notifySlack(webhookUrl: string, text: string): Promise<void> {
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

async function notifyEmail(subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!apiKey || !adminEmail) {
    console.error('[deploy-webhook] Missing RESEND_API_KEY or ADMIN_EMAIL — skipping email');
    return;
  }

  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: 'Convergence MVP <noreply@convergence-mvp.app>',
    to: adminEmail,
    subject,
    html,
  });
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.VERCEL_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[deploy-webhook] VERCEL_WEBHOOK_SECRET is not configured');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const rawBody = await req.text();

  const signature = req.headers.get('x-vercel-signature') ?? '';
  if (!verifyVercelSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let event: VercelWebhookPayload;
  try {
    event = JSON.parse(rawBody) as VercelWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { type, payload } = event;
  const { deployment, target, error } = payload ?? {};

  // Only notify for production deployments
  if (target && target !== 'production') {
    return NextResponse.json({ ok: true, skipped: 'non-production' });
  }

  const deployUrl = deployment?.url ? `https://${deployment.url}` : '';
  const inspectorUrl = deployment?.inspectorUrl ?? '';
  const sha = deployment?.meta?.githubCommitSha?.slice(0, 7) ?? '';
  const commitMsg = deployment?.meta?.githubCommitMessage ?? '';
  const branch = deployment?.meta?.githubCommitRef ?? '';

  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;

  if (type === 'deployment.succeeded') {
    const details = [
      sha && `commit: \`${sha}\``,
      commitMsg && `"${commitMsg}"`,
      branch && `branch: \`${branch}\``,
      deployUrl && `url: ${deployUrl}`,
    ]
      .filter(Boolean)
      .join(' · ');

    if (slackWebhookUrl) {
      await notifySlack(slackWebhookUrl, `✅ *Convergence MVP deployed* — ${details}`);
    } else {
      await notifyEmail(
        '✅ Convergence MVP deployed',
        `<p><strong>Deploy succeeded.</strong></p>
<ul>
  ${sha ? `<li>Commit: <code>${sha}</code></li>` : ''}
  ${commitMsg ? `<li>Message: ${commitMsg}</li>` : ''}
  ${branch ? `<li>Branch: <code>${branch}</code></li>` : ''}
  ${deployUrl ? `<li>URL: <a href="${deployUrl}">${deployUrl}</a></li>` : ''}
  ${inspectorUrl ? `<li><a href="${inspectorUrl}">View deployment</a></li>` : ''}
</ul>`,
      );
    }
  } else if (type === 'deployment.error' || type === 'deployment.canceled') {
    const errorMsg = error?.message ?? type;
    const label = type === 'deployment.canceled' ? '⚠️ Deploy canceled' : '❌ Deploy failed';

    if (slackWebhookUrl) {
      await notifySlack(
        slackWebhookUrl,
        `${label} *Convergence MVP* — ${errorMsg}${inspectorUrl ? ` · <${inspectorUrl}|View logs>` : ''}`,
      );
    } else {
      await notifyEmail(
        `${label} — Convergence MVP`,
        `<p><strong>${label}.</strong></p>
<ul>
  <li>Error: ${errorMsg}</li>
  ${sha ? `<li>Commit: <code>${sha}</code></li>` : ''}
  ${inspectorUrl ? `<li><a href="${inspectorUrl}">View logs</a></li>` : ''}
</ul>`,
      );
    }
  }
  // Other event types (deployment.created, deployment.ready, etc.) are silently acknowledged

  return NextResponse.json({ ok: true });
}
