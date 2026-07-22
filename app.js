// ---- SUPABASE CONFIG ----
// Fill these in from Project Settings → API in your Supabase dashboard.
// The anon key is safe to expose in client code — it's designed for this,
// and your Row Level Security policies are what actually protect the data.
const SUPABASE_URL = 'https://jqtibmsqlzcagydnnwpg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_RjMrtGKMZZBL1WzR_DdG3w_xSYJkWfV';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let records = [];
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

el('signOutBtn').addEventListener('click', async () => {
  await sb.auth.signOut();
});

sb.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  if (currentUser) {
    checkAalAndProceed();
  } else {
    el('loginOverlay').classList.add('open');
    el('mfaChallengeOverlay').classList.remove('open');
    el('appBody').style.display = 'none';
    el('signOutBtn').style.display = 'none';
    el('securityBtn').style.display = 'none';
    el('helpBtn').style.display = 'none';
    el('userEmail').textContent = '';
    records = [];
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
    el('securityBtn').style.display = 'none';
    el('helpBtn').style.display = 'none';
    el('signOutBtn').style.display = 'none';
    el('mfaChallengeOverlay').classList.add('open');
    el('mfaChallengeCode').value = '';
    el('mfaChallengeError').style.display = 'none';
    el('mfaChallengeCode').focus();
  } else {
    el('loginOverlay').classList.remove('open');
    el('mfaChallengeOverlay').classList.remove('open');
    el('appBody').style.display = 'block';
    el('signOutBtn').style.display = 'inline-block';
    el('securityBtn').style.display = 'inline-block';
    el('helpBtn').style.display = 'inline-block';
    el('userEmail').textContent = currentUser.email;
    loadRecords();
  }
}

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
async function loadRecords() {
  const { data, error } = await sb
    .from('records')
    .select('*')
    .order('added_at', { ascending: false });
  if (error) {
    console.error(error);
    alert('Could not load your collection: ' + error.message);
    return;
  }
  records = (data || []).map(r => ({
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
  }));
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

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  let error;
  if (editingId) {
    ({ error } = await sb.from('records').update(payload).eq('id', editingId));
  } else {
    ({ error } = await sb.from('records').insert(payload));
  }
  submitBtn.disabled = false;

  if (error) {
    alert('Could not save: ' + error.message);
    return;
  }
  closeModal();
  await loadRecords();
});

async function deleteRecord(id) {
  if (!confirm('Remove this record from your collection?')) return;
  const { error } = await sb.from('records').delete().eq('id', id);
  if (error) {
    alert('Could not delete: ' + error.message);
    return;
  }
  await loadRecords();
}

function editRecord(id) {
  const r = records.find(x => x.id === id);
  if (r) openModal(r);
}

async function toggleFace(id) {
  const record = records.find(x => x.id === id);
  if (!record) return;
  if (!record.genre) {
    alert('Give this record a genre before setting it as a stack cover — covers are picked per genre.');
    return;
  }
  try {
    if (record.isFace) {
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
    await loadRecords();
  } catch (err) {
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
  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state">No records here yet.</div>`;
    return;
  }
  container.innerHTML = list.map(r => {
    const coverHtml = r.coverUrl
      ? `<img src="${escapeAttr(r.coverUrl)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;gallery-cover-fallback&quot;><i class=&quot;ti ${iconForGenre(r.genre)}&quot;></i></div>'">`
      : `<div class="gallery-cover-fallback"><i class="ti ${iconForGenre(r.genre)}"></i></div>`;
    return `
      <div class="gallery-card">
        <div class="gallery-cover-wrap" onclick='handleGalleryTap(this, "${r.id}")'>
          ${coverHtml}
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

// ---- ALBUM DETAIL MODAL ("opening the record jacket") ----
function openDetailModal(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;

  if (r.coverUrl) {
    el('detailCover').src = r.coverUrl;
    el('detailCover').style.display = 'block';
    el('detailCoverFallback').style.display = 'none';
  } else {
    el('detailCover').style.display = 'none';
    el('detailCoverFallback').style.display = 'flex';
    el('detailCoverFallback').innerHTML = `<i class="ti ${iconForGenre(r.genre)}"></i>`;
  }

  el('detailAlbum').textContent = r.album;
  el('detailArtist').textContent = r.artist;

  const metaLines = [
    [r.year, r.format, r.releaseType].filter(Boolean).join(' · '),
    [r.label, r.catalogNumber].filter(Boolean).join(' · '),
    r.country
  ].filter(Boolean);
  el('detailMeta').innerHTML = metaLines.map(l => `<div>${escapeHtml(l)}</div>`).join('');

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

  el('detailStarBtn').classList.toggle('active', !!r.isFace);
  el('detailStarBtn').onclick = () => toggleFace(r.id);
  el('detailEditBtn').onclick = () => { el('detailOverlay').classList.remove('open'); editRecord(r.id); };
  el('detailDeleteBtn').onclick = () => deleteRecord(r.id);

  el('detailOverlay').classList.add('open');
}
el('detailCloseBtn').addEventListener('click', () => el('detailOverlay').classList.remove('open'));
el('detailOverlay').addEventListener('click', e => {
  if (e.target === el('detailOverlay')) el('detailOverlay').classList.remove('open');
});

function openRandomRecord() {
  if (!records.length) return;
  const r = records[Math.floor(Math.random() * records.length)];
  openDetailModal(r.id);
}

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
