'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { PERSONA_INFO } from '@/lib/personas';

type Persona = keyof typeof PERSONA_INFO;

const ERRORS: Record<string, string> = {
  microsoft_not_configured: 'Microsoft sign-in is not set up on this deployment yet.',
  microsoft_declined: 'Microsoft sign-in was cancelled.',
  sign_in_expired: 'The sign-in took too long. Please try again.',
  state_mismatch: 'The sign-in could not be verified. Please try again.',
  token_exchange_failed: 'Microsoft did not confirm the sign-in. Please try again.',
  invalid_token: 'The sign-in could not be verified. Please try again.',
  wrong_tenant: 'This Microsoft account is not part of the organisation that runs Lumina. Use the demo, or ask for access.',
  bad_issuer: 'The sign-in could not be verified. Please try again.',
  nonce_mismatch: 'The sign-in could not be verified. Please try again.',
};

const MODELS = [
  { name: 'Muse Spark', role: 'plans the analysis and writes every answer' },
  { name: 'SAM 3.1', role: 'reads aerial photos for land cover' },
  { name: 'Muse Voice', role: 'lets you ask out loud' },
  { name: 'Muse Image', role: 'renders precinct briefing cards' },
];

export function SignIn() {
  const params = useSearchParams();
  const next = params.get('next') ?? '/';
  const error = params.get('error');
  const [persona, setPersona] = useState<Persona>('developer');
  const [providers, setProviders] = useState<{ microsoft: boolean; demo: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth/providers').then((r) => r.json()).then(setProviders).catch(() => setProviders({ microsoft: false, demo: true }));
  }, []);

  async function demo() {
    setBusy(true);
    const r = await fetch('/api/auth/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ persona }) });
    if (r.ok) window.location.assign(next.startsWith('/') ? next : '/');
    else setBusy(false);
  }

  return (
    <main className="signin">
      <section className="signin-story" aria-label="About Lumina">
        <div className="brand brand-lg">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <p className="signin-kicker">Dronovation Labs</p>
            <h1>Lumina Precinct Agent</h1>
          </div>
        </div>
        <p className="signin-lead">
          Screen any of Sydney&apos;s 185 train and metro station precincts in minutes. Ask in plain English; every
          figure is computed from NSW open data, checked before you see it, and shown on the map.
        </p>
        <ul className="signin-facts">
          <li><strong>185</strong> stations</li>
          <li><strong>NSW</strong> sales, patronage, boundaries</li>
          <li><strong>Every</strong> figure sourced and dated</li>
        </ul>
        <div className="signin-models">
          <p>Built on Meta models</p>
          <ul>
            {MODELS.map((m) => (
              <li key={m.name}><span className="meta-chip">{m.name}</span> {m.role}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="signin-card" aria-label="Sign in">
        <h2>Sign in</h2>
        {error && <p className="signin-error" role="alert">{ERRORS[error] ?? 'Sign-in failed. Please try again.'}</p>}
        <fieldset className="persona-pick">
          <legend>What kind of work do you do?</legend>
          {(Object.keys(PERSONA_INFO) as Persona[]).map((p) => (
            <label key={p} className={`persona-option${persona === p ? ' is-on' : ''}`}>
              <input type="radio" name="persona" value={p} checked={persona === p} onChange={() => setPersona(p)} />
              <span className="persona-name">{PERSONA_INFO[p].label}</span>
              <span className="persona-blurb">{PERSONA_INFO[p].blurb}</span>
            </label>
          ))}
        </fieldset>
        <div className="signin-actions">
          {providers?.microsoft && (
            <a className="btn btn-primary" href={`/api/auth/login/microsoft?persona=${persona}&next=${encodeURIComponent(next)}`}>
              <span className="ms-logo" aria-hidden="true"><i /><i /><i /><i /></span>
              Sign in with Microsoft
            </a>
          )}
          {providers?.demo !== false && (
            <button type="button" className={`btn ${providers?.microsoft ? 'btn-secondary' : 'btn-primary'}`} onClick={demo} disabled={busy}>
              {busy ? 'Opening…' : 'Try the demo (no account)'}
            </button>
          )}
        </div>
        <p className="signin-note">The demo session needs no account and lasts 8 hours. You can change your work type later.</p>
      </section>
    </main>
  );
}
