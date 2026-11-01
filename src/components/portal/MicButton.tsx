'use client';

/**
 * Ask by voice: records a question with the microphone, sends it to
 * /api/v1/transcribe, and puts the returned text into the question box
 * (never submitted automatically). Hidden where there is no microphone API.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { toWav } from './wav';

const MAX_RECORD_MS = 30_000;

const SUPPORTED_MIME = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
];

type Phase = 'idle' | 'recording' | 'sending';

function extensionFor(mime: string): string {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

function micSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  );
}

function subscribeMic(): () => void {
  return () => {};
}

export function MicButton({ onTranscript, station }: { onTranscript: (text: string) => void; station?: string }) {
  // External store (not state-in-effect) so server and client agree on the first render.
  const ready = useSyncExternalStore(subscribeMic, micSupported, () => false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (!ready) return null;

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const send = async (blob: Blob) => {
    setPhase('sending');
    try {
      const form = new FormData();
      // Send WAV (the format Muse Voice Transcribe documents); fall back to the raw recording.
      const wav = await toWav(blob).catch(() => null);
      if (wav) form.append('audio', wav, 'question.wav');
      else form.append('audio', blob, `question.${extensionFor(blob.type)}`);
      if (station) form.append('station', station);
      const res = await fetch('/api/v1/transcribe', { method: 'POST', body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `Transcription failed (HTTP ${res.status}).`);
      }
      const data = (await res.json()) as { text?: string };
      onTranscript(data.text ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase('idle');
    }
  };

  const stop = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // The recorder's onstop handler uploads the clip.
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  const start = async () => {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError('The microphone is blocked. Allow access and try again.');
      return;
    }
    streamRef.current = stream;
    const mime = SUPPORTED_MIME.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      chunksRef.current = [];
      recorderRef.current = null;
      stopTracks();
      void send(blob);
    };
    recorderRef.current = recorder;
    recorder.start();
    setPhase('recording');
    timerRef.current = window.setTimeout(stop, MAX_RECORD_MS);
  };

  return (
    <span className="mic-wrap">
      <button
        type="button"
        className={`mic-button${phase === 'recording' ? ' is-recording' : ''}`}
        aria-label="Ask by voice"
        title={phase === 'recording' ? 'Click to stop recording' : 'Ask by voice'}
        disabled={phase === 'sending'}
        onClick={() => (phase === 'recording' ? stop() : void start())}
      >
        {phase === 'recording' ? (
          <>
            <span className="rec-dot" aria-hidden="true" />
            <span aria-live="polite">Listening…</span>
          </>
        ) : phase === 'sending' ? (
          <>
            <span className="meta-dot" aria-hidden="true" />
            <span aria-live="polite">Muse Voice is transcribing…</span>
          </>
        ) : (
          <>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <rect x="6" y="1.5" width="4" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            Voice
          </>
        )}
      </button>
      {error && (
        <span className="mic-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
