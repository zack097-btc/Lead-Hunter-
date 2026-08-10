import React, { useState } from 'react';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, name, invite);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">JZ</div>
        <h1>JZac Lead Generator</h1>
        <p className="sub">{mode === 'login' ? 'Sign in to start prospecting' : 'Create your rep account'}</p>

        {mode === 'register' && (
          <>
            <label htmlFor="name">Name</label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </>
        )}

        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
        />

        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          required
        />

        {mode === 'register' && (
          <>
            <label htmlFor="invite">Invite code</label>
            <input
              id="invite"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
              placeholder="from Zack"
            />
          </>
        )}

        {error && <div className="error">{error}</div>}

        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
        </button>

        <div className="switch">
          {mode === 'login' ? (
            <>
              New rep?{' '}
              <button type="button" className="link-btn" onClick={() => setMode('register')}>
                Create an account
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button type="button" className="link-btn" onClick={() => setMode('login')}>
                Sign in
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
