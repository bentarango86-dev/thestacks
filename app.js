// ---- SUPABASE CONFIG ----
// Fill these in from Project Settings → API in your Supabase dashboard.
// The anon key is safe to expose in client code — it's designed for this,
// and your Row Level Security policies are what actually protect the data.
const SUPABASE_URL = 'https://jqtibmsqlzcagydnnwpg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RjMrtGKMZZBL1WzR_DdG3w_xSYJkWfV';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let records = [];
// The list a Detail Modal was opened from (a gallery grid, the All Records
// table, etc.) so Prev/Next inside the modal flips through the same set the
// person was actually looking at, rather than some unrelated ordering.
let lastListContext = [];
let detailList = [];
let detailIndex = -1;

function recordMatchesQuery(r, q) {
  return r.album.toLowerCase().includes(q) ||
    r.artist.toLowerCase().includes(q) ||
    (r.genre || '').toLowerCase().includes(q);
}
let editingId = null;
let currentUser = null;

const el = id => document.getElementById(id);
const overlay = el('overlay');
const form = el('recordForm');

// Each page defines its own renderPage() (after this script loads) to draw
// whatever that page actually shows — this is just a safe default.
function renderPage() { renderStats(); }

// ---- AUTH ----
let authMode = 'signin'; // or 'signup'

el('authToggleBtn').addEventListener('click', () => {
  authMode = authMode === 'signin' ? 'signup' : 'signin';
  el('authTitle').textContent = authMode === 'signin' ? 'Sign in' : 'Create account';
  el('authSubmitBtn').textContent = authMode === 'signin' ? 'Sign in' : 'Sign up';
  el('authToggleBtn').textContent = authMode === 'signin' ? 'Need an account? Sign up' : 'Have an account? Sign in';
  el('authError').style.display = 'none';
  el('authStatus').style.display = 'none';
});

el('authSubmitBtn').addEventListener('click', async () => {
  const email = el('authEmail').value.trim();
  const password = el('authPassword').value;
  el('authError').style.display = 'none';
  el('authStatus').style.display = 'none';
  if (!email || !password) {
    el('authError').textContent = 'Enter both an email and a password.';
    el('authError').style.display = 'block';
    return;
  }
  el('authSubmitBtn').disabled = true;
  try {
    if (authMode === 'signup') {
      const { error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      el('authStatus').textContent = 'Account created. Check your email to confirm, then sign in.';
      el('authStatus').style.display = 'block';
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    el('authError').textContent = err.message || 'Something went wrong.';
    el('authError').style.display = 'block';
  }
  el('authSubmitBtn').disabled = false;
});

sb.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  if (currentUser) {
    checkAalAndProceed();
  } else {
    el('loginOverlay').classList.add('open');
    el('mfaChallengeOverlay').classList.remove('open');
    el('appBody').style.display = 'none';
    el('profileMenuWrap').style.display = 'none';
    closeProfileMenu();
    records = [];
    clearRecordsCache();
  }
});

async function checkAalAndProceed() {
  const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) {
    console.error(error);
    return;
  }
  if (data.nextLevel === 'aal2' && data.currentLevel !== data.nextLevel) {
    // User has MFA enrolled and hasn't completed the second factor yet this session.
    el('loginOverlay').classList.remove('open');
    el('appBody').style.display = 'none';
    el('profileMenuWrap').style.display = 'none';
    el('mfaChallengeOverlay').classList.add('open');
    el('mfaChallengeCode').value = '';
    el('mfaChallengeError').style.display = 'none';
    el('mfaChallengeCode').focus();
  } else {
    el('loginOverlay').classList.remove('open');
    el('mfaChallengeOverlay').classList.remove('open');
    el('appBody').style.display = 'block';
    el('profileMenuWrap').style.display = 'flex';
    setProfileIdentity(currentUser.email);
    loadRecords();
  }
}

// ---- Profile / "collector card" menu ----
// One consolidated identity control in the header (avatar + name + caret)
// instead of a loose row of buttons — Help, Security, and Sign out (plus
// Export CSV on pages that don't have a natural spot for it in-page) live
// behind it.
function deriveDisplayName(email) {
  if (!email) return '';
  const local = email.split('@')[0] || email;
  const cleaned = local.replace(/[._-]+/g, ' ').trim();
  const first = cleaned.split(' ')[0] || local;
  return first.charAt(0).toUpperCase() + first.slice(1);
}
function setProfileIdentity(email) {
  const name = deriveDisplayName(email);
  el('profileName').textContent = name;
  el('profileAvatar').textContent = name.charAt(0).toUpperCase();
  el('profileMenuBtn').title = email;
}
function openProfileMenu() {
  el('profileMenu').hidden = false;
  el('profileMenuBtn').classList.add('open');
  el('profileMenuBtn').setAttribute('aria-expanded', 'true');
}
function closeProfileMenu() {
  el('profileMenu').hidden = true;
  el('profileMenuBtn').classList.remove('open');
  el('profileMenuBtn').setAttribute('aria-expanded', 'false');
}
el('profileMenuBtn').addEventListener('click', e => {
  e.stopPropagation();
  if (el('profileMenu').hidden) openProfileMenu(); else closeProfileMenu();
});
document.addEventListener('click', e => {
  if (!el('profileMenu').hidden && !el('profileMenu').contains(e.target) && e.target !== el('profileMenuBtn')) {
    closeProfileMenu();
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !el('profileMenu').hidden) closeProfileMenu();
});

el('signOutBtn').addEventListener('click', async () => {
  closeProfileMenu();
  await sb.auth.signOut();
});

// ---- MFA: sign-in challenge (second factor) ----
el('mfaChallengeSubmitBtn').addEventListener('click', async () => {
  const code = el('mfaChallengeCode').value.trim();
  el('mfaChallengeError').style.display = 'none';
  if (!code) return;
  el('mfaChallengeSubmitBtn').disabled = true;
  try {
    const { data: factorsData, error: factorsErr } = await sb.auth.mfa.listFactors();
    if (factorsErr) throw factorsErr;
    const factor = (factorsData.totp || [])[0];
    if (!factor) throw new Error('No authenticator factor found.');
    const { data: challenge, error: challengeErr } = await sb.auth.mfa.challenge({ factorId: factor.id });
    if (challengeErr) throw challengeErr;
    const { error: verifyErr } = await sb.auth.mfa.verify({
      factorId: factor.id, challengeId: challenge.id, code
    });
    if (verifyErr) throw verifyErr;
    checkAalAndProceed();
  } catch (err) {
    el('mfaChallengeError').textContent = err.message || 'Invalid code, try again.';
    el('mfaChallengeError').style.display = 'block';
  }
  el('mfaChallengeSubmitBtn').disabled = false;
});
el('mfaChallengeCode').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); el('mfaChallengeSubmitBtn').click(); }
});
el('mfaChallengeSignOutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
});

// ---- MFA: security modal (enroll / disable) ----
let pendingFactorId = null;

function showMfaState(state) {
  el('mfaOffState').style.display = state === 'off' ? 'block' : 'none';
  el('mfaEnrollState').style.display = state === 'enrolling' ? 'block' : 'none';
  el('mfaOnState').style.display = state === 'on' ? 'block' : 'none';
}

el('securityBtn').addEventListener('click', async () => {
  closeProfileMenu();
  el('securityOverlay').classList.add('open');
  const { data, error } = await sb.auth.mfa.listFactors();
  if (error) { console.error(error); return; }
  const verified = (data.totp || []).find(f => f.status === 'verified');
  showMfaState(verified ? 'on' : 'off');
});
[el('securityCloseBtn1'), el('securityCloseBtn2')].forEach(btn =>
  btn.addEventListener('click', () => el('securityOverlay').classList.remove('open'))
);
el('securityOverlay').addEventListener('click', e => {
  if (e.target === el('securityOverlay')) el('securityOverlay').classList.remove('open');
});

el('helpBtn').addEventListener('click', () => {
  closeProfileMenu();
  el('helpOverlay').classList.add('open');
});
el('helpCloseBtn').addEventListener('click', () => el('helpOverlay').classList.remove('open'));
el('helpOverlay').addEventListener('click', e => {
  if (e.target === el('helpOverlay')) el('helpOverlay').classList.remove('open');
});

el('mfaEnableBtn').addEventListener('click', async () => {
  try {
    const { data, error } = await sb.auth.mfa.enroll({
      factorType: 'totp', friendlyName: 'Authenticator app'
    });
    if (error) throw error;
    pendingFactorId = data.id;
    el('mfaQrCode').src = data.totp.qr_code;
    el('mfaSecret').textContent = data.totp.secret;
    el('mfaEnrollCode').value = '';
    el('mfaEnrollError').style.display = 'none';
    showMfaState('enrolling');
  } catch (err) {
    alert('Could not start enrollment: ' + err.message);
  }
});

el('mfaEnrollConfirmBtn').addEventListener('click', async () => {
  const code = el('mfaEnrollCode').value.trim();
  el('mfaEnrollError').style.display = 'none';
  if (!code || !pendingFactorId) return;
  el('mfaEnrollConfirmBtn').disabled = true;
  try {
    const { data: challenge, error: challengeErr } = await sb.auth.mfa.challenge({ factorId: pendingFactorId });
    if (challengeErr) throw challengeErr;
    const { error: verifyErr } = await sb.auth.mfa.verify({
      factorId: pendingFactorId, challengeId: challenge.id, code
    });
    if (verifyErr) throw verifyErr;
    pendingFactorId = null;
    showMfaState('on');
  } catch (err) {
    el('mfaEnrollError').textContent = err.message || 'Invalid code, try again.';
    el('mfaEnrollError').style.display = 'block';
  }
  el('mfaEnrollConfirmBtn').disabled = false;
});

el('mfaEnrollCancelBtn').addEventListener('click', async () => {
  if (pendingFactorId) {
    await sb.auth.mfa.unenroll({ factorId: pendingFactorId }).catch(() => {});
    pendingFactorId = null;
  }
  showMfaState('off');
});

el('mfaDisableBtn').addEventListener('click', async () => {
  if (!confirm('Turn off two-factor authentication? You\'ll only need your password to sign in after this.')) return;
  try {
    const { data, error } = await sb.auth.mfa.listFactors();
    if (error) throw error;
    const factor = (data.totp || [])[0];
    if (factor) {
      const { error: unenrollErr } = await sb.auth.mfa.unenroll({ factorId: factor.id });
      if (unenrollErr) throw unenrollErr;
    }
    showMfaState('off');
  } catch (err) {
    alert('Could not disable 2FA: ' + err.message);
  }
});

// ---- RECORD CRUD (Supabase) ----
// ---- RECORDS CACHE (sessionStorage) ----
// Lets a page navigation (Stacks → All Records, drilling into a genre, etc.)
// render instantly from the last known list instead of showing a blank
// screen while Supabase re-fetches on every single click. Short freshness
// window keeps it from ever going noticeably stale.
const RECORDS_CACHE_KEY = 'stacks:recordsCache';
const RECORDS_CACHE_FRESH_MS = 60000;

function getCachedRecords() {
  try {
    const raw = sessionStorage.getItem(RECORDS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.records)) return null;
    return parsed;
  } catch (e) { return null; }
}
function setCachedRecords(list) {
  try {
    sessionStorage.setItem(RECORDS_CACHE_KEY, JSON.stringify({
      records: list, savedAt: Date.now(), userId: currentUser ? currentUser.id : null
    }));
  } catch (e) { /* private browsing / quota — non-fatal, just skip caching */ }
}
function clearRecordsCache() {
  try { sessionStorage.removeItem(RECORDS_CACHE_KEY); } catch (e) { /* non-fatal */ }
}

function showLoadingState() { const l = el('loadingState'); if (l) l.style.display = 'flex'; }
function hideLoadingState() { const l = el('loadingState'); if (l) l.style.display = 'none'; }

// ---- RECORD CRUD (Supabase) ----
function mapRow(r) {
  return {
    id: r.id,
    album: r.album,
    artist: r.artist,
    year: r.year || '',
    genre: r.genre || '',
    format: r.format,
    condition: r.condition,
    price: r.price || 0,
    purchaseDate: r.purchase_date || '',
    notes: r.notes || '',
    addedAt: r.added_at,
    coverUrl: r.cover_url || '',
    label: r.label || '',
    catalogNumber: r.catalog_number || '',
    country: r.country || '',
    releaseType: r.release_type || '',
    tracklist: r.tracklist || '',
    isFace: r.is_face || false,
    estimatedValue: r.estimated_value || 0
  };
}

async function loadRecords() {
  // Serve a fresh-enough cached list immediately (if we have one for this
  // user) so navigating between pages doesn't flash blank while re-fetching —
  // then quietly revalidate against the server underneath.
  const cached = getCachedRecords();
  const cacheIsFresh = cached && cached.userId === currentUser?.id &&
    (Date.now() - cached.savedAt) < RECORDS_CACHE_FRESH_MS;

  if (cacheIsFresh) {
    records = cached.records;
    renderPage();
  } else {
    showLoadingState();
  }

  const { data, error } = await sb
    .from('records')
    .select('*')
    .order('added_at', { ascending: false });

  if (error) {
    console.error(error);
    hideLoadingState();
    if (!cacheIsFresh) alert('Could not load your collection: ' + error.message);
    return;
  }

  records = (data || []).map(mapRow);
  setCachedRecords(records);
  hideLoadingState();
  renderPage();
}

async function fetchCoverArt(kind, mbid) {
  // kind is 'release-group' (from name search) or 'release' (from barcode search)
  try {
    const url = `https://coverartarchive.org/${kind}/${mbid}/front-500`;
    const res = await fetch(url, { method: 'HEAD' });
    if (res.ok) return url;
  } catch (e) { /* no art on file — that's common, not an error */ }
  return null;
}

function extractReleaseDetails(release) {
  const labelInfo = (release['label-info'] || [])[0];
  const label = labelInfo && labelInfo.label ? labelInfo.label.name : '';
  const catalogNumber = labelInfo ? (labelInfo['catalog-number'] || '') : '';
  const country = release.country || '';
  const media = (release.media || [])[0];
  let tracklist = '';
  if (media && media.tracks && media.tracks.length) {
    tracklist = media.tracks.map(t => {
      const ms = t.length;
      const dur = ms ? ` (${Math.floor(ms/60000)}:${String(Math.round((ms%60000)/1000)).padStart(2,'0')})` : '';
      return `${t.number}. ${t.title}${dur}`;
    }).join('\n');
  }
  return { label, catalogNumber, country, tracklist };
}

async function fetchReleaseDetails(releaseGroupId) {
  try {
    const url = `https://musicbrainz.org/ws/2/release?release-group=${releaseGroupId}&inc=labels+recordings+media&fmt=json&limit=15`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    const releases = data.releases || [];
    if (releases.length === 0) return null;
    const vinylRelease = releases.find(r => (r.media || []).some(m => m.format === 'Vinyl'));
    return extractReleaseDetails(vinylRelease || releases[0]);
  } catch (e) {
    return null;
  }
}

async function searchMusicBrainz(query) {
  const resultsEl = el('lookupResults');
  resultsEl.innerHTML = '<div class="lookup-status">Searching…</div>';
  try {
    const url = 'https://musicbrainz.org/ws/2/release-group/?query=' +
      encodeURIComponent(query) + '&fmt=json&limit=8';
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('Lookup failed');
    const data = await res.json();
    const hits = data['release-groups'] || [];
    if (hits.length === 0) {
      resultsEl.innerHTML = '<div class="lookup-status">No matches. Try a simpler search, or just enter it manually below.</div>';
      return;
    }
    resultsEl.innerHTML = hits.map((h, i) => {
      const artist = (h['artist-credit'] || []).map(a => a.name).join(', ');
      const year = h['first-release-date'] ? h['first-release-date'].slice(0, 4) : '';
      const type = h['primary-type'] || '';
      return `<div class="lookup-hit" data-idx="${i}">
        <div>
          <div class="lh-title">${escapeHtml(h.title || '')}</div>
          <div class="lh-sub">${escapeHtml(artist)}${year ? ' · ' + year : ''}${type ? ' · ' + escapeHtml(type) : ''}</div>
        </div>
      </div>`;
    }).join('');
    resultsEl.querySelectorAll('.lookup-hit').forEach(node => {
      node.addEventListener('click', async () => {
        const h = hits[parseInt(node.dataset.idx)];
        const artist = (h['artist-credit'] || []).map(a => a.name).join(', ');
        const year = h['first-release-date'] ? h['first-release-date'].slice(0, 4) : '';
        el('album').value = h.title || '';
        el('artist').value = artist;
        if (year) el('year').value = year;
        if (h.tags && h.tags.length) {
          el('genre').value = h.tags.sort((a,b) => b.count - a.count)[0].name;
        }
        el('releaseType').value = [h['primary-type'], ...(h['secondary-types']||[])].filter(Boolean).join(', ');
        resultsEl.innerHTML = '<div class="lookup-status">Filled in below — checking for cover art and release details…</div>';
        const [art, details] = await Promise.all([
          h.id ? fetchCoverArt('release-group', h.id) : null,
          h.id ? fetchReleaseDetails(h.id) : null
        ]);
        if (art) {
          el('coverUrl').value = art;
          updateCoverPreview();
        }
        if (details) {
          el('label').value = details.label;
          el('catalogNumber').value = details.catalogNumber;
          el('country').value = details.country;
          el('tracklist').value = details.tracklist;
        }
        resultsEl.innerHTML = art
          ? '<div class="lookup-status">Filled in below, cover art found — adjust anything, then save.</div>'
          : '<div class="lookup-status">Filled in below — no cover art on file, paste a URL if you have one.</div>';
      });
    });
  } catch (e) {
    resultsEl.innerHTML = '<div class="lookup-status">Lookup failed. Check your connection, or enter it manually below.</div>';
  }
}

async function searchByBarcode(code) {
  const resultsEl = el('lookupResults');
  resultsEl.innerHTML = '<div class="lookup-status">Looking up barcode…</div>';
  try {
    const url = 'https://musicbrainz.org/ws/2/release/?query=barcode:' +
      encodeURIComponent(code) + '&fmt=json&limit=8&inc=labels+recordings+media+release-groups';
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('Lookup failed');
    const data = await res.json();
    const hits = data['releases'] || [];
    if (hits.length === 0) {
      resultsEl.innerHTML = '<div class="lookup-status">No release found for that barcode. Try the name search above, or enter it manually.</div>';
      return;
    }
    resultsEl.innerHTML = hits.map((h, i) => {
      const artist = (h['artist-credit'] || []).map(a => a.name).join(', ');
      const year = h.date ? h.date.slice(0, 4) : '';
      const country = h.country ? ' · ' + h.country : '';
      const fmt = (h.media && h.media[0] && h.media[0].format) ? ' · ' + h.media[0].format : '';
      return `<div class="lookup-hit" data-idx="${i}">
        <div>
          <div class="lh-title">${escapeHtml(h.title || '')}</div>
          <div class="lh-sub">${escapeHtml(artist)}${year ? ' · ' + year : ''}${country}${fmt}</div>
        </div>
      </div>`;
    }).join('');
    resultsEl.querySelectorAll('.lookup-hit').forEach(node => {
      node.addEventListener('click', async () => {
        const h = hits[parseInt(node.dataset.idx)];
        const artist = (h['artist-credit'] || []).map(a => a.name).join(', ');
        const year = h.date ? h.date.slice(0, 4) : '';
        const fmt = (h.media && h.media[0] && h.media[0].format) ? h.media[0].format : '';
        el('album').value = h.title || '';
        el('artist').value = artist;
        if (year) el('year').value = year;
        if (fmt === 'Vinyl') el('format').value = 'LP';
        const rg = h['release-group'];
        if (rg) {
          el('releaseType').value = [rg['primary-type'], ...(rg['secondary-types']||[])].filter(Boolean).join(', ');
        }
        const details = extractReleaseDetails(h);
        el('label').value = details.label;
        el('catalogNumber').value = details.catalogNumber;
        el('country').value = details.country;
        el('tracklist').value = details.tracklist;
        resultsEl.innerHTML = '<div class="lookup-status">Filled in below — checking for cover art…</div>';
        const art = h.id ? await fetchCoverArt('release', h.id) : null;
        if (art) {
          el('coverUrl').value = art;
          updateCoverPreview();
          resultsEl.innerHTML = '<div class="lookup-status">Filled in below, cover art found — adjust anything, then save.</div>';
        } else {
          resultsEl.innerHTML = '<div class="lookup-status">Filled in below — no cover art on file, paste a URL if you have one.</div>';
        }
      });
    });
  } catch (e) {
    resultsEl.innerHTML = '<div class="lookup-status">Lookup failed. Check your connection, or enter it manually.</div>';
  }
}

el('barcodeBtn').addEventListener('click', () => {
  const code = el('barcodeQuery').value.trim();
  if (code) searchByBarcode(code);
});
el('barcodeQuery').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); el('barcodeBtn').click(); }
});

let scannerRunning = false;

function startScanner() {
  el('scannerBox').style.display = 'block';
  el('lookupResults').innerHTML = '';
  if (typeof Quagga === 'undefined') {
    el('lookupResults').innerHTML = '<div class="lookup-status">Scanner library failed to load. Enter the barcode number manually above.</div>';
    el('scannerBox').style.display = 'none';
    return;
  }
  Quagga.init({
    inputStream: {
      type: 'LiveStream',
      target: document.querySelector('#scannerViewport'),
      constraints: { facingMode: 'environment' }
    },
    decoder: {
      readers: ['ean_reader', 'upc_reader', 'upc_e_reader']
    },
    locate: true
  }, err => {
    if (err) {
      el('lookupResults').innerHTML = '<div class="lookup-status">Could not access camera. Check permissions, or enter the barcode manually above.</div>';
      el('scannerBox').style.display = 'none';
      return;
    }
    Quagga.start();
    scannerRunning = true;
  });

  Quagga.onDetected(handleDetected);
}

function handleDetected(result) {
  const code = result?.codeResult?.code;
  if (!code) return;
  stopScanner();
  el('barcodeQuery').value = code;
  searchByBarcode(code);
}

function stopScanner() {
  if (scannerRunning && typeof Quagga !== 'undefined') {
    Quagga.offDetected(handleDetected);
    Quagga.stop();
    scannerRunning = false;
  }
  el('scannerBox').style.display = 'none';
}

el('scanBtn').addEventListener('click', startScanner);
el('scanCancelBtn').addEventListener('click', stopScanner);

el('lookupBtn').addEventListener('click', () => {
  const q = el('lookupQuery').value.trim();
  if (q) searchMusicBrainz(q);
});
el('lookupQuery').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); el('lookupBtn').click(); }
});

function updateCoverPreview() {
  const url = el('coverUrl').value.trim();
  const img = el('coverPreview');
  if (url) {
    img.src = url;
    img.style.display = 'block';
  } else {
    img.style.display = 'none';
  }
}
el('coverUrl').addEventListener('input', updateCoverPreview);
el('coverPreview').addEventListener('error', () => { el('coverPreview').style.display = 'none'; });

function openModal(record) {
  form.reset();
  stopScanner();
  el('lookupQuery').value = '';
  el('barcodeQuery').value = '';
  el('lookupResults').innerHTML = '';
  el('condition').value = 'VG';
  el('coverUrl').value = '';
  updateCoverPreview();
  if (record) {
    editingId = record.id;
    el('modalTitle').textContent = 'Edit Record';
    el('recordId').value = record.id;
    el('album').value = record.album || '';
    el('artist').value = record.artist || '';
    el('year').value = record.year || '';
    el('genre').value = record.genre || '';
    el('format').value = record.format || 'LP';
    el('condition').value = record.condition || 'VG';
    el('price').value = record.price || '';
    el('estimatedValue').value = record.estimatedValue || '';
    el('purchaseDate').value = record.purchaseDate || '';
    el('notes').value = record.notes || '';
    el('coverUrl').value = record.coverUrl || '';
    el('releaseType').value = record.releaseType || '';
    el('country').value = record.country || '';
    el('label').value = record.label || '';
    el('catalogNumber').value = record.catalogNumber || '';
    el('tracklist').value = record.tracklist || '';
    updateCoverPreview();
  } else {
    editingId = null;
    el('modalTitle').textContent = 'Add Record';
  }
  overlay.classList.add('open');
  el('album').focus();
}

function closeModal() { overlay.classList.remove('open'); stopScanner(); }

el('addBtn').addEventListener('click', () => openModal(null));
el('cancelBtn').addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

form.addEventListener('submit', async e => {
  e.preventDefault();
  const payload = {
    user_id: currentUser.id,
    album: el('album').value.trim(),
    artist: el('artist').value.trim(),
    year: el('year').value.trim(),
    genre: el('genre').value.trim(),
    format: el('format').value,
    condition: el('condition').value,
    price: parseFloat(el('price').value) || 0,
    estimated_value: parseFloat(el('estimatedValue').value) || null,
    purchase_date: el('purchaseDate').value || null,
    notes: el('notes').value.trim(),
    cover_url: el('coverUrl').value.trim() || null,
    release_type: el('releaseType').value.trim() || null,
    country: el('country').value.trim() || null,
    label: el('label').value.trim() || null,
    catalog_number: el('catalogNumber').value.trim() || null,
    tracklist: el('tracklist').value.trim() || null,
    added_at: editingId ? (records.find(r => r.id === editingId)?.addedAt || Date.now()) : Date.now()
  };

  if (!editingId) {
    const isDuplicate = records.some(r =>
      r.album.trim().toLowerCase() === payload.album.toLowerCase() &&
      r.artist.trim().toLowerCase() === payload.artist.toLowerCase()
    );
    if (isDuplicate) {
      const proceed = confirm(`You already have "${payload.album}" by ${payload.artist} in your collection. Add it again anyway?`);
      if (!proceed) return;
    }
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;

  if (editingId) {
    // Optimistic: apply the edit locally and close the modal right away,
    // reconciling with the server in the background instead of making the
    // whole save feel like it's waiting on a network round trip.
    const idx = records.findIndex(r => r.id === editingId);
    const previous = idx > -1 ? records[idx] : null;
    if (idx > -1) {
      records[idx] = mapRow({ ...payload, id: editingId, is_face: previous.isFace });
      setCachedRecords(records);
    }
    closeModal();
    renderPage();
    submitBtn.disabled = false;

    const { error } = await sb.from('records').update(payload).eq('id', editingId);
    if (error) {
      if (previous && idx > -1) {
        records[idx] = previous;
        setCachedRecords(records);
        renderPage();
      }
      alert('Could not save your changes: ' + error.message);
    }
  } else {
    // A brand-new record needs its real row back from the server (id,
    // defaults) before it can safely enter the local list, so this path
    // still waits on the insert rather than going fully optimistic.
    const { error } = await sb.from('records').insert(payload);
    submitBtn.disabled = false;
    if (error) {
      alert('Could not save: ' + error.message);
      return;
    }
    closeModal();
    await loadRecords();
  }
});

async function deleteRecord(id) {
  if (!confirm('Remove this record from your collection?')) return;

  const index = records.findIndex(x => x.id === id);
  if (index === -1) return;
  const [removed] = records.splice(index, 1);
  setCachedRecords(records);
  renderPage();

  const { error } = await sb.from('records').delete().eq('id', id);
  if (error) {
    records.splice(index, 0, removed);
    setCachedRecords(records);
    renderPage();
    alert('Could not delete: ' + error.message);
  }
}

function editRecord(id) {
  const r = records.find(x => x.id === id);
  if (r) openModal(r);
}

// Refreshes just the star-cover control on the currently-open Detail Modal,
// if it happens to be showing the record that was just toggled — toggleFace
// can be triggered from the gallery/table/shelf behind the modal too (once
// those get real-time updates), so this keeps the open view in sync without
// forcing a full reopen.
function refreshOpenDetailStar(id) {
  if (!el('detailOverlay').classList.contains('open')) return;
  const current = detailList[detailIndex];
  if (!current || current.id !== id) return;
  const r = records.find(x => x.id === id);
  if (!r) return;
  el('detailStarBtn').classList.toggle('active', !!r.isFace);
  el('detailStarLabel').textContent = r.isFace ? 'Stack cover' : 'Set as stack cover';
}

async function toggleFace(id) {
  const record = records.find(x => x.id === id);
  if (!record) return;
  if (!record.genre) {
    alert('Give this record a genre before setting it as a stack cover — covers are picked per genre.');
    return;
  }

  // Optimistic: flip locally and re-render immediately, reconciling with the
  // server afterward instead of waiting on a full refetch for one toggle.
  const snapshot = records.map(r => ({ id: r.id, isFace: r.isFace }));
  const turningOn = !record.isFace;
  records.forEach(r => {
    if (r.id === id) r.isFace = turningOn;
    else if (turningOn && r.genre === record.genre) r.isFace = false;
  });
  setCachedRecords(records);
  renderPage();
  refreshOpenDetailStar(id);

  try {
    if (!turningOn) {
      const { error } = await sb.from('records').update({ is_face: false }).eq('id', id);
      if (error) throw error;
    } else {
      const { error: clearErr } = await sb.from('records')
        .update({ is_face: false })
        .eq('user_id', currentUser.id)
        .eq('genre', record.genre);
      if (clearErr) throw clearErr;
      const { error: setErr } = await sb.from('records').update({ is_face: true }).eq('id', id);
      if (setErr) throw setErr;
    }
  } catch (err) {
    snapshot.forEach(s => {
      const r = records.find(x => x.id === s.id);
      if (r) r.isFace = s.isFace;
    });
    setCachedRecords(records);
    renderPage();
    refreshOpenDetailStar(id);
    alert('Could not update stack cover: ' + err.message);
  }
}

function renderStats() {
  if (!el('stats')) return;
  const total = records.length;
  const hasAnyValue = records.some(r => r.estimatedValue > 0);
  const value = records.reduce((sum, r) => sum + (r.estimatedValue || 0), 0);
  const genres = new Set(records.map(r => r.genre).filter(Boolean)).size;
  const decades = {};
  records.forEach(r => {
    const y = parseInt(r.year);
    if (y) {
      const d = Math.floor(y / 10) * 10 + 's';
      decades[d] = (decades[d] || 0) + 1;
    }
  });
  const topDecade = Object.entries(decades).sort((a,b) => b[1]-a[1])[0];
  const valueDisplay = hasAnyValue
    ? `<div class="n">$${value.toFixed(0)}</div>`
    : `<div class="n" style="font-size:15px;">Not calculated</div>`;

  el('stats').innerHTML = `
    <div class="stat"><div class="n">${total}</div><div class="l">Record${total === 1 ? '' : 's'}</div></div>
    <div class="stat">${valueDisplay}<div class="l">Collection Value</div></div>
    <div class="stat"><div class="n">${genres}</div><div class="l">Genre${genres === 1 ? '' : 's'}</div></div>
    <div class="stat"><div class="n">${topDecade ? topDecade[0] : '—'}</div><div class="l">Top Decade</div></div>
  `;
}

function renderGenreFilter() {
  const filterEl = el('filterGenre');
  if (!filterEl) return;
  const current = filterEl.value;
  const genres = [...new Set(records.map(r => r.genre).filter(Boolean))].sort();
  const hasUnsorted = records.some(r => !r.genre);
  filterEl.innerHTML = '<option value="">All genres</option>' +
    genres.map(g => `<option value="${escapeAttr(g)}">${escapeHtml(g)}</option>`).join('') +
    (hasUnsorted ? '<option value="__none__">No genre</option>' : '');
  filterEl.value = current;
}

// ---- Shared genre → icon mapping (used by stacks tiles, gallery cards, detail modal) ----
function iconForGenre(genre) {
  const g = (genre || '').toLowerCase();
  const map = [
    [['rock', 'grunge', 'punk', 'metal'], 'ti-guitar-pick'],
    [['jazz', 'blues'], 'ti-piano'],
    [['classical', 'orchestra'], 'ti-violin'],
    [['electronic', 'techno', 'house', 'edm'], 'ti-wave-square'],
    [['hip hop', 'rap'], 'ti-microphone-2'],
    [['country', 'folk', 'americana'], 'ti-guitar-pick'],
    [['soundtrack', 'score'], 'ti-movie'],
  ];
  for (const [keywords, icon] of map) {
    if (keywords.some(k => g.includes(k))) return icon;
  }
  return 'ti-music';
}

// ---- GALLERY CARD GRID (album-art-first browsing — replaces the old dense collector cards) ----
// Desktop: hover reveals condition/year + quick actions.
// Mobile (no hover capability): first tap reveals the same overlay, second tap opens the detail modal.
function renderGalleryGrid(container, list) {
  if (!container) return;
  lastListContext = list;
  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state">No records here yet.</div>`;
    return;
  }
  container.innerHTML = list.map(r => {
    const coverHtml = r.coverUrl
      ? `<img src="${escapeAttr(r.coverUrl)}" alt="" loading="lazy" onload="this.parentElement.classList.remove('img-loading')" onerror="this.parentElement.classList.remove('img-loading'); this.outerHTML='<div class=&quot;gallery-cover-fallback&quot;><i class=&quot;ti ${iconForGenre(r.genre)}&quot;></i></div>'">`
      : `<div class="gallery-cover-fallback"><i class="ti ${iconForGenre(r.genre)}"></i></div>`;
    return `
      <div class="gallery-card">
        <div class="gallery-cover-wrap${r.coverUrl ? ' img-loading' : ''}" onclick='handleGalleryTap(this, "${r.id}")'>
          ${coverHtml}
          ${r.isFace ? '<div class="gallery-face-badge" title="Current stack cover"><i class="ti ti-star"></i></div>' : ''}
          <div class="gallery-overlay">
            <div class="gallery-overlay-meta">
              <span>${escapeHtml(r.condition || '')}</span>
              <span>${escapeHtml(r.year || '')}</span>
            </div>
            <div class="gallery-overlay-actions">
              <button class="star ${r.isFace ? 'active' : ''}" onclick='event.stopPropagation(); toggleFace("${r.id}")' title="Set as stack cover"><i class="ti ti-star"></i></button>
              <button onclick='event.stopPropagation(); editRecord("${r.id}")' title="Edit"><i class="ti ti-pencil"></i></button>
              <button onclick='event.stopPropagation(); openDetailModal("${r.id}")' title="View"><i class="ti ti-eye"></i></button>
            </div>
          </div>
        </div>
        <div class="gallery-label">
          <div class="gallery-album">${escapeHtml(r.album)}</div>
          <div class="gallery-artist">${escapeHtml(r.artist)}</div>
        </div>
      </div>
    `;
  }).join('');
  armLazyImageTimeouts(container);
}

function handleGalleryTap(wrap, id) {
  const supportsHover = window.matchMedia('(hover: hover)').matches;
  if (supportsHover) {
    openDetailModal(id);
    return;
  }
  if (wrap.classList.contains('revealed')) {
    openDetailModal(id);
  } else {
    document.querySelectorAll('.gallery-cover-wrap.revealed').forEach(w => {
      if (w !== wrap) w.classList.remove('revealed');
    });
    wrap.classList.add('revealed');
  }
}

// ---- SHELF COVER (Stacks homepage — bare art, nothing shown until hover/tap) ----
// Several shelves are visible at once, so each cover needs to point Prev/Next
// at its OWN shelf's list, not whichever shelf happened to render last —
// shelfListRegistry + setShelfContext resolve that at click time.
let shelfListRegistry = {};
function setShelfContext(key) {
  lastListContext = shelfListRegistry[key] || [];
  // Soft hook: only the Stacks page defines saveLastGenre (for "Continue
  // Browsing"). Records.html never builds shelves, so this never fires there.
  if (typeof saveLastGenre === 'function') saveLastGenre(key);
}

// Today / Yesterday / weekday / short date — matches how someone would
// actually describe when something came in, not a raw timestamp.
function relativeAddedLabel(addedAt) {
  if (!addedAt) return null;
  const added = new Date(addedAt);
  if (isNaN(added)) return null;
  const startOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOf(new Date()) - startOf(added)) / 86400000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return added.toLocaleDateString(undefined, { weekday: 'long' });
  return added.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function buildShelfCover(r, listKey, opts = {}) {
  const coverHtml = r.coverUrl
    ? `<img src="${escapeAttr(r.coverUrl)}" alt="" loading="lazy" onload="this.parentElement.classList.remove('img-loading')" onerror="this.parentElement.classList.remove('img-loading'); this.outerHTML='<div class=&quot;gallery-cover-fallback&quot;><i class=&quot;ti ${iconForGenre(r.genre)}&quot;></i></div>'">`
    : `<div class="gallery-cover-fallback"><i class="ti ${iconForGenre(r.genre)}"></i></div>`;
  const key = escapeAttr(JSON.stringify(listKey));
  const addedLabel = opts.featured ? relativeAddedLabel(r.addedAt) : null;
  return `
    <div class="gallery-cover-wrap shelf-cover${opts.featured ? ' shelf-cover-featured' : ''}${r.coverUrl ? ' img-loading' : ''}" onclick='setShelfContext(${key}); handleGalleryTap(this, "${r.id}")'>
      ${coverHtml}
      ${addedLabel ? `<div class="shelf-added-badge">Added ${addedLabel}</div>` : ''}
      <div class="shelf-cover-overlay">
        <div class="shelf-cover-text">
          <div class="shelf-cover-album">${escapeHtml(r.album)}</div>
          <div class="shelf-cover-artist">${escapeHtml(r.artist)}</div>
        </div>
        <div class="shelf-cover-actions">
          <button onclick='event.stopPropagation(); setShelfContext(${key}); openDetailModal("${r.id}")' title="View record"><i class="ti ti-eye"></i>View</button>
        </div>
      </div>
    </div>
  `;
}

// ---- SHELF SCROLL ARROWS ----
// Arrows page the row by roughly a screenful, and hide themselves at each end
// (and entirely when the whole shelf already fits) so they never sit there dead.
function updateShelfArrows(row) {
  const body = row.closest('.shelf-body');
  if (!body) return;
  const prev = body.querySelector('.shelf-arrow.prev');
  const next = body.querySelector('.shelf-arrow.next');
  if (!prev || !next) return;
  // 2px slack absorbs sub-pixel rounding, which otherwise leaves the "next"
  // arrow visible-but-useless when a row is scrolled fully to the end.
  const maxScroll = row.scrollWidth - row.clientWidth;
  const overflows = maxScroll > 2;
  prev.hidden = !overflows || row.scrollLeft <= 2;
  next.hidden = !overflows || row.scrollLeft >= maxScroll - 2;
}

function scrollShelf(btn, direction) {
  const row = btn.closest('.shelf-body').querySelector('.shelf-row');
  if (!row) return;
  row.scrollBy({ left: direction * Math.max(row.clientWidth * 0.8, 160), behavior: 'smooth' });
}

function wireShelfArrows(row) {
  if (!row) return;
  row.addEventListener('scroll', () => updateShelfArrows(row), { passive: true });
  // Cover art loads in after render and can change scrollWidth, so re-check.
  row.querySelectorAll('img').forEach(img => {
    if (!img.complete) img.addEventListener('load', () => updateShelfArrows(row), { once: true });
  });
  updateShelfArrows(row);
}

// One observer for all shelves — recalculates arrow visibility when the
// viewport (and therefore each row's clientWidth) changes.
const shelfResizeObserver = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver(entries => entries.forEach(e => updateShelfArrows(e.target)))
  : null;

function buildShelfRow(container, list, listKey, opts = {}) {
  if (!container) return;
  shelfListRegistry[listKey] = list;
  container.innerHTML = list.map(r => buildShelfCover(r, listKey, opts)).join('');
  armLazyImageTimeouts(container);
  wireShelfArrows(container);
  if (shelfResizeObserver) shelfResizeObserver.observe(container);
}

// ---- ALBUM DETAIL MODAL ("opening the record jacket") ----
// This is a dedicated VIEWING experience, deliberately separate from
// editing: the only actions surfaced here are Edit (hands off to the
// record form) and Set as stack cover (a curation action, not an edit).
// Delete lives exclusively in the edit/management flows (the record form
// isn't the place for it either — All Records' row actions and the
// gallery overlay are), never inside the viewing experience itself.
function openDetailModal(id) {
  closeDetailMenu();
  // Flip through whichever list this was opened from (the grid or table the
  // person was just looking at) — falls back to the full collection if the
  // record isn't part of the last-rendered list (e.g. Random Record).
  const contextList = lastListContext.some(x => x.id === id) ? lastListContext : records;
  const idx = contextList.findIndex(x => x.id === id);
  const r = idx > -1 ? contextList[idx] : records.find(x => x.id === id);
  if (!r) return;
  detailList = contextList;
  detailIndex = idx;

  if (r.coverUrl) {
    el('detailCoverWrap').classList.add('img-loading');
    el('detailCoverWrap').classList.remove('has-cover');
    el('detailCover').onload = () => {
      el('detailCoverWrap').classList.remove('img-loading');
      el('detailCoverWrap').classList.add('has-cover');
    };
    el('detailCover').onerror = () => {
      el('detailCoverWrap').classList.remove('img-loading');
      el('detailCoverWrap').classList.remove('has-cover');
      el('detailCover').style.display = 'none';
      el('detailCoverFallback').style.display = 'flex';
      el('detailCoverFallback').innerHTML = `<i class="ti ${iconForGenre(r.genre)}"></i>`;
    };
    el('detailCover').src = r.coverUrl;
    el('detailCover').style.display = 'block';
    el('detailCoverFallback').style.display = 'none';
  } else {
    el('detailCoverWrap').classList.remove('img-loading');
    el('detailCoverWrap').classList.remove('has-cover');
    el('detailCover').style.display = 'none';
    el('detailCoverFallback').style.display = 'flex';
    el('detailCoverFallback').innerHTML = `<i class="ti ${iconForGenre(r.genre)}"></i>`;
  }

  el('detailAlbum').textContent = r.album;
  el('detailAlbum').title = r.album;
  el('detailArtist').textContent = r.artist;
  el('detailArtist').title = r.artist;

  const metaLines = [
    [r.year, r.format, r.releaseType].filter(Boolean).join(' · '),
    [r.label, r.catalogNumber].filter(Boolean).join(' · '),
    r.country
  ].filter(Boolean);
  el('detailMeta').innerHTML = metaLines.map(l => `<div title="${escapeAttr(l)}">${escapeHtml(l)}</div>`).join('');

  el('detailCondition').textContent = r.condition || '—';
  el('detailPrice').textContent = r.price ? '$' + r.price.toFixed(2) : '—';
  el('detailValue').textContent = r.estimatedValue ? '$' + r.estimatedValue.toFixed(2) : '—';

  if (r.notes) {
    el('detailNotes').textContent = r.notes;
    el('detailNotesWrap').style.display = 'block';
  } else {
    el('detailNotesWrap').style.display = 'none';
  }

  const tracks = r.tracklist ? r.tracklist.split('\n').filter(Boolean) : [];
  if (tracks.length) {
    el('detailTracklist').innerHTML = tracks.map(t => `<li>${escapeHtml(t)}</li>`).join('');
    el('detailTracklistWrap').style.display = 'block';
  } else {
    el('detailTracklistWrap').style.display = 'none';
  }
  // Hide the whole scroll region (and its top border) when there's neither
  // notes nor a tracklist, rather than leaving an empty bordered gap.
  const scrollEl = document.querySelector('#detailOverlay .detail-modal-scroll');
  if (scrollEl) scrollEl.style.display = (r.notes || tracks.length) ? 'block' : 'none';

  el('detailStarBtn').classList.toggle('active', !!r.isFace);
  el('detailStarLabel').textContent = r.isFace ? 'Stack cover' : 'Set as stack cover';
  el('detailStarBtn').onclick = () => { closeDetailMenu(); toggleFace(r.id); };
  el('detailEditBtn').onclick = () => { closeDetailMenu(); el('detailOverlay').classList.remove('open'); editRecord(r.id); };

  const hasNav = detailList.length > 1 && detailIndex > -1;
  el('detailPrevBtn').style.display = hasNav ? 'flex' : 'none';
  el('detailNextBtn').style.display = hasNav ? 'flex' : 'none';

  el('detailOverlay').classList.add('open');
}

// ---- Detail modal's ellipsis menu (Star / Edit / Close, consolidated) ----
function openDetailMenu() {
  el('detailMenu').hidden = false;
  el('detailMenuBtn').setAttribute('aria-expanded', 'true');
}
function closeDetailMenu() {
  el('detailMenu').hidden = true;
  el('detailMenuBtn').setAttribute('aria-expanded', 'false');
}
el('detailMenuBtn').addEventListener('click', e => {
  e.stopPropagation();
  if (el('detailMenu').hidden) openDetailMenu(); else closeDetailMenu();
});
document.addEventListener('click', e => {
  if (!el('detailMenu').hidden && !el('detailMenu').contains(e.target) && e.target !== el('detailMenuBtn')) {
    closeDetailMenu();
  }
});
el('detailCloseBtn').addEventListener('click', () => {
  closeDetailMenu();
  el('detailOverlay').classList.remove('open');
});
el('detailOverlay').addEventListener('click', e => {
  if (e.target === el('detailOverlay')) {
    closeDetailMenu();
    el('detailOverlay').classList.remove('open');
  }
});

function detailStep(direction) {
  if (!detailList.length || detailIndex === -1) return;
  const nextIndex = (detailIndex + direction + detailList.length) % detailList.length;
  openDetailModal(detailList[nextIndex].id);
}
el('detailPrevBtn').addEventListener('click', e => { e.stopPropagation(); detailStep(-1); });
el('detailNextBtn').addEventListener('click', e => { e.stopPropagation(); detailStep(1); });
document.addEventListener('keydown', e => {
  if (!el('detailOverlay').classList.contains('open')) return;
  if (e.key === 'ArrowLeft') detailStep(-1);
  else if (e.key === 'ArrowRight') detailStep(1);
  else if (e.key === 'Escape') {
    if (!el('detailMenu').hidden) closeDetailMenu();
    else el('detailOverlay').classList.remove('open');
  }
});

function openRandomRecord() {
  if (!records.length) return;
  const r = records[Math.floor(Math.random() * records.length)];
  openDetailModal(r.id);
}

// ---- Small shared utilities ----
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// Wires a text input + its clear (×) button: shows/hides the button based on
// whether there's a value, and clearing it re-runs the given callback right
// away (not debounced — clearing should feel instant).
function wireSearchClear(inputId, clearBtnId, onChange) {
  const input = el(inputId), btn = el(clearBtnId);
  if (!input || !btn) return;
  const sync = () => { btn.style.display = input.value ? 'flex' : 'none'; };
  input.addEventListener('input', sync);
  btn.addEventListener('click', () => { input.value = ''; sync(); input.focus(); onChange(); });
  sync();
}

el('exportBtn').addEventListener('click', () => {
  closeProfileMenu();
  if (!records.length) { alert('Your collection is empty — nothing to export yet.'); return; }
  const columns = [
    ['album', 'Album'], ['artist', 'Artist'], ['year', 'Year'], ['genre', 'Genre'],
    ['format', 'Format'], ['condition', 'Condition'], ['price', 'Price Paid'],
    ['estimatedValue', 'Estimated Value'], ['purchaseDate', 'Purchase Date'],
    ['label', 'Label'], ['catalogNumber', 'Catalog Number'], ['country', 'Country'],
    ['releaseType', 'Release Type'], ['coverUrl', 'Cover URL'], ['notes', 'Notes'],
    ['tracklist', 'Track Listing']
  ];
  const escapeCsv = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = columns.map(([, label]) => escapeCsv(label)).join(',');
  const rows = records.map(r => columns.map(([key]) =>
    escapeCsv(key === 'tracklist' ? (r.tracklist || '').replace(/\n/g, ' / ') : r[key])
  ).join(','));
  const csv = [header, ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `the-stacks-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

function armLazyImageTimeouts(container, ms = 8000) {
  // A slow/hung image request (as opposed to a hard failure) never fires
  // onerror on its own — it just sits pending indefinitely. This forces
  // a fallback after a reasonable wait so a tile never gets stuck blank.
  if (!container) return;
  container.querySelectorAll('img[loading="lazy"]').forEach(img => {
    if (img.complete) return;
    const timer = setTimeout(() => {
      if (!img.complete || img.naturalWidth === 0) {
        img.dispatchEvent(new Event('error'));
      }
    }, ms);
    img.addEventListener('load', () => clearTimeout(timer), { once: true });
    img.addEventListener('error', () => clearTimeout(timer), { once: true });
  });
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
