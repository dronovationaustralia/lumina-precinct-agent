Add a voice question endpoint to Lumina Precinct Agent using Meta's Muse Voice Transcribe model.

Context:
- Next.js 16 App Router, TypeScript. Read `AGENTS.md` first. API routes live in `src/app/api/v1/*/route.ts`; follow the style of `src/app/api/v1/ask/route.ts` (CORS via `src/server/http.ts`, `rateLimit`, `errorJson`).
- The working request shape for transcription is in `spikes/03-voice-transcribe.ts` (multipart POST to `${META_BASE_URL}/asr/transcribe` with a JSON "request" part and the audio file, model `muse-voice-transcribe-1.0`, optional `keywords` for biasing). Reuse that shape exactly.
- Station names for keyword biasing: `STATIONS` in `src/lib/stations.ts` (use the names of all stations, plus "Sydney", "metro", "unit", "house").

Build:
1. `src/server/voice.ts`: `transcribe(audio: Blob, filename: string): Promise<{ text: string; ms: number }>` that calls Muse Voice Transcribe with `MODEL_API_KEY` from the environment, keyword-biased to station names. Throw a clear error when the key is missing. Timeout 30 s.
2. `src/app/api/v1/transcribe/route.ts`: `POST` multipart form with field `audio` (webm, ogg, wav or mp4, max 10 MB, max 60 s). Returns `{ text, model, ms }`. 400 for a missing or oversized file, 503 when the model call fails. Rate limited like `/ask`.
3. Add the route to the mock server `spikes/mock-meta-server.ts` if it does not already answer `/asr/transcribe`, returning a fixed transcript.
4. `tests/voice.test.ts`: unit tests for input validation (no file, too large) without calling the network.

Do not change the agent, the verifier or the database. Run `npm test`, `npm run typecheck`, `npm run lint`. Add a CHANGELOG entry: "Voice questions: /api/v1/transcribe with Muse Voice Transcribe (built with Muse Code)."
