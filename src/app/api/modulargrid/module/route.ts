import { NextResponse } from 'next/server';
import { fetchModule, isEnabled, slugFromInput, takeToken } from '@/lib/modulargrid';

export async function GET(req: Request) {
  if (!isEnabled()) {
    return NextResponse.json(
      { error: 'ModularGrid lookup is switched off. Set MODULARGRID_ENABLED=1 to turn it on.', disabled: true },
      { status: 503 },
    );
  }

  // Validate before spending a token. Someone typing a URL a character at a
  // time should not exhaust their budget on requests that never leave here.
  const raw = new URL(req.url).searchParams.get('q') ?? '';
  const slug = slugFromInput(raw);
  if (!slug) {
    return NextResponse.json(
      { error: 'Paste a ModularGrid module link, such as modulargrid.net/e/make-noise-maths' },
      { status: 400 },
    );
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
  if (!takeToken(ip)) {
    return NextResponse.json({ error: 'Too many requests. Give it a moment.' }, { status: 429 });
  }

  try {
    return NextResponse.json(await fetchModule(slug));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Lookup failed' },
      { status: 502 },
    );
  }
}
