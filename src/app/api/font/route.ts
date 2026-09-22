import { NextResponse } from 'next/server';
import { FONT_FAMILIES } from '@/lib/fonts';

/**
 * Resolve a Google Font to a TrueType file.
 *
 * This has to happen server-side. The Google Fonts CSS endpoint picks a format
 * from the User-Agent, and a browser's own UA gets woff2, which opentype.js
 * cannot parse. Sending our own identifier gets TrueType back. A browser
 * cannot set User-Agent on a fetch, hence the detour.
 */

const ALLOWED = new Set<string>(FONT_FAMILIES);

/**
 * Our own identifier, which the CSS API answers with a truetype `src`.
 *
 * Spoofing an ancient browser looks like the trick to use here but does the
 * opposite: those UAs get routed to the EOT-era endpoint, which returns an
 * extension-less URL rather than a .ttf.
 */
const UA = 'Panelmate/0.1 (+font resolution)';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const family = searchParams.get('family') ?? '';
  const weight = Number(searchParams.get('weight') ?? 400);

  // Only serve from a fixed list, so this cannot be pointed at arbitrary hosts.
  if (!ALLOWED.has(family)) {
    return NextResponse.json({ error: `Unknown font family "${family}"` }, { status: 400 });
  }
  if (!Number.isFinite(weight) || weight < 100 || weight > 900) {
    return NextResponse.json({ error: 'Invalid weight' }, { status: 400 });
  }

  const cssUrl =
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`;

  try {
    const cssRes = await fetch(cssUrl, {
      headers: { 'User-Agent': UA },
      next: { revalidate: 60 * 60 * 24 * 30 },
    });
    if (!cssRes.ok) {
      return NextResponse.json({ error: `Font lookup failed (${cssRes.status})` }, { status: 502 });
    }
    const css = await cssRes.text();
    const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.ttf)\)/);
    if (!match) {
      return NextResponse.json(
        { error: `No TrueType build of "${family}" at weight ${weight}` },
        { status: 404 },
      );
    }

    const fontRes = await fetch(match[1], { next: { revalidate: 60 * 60 * 24 * 365 } });
    if (!fontRes.ok) {
      return NextResponse.json({ error: 'Font download failed' }, { status: 502 });
    }

    return new NextResponse(await fontRes.arrayBuffer(), {
      headers: {
        'Content-Type': 'font/ttf',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Font service unreachable' }, { status: 502 });
  }
}
