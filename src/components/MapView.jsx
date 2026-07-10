import React, { useEffect, useRef } from 'react';
import L from 'leaflet';

// Imperative Leaflet map (avoids react-leaflet version/peer-dep issues).
export default function MapView({ center, businesses, onSelect }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const repMarkerRef = useRef(null);
  const layerRef = useRef(null);

  // Init once.
  useEffect(() => {
    if (mapRef.current || !elRef.current) return;
    const map = L.map(elRef.current, { zoomControl: true, attributionControl: true }).setView(
      center && center.lat ? [center.lat, center.lng] : [47.6062, -122.3321], // default: Seattle
      13
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    // Leaflet needs a size recalc when shown inside a flex container.
    setTimeout(() => map.invalidateSize(), 100);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update rep position.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center || !center.lat) return;
    const pos = [center.lat, center.lng];
    if (!repMarkerRef.current) {
      repMarkerRef.current = L.marker(pos, {
        icon: L.divIcon({
          className: '',
          html: '<div style="width:18px;height:18px;border-radius:50%;background:#0b5cff;border:3px solid #fff;box-shadow:0 0 0 3px rgba(11,92,255,.35)"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        })
      }).addTo(map);
      map.setView(pos, 14);
    } else {
      repMarkerRef.current.setLatLng(pos);
    }
  }, [center]);

  // Update business markers.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    (businesses || []).forEach((b) => {
      if (typeof b.lat !== 'number' || typeof b.lng !== 'number') return;
      const m = L.marker([b.lat, b.lng], {
        icon: L.divIcon({
          className: '',
          html: '<div style="width:14px;height:14px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#ffd23f;border:2px solid #7a5b00"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 14]
        })
      });
      m.bindPopup(
        `<strong>${escapeHtml(b.name)}</strong><br/>${escapeHtml(b.type)}<br/>${escapeHtml(b.address)}`
      );
      m.on('click', () => onSelect && onSelect(b));
      m.addTo(layer);
    });
  }, [businesses, onSelect]);

  return <div className="map" ref={elRef} />;
}

function escapeHtml(s = '') {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
