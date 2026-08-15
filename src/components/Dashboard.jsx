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

// Half a mile is far enough that the businesses around you have genuinely
// changed, and short enough that a rep working a strip gets fresh leads without
// asking. The time floor stops a bad GPS fix from triggering a burst.
const AUTO_REFRESH_MILES = 0.5;
const AUTO_REFRESH_MIN_MS = 60000;

function milesBetween(a, b) {
  const R = 3958.8, toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

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
  const lastSearchAt = useRef(null);          // { lat, lng, t } of the last search
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoNote, setAutoNote] = useState(false);

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

  // ---- searching as the rep moves -------------------------------------------
  //
  // The first search happens by itself once GPS arrives. After that it refreshes
  // when the rep has actually MOVED somewhere new — driving half a mile down the
  // road means a different set of doors, and nobody should have to remember to
  // tap a button for that.
  //
  // Distance, not time, is the trigger. A rep parked outside a shop for twenty
  // minutes writing a quote does not need the free map service hit every minute,
  // and GPS drift of a few metres is not movement.
  useEffect(() => {
    if (!coords) return;
    if (!didInitialSearch.current) {
      didInitialSearch.current = true;
      lastSearchAt.current = { ...coords, t: Date.now() };
      search();
      return;
    }
    if (!autoRefresh || searching) return;
    const last = lastSearchAt.current;
    if (!last) return;
    if (milesBetween(last, coords) < AUTO_REFRESH_MILES) return;
    if (Date.now() - last.t < AUTO_REFRESH_MIN_MS) return;   // belt and braces
    lastSearchAt.current = { ...coords, t: Date.now() };
    setAutoNote(true);
    setTimeout(() => setAutoNote(false), 4000);
    search({ auto: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords, autoRefresh, searching]);

  async function search({ force = false, auto = false } = {}) {
    if (!coords) {
      setSearchError('Waiting for your GPS location…');
      return;
    }
    if (!auto) lastSearchAt.current = { ...coords, t: Date.now() };
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

  // Marking a lead updates the screen straight away and reconciles with the
  // server after. A rep tapping "Talked to" outside a shop should not be made
  // to wait on a network round trip to see it land — and if the save fails they
  // are told, and the card goes back to what it was.
  async function markLead(b, status) {
    const before = businesses;
    const stamp = new Date().toISOString();
    setBusinesses((list) =>
      list.map((x) =>
        x.id === b.id
          ? { ...x, leadStatus: status || undefined, leadBy: status ? user.name : undefined,
              leadAt: status ? stamp : undefined, leadNote: status ? x.leadNote : undefined }
          : x
      )
    );
    try {
      await api.setLeadStatus(b, status);
    } catch (err) {
      setBusinesses(before);
      alert('Could not save that: ' + err.message + '\n\nThe lead has been put back as it was.');
    }
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

          <div className="statusline statusrow">
            <span className="statustext">{geoError
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
            </span>
            {/* Sits on the status line rather than its own row — the leads are
                what the screen is for, and this is set once and forgotten. */}
            <label className="auto-toggle" title="Refresh the list by itself once you've moved half a mile">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto
            </label>
          </div>

          {autoNote && <div className="note">You've moved — refreshing the leads around you.</div>}
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
          <ListView
            businesses={visible}
            onSelect={openBusiness}
            searching={searching}
            onStatus={markLead}
          />
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
