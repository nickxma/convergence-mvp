/**
 * POST /api/webhooks/uptime-alert
 *
 * Accepts UptimeRobot webhook payloads (form-encoded or JSON) and logs them
 * to Sentry. Down events are captured as errors; up events as info messages.
 *
 * UptimeRobot webhook fields:
 *   monitorID, monitorURL, monitorFriendlyName, alertType (1=down, 2=up),
 *   alertTypeFriendlyName, alertDetails, monitorAlertContacts
 *
 * No auth required — UptimeRobot does not support signed payloads on the free tier.
 * The endpoint is write-only (returns no sensitive data) so this is acceptable.
 */
import * as Sentry from '@sentry/nextjs';
import { NextRequest, NextResponse } from 'next/server';

interface UptimePayload {
  monitorID?: string;
  monitorURL?: string;
  monitorFriendlyName?: string;
  /** 1 = down, 2 = up */
  alertType?: string | number;
  alertTypeFriendlyName?: string;
  alertDetails?: string;
}

async function parsePayload(req: NextRequest): Promise<UptimePayload> {
  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    try {
      return (await req.json()) as UptimePayload;
    } catch {
      return {};
    }
  }

  // UptimeRobot default: application/x-www-form-urlencoded
  try {
    const text = await req.text();
    const params = new URLSearchParams(text);
    return Object.fromEntries(params.entries()) as UptimePayload;
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const payload = await parsePayload(req);

  const {
    monitorID,
    monitorURL,
    monitorFriendlyName,
    alertType,
    alertTypeFriendlyName,
    alertDetails,
  } = payload;

  // alertType 1 = down, 2 = up (UptimeRobot convention)
  const isDown = String(alertType) === '1';
  const statusLabel = isDown ? 'DOWN' : 'UP';
  const message = `Uptime alert [${statusLabel}]: ${monitorFriendlyName ?? monitorURL ?? 'unknown monitor'}`;

  Sentry.withScope((scope) => {
    scope.setTag('uptime.monitorId', monitorID ?? 'unknown');
    scope.setTag('uptime.status', statusLabel);
    scope.setContext('uptime_alert', {
      monitorID,
      monitorURL,
      monitorFriendlyName,
      alertType,
      alertTypeFriendlyName,
      alertDetails,
    });

    if (isDown) {
      scope.setLevel('error');
      Sentry.captureMessage(message, 'error');
    } else {
      scope.setLevel('info');
      Sentry.captureMessage(message, 'info');
    }
  });

  return NextResponse.json({ ok: true });
}
