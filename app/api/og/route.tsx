import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'

export const runtime = 'edge'

async function loadFont(family: string, weight: 400 | 700): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`,
      {
        headers: {
          // Older UA requests TTF format, which satori supports
          'User-Agent': 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1; SV1)',
        },
      }
    ).then((r) => r.text())

    const match = css.match(/url\(([^)]+\.ttf)\)/)
    if (!match) return null

    return fetch(match[1]).then((r) => r.arrayBuffer())
  } catch {
    return null
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  // Break at last word boundary before max
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…'
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const q = truncate(searchParams.get('q') ?? 'Ask anything about mindfulness', 140)
  const a = truncate(searchParams.get('a') ?? '', 200)

  const [regular, bold] = await Promise.all([
    loadFont('Lora', 400),
    loadFont('Lora', 700),
  ])

  type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900
  const fonts: { name: string; data: ArrayBuffer; weight: FontWeight; style: 'normal' }[] = []
  if (regular) fonts.push({ name: 'Lora', data: regular, weight: 400, style: 'normal' })
  if (bold) fonts.push({ name: 'Lora', data: bold, weight: 700, style: 'normal' })

  const fontFamily = fonts.length > 0 ? 'Lora' : 'Georgia, serif'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#faf8f4',
          padding: '56px 72px',
          fontFamily,
        }}
      >
        {/* Wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 32 }}>
          <span
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: '#7d8c6e',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          >
            Convergence
          </span>
        </div>

        {/* Divider */}
        <div
          style={{
            display: 'flex',
            width: 40,
            height: 2,
            background: '#b0c4a8',
            marginBottom: 40,
          }}
        />

        {/* Question */}
        <div style={{ display: 'flex', flex: 1, alignItems: 'flex-start' }}>
          <p
            style={{
              fontSize: 52,
              fontWeight: 700,
              color: '#2c2c2c',
              lineHeight: 1.2,
              margin: 0,
              maxWidth: 1000,
            }}
          >
            {q}
          </p>
        </div>

        {/* Answer excerpt */}
        {a && (
          <div style={{ display: 'flex', marginTop: 28 }}>
            <p
              style={{
                fontSize: 26,
                fontWeight: 400,
                color: '#5c5248',
                lineHeight: 1.55,
                margin: 0,
                maxWidth: 960,
              }}
            >
              {a}
            </p>
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            marginTop: 44,
          }}
        >
          <span style={{ fontSize: 18, color: '#7d8c6e', letterSpacing: '0.02em' }}>
            convergence-mvp.vercel.app
          </span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
      ...(fonts.length > 0 && { fonts }),
    }
  )
}
