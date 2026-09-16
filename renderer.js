// ── Platform class for CSS ───────────────────────────────────
if (window.ghostAPI.platform === 'darwin') document.body.classList.add('platform-mac');

// ── State ────────────────────────────────────────────────────
let selectedLat = null;
let selectedLng = null;
let isSpoofing = false;
let marker = null;
let homeMarker = null;
let selectedLocationName = 'Dropped Pin';
let searchDebounceTimer = null;

// ── Map Setup (no default zoom control) ─────────────────────
const map = L.map('map', { zoomControl: false }).setView([20, 0], 3);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19
}).addTo(map);

// ── DOM Elements ─────────────────────────────────────────────
const searchInput = document.getElementById('search');
const searchClear = document.getElementById('searchClear');
const searchSpinner = document.getElementById('searchSpinner');
const searchHint = document.getElementById('searchHint');
const searchResults = document.getElementById('searchResults');
const locationCard = document.getElementById('locationCard');
const locationName = document.getElementById('locationName');
const locationCoords = document.getElementById('locationCoords');
const spoofBtn = document.getElementById('spoofBtn');
const resetBtn = document.getElementById('resetBtn');
const saveHomeBtn = document.getElementById('saveHomeBtn');
const goHomeBtn = document.getElementById('goHomeBtn');
const copyBtn = document.getElementById('copyBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const dockIdle = document.getElementById('dockIdle');
const dockActive = document.getElementById('dockActive');
const spoofLocationName = document.getElementById('spoofLocationName');
const travelBtn = document.getElementById('travelBtn');
const travelProgress = document.getElementById('travelProgress');
const travelProgressBar = document.getElementById('travelProgressBar');
const spoofDot = document.getElementById('spoofDot');
const spoofStatusText = document.getElementById('spoofStatusText');
const rsdPanel = document.getElementById('rsdPanel');
const rsdInput = document.getElementById('rsdInput');
const rsdConnectBtn = document.getElementById('rsdConnectBtn');

// ── Map Click → Place Marker ─────────────────────────────────
map.on('click', (e) => {
  placeMarker(e.latlng.lat, e.latlng.lng);
  reverseGeocode(e.latlng.lat, e.latlng.lng);
});

function placeMarker(lat, lng) {
  selectedLat = lat;
  selectedLng = lng;

  const ghostIcon = L.divIcon({
    html: '<div class="ghost-marker"><div class="ghost-marker-pulse"></div></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    className: ''
  });

  if (marker) {
    marker.setLatLng([lat, lng]);
  } else {
    marker = L.marker([lat, lng], { draggable: true, icon: ghostIcon }).addTo(map);
    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      placeMarker(pos.lat, pos.lng);
      reverseGeocode(pos.lat, pos.lng);
    });
  }

  locationCoords.textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  locationCard.hidden = false;
  spoofBtn.disabled = false;
  travelBtn.disabled = false;
  saveHomeBtn.disabled = false;
}

// ── Reverse Geocode (get place name from coordinates) ────────
async function reverseGeocode(lat, lng) {
  selectedLocationName = 'Dropped Pin';
  locationName.textContent = selectedLocationName;
  try {
    const result = await window.ghostAPI.reverseGeocode(lat, lng);
    if (result && result.display_name) {
      const parts = result.display_name.split(',');
      selectedLocationName = parts.slice(0, 2).join(',').trim();
      locationName.textContent = selectedLocationName;
    }
  } catch (e) {
    // Keep "Dropped Pin"
  }
}

// ── Search (Enter to submit, live suggestions) ───────────────
searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim();
  searchClear.hidden = !query;
  if (searchHint) searchHint.style.display = query ? 'none' : '';

  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);

  if (!query) {
    searchResults.hidden = true;
    return;
  }

  searchDebounceTimer = setTimeout(() => fetchSuggestions(query), 350);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    searchResults.hidden = true;
    doSearch();
  }
  if (e.key === 'Escape') {
    searchResults.hidden = true;
    searchInput.blur();
  }
});

searchInput.addEventListener('focus', () => {
  if (searchHint) searchHint.style.display = 'none';
});

searchInput.addEventListener('blur', () => {
  if (searchHint && !searchInput.value.trim()) searchHint.style.display = '';
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.hidden = true;
  searchResults.hidden = true;
  if (searchHint) searchHint.style.display = '';
});

async function fetchSuggestions(query) {
  const coordMatch = query.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if (coordMatch) {
    showSearchResults([{
      display_name: `${coordMatch[1]}, ${coordMatch[2]}`,
      lat: coordMatch[1],
      lon: coordMatch[2]
    }]);
    return;
  }

  searchSpinner.hidden = false;
  try {
    const results = await window.ghostAPI.geocode(query);
    searchSpinner.hidden = true;
    if (results && results.length > 0) {
      showSearchResults(results.slice(0, 5));
    } else {
      searchResults.hidden = true;
    }
  } catch (e) {
    searchSpinner.hidden = true;
    searchResults.hidden = true;
  }
}

function showSearchResults(results) {
  searchResults.innerHTML = '';
  results.forEach((r) => {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    // Show full name on one line, trimmed to reasonable length
    const fullName = r.display_name;
    item.innerHTML = `<div class="search-result-text">${fullName}</div>`;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const lat = parseFloat(r.lat);
      const lng = parseFloat(r.lon);
      map.setView([lat, lng], 16);
      placeMarker(lat, lng);
      const parts = fullName.split(',');
      selectedLocationName = parts.slice(0, 2).join(',').trim();
      locationName.textContent = selectedLocationName;
      searchInput.value = parts.slice(0, 3).join(',').trim();
      searchResults.hidden = true;
      searchClear.hidden = false;
    });
    searchResults.appendChild(item);
  });
  searchResults.hidden = false;
}

async function doSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  const coordMatch = query.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    map.setView([lat, lng], 16);
    placeMarker(lat, lng);
    reverseGeocode(lat, lng);
    return;
  }

  setStatus('searching', 'Searching...');
  searchSpinner.hidden = false;
  try {
    const results = await window.ghostAPI.geocode(query);
    searchSpinner.hidden = true;
    if (!results || results.length === 0) {
      setStatus('error', 'No results found');
      return;
    }
    const { lat, lon, display_name } = results[0];
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lon);
    map.setView([latNum, lngNum], 16);
    placeMarker(latNum, lngNum);
    const parts = display_name.split(',');
    selectedLocationName = parts.slice(0, 2).join(',').trim();
    locationName.textContent = selectedLocationName;
    setStatus('connected', `Found: ${display_name.substring(0, 60)}`);
  } catch (err) {
    searchSpinner.hidden = true;
    setStatus('error', `Search failed: ${err.message}`);
  }
}

// Close search results when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-container')) {
    searchResults.hidden = true;
  }
});

// ── Custom Zoom Controls ─────────────────────────────────────
document.getElementById('zoomIn').addEventListener('click', () => map.zoomIn());
document.getElementById('zoomOut').addEventListener('click', () => map.zoomOut());

// ── Spoof Location ───────────────────────────────────────────
spoofBtn.addEventListener('click', async () => {
  if (selectedLat === null) return;

  spoofBtn.disabled = true;
  setStatus('searching', 'Spoofing...');

  try {
    const result = await window.ghostAPI.setLocation(selectedLat, selectedLng);
    if (result.error) {
      setStatus('error', `Spoof failed: ${result.error}`);
      spoofBtn.disabled = false;
      return;
    }
    isSpoofing = true;
    dockIdle.hidden = true;
    dockActive.hidden = false;
    spoofLocationName.textContent = selectedLocationName;
    setStatus('spoofing', 'Spoofing active. Force-close Life360 and reopen for best results.');
  } catch (err) {
    setStatus('error', `Spoof failed: ${err.message}`);
    spoofBtn.disabled = false;
  }
});

// ── Travel to Location (gradual movement) ────────────
travelBtn.addEventListener('click', async () => {
  if (selectedLat === null) return;

  travelBtn.disabled = true;
  spoofBtn.disabled = true;
  setStatus('searching', 'Starting travel...');

  try {
    // If not already spoofing, start spoofer first with current real-ish location
    if (!isSpoofing) {
      // First set to trigger spoofer start, then travel
      const startResult = await window.ghostAPI.setLocation(selectedLat, selectedLng);
      if (startResult.error) {
        setStatus('error', `Failed: ${startResult.error}`);
        travelBtn.disabled = false;
        spoofBtn.disabled = false;
        return;
      }
    }

    isSpoofing = true;
    dockIdle.hidden = true;
    dockActive.hidden = false;
    spoofLocationName.textContent = selectedLocationName;
    spoofStatusText.textContent = 'Traveling';
    spoofDot.style.background = 'var(--success)';
    travelProgress.hidden = false;
    travelProgressBar.style.width = '0%';
    setStatus('spoofing', `Traveling to ${selectedLocationName}...`);

    const result = await window.ghostAPI.travelTo(selectedLat, selectedLng);
    if (result.error) {
      setStatus('error', `Travel failed: ${result.error}`);
      travelBtn.disabled = false;
      spoofBtn.disabled = false;
      return;
    }

    // Arrived
    travelProgress.hidden = true;
    spoofStatusText.textContent = 'Spoofing';
    spoofDot.style.background = '';
    setStatus('spoofing', `Arrived at ${selectedLocationName}. Force-close Life360 and reopen.`);
    travelBtn.disabled = false;
    spoofBtn.disabled = false;
  } catch (err) {
    setStatus('error', `Travel failed: ${err.message}`);
    travelBtn.disabled = false;
    spoofBtn.disabled = false;
  }
});

// Listen for travel progress updates
window.ghostAPI.onTravelProgress((data) => {
  travelProgressBar.style.width = `${data.progress}%`;
  if (data.progress < 100) {
    setStatus('spoofing', `Traveling... ${data.progress}%`);
  }
  // Move marker along the path
  if (marker) {
    marker.setLatLng([data.lat, data.lng]);
  }
});

// ── Reset Location ───────────────────────────────────────────
resetBtn.addEventListener('click', async () => {
  resetBtn.disabled = true;
  setStatus('searching', 'Resetting...');

  try {
    const result = await window.ghostAPI.clearLocation();
    if (result.error) {
      setStatus('error', `Reset failed: ${result.error}`);
      resetBtn.disabled = false;
      return;
    }
    isSpoofing = false;
    dockIdle.hidden = false;
    dockActive.hidden = true;
    travelProgress.hidden = true;
    spoofDot.style.background = '';
    spoofBtn.disabled = false;
    travelBtn.disabled = false;
    setStatus('connected', 'Location reset to real GPS');
  } catch (err) {
    setStatus('error', `Reset failed: ${err.message}`);
    resetBtn.disabled = false;
  }
});

// ── Save Home ────────────────────────────────────────────────
saveHomeBtn.addEventListener('click', async () => {
  if (selectedLat === null) return;
  await window.ghostAPI.setHome(selectedLat, selectedLng, selectedLocationName);
  loadHome();
  setStatus('connected', 'Home location saved!');
});

// ── Go Home (one-click spoof) ────────────────────────────────
goHomeBtn.addEventListener('click', async () => {
  const home = await window.ghostAPI.getHome();
  if (!home) return;

  map.setView([home.lat, home.lng], 16);
  placeMarker(home.lat, home.lng);
  selectedLocationName = home.label || 'Home';
  locationName.textContent = selectedLocationName;

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
    dockIdle.hidden = true;
    dockActive.hidden = false;
    spoofLocationName.textContent = selectedLocationName;
    setStatus('spoofing', 'Spoofing to home. Force-close Life360 and reopen for best results.');
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
    const homeIcon = L.divIcon({
      html: '<div class="home-marker"></div>',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
      className: ''
    });
    if (homeMarker) {
      homeMarker.setLatLng([home.lat, home.lng]);
    } else {
      homeMarker = L.marker([home.lat, home.lng], { icon: homeIcon, interactive: false }).addTo(map);
    }
  }
}

// ── Copy Coordinates ─────────────────────────────────────────
copyBtn.addEventListener('click', () => {
  if (selectedLat === null) return;
  navigator.clipboard.writeText(`${selectedLat.toFixed(6)}, ${selectedLng.toFixed(6)}`);
  setStatus('connected', 'Coordinates copied!');
});

// ── Status Helpers ───────────────────────────────────────────
function setStatus(state, message) {
  statusDot.className = 'status-dot';
  if (state === 'connected') statusDot.classList.add('connected');
  else if (state === 'spoofing') statusDot.classList.add('spoofing');
  else if (state === 'error') statusDot.classList.add('error');
  statusText.textContent = message;
}

// ── RSD Manual Connect (fallback) ────────────────────────────
rsdConnectBtn.addEventListener('click', async () => {
  const val = rsdInput.value.trim();
  if (!val) return;

  let host, port;
  if (val.includes(' ')) {
    [host, port] = val.split(/\s+/);
  } else if (val.match(/:\d+$/)) {
    const lastColon = val.lastIndexOf(':');
    port = val.slice(lastColon + 1);
    host = val.slice(0, lastColon);
  } else {
    setStatus('error', 'Enter: host port');
    return;
  }

  const result = await window.ghostAPI.setRsd(host, port);
  if (result.ok) {
    setStatus('connected', `Connected to ${host}:${port}. Ready to spoof!`);
    rsdPanel.hidden = true;
  }
});

// ── Keyboard Shortcuts ───────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    searchInput.focus();
  }
});

// ── Setup Wizard ─────────────────────────────────────
const setupOverlay = document.getElementById('setupOverlay');
const step1El = document.getElementById('step1');
const step2El = document.getElementById('step2');
const step3El = document.getElementById('step3');
const step4El = document.getElementById('step4');
const step1Btn = document.getElementById('step1Btn');
const step2Btn = document.getElementById('step2Btn');
const step3CheckBtn = document.getElementById('step3CheckBtn');
const step4Btn = document.getElementById('step4Btn');
const step1Error = document.getElementById('step1Error');
const step2Error = document.getElementById('step2Error');
const step3Error = document.getElementById('step3Error');
const step4Error = document.getElementById('step4Error');
const devModeGuide = document.getElementById('devModeGuide');
const substep3a = document.getElementById('substep3a');
const substep3b = document.getElementById('substep3b');
const substep3c = document.getElementById('substep3c');
const substep3aDone = document.getElementById('substep3aDone');
const substep3bBtn = document.getElementById('substep3bBtn');
const substep3bError = document.getElementById('substep3bError');
const substep3cDone = document.getElementById('substep3cDone');
const setupDone = document.getElementById('setupDone');
const setupDoneBtn = document.getElementById('setupDoneBtn');
const iTunesLink = document.getElementById('iTunesLink');

function setStepStatus(el, status) {
  el.dataset.status = status;
}

function unlockStep(el, btn) {
  setStepStatus(el, 'pending');
  if (btn) btn.disabled = false;
}

function showStepError(errorEl, msg) {
  errorEl.hidden = false;
  const textEl = errorEl.querySelector('.step-error-text');
  if (textEl) textEl.innerHTML = msg;
}

// Open iTunes download in browser
iTunesLink.addEventListener('click', (e) => {
  e.preventDefault();
  window.ghostAPI.openExternal && window.ghostAPI.openExternal('https://www.apple.com/itunes/');
});

// ── Step 1: Check Apple Drivers ──────────────────────
step1Btn.addEventListener('click', async () => {
  setStepStatus(step1El, 'checking');
  step1Error.hidden = true;

  const result = await window.ghostAPI.checkiTunes();

  if (result.installed) {
    setStepStatus(step1El, 'done');
    unlockStep(step2El, step2Btn);
    setStepStatus(step2El, 'active');
  } else {
    setStepStatus(step1El, 'error');
    step1Error.hidden = false;
  }
});

// ── Step 2: Check iPhone Connection ──────────────────
step2Btn.addEventListener('click', async () => {
  setStepStatus(step2El, 'checking');
  step2Error.hidden = true;

  const status = await window.ghostAPI.checkStatus();

  if (!status.installed) {
    setStepStatus(step2El, 'error');
    showStepError(step2Error, 'Could not communicate with your iPhone. Make sure iTunes is installed and try again.');
    return;
  }

  if (!status.connected) {
    setStepStatus(step2El, 'error');
    showStepError(step2Error, 'No iPhone detected. Make sure it\'s plugged in with a USB cable and you tapped <strong>Trust</strong> on your phone.');
    return;
  }

  setStepStatus(step2El, 'done');
  unlockStep(step3El, step3CheckBtn);
  setStepStatus(step3El, 'active');
});

// ── Step 3: Developer Mode ───────────────────────────
step3CheckBtn.addEventListener('click', async () => {
  setStepStatus(step3El, 'checking');
  step3Error.hidden = true;

  const result = await window.ghostAPI.checkDevMode();

  if (result.enabled) {
    setStepStatus(step3El, 'done');
    unlockStep(step4El, step4Btn);
    setStepStatus(step4El, 'active');
  } else {
    setStepStatus(step3El, 'active');
    step3CheckBtn.textContent = 'Re-check Developer Mode';
    devModeGuide.hidden = false;
  }
});

// Sub-step 3a: Passcode off confirmation
substep3aDone.addEventListener('click', () => {
  substep3a.dataset.status = 'done';
  substep3b.dataset.status = '';
  substep3bBtn.disabled = false;
});

// Sub-step 3b: Enable Developer Mode
substep3bBtn.addEventListener('click', async () => {
  substep3bBtn.disabled = true;
  substep3bBtn.textContent = 'Enabling...';
  substep3bError.hidden = true;

  const result = await window.ghostAPI.enableDevMode();

  if (result.error) {
    substep3bBtn.disabled = false;
    substep3bBtn.textContent = 'Enable Developer Mode';

    let errMsg = result.error;
    if (errMsg.toLowerCase().includes('passcode')) {
      errMsg = 'Your passcode is still on. Go to <strong>Settings &rarr; Face ID & Passcode &rarr; Turn Passcode Off</strong> first, then try again.';
    } else {
      errMsg = 'Something went wrong: ' + errMsg + '. Make sure your iPhone is connected and unlocked.';
    }
    showStepError(substep3bError, errMsg);
    return;
  }

  substep3b.dataset.status = 'done';
  substep3bBtn.textContent = 'Sent! Phone will restart...';
  substep3c.dataset.status = '';
  substep3cDone.disabled = false;
});

// Sub-step 3c: Verify after restart
substep3cDone.addEventListener('click', async () => {
  substep3cDone.disabled = true;
  substep3cDone.textContent = 'Checking...';
  step3Error.hidden = true;

  const status = await window.ghostAPI.checkStatus();
  if (!status.connected) {
    substep3cDone.disabled = false;
    substep3cDone.textContent = 'Done — verify it worked';
    showStepError(step3Error, 'iPhone not detected. Reconnect USB cable, unlock your phone, tap <strong>Trust</strong> if asked, then try again.');
    return;
  }

  const result = await window.ghostAPI.checkDevMode();
  if (result.enabled) {
    setStepStatus(step3El, 'done');
    devModeGuide.hidden = true;
    unlockStep(step4El, step4Btn);
    setStepStatus(step4El, 'active');
  } else {
    substep3cDone.disabled = false;
    substep3cDone.textContent = 'Done — verify it worked';
    showStepError(step3Error, 'Developer Mode is not on yet. Make sure you tapped <strong>Turn On</strong> in the popup after your phone restarted, then try again.');
  }
});

// ── Step 4: Start Tunnel ─────────────────────────────
step4Btn.addEventListener('click', async () => {
  setStepStatus(step4El, 'checking');
  step4Error.hidden = true;
  step4Btn.textContent = 'Connecting...';

  await window.ghostAPI.autoMount();

  try {
    const tunnel = await window.ghostAPI.startTunnelElevated();
    if (tunnel.ready || tunnel.alreadyRunning) {
      setStepStatus(step4El, 'done');
      setupDone.hidden = false;
    } else if (tunnel.error) {
      setStepStatus(step4El, 'error');
      showStepError(step4Error, 'Connection failed: ' + tunnel.error);
      step4Btn.disabled = false;
      step4Btn.textContent = 'Try Again';
    }
  } catch (err) {
    setStepStatus(step4El, 'error');
    const hint = window.ghostAPI.platform === 'darwin'
      ? '. Make sure your iPhone is connected and unlocked.'
      : '. Click <strong>Yes</strong> on the admin prompt if it appears.';
    showStepError(step4Error, 'Connection failed: ' + err.message + hint);
    step4Btn.disabled = false;
    step4Btn.textContent = 'Try Again';
  }
});

// ── Done → Dismiss Wizard ────────────────────────────
setupDoneBtn.addEventListener('click', () => {
  setupOverlay.hidden = true;
  setStatus('connected', 'Ready to spoof!');
  loadHome();
});

// ── Auto-connect: skip wizard if already set up ──────
async function tryAutoConnect() {
  const status = await window.ghostAPI.checkStatus();
  if (!status.installed || !status.connected) return false;

  const devMode = await window.ghostAPI.checkDevMode();
  if (!devMode.enabled) return false;

  setStatus('searching', 'Connecting...');
  await window.ghostAPI.autoMount();

  try {
    const tunnel = await window.ghostAPI.startTunnelElevated();
    if (tunnel.ready || tunnel.alreadyRunning) {
      setupOverlay.hidden = true;
      setStatus('connected', 'Ready to spoof!');
      loadHome();
      return true;
    }
  } catch (e) {
    // Fall through to wizard
  }
  return false;
}

// Activate step 1, try auto-connect in background
if (window.ghostAPI.platform === 'darwin') {
  step1El.hidden = true;
  setStepStatus(step1El, 'done');
  unlockStep(step2El, step2Btn);
  setStepStatus(step2El, 'active');
  step2El.querySelector('.step-number').textContent = '1';
  step3El.querySelector('.step-number').textContent = '2';
  step4El.querySelector('.step-number').textContent = '3';
  step4El.querySelector('.step-desc').textContent = 'We’ll open a connection to your iPhone using macOS’s built-in device support.';
} else {
  setStepStatus(step1El, 'active');
}
tryAutoConnect();
