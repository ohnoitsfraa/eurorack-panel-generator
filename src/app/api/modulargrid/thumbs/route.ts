import { NextResponse } from 'next/server';
import { isEnabled, takeToken, thumbsFor } from '@/lib/modulargrid';

/** No more than one list of results' worth in a single request. */
const MAX_SLUGS = 12;

/**
 * Panel shots for a list of search results.
 *
 * Separate from the search itself because the search is free — it runs against
 * an index already in memory — while this costs a page fetch for every module
 * nobody has asked about yet. Keeping them apart means results appear at once
 * and fill in afterwards, rather than the whole list waiting on the slowest
 * picture.
 */
export async function GET(req: Request) {
  if (!isEnabled()) {
    return NextResponse.json({ error: 'ModularGrid lookup is switched off.', disabled: true }, { status: 503 });
  }

  const raw = new URL(req.url).searchParams.get('slugs') ?? '';
  const slugs = [...new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))]
    .filter((s) => /^[a-z0-9][a-z0-9-]{2,120}$/.test(s))
    .slice(0, MAX_SLUGS);
  if (slugs.length === 0) return NextResponse.json({ thumbs: [] });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
  if (!takeToken(ip, 'thumbs')) {
    // Not an error the user needs to see: the list is perfectly usable with
    // names alone, so the caller treats this as "no pictures this time".
    return NextResponse.json({ thumbs: [] });
  }

  try {
    return NextResponse.json({ thumbs: await thumbsFor(slugs) });
  } catch {
    return NextResponse.json({ thumbs: [] });
  }
}
