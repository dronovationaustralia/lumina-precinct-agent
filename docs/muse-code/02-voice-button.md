Add a microphone button to the question box in Lumina Precinct Agent that records a question and fills the box using `/api/v1/transcribe` (Muse Voice Transcribe).

Context: read `AGENTS.md`. The composer is in `src/components/portal/Portal.tsx` (form with class `composer`, textarea `#q`); styles in `src/app/globals.css` (use the existing CSS variables; Meta model marks use the `.meta-dot` class).

Build:
1. `src/components/portal/MicButton.tsx`: a button with an accessible label "Ask by voice". Click to start recording with `MediaRecorder` (audio only), click again (or after 30 s) to stop, then POST the blob as `audio` to `/api/v1/transcribe`. While recording show a pulsing red dot and "Listening…"; while transcribing show the Meta dot and "Muse Voice is transcribing…". Put the returned text into the question box (do not submit automatically). Show a short inline error if the microphone is blocked or the call fails.
2. Place it next to the Ask button in the composer footer. Hide it when `navigator.mediaDevices` is unavailable.
3. Respect `prefers-reduced-motion` for the pulse.

Run `npm test`, `npm run typecheck`, `npm run lint`. CHANGELOG: "Ask by voice: microphone in the question box (Muse Voice Transcribe; built with Muse Code)."
