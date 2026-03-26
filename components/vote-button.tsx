'use client';

interface VoteButtonProps {
  votes: number;
  userVote: 'up' | 'down' | null;
  onVote: (direction: 'up' | 'down') => void;
  disabled?: boolean;
  pending?: boolean;
  size?: 'sm' | 'md';
}

export function VoteButton({
  votes,
  userVote,
  onVote,
  disabled = false,
  pending = false,
  size = 'md',
}: VoteButtonProps) {
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';
  const isDisabled = disabled || pending;

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onVote('up')}
        disabled={isDisabled}
        aria-label="Upvote"
        className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded transition-colors disabled:cursor-not-allowed"
        style={{
          color: userVote === 'up' ? '#5a6b52' : '#9c9080',
          background: userVote === 'up' ? '#d4e6cc' : 'transparent',
          opacity: pending ? 0.5 : undefined,
        }}
      >
        <svg
          className={iconSize}
          fill={userVote === 'up' ? 'currentColor' : 'none'}
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
        </svg>
      </button>

      {pending ? (
        <span className={`${textSize} tabular-nums font-medium min-w-[1.5rem] text-center`} style={{ color: '#9c9080' }}>
          <svg
            className={`${iconSize} animate-spin mx-auto`}
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="8" strokeLinecap="round" />
          </svg>
        </span>
      ) : (
        <span
          className={`${textSize} tabular-nums font-medium min-w-[1.5rem] text-center`}
          style={{ color: votes > 0 ? '#5a6b52' : votes < 0 ? '#c0392b' : '#9c9080' }}
        >
          {votes}
        </span>
      )}

      <button
        onClick={() => onVote('down')}
        disabled={isDisabled}
        aria-label="Downvote"
        className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded transition-colors disabled:cursor-not-allowed"
        style={{
          color: userVote === 'down' ? '#c0392b' : '#9c9080',
          background: userVote === 'down' ? '#fde8e6' : 'transparent',
          opacity: pending ? 0.5 : undefined,
        }}
      >
        <svg
          className={iconSize}
          fill={userVote === 'down' ? 'currentColor' : 'none'}
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3" />
        </svg>
      </button>
    </div>
  );
}
