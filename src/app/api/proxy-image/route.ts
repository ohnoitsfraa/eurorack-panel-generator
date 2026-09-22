import { NextResponse } from 'next/server';
import { isPrivateHost } from '@/lib/net';

/**
 * Fetch a remote image so the canvas can read its pixels.
 *
 * Detection needs getImageData, which taints on a cross-origin image unless
 * the far end sends CORS headers. Most image hosts do not, so we relay the
 * bytes from same-origin instead.
 */

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('url');
  if (!raw) return NextResponse.json({ error: 'Missing url' }, { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: 'Malformed URL' }, { status: 400 });
  }

  // Refuse anything that is not plain public HTTP(S). Without this the route
  // is an open door onto the host's private network.
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return NextResponse.json({ error: 'Only http and https are supported' }, { status: 400 });
  }
  if (isPrivateHost(target.hostname)) {
    return NextResponse.json({ error: 'That address is not reachable' }, { status: 400 });
  }

  try {
    const res = await fetch(target, {
      headers: { 'User-Agent': 'EurorackPanelGenerator/0.1 (+image fetch)', Accept: 'image/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Source returned ${res.status}` }, { status: 502 });
    }

    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.includes(type)) {
      return NextResponse.json({ error: `That URL is not an image (${type || 'unknown'})` }, { status: 415 });
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: 'Image is too large (25 MB limit)' }, { status: 413 });
    }

    return new NextResponse(buf, {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Could not reach that URL' }, { status: 502 });
  }
}
