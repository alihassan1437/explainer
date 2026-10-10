// Server re-export: the voice list lives in the explainer module (pure data,
// used by the player too); the route reads it from there.
export { DEFAULT_VOICE, VOICES, isVoice, languageOfVoice, pickVoice } from '../explainer/voices';
export type { Voice } from '../explainer/voices';
