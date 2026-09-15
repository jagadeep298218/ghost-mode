// ── State ────────────────────────────────────────────────────
let selectedLat = null;
let selectedLng = null;
let isSpoofing = false;
let marker = null;
let homeMarker = null;

// ── Map Setup ────────────────────────────────────────────────
const map = L.map('map', {
  zoomControl: true
}).setView([20, 0], 3);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19
}).addTo(map);

// ── DOM Elements ─────────────────────────────────────────────
const searchInput = document.getElementById('search');
const searchBtn = document.getElementById('searchBtn');
const spoofBtn = document.getElementById('spoofBtn');
const resetBtn = document.getElementById('resetBtn');
const saveHomeBtn = document.getElementById('saveHomeBtn');
const goHomeBtn = document.getElementById('goHomeBtn');
const coordsEl = document.getElementById('coords');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

// ── Map Click → Place Marker ─────────────────────────────────
map.on('click', (e) => {
  placeMarker(e.latlng.lat, e.latlng.lng);
});

function placeMarker(lat, lng) {
  selectedLat = lat;
  selectedLng = lng;

  if (marker) {
    marker.setLatLng([lat, lng]);
  } else {
    marker = L.marker([lat, lng], { draggable: true }).addTo(map);
    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      placeMarker(pos.lat, pos.lng);
    });
  }

  coordsEl.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  spoofBtn.disabled = false;
  saveHomeBtn.disabled = false;
}

// ── Search ───────────────────────────────────────────────────
async function doSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  // Check if it's raw coordinates (e.g., "28.6139, 77.2090")
  const coordMatch = query.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    map.setView([lat, lng], 16);
    placeMarker(lat, lng);
    return;
  }

  setStatus('searching', 'Searching...');
  try {
    const results = await window.ghostAPI.geocode(query);
    if (!results || results.length === 0) {
      setStatus('error', 'No results found');
      return;
    }
    const { lat, lon, display_name } = results[0];
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lon);
    map.setView([latNum, lngNum], 16);
    placeMarker(latNum, lngNum);
    setStatus('connected', `Found: ${display_name}`);
  } catch (err) {
    setStatus('error', `Search failed: ${err.message}`);
  }
}

searchBtn.addEventListener('click', doSearch);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

// ── Spoof Location ───────────────────────────────────────────
spoofBtn.addEventListener('click', async () => {
  if (selectedLat === null) return;

  spoofBtn.disabled = true;
  setStatus('searching', `Spoofing to ${selectedLat.toFixed(6)}, ${selectedLng.toFixed(6)}...`);

  try {
    const result = await window.ghostAPI.setLocation(selectedLat, selectedLng);
    if (result.error) {
      setStatus('error', `Spoof failed: ${result.error}`);
      spoofBtn.disabled = false;
      return;
    }
    isSpoofing = true;
    setStatus('spoofing', `Spoofing: ${selectedLat.toFixed(6)}, ${selectedLng.toFixed(6)}`);
    resetBtn.disabled = false;
    spoofBtn.disabled = false;
  } catch (err) {
    setStatus('error', `Spoof failed: ${err.message}`);
    spoofBtn.disabled = false;
  }
});

// ── Reset Location ───────────────────────────────────────────
resetBtn.addEventListener('click', async () => {
  resetBtn.disabled = true;
  setStatus('searching', 'Resetting to real location...');

  try {
    const result = await window.ghostAPI.clearLocation();
    if (result.error) {
      setStatus('error', `Reset failed: ${result.error}`);
      resetBtn.disabled = false;
      return;
    }
    isSpoofing = false;
    setStatus('connected', 'Location reset to real GPS');
    resetBtn.disabled = true;
  } catch (err) {
    setStatus('error', `Reset failed: ${err.message}`);
    resetBtn.disabled = false;
  }
});

// ── Save Home ────────────────────────────────────────────────
saveHomeBtn.addEventListener('click', async () => {
  if (selectedLat === null) return;
  const label = `${selectedLat.toFixed(6)}, ${selectedLng.toFixed(6)}`;
  await window.ghostAPI.setHome(selectedLat, selectedLng, label);
  loadHome();
  setStatus('connected', 'Home location saved!');
});

// ── Go Home (one-click spoof to home) ────────────────────────
goHomeBtn.addEventListener('click', async () => {
  const home = await window.ghostAPI.getHome();
  if (!home) return;

  map.setView([home.lat, home.lng], 16);
  placeMarker(home.lat, home.lng);

  goHomeBtn.disabled = true;
  setStatus('searching', 'Spoofing to home...');

  try {
    const result = await window.ghostAPI.setLocation(home.lat, home.lng);
    if (result.error) {
      setStatus('error', `Spoof failed: ${result.error}`);
      goHomeBtn.disabled = false;
      return;
    }
    isSpoofing = true;
    setStatus('spoofing', `Spoofing to home: ${home.label}`);
    resetBtn.disabled = false;
    goHomeBtn.disabled = false;
  } catch (err) {
    setStatus('error', `Spoof failed: ${err.message}`);
    goHomeBtn.disabled = false;
  }
});

// ── Load Home Marker on Startup ──────────────────────────────
async function loadHome() {
  const home = await window.ghostAPI.getHome();
  if (home) {
    goHomeBtn.disabled = false;
    if (homeMarker) {
      homeMarker.setLatLng([home.lat, home.lng]);
    } else {
      const homeIcon = L.divIcon({
        html: '<div style="background:#6c63ff;width:12px;height:12px;border-radius:50%;border:2px solid white;"></div>',
        iconSize: [12, 12],
        className: ''
      });
      homeMarker = L.marker([home.lat, home.lng], { icon: homeIcon, interactive: false }).addTo(map);
    }
  }
}

// ── Status Helpers ───────────────────────────────────────────
function setStatus(state, message) {
  statusDot.className = 'status-dot';
  if (state === 'connected') statusDot.classList.add('connected');
  else if (state === 'spoofing') statusDot.classList.add('spoofing');
  else if (state === 'error') statusDot.classList.add('error');
  statusText.textContent = message;
}

// ── Startup ──────────────────────────────────────────────────
async function init() {
  setStatus('searching', 'Checking device...');

  const status = await window.ghostAPI.checkStatus();
  if (!status.installed) {
    setStatus('error', 'pymobiledevice3 not found. Run: pip install pymobiledevice3');
    return;
  }
  if (!status.connected) {
    setStatus('error', 'No iOS device detected. Connect your iPhone via USB and trust this computer.');
    return;
  }

  setStatus('searching', 'Starting tunnel (may need admin)...');
  const tunnel = await window.ghostAPI.startTunnel();
  if (tunnel.error) {
    setStatus('error', `Tunnel failed: ${tunnel.error}`);
    return;
  }

  setStatus('connected', 'Device connected and ready');
  loadHome();
}

init();
