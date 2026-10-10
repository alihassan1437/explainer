import { NextResponse } from 'next/server';
import { synthesizeNarration } from '@/server/tts';
import { pickVoice, languageOfVoice, isVoice } from '@/server/voices';
import { checkCap, recordUsage, usageThisMonth } from '@/server/narration-usage';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_CHARS = 5000;

interface Body { text?: unknown; voice?: unknown; key?: unknown }

/** Creates narration audio with word timings. The Google key stays on the server. */
export async function POST(request: Request): Promise<NextResponse> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: 'The request was not JSON.' }, { status: 400 });
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return NextResponse.json({ ok: false, error: 'There is no text to read.' }, { status: 400 });
  if (text.length > MAX_CHARS) {
    return NextResponse.json({ ok: false, error: `The script is ${text.length.toLocaleString()} characters; the most one narration can read is ${MAX_CHARS.toLocaleString()}.` }, { status: 400 });
  }
  const apiKey = process.env.GOOGLE_TTS_API_KEY
    || (typeof body.key === 'string' && body.key.trim() ? body.key.trim() : '');
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'Narration needs a Google TTS key: paste yours in the editor, or set GOOGLE_TTS_API_KEY on the server.' }, { status: 500 });
  }
  const voice = pickVoice(typeof body.voice === 'string' && isVoice(body.voice) ? body.voice : undefined);
  try {
    checkCap(text.length);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'The narration allowance is used up.' }, { status: 429 });
  }
  try {
    const result = await synthesizeNarration({ text, voice, language: languageOfVoice(voice), apiKey });
    recordUsage(result.characters);
    const usage = usageThisMonth();
    return NextResponse.json({
      ok: true,
      audio: `data:audio/wav;base64,${result.wav.toString('base64')}`,
      words: result.words,
      durationMs: result.durationMs,
      voice: result.voice,
      characters: result.characters,
      usage,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'The narration service could not create the audio.';
    const status = /busy|allowance/i.test(message) ? 429 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
