import React from 'react';
import { useAuth } from './auth.jsx';
import Login from './components/Login.jsx';
import Dashboard from './components/Dashboard.jsx';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="splash">
        <div className="splash-logo">JZ</div>
        <p>Loading…</p>
      </div>
    );
  }

  return user ? <Dashboard /> : <Login />;
}
