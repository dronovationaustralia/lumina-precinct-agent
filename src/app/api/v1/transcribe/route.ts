/**
 * POST /api/v1/transcribe
 *
 * Multipart form with field `audio` (webm, ogg, wav or mp4, max 10 MB, max 60 s).
 * Returns { text, model, ms } transcribed by Muse Voice Transcribe.
 */
import { MAX_AUDIO_MS, transcribe, transcribeModel, validateAudio } from '@/server/voice';
import { errorJson, json, preflight, rateLimit } from '@/server/http';

export const maxDuration = 60;

export function OPTIONS() {
  return preflight();
}

export async function POST(request: Request) {
  const limited = rateLimit(request);
  if (limited) return limited;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorJson(400, 'invalid_form', 'Body must be a multipart form with an "audio" field.');
  }
  const checked = validateAudio(form.get('audio'));
  if (!checked.ok) return errorJson(400, checked.code, checked.message);

  const filename = checked.file instanceof File && checked.file.name ? checked.file.name : 'question.webm';
  try {
    const station = form.get('station');
    const { text, ms, durationMs } = await transcribe(checked.file, filename, typeof station === 'string' ? station.slice(0, 80) : null);
    if (durationMs !== null && durationMs > MAX_AUDIO_MS) {
      return errorJson(400, 'audio_too_long', 'The audio is over 60 seconds; ask a shorter question.');
    }
    return json({ text, model: transcribeModel(), ms });
  } catch (e) {
    return errorJson(503, 'transcription_unavailable', e instanceof Error ? e.message : String(e));
  }
}
