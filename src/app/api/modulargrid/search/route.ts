import { NextResponse } from 'next/server';
import { isEnabled, searchModules, takeToken } from '@/lib/modulargrid';

export async function GET(req: Request) {
  if (!isEnabled()) {
    return NextResponse.json(
      { error: 'ModularGrid lookup is switched off.', disabled: true },
      { status: 503 },
    );
  }

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
  // Two characters match thousands of modules and tell nobody anything.
  if (q.length < 3) return NextResponse.json({ results: [] });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
  if (!takeToken(ip, 'search')) {
    return NextResponse.json({ error: 'Too many searches. Give it a moment.' }, { status: 429 });
  }

  try {
    return NextResponse.json({ results: await searchModules(q) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Search failed' },
      { status: 502 },
    );
  }
}
