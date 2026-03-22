'use client';

/**
 * WalletAvatar — deterministic SVG avatar generated from a wallet address.
 * No external dependencies. Uses a simple hash to produce a consistent
 * 5×5 blockie pattern in the project's sage/cream palette.
 */

const PALETTE = [
  '#7d8c6e', // sage-400
  '#5a6b52', // sage-600
  '#3d4f38', // sage-800
  '#b8ccb0', // sage-200
  '#e8e0d5', // cream-200
];

function hashAddress(address: string): number[] {
  const normalized = address.toLowerCase().replace('0x', '');
  const nums: number[] = [];
  for (let i = 0; i < normalized.length; i++) {
    nums.push(parseInt(normalized[i], 16));
  }
  return nums;
}

function makeBlockieColors(address: string) {
  const hash = hashAddress(address);
  const color = PALETTE[hash[0] % PALETTE.length];
  const bg = PALETTE[(hash[1] + 2) % PALETTE.length];
  const spotColor = PALETTE[(hash[2] + 4) % PALETTE.length];

  // 5×5 grid, mirrored left-right
  const cells: boolean[] = [];
  for (let i = 0; i < 15; i++) {
    cells.push(hash[i % hash.length] % 2 === 0);
  }

  // Mirror: columns 0-4, rows 0-4
  const grid: boolean[][] = [];
  for (let row = 0; row < 5; row++) {
    const r: boolean[] = [];
    for (let col = 0; col < 5; col++) {
      const idx = col < 3 ? row * 3 + col : row * 3 + (4 - col);
      r.push(cells[idx % cells.length]);
    }
    grid.push(r);
  }

  return { color, bg, spotColor, grid };
}

interface WalletAvatarProps {
  address: string;
  size?: number;
  className?: string;
}

export function WalletAvatar({ address, size = 48, className }: WalletAvatarProps) {
  const { color, bg, grid } = makeBlockieColors(address);
  const cellSize = size / 5;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      style={{ borderRadius: '50%', display: 'block', flexShrink: 0 }}
      aria-label={`Avatar for ${address}`}
    >
      <rect width={size} height={size} fill={bg} />
      {grid.map((row, rowIdx) =>
        row.map((filled, colIdx) =>
          filled ? (
            <rect
              key={`${rowIdx}-${colIdx}`}
              x={colIdx * cellSize}
              y={rowIdx * cellSize}
              width={cellSize}
              height={cellSize}
              fill={color}
            />
          ) : null
        )
      )}
    </svg>
  );
}
