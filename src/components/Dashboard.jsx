import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth.jsx';
import { api } from '../api.js';
import { DEFAULT_STATE_CODES } from '../config/states.js';
import RadiusSelector from './RadiusSelector.jsx';
import StateFilter from './StateFilter.jsx';
import MapView from './MapView.jsx';
import ListView from './ListView.jsx';
import BusinessDetail from './BusinessDetail.jsx';
import AdminPanel from './AdminPanel.jsx';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [coords, setCoords] = useState(null); // { lat, lng }
  const [geoError, setGeoError] = useState('');
  const [radius, setRadius] = useState(5);
  const [states, setStates] = useState(DEFAULT_STATE_CODES);
  const [tab, setTab] = useState('map'); // map | list | admin
  const [businesses, setBusinesses] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [meta, setMeta] = useState(null);
  const [slowNote, setSlowNote] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState(null);
  const didInitialSearch = useRef(false);

  // Continuous GPS tracking via the browser geolocation API.
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGeoError('Geolocation is not supported on this device/browser.');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setGeoError('');
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => setGeoError(err.message || 'Unable to get your location. Enable location access.'),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Auto-search once when we first get a location (then it's manual, to save API cost).
  useEffect(() => {
    if (coords && !didInitialSearch.current) {
      didInitialSearch.current = true;
      search();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords]);

  async function search({ force = false } = {}) {
    if (!coords) {
      setSearchError('Waiting for your GPS location…');
      return;
    }
    setSearching(true);
    setSearchError('');
    setMeta(null);
    // The free map service can genuinely take twenty seconds on a bad day.
    // Saying so out loud beats a silent spinner, which is the thing that makes
    // people decide the app has frozen and close it.
    const slow = setTimeout(() => setSlowNote(true), 6000);
    try {
      const res = await api.nearby(coords.lat, coords.lng, radius, { force });
      setBusinesses(res.businesses || []);
      setMeta(res.meta || null);
    } catch (err) {
      setSearchError(err.message);
    } finally {
      clearTimeout(slow);
      setSlowNote(false);
      setSearching(false);
    }
  }

  function toggleState(code) {
    setStates((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  async function openBusiness(b) {
    setSelected(b);
    // Fire-and-forget activity log (rep tapped into a business).
    api
      .logActivity({
        type: 'view_business',
        business_name: b.name,
        business_address: b.address,
        lat: b.lat,
        lng: b.lng
      })
      .catch(() => {});
  }

  // Apply the state territory filter. Businesses with no detectable state are
  // kept (so reps never lose a lead just because the address didn't parse).
  const visible = businesses.filter((b) => !b.state || states.includes(b.state));
  // Worth stating out loud: a filter that silently removes leads is how people
  // conclude the search is broken.
  const hiddenByState = businesses.length - visible.length;

  return (
    <div className="app">
      <div className="topbar">
        <div className="who">
          <b>{user.name}</b>
          {user.role === 'admin' && <span className="badge">ADMIN</span>}
        </div>
        <button className="link-btn" onClick={logout}>
          Sign out
        </button>
      </div>

      {tab !== 'admin' && (
        <div className="controls">
          <RadiusSelector value={radius} onChange={setRadius} />

          {/* Territory is a start-of-day setting, not a per-search one, so it
              folds away. It stays one tap from view and announces itself when
              it is actually filtering something out. */}
          <button
            className="filter-toggle"
            type="button"
            onClick={() => setShowFilters((v) => !v)}
          >
            {showFilters ? '▾' : '▸'} Territory · {states.length} state
            {states.length === 1 ? '' : 's'}
            {hiddenByState > 0 ? ` · ${hiddenByState} hidden` : ''}
          </button>
          {showFilters && <StateFilter selected={states} onToggle={toggleState} />}
          <div className="row search-row">
            <button
              className="btn"
              style={{ marginTop: 0 }}
              onClick={() => search()}
              disabled={searching || !coords}
            >
              {searching ? 'Searching…' : 'Search this area'}
            </button>
            {!!businesses.length && !searching && (
              <button
                className="btn ghost"
                style={{ marginTop: 0 }}
                onClick={() => search({ force: true })}
                title="Ignore the saved copy and ask the map service again"
              >
                ↻
              </button>
            )}
          </div>

          <div className="statusline">
            {geoError
              ? `📍 ${geoError}`
              : coords
              ? `📍 ${visible.length} lead${visible.length === 1 ? '' : 's'} within ${radius} mi`
              : '📍 Acquiring GPS…'}
            {meta && !searching && (
              <span className="dim">
                {' '}
                · {meta.cached ? 'saved copy' : `${(meta.ms / 1000).toFixed(1)}s`}
              </span>
            )}
          </div>

          {slowNote && (
            <div className="note">
              Still going — the free map service is slow right now. It has up to a
              minute before it gives up, and a smaller radius almost always gets
              through faster.
            </div>
          )}
          {meta?.partial && <div className="note">{meta.note}</div>}
          {searchError && <div className="error" style={{ textAlign: 'left' }}>{searchError}</div>}
        </div>
      )}

      <div className="content">
        {tab === 'map' && <MapView center={coords} businesses={visible} onSelect={openBusiness} />}
        {tab === 'list' && (
          <ListView businesses={visible} onSelect={openBusiness} searching={searching} />
        )}
        {tab === 'admin' && <AdminPanel />}
      </div>

      <div className="tabbar">
        <button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}>
          🗺️ Map
        </button>
        <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}>
          📋 List
        </button>
        {user.role === 'admin' && (
          <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>
            👥 Team
          </button>
        )}
      </div>

      {selected && <BusinessDetail business={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
