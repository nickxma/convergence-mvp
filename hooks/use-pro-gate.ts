'use client';

import { useState, useCallback } from 'react';
import { useAuth } from '@/lib/use-auth';

export type FeatureKey =
  | 'qa_unlimited'
  | 'community_post'
  | 'dms'
  | 'wallet'
  | 'session_notes';

interface ProGateState {
  /** Whether the upgrade prompt should be shown */
  showUpgradePrompt: boolean;
  /** The feature that was gated (for contextual prompt copy) */
  gatedFeature: FeatureKey | null;
}

/**
 * useProGate
 *
 * Wraps API calls that may return 402 upgrade_required.
 * When a 402 is received, sets showUpgradePrompt=true so the UpgradePrompt
 * component (OLU-468) can be rendered.
 *
 * Usage:
 *   const { checkGate, showUpgradePrompt, gatedFeature, dismissUpgradePrompt } = useProGate();
 *
 *   // In an event handler:
 *   const allowed = await checkGate(response); // pass the fetch Response
 *   if (!allowed) return; // upgrade prompt is now showing
 *
 * Or use the provided `guardedFetch` helper to automatically check the gate:
 *   const res = await guardedFetch('/api/community/posts', { method: 'POST', ... });
 *   if (!res) return; // gate triggered, prompt shown
 */
export function useProGate() {
  const { getAccessToken } = useAuth();
  const [state, setState] = useState<ProGateState>({
    showUpgradePrompt: false,
    gatedFeature: null,
  });

  const dismissUpgradePrompt = useCallback(() => {
    setState({ showUpgradePrompt: false, gatedFeature: null });
  }, []);

  /**
   * Check a fetch Response for a 402 gate. Returns true if allowed, false if gated.
   * When gated, triggers the upgrade prompt UI.
   */
  const checkGate = useCallback(async (res: Response): Promise<boolean> => {
    if (res.status !== 402) return true;

    let feature: FeatureKey | null = null;
    try {
      const body = await res.clone().json();
      if (typeof body.feature === 'string') {
        feature = body.feature as FeatureKey;
      }
    } catch {
      // Non-fatal — we still show the prompt without knowing the feature
    }

    setState({ showUpgradePrompt: true, gatedFeature: feature });
    return false;
  }, []);

  /**
   * Convenience: perform a fetch and automatically check for the Pro gate.
   * Returns the Response if allowed, or null if the gate was triggered.
   * Automatically attaches the Privy auth token.
   */
  const guardedFetch = useCallback(
    async (url: string, init?: RequestInit): Promise<Response | null> => {
      const token = await getAccessToken();
      const headers = new Headers(init?.headers);
      if (token) headers.set('Authorization', `Bearer ${token}`);

      const res = await fetch(url, { ...init, headers });
      const allowed = await checkGate(res);
      return allowed ? res : null;
    },
    [getAccessToken, checkGate],
  );

  return {
    showUpgradePrompt: state.showUpgradePrompt,
    gatedFeature: state.gatedFeature,
    checkGate,
    guardedFetch,
    dismissUpgradePrompt,
  };
}
