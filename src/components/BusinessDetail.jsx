import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

// Modal that generates the cold email + walk-in pitch on demand (when opened).
export default function BusinessDetail({ business, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [pitch, setPitch] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function gen() {
      setLoading(true);
      setError('');
      try {
        const res = await api.pitch(business.name, business.type, business.address);
        if (!cancelled) {
          setEmail(res.email || '');
          setPitch(res.pitch || '');
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    gen();
    return () => {
      cancelled = true;
    };
  }, [business]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" type="button" onClick={onClose}>
          Close
        </button>
        <h2>{business.name}</h2>
        <div className="meta" style={{ color: 'var(--muted)', fontSize: 13 }}>
          {business.type} · {business.address}
        </div>

        {loading && <div className="loading-dots">Building your tailored pitch…</div>}
        {error && <div className="error">{error}</div>}

        {!loading && !error && (
          <>
            <PitchBlock title="Cold Email" text={email} />
            <PitchBlock title="Walk-In Pitch Script" text={pitch} />
          </>
        )}
      </div>
    </div>
  );
}

function PitchBlock({ title, text }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }
  return (
    <div className="pitch-block">
      <div className="head">
        <h4>{title}</h4>
        <button className="copy-btn" type="button" onClick={copy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre>{text}</pre>
    </div>
  );
}
