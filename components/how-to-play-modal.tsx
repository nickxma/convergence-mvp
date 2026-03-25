'use client';

/**
 * HowToPlayModal
 *
 * First-time onboarding modal for OpenClaw players.
 * - Auto-shown on first visit to /play (tracked via localStorage key `openclaw_howto_seen`)
 * - Accessible any time via the Help button on the play page
 * - 3 panels: (1) claw demo video, (2) control guide, (3) tips + credit reminder
 * - Next/Back navigation, close X on all panels
 *
 * Usage:
 *   <HowToPlayModal open={open} onClose={() => setOpen(false)} />
 */

import { useState, useEffect, useCallback } from 'react';

export const HOW_TO_PLAY_STORAGE_KEY = 'openclaw_howto_seen';

// ── D-pad diagram ──────────────────────────────────────────────────────────────

function DPadDiagram() {
  const btnBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'rgba(59,130,246,0.25)',
    color: '#93c5fd',
    fontWeight: 700,
    fontSize: 18,
    userSelect: 'none',
  };

  const arrowBtn: React.CSSProperties = {
    ...btnBase,
    width: 44,
    height: 44,
  };

  const dropBtn: React.CSSProperties = {
    ...btnBase,
    width: 44,
    height: 44,
    borderRadius: '50%',
    background: 'rgba(239,68,68,0.25)',
    color: '#fca5a5',
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.04em',
  };

  const empty: React.CSSProperties = { width: 44, height: 44 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '44px 44px 44px',
          gridTemplateRows: '44px 44px 44px',
          gap: 6,
        }}
      >
        <div style={empty} />
        <div style={arrowBtn}>▲</div>
        <div style={empty} />

        <div style={arrowBtn}>◄</div>
        <div style={dropBtn}>DROP</div>
        <div style={arrowBtn}>►</div>

        <div style={empty} />
        <div style={arrowBtn}>▼</div>
        <div style={empty} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>
          Keyboard: Arrow keys to move · Space or Enter to drop
        </div>
        <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>
          Mobile: Tap the on-screen buttons
        </div>
      </div>
    </div>
  );
}

// ── Claw demo animation ────────────────────────────────────────────────────────

function ClawDemo() {
  const [phase, setPhase] = useState<'idle' | 'moving' | 'dropping' | 'grabbing' | 'lifting'>('idle');
  const [clawX, setClawX] = useState(50); // percent
  const [clawY, setClawY] = useState(15); // percent

  useEffect(() => {
    const seq = async () => {
      // idle → moving right
      setPhase('moving');
      for (let x = 50; x <= 68; x += 2) {
        await delay(60);
        setClawX(x);
      }
      // moving → dropping
      setPhase('dropping');
      for (let y = 15; y <= 52; y += 3) {
        await delay(50);
        setClawY(y);
      }
      // dropping → grabbing
      setPhase('grabbing');
      await delay(600);
      // grabbing → lifting
      setPhase('lifting');
      for (let y = 52; y >= 15; y -= 3) {
        await delay(50);
        setClawY(y);
      }
      // reset
      setPhase('idle');
      setClawX(50);
      await delay(1200);
    };

    let cancelled = false;
    const loop = async () => {
      while (!cancelled) {
        await seq();
      }
    };
    loop();
    return () => { cancelled = true; };
  }, []);

  const isGrabbing = phase === 'grabbing' || phase === 'lifting';

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: 280,
        height: 180,
        background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.08)',
        overflow: 'hidden',
        margin: '0 auto',
      }}
    >
      {/* Rail at top */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: '10%',
          right: '10%',
          height: 4,
          background: '#334155',
          borderRadius: 2,
        }}
      />

      {/* Claw arm (wire) */}
      <div
        style={{
          position: 'absolute',
          top: 18,
          left: `${clawX}%`,
          width: 2,
          height: `${clawY}%`,
          background: '#475569',
          transform: 'translateX(-50%)',
          transition: 'left 0.06s linear',
        }}
      />

      {/* Claw head */}
      <div
        style={{
          position: 'absolute',
          top: `calc(18px + ${clawY}%)`,
          left: `${clawX}%`,
          transform: 'translate(-50%, 0)',
          transition: 'left 0.06s linear',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {/* Claw prongs */}
        <div style={{ display: 'flex', gap: isGrabbing ? 2 : 10, transition: 'gap 0.2s' }}>
          <div
            style={{
              width: 3,
              height: 14,
              background: '#94a3b8',
              borderRadius: '0 0 3px 3px',
              transform: isGrabbing ? 'rotate(-20deg)' : 'rotate(-35deg)',
              transformOrigin: 'top center',
              transition: 'transform 0.2s',
            }}
          />
          <div
            style={{
              width: 3,
              height: 14,
              background: '#94a3b8',
              borderRadius: '0 0 3px 3px',
              transform: 'rotate(0deg)',
            }}
          />
          <div
            style={{
              width: 3,
              height: 14,
              background: '#94a3b8',
              borderRadius: '0 0 3px 3px',
              transform: isGrabbing ? 'rotate(20deg)' : 'rotate(35deg)',
              transformOrigin: 'top center',
              transition: 'transform 0.2s',
            }}
          />
        </div>
      </div>

      {/* Prize items */}
      {[
        { x: '20%', label: '🧸' },
        { x: '40%', label: '🎮' },
        { x: '65%', label: '⭐' },
        { x: '80%', label: '🎁' },
      ].map((prize) => (
        <div
          key={prize.x}
          style={{
            position: 'absolute',
            bottom: 16,
            left: prize.x,
            fontSize: 20,
            transform: 'translateX(-50%)',
            opacity: isGrabbing && prize.x === '65%' ? 0 : 1,
            transition: 'opacity 0.3s',
          }}
        >
          {prize.label}
        </div>
      ))}

      {/* Grabbed prize (lifting) */}
      {phase === 'lifting' && (
        <div
          style={{
            position: 'absolute',
            top: `calc(18px + ${clawY}% + 16px)`,
            left: `${clawX}%`,
            fontSize: 18,
            transform: 'translateX(-50%)',
            transition: 'left 0.06s linear',
          }}
        >
          ⭐
        </div>
      )}

      {/* Phase label */}
      <div
        style={{
          position: 'absolute',
          bottom: 6,
          right: 10,
          fontSize: 10,
          color: '#475569',
          fontFamily: 'monospace',
        }}
      >
        {phase === 'moving' && 'moving →'}
        {phase === 'dropping' && 'dropping ↓'}
        {phase === 'grabbing' && 'grabbing ✓'}
        {phase === 'lifting' && 'lifting ↑'}
      </div>
    </div>
  );
}

function delay(ms: number) {
  return new Promise<void>((res) => setTimeout(res, ms));
}

// ── Panels ────────────────────────────────────────────────────────────────────

const PANELS = [
  {
    title: 'How to play',
    subtitle: 'Control the claw to grab a prize',
  },
  {
    title: 'Controls',
    subtitle: 'Move the claw, then drop it on your prize',
  },
  {
    title: 'Tips & credits',
    subtitle: 'Maximize your chances',
  },
];

// ── Modal ─────────────────────────────────────────────────────────────────────

export function HowToPlayModal({
  open,
  onClose,
  creditCost = 1,
}: {
  open: boolean;
  onClose: () => void;
  creditCost?: number;
}) {
  const [panel, setPanel] = useState(0);

  // Reset to first panel when reopened
  useEffect(() => {
    if (open) setPanel(0);
  }, [open]);

  const handleClose = useCallback(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(HOW_TO_PLAY_STORAGE_KEY, '1');
    }
    onClose();
  }, [onClose]);

  const handleNext = useCallback(() => {
    if (panel < PANELS.length - 1) {
      setPanel((p) => p + 1);
    } else {
      handleClose();
    }
  }, [panel, handleClose]);

  const handleBack = useCallback(() => {
    setPanel((p) => Math.max(0, p - 1));
  }, []);

  if (!open) return null;

  const isLast = panel === PANELS.length - 1;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        zIndex: 300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={handleClose}
    >
      <div
        style={{
          background: 'linear-gradient(145deg, #1e293b, #0f172a)',
          border: '1px solid rgba(249,115,22,0.25)',
          borderRadius: 20,
          padding: '28px 24px 24px',
          maxWidth: 380,
          width: '100%',
          position: 'relative',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 12,
            right: 14,
            background: 'none',
            border: 'none',
            color: '#475569',
            fontSize: 22,
            cursor: 'pointer',
            lineHeight: 1,
            padding: 4,
          }}
        >
          ×
        </button>

        {/* Panel indicators */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            justifyContent: 'center',
            marginBottom: 20,
          }}
        >
          {PANELS.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === panel ? 20 : 6,
                height: 6,
                borderRadius: 3,
                background: i === panel ? '#f97316' : '#334155',
                transition: 'width 0.2s, background 0.2s',
              }}
            />
          ))}
        </div>

        {/* Header */}
        <div style={{ marginBottom: 20, textAlign: 'center' }}>
          <h2
            style={{
              margin: '0 0 4px',
              fontSize: 20,
              fontWeight: 700,
              color: '#f8fafc',
            }}
          >
            {PANELS[panel].title}
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>
            {PANELS[panel].subtitle}
          </p>
        </div>

        {/* Panel content */}
        {panel === 0 && (
          <div style={{ marginBottom: 24 }}>
            <ClawDemo />
            <p
              style={{
                margin: '14px 0 0',
                fontSize: 13,
                color: '#94a3b8',
                textAlign: 'center',
                lineHeight: 1.5,
              }}
            >
              Guide the claw over a prize, then hit{' '}
              <strong style={{ color: '#f87171' }}>DROP</strong> to grab it.
              Each drop costs 1 credit. Win the grab and the prize ships to you!
            </p>
          </div>
        )}

        {panel === 1 && (
          <div style={{ marginBottom: 24 }}>
            <DPadDiagram />
            <div
              style={{
                marginTop: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {[
                { icon: '▲ ▼ ◄ ►', label: 'Move the claw' },
                { icon: 'DROP', label: 'Lower claw and attempt grab', red: true },
                { icon: '⌨', label: 'Arrow keys + Space/Enter on desktop' },
              ].map(({ icon, label, red }) => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 12px',
                    background: 'rgba(255,255,255,0.04)',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <span
                    style={{
                      minWidth: 40,
                      fontSize: 12,
                      fontWeight: 800,
                      color: red ? '#f87171' : '#93c5fd',
                      textAlign: 'center',
                    }}
                  >
                    {icon}
                  </span>
                  <span style={{ fontSize: 13, color: '#94a3b8' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {panel === 2 && (
          <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              {
                emoji: '🎯',
                tip: 'Position the claw directly over the prize before dropping.',
              },
              {
                emoji: '⏱',
                tip: 'Sessions are timed — each credit buys one drop attempt.',
              },
              {
                emoji: '🪙',
                tip: `Each drop costs ${creditCost} credit. Buy more credits if you run out.`,
              },
              {
                emoji: '👀',
                tip: 'Watch returning players in the recent wins ticker for prize locations.',
              },
            ].map(({ emoji, tip }) => (
              <div
                key={tip}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  padding: '10px 12px',
                  background: 'rgba(255,255,255,0.04)',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <span style={{ fontSize: 18, flexShrink: 0 }}>{emoji}</span>
                <span style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>{tip}</span>
              </div>
            ))}
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: 'flex', gap: 10 }}>
          {panel > 0 && (
            <button
              onClick={handleBack}
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 10,
                padding: '12px 0',
                color: '#94a3b8',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ← Back
            </button>
          )}
          <button
            onClick={handleNext}
            style={{
              flex: panel > 0 ? 2 : 1,
              background: isLast
                ? 'linear-gradient(135deg, #f97316, #ea580c)'
                : 'linear-gradient(135deg, #3b82f6, #2563eb)',
              border: 'none',
              borderRadius: 10,
              padding: '12px 0',
              color: '#fff',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: isLast
                ? '0 4px 12px rgba(249,115,22,0.35)'
                : '0 4px 12px rgba(59,130,246,0.35)',
            }}
          >
            {isLast ? "Let's play! 🎮" : 'Next →'}
          </button>
        </div>

        {/* Skip hint on first panel */}
        {panel === 0 && (
          <button
            onClick={handleClose}
            style={{
              display: 'block',
              margin: '12px auto 0',
              background: 'none',
              border: 'none',
              color: '#475569',
              fontSize: 12,
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            Skip tutorial
          </button>
        )}
      </div>
    </div>
  );
}
