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

  async function search() {
    if (!coords) {
      setSearchError('Waiting for your GPS location…');
      return;
    }
    setSearching(true);
    setSearchError('');
    try {
      const { businesses } = await api.nearby(coords.lat, coords.lng, radius);
      setBusinesses(businesses);
    } catch (err) {
      setSearchError(err.message);
    } finally {
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
          <StateFilter selected={states} onToggle={toggleState} />
          <div className="row">
            <button className="btn" style={{ marginTop: 0 }} onClick={search} disabled={searching}>
              {searching ? 'Searching…' : 'Search this area'}
            </button>
          </div>
          <div className="statusline">
            {geoError
              ? `📍 ${geoError}`
              : coords
              ? `📍 ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)} · ${visible.length} leads`
              : '📍 Acquiring GPS…'}
          </div>
          {searchError && <div className="error" style={{ textAlign: 'left' }}>{searchError}</div>}
        </div>
      )}

      <div className="content">
        {tab === 'map' && <MapView center={coords} businesses={visible} onSelect={openBusiness} />}
        {tab === 'list' && <ListView businesses={visible} onSelect={openBusiness} />}
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
