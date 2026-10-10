// The narration voices: Google Cloud Text-to-Speech WaveNet voices. Pure data;
// both the server route and the player read it.

export interface Voice { id: string; name: string; language: string; languageName: string }

const v = (language: string, languageName: string, letter: string, gender: 'Male' | 'Female', n: number): Voice => ({
  id: `${language}-Wavenet-${letter}`, name: `${languageName} · ${gender} ${n}`, language, languageName,
});

export const VOICES: Voice[] = [
  v('en-US', 'English (US)', 'D', 'Male', 1), v('en-US', 'English (US)', 'J', 'Male', 2), v('en-US', 'English (US)', 'A', 'Male', 3),
  v('en-US', 'English (US)', 'F', 'Female', 1), v('en-US', 'English (US)', 'C', 'Female', 2), v('en-US', 'English (US)', 'H', 'Female', 3),
  v('en-GB', 'English (UK)', 'B', 'Male', 1), v('en-GB', 'English (UK)', 'D', 'Male', 2),
  v('en-GB', 'English (UK)', 'A', 'Female', 1), v('en-GB', 'English (UK)', 'F', 'Female', 2),
  v('en-AU', 'English (Australia)', 'B', 'Male', 1), v('en-AU', 'English (Australia)', 'D', 'Male', 2),
  v('en-AU', 'English (Australia)', 'A', 'Female', 1), v('en-AU', 'English (Australia)', 'C', 'Female', 2),
  v('hi-IN', 'Hindi', 'B', 'Male', 1), v('hi-IN', 'Hindi', 'C', 'Male', 2),
  v('hi-IN', 'Hindi', 'A', 'Female', 1), v('hi-IN', 'Hindi', 'D', 'Female', 2),
  v('ur-IN', 'Urdu', 'B', 'Male', 1), v('ur-IN', 'Urdu', 'A', 'Female', 1),
];

export const DEFAULT_VOICE = 'en-US-Wavenet-D';

export const isVoice = (id: unknown): id is string => typeof id === 'string' && VOICES.some(x => x.id === id);

/** The voice to use: the one asked for when it is known, otherwise the default. */
export function pickVoice(voice?: string): string {
  return isVoice(voice) ? voice : DEFAULT_VOICE;
}

/** The language code for a voice id, e.g. en-US-Wavenet-D -> en-US. */
export function languageOfVoice(voiceId: string): string {
  const m = /^([a-z]{2,3}-[A-Z]{2})/.exec(voiceId);
  return m ? m[1] : 'en-US';
}
