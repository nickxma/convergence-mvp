'use client';

import { useState } from 'react';

const ONBOARDING_KEY_PREFIX = 'convergence_onboarding_';

export function hasSeenOnboarding(userId: string): boolean {
  try {
    return localStorage.getItem(`${ONBOARDING_KEY_PREFIX}${userId}`) === 'true';
  } catch {
    return true; // fail safe — don't block if storage unavailable
  }
}

export function markOnboardingSeen(userId: string): void {
  try {
    localStorage.setItem(`${ONBOARDING_KEY_PREFIX}${userId}`, 'true');
  } catch {
    // ignore
  }
}

const STEPS = [
  {
    title: 'Welcome to the Knowledge Commons',
    body: 'A token-governed space for Acceptance Pass holders to explore mindfulness, share insights, and shape the community together.',
    icon: (
      <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
      </svg>
    ),
  },
  {
    title: 'How voting works',
    body: 'Upvote posts and replies that add real value. Token-weighted governance means your voice as a pass holder shapes what rises to the top.',
    icon: (
      <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.25c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 0 1 2.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 0 0 .322-1.672V2.75a.75.75 0 0 1 .75-.75 2.25 2.25 0 0 1 2.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558.107 1.282.725 1.282m0 0h3.126c1.026 0 1.945.694 2.054 1.715.045.422.068.85.068 1.285a11.95 11.95 0 0 1-2.649 7.521c-.388.482-.987.729-1.605.729H13.48c-.483 0-.964-.078-1.423-.23l-3.114-1.04a4.501 4.501 0 0 0-1.423-.23H5.904m10.598-9.75H14.25M5.904 18.5c.083.205.173.405.27.602.197.4-.078.898-.523.898h-.908c-.889 0-1.713-.518-1.972-1.368a12 12 0 0 1-.521-3.507c0-1.553.295-3.036.831-4.398C3.387 9.953 4.167 9.5 5 9.5h1.053c.472 0 .745.556.5.96a8.958 8.958 0 0 0-1.302 4.665c0 1.194.232 2.333.654 3.375Z" />
      </svg>
    ),
  },
  {
    title: 'Create your first post',
    body: 'Share a question, insight, or practice note with the community. Only pass holders can post — every voice here is vetted.',
    cta: 'Create a post',
    icon: (
      <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
      </svg>
    ),
  },
];

interface OnboardingModalProps {
  userId: string;
  onClose: () => void;
  onCreatePost: () => void;
}

export function OnboardingModal({ userId, onClose, onCreatePost }: OnboardingModalProps) {
  const [step, setStep] = useState(0);
  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  function dismiss() {
    markOnboardingSeen(userId);
    onClose();
  }

  function next() {
    if (isLast) {
      markOnboardingSeen(userId);
      onClose();
      onCreatePost();
    } else {
      setStep((s) => s + 1);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)' }}
    >
      <div
        className="w-full max-w-md rounded-2xl flex flex-col"
        style={{ background: '#faf8f3', boxShadow: '0 24px 64px rgba(0,0,0,0.18)' }}
      >
        {/* Progress + close */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: '#e0d8cc' }}
        >
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className="rounded-full transition-all duration-200"
                style={{
                  width: i === step ? 22 : 6,
                  height: 6,
                  background: i === step ? '#7d8c6e' : i < step ? '#b8ccb0' : '#e0d8cc',
                }}
              />
            ))}
          </div>
          <button
            onClick={dismiss}
            className="p-1 rounded-lg"
            style={{ color: '#9c9080' }}
            aria-label="Skip onboarding"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-8 text-center">
          <div className="flex justify-center mb-5" style={{ color: '#7d8c6e' }}>
            {current.icon}
          </div>
          <h2 className="text-base font-semibold mb-3" style={{ color: '#3d4f38' }}>
            {current.title}
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: '#7d8c6e' }}>
            {current.body}
          </p>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-5 py-4 border-t"
          style={{ borderColor: '#e0d8cc' }}
        >
          <button
            onClick={dismiss}
            className="text-xs px-4 py-2 rounded-full"
            style={{ color: '#9c9080' }}
          >
            Skip
          </button>
          <button
            onClick={next}
            className="text-xs px-5 py-2 rounded-full font-medium"
            style={{ background: '#7d8c6e', color: '#fff' }}
          >
            {isLast ? (current.cta ?? 'Get started') : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}
