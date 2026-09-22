import { NextResponse } from 'next/server';
import {
  fetchModule, isEnabled, looksLikeLink, slugFromInput, slugFromName, takeToken,
} from '@/lib/modulargrid';

export async function GET(req: Request) {
  if (!isEnabled()) {
    return NextResponse.json(
      { error: 'ModularGrid lookup is switched off. Set MODULARGRID_ENABLED=1 to turn it on.', disabled: true },
      { status: 503 },
    );
  }

  // Validate before spending a token. Someone typing a name a character at a
  // time should not exhaust their budget on requests that never leave here.
  const raw = new URL(req.url).searchParams.get('q') ?? '';
  // A link is taken at its word; anything else is treated as a module name and
  // turned into the address it would have.
  const fromLink = looksLikeLink(raw) ? slugFromInput(raw) : null;
  const slug = fromLink ?? slugFromName(raw);
  const guessed = fromLink === null;
  if (!slug) {
    return NextResponse.json(
      { error: 'Type a module name, such as "Make Noise Maths", or paste its ModularGrid link.' },
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
    const message = e instanceof Error ? e.message : 'Lookup failed';
    // A guessed address that does not exist is an ordinary miss, not a
    // failure: the name needs the maker in it, or a search will find it.
    if (guessed && /No module called/i.test(message)) {
      return NextResponse.json(
        {
          error: 'No module of that name. Include the maker — "Make Noise Maths" rather than "Maths" — or search for it.',
          notFound: true,
        },
        { status: 404 },
      );
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
