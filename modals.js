// Shared modals — login, MFA, Help, Security, and the Add/Edit Record form.
// Injected into #modals-root at load time so this markup lives in exactly
// one place instead of being duplicated across every page. This script
// must load BEFORE app.js, since app.js attaches event listeners to
// elements defined here.
document.getElementById('modals-root').innerHTML = `
<div class="overlay open" id="loginOverlay">
  <div class="modal" style="max-width:360px;">
    <h2 id="authTitle">Sign in</h2>
    <div class="field">
      <label>Email</label>
      <input type="text" id="authEmail" autocomplete="email">
    </div>
    <div class="field">
      <label>Password</label>
      <input type="password" id="authPassword" autocomplete="current-password">
    </div>
    <div id="authError" style="color:var(--rust); font-size:12px; margin-bottom:10px; display:none;"></div>
    <div id="authStatus" style="color:#6b6650; font-size:12px; margin-bottom:10px; display:none;"></div>
    <div class="modal-actions" style="justify-content:space-between;">
      <button type="button" class="btn btn-ghost" id="authToggleBtn" style="border:none; padding-left:0;">Need an account? Sign up</button>
      <button type="button" class="btn btn-primary" id="authSubmitBtn">Sign in</button>
    </div>
  </div>
</div>

<div class="overlay" id="mfaChallengeOverlay">
  <div class="modal" style="max-width:360px;">
    <h2>Enter your code</h2>
    <p style="font-size:12.5px; color:#6b6650; margin-bottom:14px;">Open your authenticator app and enter the 6-digit code for The Stacks.</p>
    <div class="field">
      <label>Verification code</label>
      <input type="text" id="mfaChallengeCode" inputmode="numeric" maxlength="6" placeholder="123456" autocomplete="one-time-code">
    </div>
    <div id="mfaChallengeError" style="color:var(--rust); font-size:12px; margin-bottom:10px; display:none;"></div>
    <div class="modal-actions" style="justify-content:space-between;">
      <button type="button" class="btn btn-ghost" id="mfaChallengeSignOutBtn" style="border:none; padding-left:0;">Sign out instead</button>
      <button type="button" class="btn btn-primary" id="mfaChallengeSubmitBtn">Verify</button>
    </div>
  </div>
</div>

<div class="overlay" id="trackOverlay">
  <div class="modal" style="max-width:420px;">
    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
      <div>
        <h2 id="trackModalAlbum" style="margin-bottom:2px;"></h2>
        <div id="trackModalArtist" style="font-size:13px; color:#6b6650;"></div>
      </div>
      <button type="button" class="btn btn-ghost" id="trackCloseBtn" style="padding:6px 10px;"><i class="ti ti-x"></i></button>
    </div>
    <ol id="trackModalList" style="list-style:none; margin-top:14px; font-size:13.5px; line-height:1.7; color:#3a362b;"></ol>
  </div>
</div>

<div class="overlay" id="detailOverlay">
  <div class="modal detail-modal">
    <div class="detail-modal-cover-wrap" id="detailCoverWrap">
      <img id="detailCover" src="" alt="" style="display:none;">
      <div class="gallery-cover-fallback" id="detailCoverFallback"><i class="ti ti-music"></i></div>
      <button type="button" class="detail-modal-nav prev" id="detailPrevBtn" title="Previous record" style="display:none;"><i class="ti ti-chevron-left"></i></button>
      <button type="button" class="detail-modal-nav next" id="detailNextBtn" title="Next record" style="display:none;"><i class="ti ti-chevron-right"></i></button>
    </div>
    <div class="detail-modal-body">
      <div class="detail-modal-title-row">
        <div class="detail-modal-title-text">
          <div class="detail-modal-album" id="detailAlbum"></div>
          <div class="detail-modal-artist" id="detailArtist"></div>
        </div>
        <div class="detail-modal-menu-wrap">
          <button type="button" class="detail-modal-menu-btn" id="detailMenuBtn" title="More" aria-haspopup="true" aria-expanded="false"><i class="ti ti-dots"></i></button>
          <div class="detail-modal-menu" id="detailMenu" hidden>
            <button type="button" class="detail-menu-item" id="detailStarBtn"><i class="ti ti-star"></i><span id="detailStarLabel">Set as stack cover</span></button>
            <button type="button" class="detail-menu-item" id="detailEditBtn"><i class="ti ti-pencil"></i>Edit</button>
            <button type="button" class="detail-menu-item" id="detailCloseBtn"><i class="ti ti-x"></i>Close</button>
          </div>
        </div>
      </div>
      <div class="detail-modal-meta" id="detailMeta"></div>
      <div class="detail-modal-facts">
        <div class="fact"><div class="fv" id="detailCondition">—</div><div class="fl">Condition</div></div>
        <div class="fact"><div class="fv" id="detailPrice">—</div><div class="fl">Paid</div></div>
        <div class="fact"><div class="fv" id="detailValue">—</div><div class="fl">Est. Value</div></div>
      </div>
      <div class="detail-modal-scroll">
        <div class="detail-modal-notes" id="detailNotesWrap" style="display:none;">
          <div id="detailNotes"></div>
        </div>
        <div id="detailTracklistWrap" style="display:none;">
          <ol class="detail-modal-tracklist" id="detailTracklist"></ol>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="overlay" id="helpOverlay">
  <div class="modal help-modal">
    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px;">
      <h2>The Stacks — User Guide</h2>
      <button type="button" class="btn btn-ghost" id="helpCloseBtn" style="padding:6px 10px;"><i class="ti ti-x"></i></button>
    </div>

    <h3>Getting started</h3>
    <ol>
      <li>On first visit, sign in — or tap <strong>"Need an account? Sign up"</strong>, enter an email and password, and submit.</li>
      <li>Check your email for a confirmation link, click it, then come back and sign in.</li>
      <li>Your collection is empty at first — start adding records.</li>
    </ol>

    <h3>Installing it as an app on your phone</h3>
    <p><strong>iPhone:</strong> open the link in <strong>Safari</strong> (must be Safari). Tap the Share icon → <strong>Add to Home Screen</strong>.</p>
    <p><strong>Android:</strong> open the link in Chrome. Tap the install banner, or the menu (⋮) → <strong>Install app</strong>.</p>

    <h3>Adding a record</h3>
    <p>Tap <strong>+ Add Record</strong>. Three ways to fill it in:</p>
    <ul>
      <li><strong>Search by name</strong> — type artist/album in the MusicBrainz lookup box. Most fields, including cover art, fill in automatically.</li>
      <li><strong>Scan the barcode</strong> — tap <i class="ti ti-camera" style="font-size:15px; vertical-align:-2px; margin-right:3px;"></i>Scan, allow camera access, hold the barcode steady in frame.</li>
      <li><strong>Type the barcode number</strong> — if scanning doesn't work, type the UPC digits and hit Look up.</li>
    </ul>
    <p>Everything is editable afterward, however you started.</p>

    <h3>Browsing your collection</h3>
    <p><strong>Stacks</strong> groups records into piles by genre — tap a stack to open its page in <strong>All Records</strong>, filtered to that genre.</p>
    <ul>
      <li><strong>Set as stack cover</strong> — from All Records, tap the star icon to make a record that genre's cover.</li>
      <li><strong>All Records</strong> is a full sortable, searchable table of everything you own.</li>
    </ul>

    <h3>Editing and deleting</h3>
    <p>Each row has icons to edit or delete. Deletion is permanent — there's no undo.</p>

    <h3>Security</h3>
    <p>Tap <strong><i class="ti ti-shield-lock" style="font-size:15px; vertical-align:-2px; margin-right:3px;"></i>Security</strong> to turn on two-factor authentication. Scan the QR code with an authenticator app, confirm with the 6-digit code, and you'll need it plus your password at every sign-in from then on.</p>
    <p><strong>There's no recovery code.</strong> Losing your authenticator app means losing access — keep the setup QR/key somewhere safe if you enable this. Tap <strong><i class="ti ti-download" style="font-size:15px; vertical-align:-2px; margin-right:3px;"></i>Export CSV</strong> now and then to keep a backup of your collection outside the app.</p>

    <h3>A few notes</h3>
    <ul>
      <li>Your collection is private — no one else using this app can see your records, and you can't see theirs.</li>
      <li>Lookups need internet. Browsing your existing collection works offline once the app has loaded.</li>
      <li>If something looks off after an update, fully close and reopen the app.</li>
    </ul>
  </div>
</div>

<div class="overlay" id="securityOverlay">
  <div class="modal" style="max-width:400px;">
    <h2>Two-factor authentication</h2>

    <div id="mfaOffState" style="display:none;">
      <p style="font-size:12.5px; color:#6b6650; margin-bottom:14px;">Adds a second step at sign-in using an authenticator app (Google Authenticator, Authy, 1Password, etc.), on top of your password.</p>
      <div class="modal-actions" style="justify-content:flex-end;">
        <button type="button" class="btn btn-ghost" id="securityCloseBtn1">Close</button>
        <button type="button" class="btn btn-primary" id="mfaEnableBtn">Enable 2FA</button>
      </div>
    </div>

    <div id="mfaEnrollState" style="display:none;">
      <p style="font-size:12.5px; color:#6b6650; margin-bottom:10px;">Scan this with your authenticator app:</p>
      <div style="display:flex; justify-content:center; margin-bottom:10px;">
        <img id="mfaQrCode" src="" alt="QR code" style="width:180px; height:180px; border:1px solid rgba(26,24,21,0.15); border-radius:3px;">
      </div>
      <p style="font-size:11px; color:#6b6650; margin-bottom:4px;">Can't scan? Enter this code manually:</p>
      <div id="mfaSecret" style="font-family:'IBM Plex Mono',monospace; font-size:11.5px; background:#fff; border:1px solid rgba(26,24,21,0.15); border-radius:3px; padding:8px; word-break:break-all; margin-bottom:14px;"></div>
      <div class="field">
        <label>Enter the 6-digit code from the app to confirm</label>
        <input type="text" id="mfaEnrollCode" inputmode="numeric" maxlength="6" placeholder="123456">
      </div>
      <div id="mfaEnrollError" style="color:var(--rust); font-size:12px; margin-bottom:10px; display:none;"></div>
      <div class="modal-actions" style="justify-content:space-between;">
        <button type="button" class="btn btn-ghost" id="mfaEnrollCancelBtn" style="border:none; padding-left:0;">Cancel</button>
        <button type="button" class="btn btn-primary" id="mfaEnrollConfirmBtn">Confirm</button>
      </div>
    </div>

    <div id="mfaOnState" style="display:none;">
      <p style="font-size:13px; margin-bottom:14px;"><i class="ti ti-circle-check" style="color:var(--amber); margin-right:4px;"></i>Two-factor authentication is <strong>on</strong>. You'll be asked for a code from your authenticator app each time you sign in.</p>
      <div class="modal-actions" style="justify-content:space-between;">
        <button type="button" class="btn btn-ghost" id="securityCloseBtn2">Close</button>
        <button type="button" class="btn btn-ghost" id="mfaDisableBtn" style="border-color:var(--rust); color:var(--rust);">Turn off 2FA</button>
      </div>
    </div>
  </div>
</div>

<div class="overlay" id="overlay">
  <div class="modal">
    <h2 id="modalTitle">Add Record</h2>

    <div class="field" id="lookupField">
      <label>Look up on MusicBrainz</label>
      <div style="display:flex; gap:6px;">
        <input type="text" id="lookupQuery" placeholder="e.g. Kind of Blue Miles Davis" autocomplete="new-password">
        <button type="button" class="btn btn-ghost" id="lookupBtn" style="white-space:nowrap;">Search</button>
      </div>
      <div style="display:flex; gap:6px; margin-top:8px;">
        <input type="text" id="barcodeQuery" placeholder="UPC / barcode number" inputmode="numeric" autocomplete="new-password">
        <button type="button" class="btn btn-ghost" id="barcodeBtn" style="white-space:nowrap;">Look up</button>
        <button type="button" class="btn btn-ghost" id="scanBtn" style="white-space:nowrap;"><i class="ti ti-camera" style="font-size:15px; vertical-align:-2px; margin-right:3px;"></i>Scan</button>
      </div>
      <div id="scannerBox" style="display:none; margin-top:8px;">
        <div id="scannerViewport" style="position:relative; width:100%; height:220px; background:#000; border-radius:3px; overflow:hidden;"></div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:6px;">
          <span class="lookup-status" style="margin-top:0;">Hold the barcode steady in frame.</span>
          <button type="button" class="btn btn-ghost" id="scanCancelBtn" style="padding:6px 10px;">Stop</button>
        </div>
      </div>
      <div id="lookupResults"></div>
    </div>

    <form id="recordForm">
      <input type="hidden" id="recordId">
      <div class="field">
        <label>Album *</label>
        <input type="text" id="album" required autocomplete="new-password">
      </div>
      <div class="field">
        <label>Artist *</label>
        <input type="text" id="artist" required autocomplete="new-password">
      </div>
      <div class="field">
        <label>Cover art URL</label>
        <div style="display:flex; gap:8px; align-items:flex-start;">
          <img id="coverPreview" src="" alt="" style="width:52px; height:52px; object-fit:cover; border-radius:2px; border:1px solid rgba(26,24,21,0.15); display:none; flex-shrink:0;">
          <input type="text" id="coverUrl" placeholder="Fills in automatically from lookup, or paste your own">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Year</label>
          <input type="text" id="year" placeholder="1971" inputmode="numeric">
        </div>
        <div class="field">
          <label>Genre</label>
          <input type="text" id="genre" placeholder="Soul, Jazz, Rock…">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Format</label>
          <select id="format">
            <option>LP</option>
            <option>7" Single</option>
            <option>12" Single</option>
            <option>Box Set</option>
            <option>Cassette</option>
            <option>CD</option>
          </select>
        </div>
        <div class="field">
          <label>Condition</label>
          <select id="condition">
            <option value="M">Mint (M)</option>
            <option value="NM">Near Mint (NM)</option>
            <option value="VG" selected>Very Good (VG)</option>
            <option value="G">Good (G)</option>
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Release type</label>
          <input type="text" id="releaseType" placeholder="Album, EP, Live, Compilation…">
        </div>
        <div class="field">
          <label>Country</label>
          <input type="text" id="country" placeholder="US, UK, JP…">
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Label</label>
          <input type="text" id="label" placeholder="Blue Note, Sub Pop…">
        </div>
        <div class="field">
          <label>Catalog #</label>
          <input type="text" id="catalogNumber" placeholder="BST 84195">
        </div>
      </div>
      <div class="field">
        <label>Track listing</label>
        <textarea id="tracklist" rows="3" placeholder="Fills in automatically from lookup, or type your own — one track per line"></textarea>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Purchase price ($)</label>
          <input type="text" id="price" inputmode="decimal" placeholder="0.00">
        </div>
        <div class="field">
          <label>Purchase date</label>
          <input type="date" id="purchaseDate">
        </div>
      </div>
      <div class="field">
        <label>Estimated value ($)</label>
        <input type="text" id="estimatedValue" inputmode="decimal" placeholder="Optional — enter your own estimate">
      </div>
      <div class="field">
        <label>Notes</label>
        <textarea id="notes" rows="2" placeholder="Pressing details, where you found it, dedication, etc."></textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancelBtn">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Record</button>
      </div>
    </form>
  </div>
</div>
`;
