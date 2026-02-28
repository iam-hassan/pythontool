/* ============================================================
   FMCSA Carrier Finder  |  Frontend Application Logic
   ============================================================
   Performance optimized:
     - Paginated results table (only renders current page)
     - Throttled UI updates (max once per 300ms)
     - Log capped at 50 DOM entries
     - Data kept in memory array, not in DOM
   ============================================================ */

// ── Constants ─────────────────────────────────────────────

const PAGE_SIZE = 10;          // rows visible per page
const MAX_LOG_ENTRIES = 50;    // max log lines in DOM
const UI_THROTTLE_MS = 300;    // min ms between DOM stat updates

// ── State ─────────────────────────────────────────────────

const state = {
  scanning: false,
  paused: false,
  startMC: 0,
  endMC: 0,
  batchSize: 5,
  currentMC: 0,
  checked: 0,
  found: 0,
  errors: 0,
  results: [],        // all found carriers (data only, never in DOM)
  currentPage: 1,     // current table page
  startTime: null,
  abortController: null,
  _lastUiUpdate: 0,   // timestamp of last DOM stat write
};

// ── DOM Refs ──────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const dom = {
  connStatus: $('connectionStatus'),
  quickInput: $('quickMcInput'),
  quickResult: $('quickResult'),
  btnQuickCheck: $('btnQuickCheck'),
  startMc: $('startMc'),
  endMc: $('endMc'),
  batchSize: $('batchSize'),
  btnStart: $('btnStart'),
  btnPause: $('btnPause'),
  btnStop: $('btnStop'),
  statChecked: $('statChecked'),
  statFound: $('statFound'),
  statErrors: $('statErrors'),
  progressSection: $('progressSection'),
  progressFill: $('progressFill'),
  progressPct: $('progressPct'),
  progressLabel: $('progressLabel'),
  progressEta: $('progressEta'),
  progressRange: $('progressRange'),
  resultsBody: $('resultsBody'),
  resultsCount: $('resultsCount'),
  emptyState: $('emptyState'),
  btnExportCsv: $('btnExportCsv'),
  btnExportExcel: $('btnExportExcel'),
  logConsole: $('logConsole'),
};

// ── Toast Notifications ──────────────────────────────────

function createToastContainer() {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

function showToast(message, type = 'info', duration = 4000) {
  const container = createToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Log (capped at MAX_LOG_ENTRIES) ──────────────────────

function log(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  const time = new Date().toLocaleTimeString();
  entry.textContent = `[${time}] ${message}`;
  dom.logConsole.appendChild(entry);

  // Trim to keep DOM light
  while (dom.logConsole.children.length > MAX_LOG_ENTRIES) {
    dom.logConsole.removeChild(dom.logConsole.firstChild);
  }

  dom.logConsole.scrollTop = dom.logConsole.scrollHeight;
}

// ── Connection Test ──────────────────────────────────────

async function testConnection() {
  try {
    const resp = await fetch('/api/check-mc?test=true');
    const data = await resp.json();

    if (data.connected) {
      dom.connStatus.className = 'connection-status connected';
      dom.connStatus.querySelector('.status-text').textContent = 'FMCSA Connected';
      log('FMCSA SAFER connection verified successfully', 'success');
    } else {
      dom.connStatus.className = 'connection-status error';
      dom.connStatus.querySelector('.status-text').textContent = 'FMCSA Unreachable';
      log(`Cannot reach FMCSA: ${data.message}`, 'error');
    }
  } catch (err) {
    dom.connStatus.className = 'connection-status error';
    dom.connStatus.querySelector('.status-text').textContent = 'API Error';
    log(`Connection test failed: ${err.message}`, 'error');
  }
}

// ── Quick Check ──────────────────────────────────────────

async function quickCheck() {
  const mcNumber = parseInt(dom.quickInput.value, 10);
  if (!mcNumber || mcNumber < 1) {
    showToast('Please enter a valid MC number', 'error');
    return;
  }

  const btn = dom.btnQuickCheck;
  const btnText = btn.querySelector('.btn-text');
  const btnLoader = btn.querySelector('.btn-loader');

  btn.disabled = true;
  btnText.textContent = 'Checking...';
  btnLoader.classList.remove('hidden');
  log(`Quick check: MC-${mcNumber}`, 'info');

  try {
    const resp = await fetch(`/api/check-mc?mc=${mcNumber}`);
    const data = await resp.json();

    if (!data.results || data.results.length === 0) {
      showQuickResult(null, mcNumber);
      return;
    }

    const result = data.results[0];
    showQuickResult(result, mcNumber);

    if (result.found) {
      log(`MC-${mcNumber}: ACTIVE CARRIER found! ${result.data?.legal_name || ''}`, 'success');
      showToast(`Carrier found: ${result.data?.legal_name || 'MC-' + mcNumber}`, 'success');
    } else if (result.data) {
      log(`MC-${mcNumber}: ${result.data.entity_type || 'Unknown'} / ${result.data.usdot_status || 'Unknown'}`, 'info');
    } else {
      log(`MC-${mcNumber}: No record found`, 'warn');
    }
  } catch (err) {
    log(`Quick check failed: ${err.message}`, 'error');
    showToast('Failed to check MC number', 'error');
    dom.quickResult.classList.add('hidden');
  } finally {
    btn.disabled = false;
    btnText.textContent = 'Check';
    btnLoader.classList.add('hidden');
  }
}

function showQuickResult(result, mcNumber) {
  const el = dom.quickResult;
  el.classList.remove('hidden', 'found', 'not-found');

  if (!result || !result.data) {
    el.classList.add('not-found');
    el.innerHTML = `
      <div class="result-title">❌ No Record Found</div>
      <p style="font-size:0.85rem;color:var(--text-3)">MC-${mcNumber} does not exist or has no data in FMCSA SAFER.</p>
    `;
    return;
  }

  const d = result.data;
  const isMatch = result.found;
  el.classList.add(isMatch ? 'found' : 'not-found');

  el.innerHTML = `
    <div class="result-title">${isMatch ? '✅ Active Carrier Found!' : '⚠️ Not a Matching Carrier'}</div>
    <div class="result-grid">
      <div class="result-field"><span class="field-label">MC Number: </span><span class="field-value">${d.mc_number || 'MC-' + mcNumber}</span></div>
      <div class="result-field"><span class="field-label">Entity Type: </span><span class="field-value">${d.entity_type || 'N/A'}</span></div>
      <div class="result-field"><span class="field-label">USDOT Status: </span><span class="field-value">${d.usdot_status || 'N/A'}</span></div>
      <div class="result-field"><span class="field-label">USDOT #: </span><span class="field-value">${d.usdot_number || 'N/A'}</span></div>
      <div class="result-field"><span class="field-label">Authority: </span><span class="field-value">${d.operating_authority_status || 'N/A'}</span></div>
      <div class="result-field"><span class="field-label">Legal Name: </span><span class="field-value">${d.legal_name || 'N/A'}</span></div>
      <div class="result-field"><span class="field-label">Phone: </span><span class="field-value">${d.phone || 'N/A'}</span></div>
      <div class="result-field"><span class="field-label">Address: </span><span class="field-value">${d.physical_address || 'N/A'}</span></div>
      <div class="result-field"><span class="field-label">Power Units: </span><span class="field-value">${d.power_units || 'N/A'}</span></div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════
// ── Cell text clamping (show more / show less) ───────────
// ══════════════════════════════════════════════════════════

const CLAMP_THRESHOLD = 60; // characters; anything longer gets clamped

function clampCell(text) {
  if (!text || text.length <= CLAMP_THRESHOLD) {
    return `<span class="cell-text">${text}</span>`;
  }
  return (
    `<div class="cell-clamp clamped">` +
      `<span class="cell-text">${text}</span>` +
      `<button class="clamp-toggle" onclick="toggleClamp(this)">show more</button>` +
    `</div>`
  );
}

function toggleClamp(btn) {
  const wrapper = btn.closest('.cell-clamp');
  if (!wrapper) return;
  const isClamped = wrapper.classList.contains('clamped');
  wrapper.classList.toggle('clamped');
  btn.textContent = isClamped ? 'show less' : 'show more';
}

// ══════════════════════════════════════════════════════════
// ── Paginated Results Table ──────────────────────────────
// ══════════════════════════════════════════════════════════

function getTotalPages() {
  return Math.max(1, Math.ceil(state.results.length / PAGE_SIZE));
}

/**
 * Render exactly one page of rows.  Clears tbody first so the DOM
 * never holds more than PAGE_SIZE <tr> elements.
 */
function renderResultsPage(page) {
  const total = state.results.length;
  if (total === 0) {
    dom.resultsBody.innerHTML = '';
    dom.emptyState.classList.remove('hidden');
    updatePaginationControls();
    return;
  }

  dom.emptyState.classList.add('hidden');

  const totalPages = getTotalPages();
  page = Math.max(1, Math.min(page, totalPages));
  state.currentPage = page;

  const startIdx = (page - 1) * PAGE_SIZE;
  const endIdx = Math.min(startIdx + PAGE_SIZE, total);
  const slice = state.results.slice(startIdx, endIdx);

  // Build all rows in a DocumentFragment (single reflow)
  const frag = document.createDocumentFragment();

  for (let i = 0; i < slice.length; i++) {
    const r = slice[i];
    const d = r.data || {};
    const rowNum = startIdx + i + 1;
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${rowNum}</td>` +
      `<td style="font-weight:700;color:var(--cyan)">${d.mc_number || 'MC-' + r.mc}</td>` +
      `<td style="font-weight:600;color:var(--text-1)">${d.legal_name || 'N/A'}</td>` +
      `<td><span class="badge badge-cyan">${d.entity_type || 'N/A'}</span></td>` +
      `<td><span class="badge badge-green">${d.usdot_status || 'N/A'}</span></td>` +
      `<td>${clampCell(d.operating_authority_status || 'N/A')}</td>` +
      `<td>${d.usdot_number || 'N/A'}</td>` +
      `<td>${d.phone || 'N/A'}</td>` +
      `<td>${clampCell(d.physical_address || 'N/A')}</td>` +
      `<td>${d.power_units || 'N/A'}</td>`;
    frag.appendChild(tr);
  }

  dom.resultsBody.innerHTML = '';         // wipe old rows
  dom.resultsBody.appendChild(frag);      // single paint

  updatePaginationControls();
}

function updatePaginationControls() {
  let pager = document.getElementById('paginationControls');
  const totalPages = getTotalPages();
  const total = state.results.length;

  if (total === 0) {
    if (pager) pager.classList.add('hidden');
    return;
  }

  if (!pager) {
    // Create the pagination bar once
    pager = document.createElement('div');
    pager.id = 'paginationControls';
    pager.className = 'pagination';
    const tableWrapper = dom.resultsBody.closest('.table-wrapper');
    tableWrapper.parentNode.insertBefore(pager, tableWrapper.nextSibling);
  }

  pager.classList.remove('hidden');
  pager.innerHTML = `
    <button class="btn btn-outline btn-sm" onclick="goToPage(1)" ${state.currentPage <= 1 ? 'disabled' : ''}>First</button>
    <button class="btn btn-outline btn-sm" onclick="goToPage(${state.currentPage - 1})" ${state.currentPage <= 1 ? 'disabled' : ''}>Prev</button>
    <span class="pagination-info">Page ${state.currentPage} of ${totalPages} (${total.toLocaleString()} rows)</span>
    <button class="btn btn-outline btn-sm" onclick="goToPage(${state.currentPage + 1})" ${state.currentPage >= totalPages ? 'disabled' : ''}>Next</button>
    <button class="btn btn-outline btn-sm" onclick="goToPage(${totalPages})" ${state.currentPage >= totalPages ? 'disabled' : ''}>Last</button>
  `;
}

function goToPage(page) {
  renderResultsPage(page);
}

function toggleResultsPanel() {
  const panel = document.getElementById('resultsCollapsible');
  const btn = document.getElementById('btnToggleResults');
  if (!panel || !btn) return;

  const isCollapsed = panel.classList.contains('collapsed');
  panel.classList.toggle('collapsed');

  btn.innerHTML = isCollapsed
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 15 12 9 18 15"/></svg> Hide Results'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg> Show Results';
}

// ══════════════════════════════════════════════════════════
// ── Throttled UI helpers ─────────────────────────────────
// ══════════════════════════════════════════════════════════

/** Write stats to the DOM at most once every UI_THROTTLE_MS */
function throttledUiUpdate(force) {
  const now = Date.now();
  if (!force && now - state._lastUiUpdate < UI_THROTTLE_MS) return;
  state._lastUiUpdate = now;

  dom.statChecked.textContent = state.checked.toLocaleString();
  dom.statFound.textContent = state.found.toLocaleString();
  dom.statErrors.textContent = state.errors.toLocaleString();

  dom.resultsCount.textContent =
    `${state.found} carrier${state.found !== 1 ? 's' : ''} found out of ${state.checked.toLocaleString()} checked`;
}

function updateProgress(current, start, end) {
  const total = end - start + 1;
  const done = Math.min(current - start, total);
  const pct = Math.min((done / total) * 100, 100);

  dom.progressFill.style.width = `${pct}%`;
  dom.progressPct.textContent = `${pct.toFixed(1)}%`;
  dom.progressRange.textContent = `MC-${start} to MC-${end}`;

  const elapsed = (Date.now() - state.startTime) / 1000;
  if (done > 0 && pct < 100) {
    const remaining = (elapsed / done) * (total - done);
    dom.progressEta.textContent = `ETA: ${formatTime(remaining)}`;
    dom.progressLabel.textContent = `Scanning MC-${current}...`;
  } else if (pct >= 100) {
    dom.progressEta.textContent = `Done in ${formatTime(elapsed)}`;
    dom.progressLabel.textContent = 'Scan Complete';
  }
}

function formatTime(seconds) {
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = Math.ceil(seconds % 60);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// ══════════════════════════════════════════════════════════
// ── Batch Scan ───────────────────────────────────────────
// ══════════════════════════════════════════════════════════

async function startScan() {
  const startMC = parseInt(dom.startMc.value, 10);
  const endMC = parseInt(dom.endMc.value, 10);
  const batchSize = Math.min(Math.max(parseInt(dom.batchSize.value, 10) || 5, 1), 10);

  if (!startMC || !endMC || startMC < 1 || endMC < startMC) {
    showToast('Please enter a valid MC number range (End must be >= Start)', 'error');
    return;
  }

  if (endMC - startMC + 1 > 500000) {
    showToast('Range too large. Maximum 500,000 MC numbers per scan.', 'error');
    return;
  }

  // Reset state
  state.scanning = true;
  state.paused = false;
  state.startMC = startMC;
  state.endMC = endMC;
  state.batchSize = batchSize;
  state.currentMC = startMC;
  state.checked = 0;
  state.found = 0;
  state.errors = 0;
  state.results = [];
  state.currentPage = 1;
  state.startTime = Date.now();
  state._lastUiUpdate = 0;
  state.abortController = new AbortController();

  // Update UI
  updateControls(true);
  dom.resultsBody.innerHTML = '';
  dom.emptyState.classList.add('hidden');
  dom.progressSection.classList.remove('hidden');
  dom.btnExportCsv.disabled = true;
  dom.btnExportExcel.disabled = true;
  renderResultsPage(1);

  // Add scanning pulse to stats
  document.querySelectorAll('.stat-card').forEach((c) => c.classList.add('scanning-pulse'));

  const total = endMC - startMC + 1;
  log(`Starting scan: MC-${startMC} to MC-${endMC} (${total.toLocaleString()} numbers, batch size ${batchSize})`, 'info');

  // ── Main scan loop ──
  let current = startMC;
  let foundThisBatch = false;

  while (current <= endMC && state.scanning) {
    if (state.paused) {
      await waitForResume();
      if (!state.scanning) break;
    }

    const count = Math.min(batchSize, endMC - current + 1);
    foundThisBatch = false;

    try {
      const resp = await fetch(`/api/check-mc?start=${current}&count=${count}`, {
        signal: state.abortController.signal,
      });

      if (!resp.ok) {
        log(`API error: HTTP ${resp.status} for MC-${current} to MC-${current + count - 1}`, 'error');
        state.errors += count;
        state.checked += count;
        current += count;
        throttledUiUpdate(false);
        updateProgress(current, startMC, endMC);
        continue;
      }

      const data = await resp.json();

      if (data.results) {
        for (const result of data.results) {
          state.checked++;

          if (result.error) {
            state.errors++;
            // Only log errors occasionally to avoid DOM spam
            if (state.errors <= 20 || state.errors % 50 === 0) {
              log(`MC-${result.mc}: Error: ${result.error}`, 'error');
            }
          } else if (result.found) {
            state.found++;
            state.results.push(result);
            foundThisBatch = true;
            log(`MC-${result.mc}: ACTIVE CARRIER "${result.data?.legal_name || 'Unknown'}"`, 'success');
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        log('Scan aborted by user', 'warn');
        break;
      }
      state.errors += count;
      state.checked += count;
      log(`Network error at MC-${current}: ${err.message}`, 'error');
    }

    current += count;
    state.currentMC = current;

    // Throttled DOM writes
    throttledUiUpdate(false);
    updateProgress(current, startMC, endMC);

    // When new carriers found, stay on current page (page 1 by default)
    // Just update pagination info so user sees updated count
    if (foundThisBatch) {
      const foundCard = document.querySelector('.stat-card-found');
      if (foundCard) {
        foundCard.classList.remove('flash-found');
        void foundCard.offsetWidth;
        foundCard.classList.add('flash-found');
      }
      // Re-render current page (page 1) so new rows appear there
      renderResultsPage(state.currentPage);
    }
  }

  // ── Scan complete ──
  state.scanning = false;
  updateControls(false);
  document.querySelectorAll('.stat-card').forEach((c) => c.classList.remove('scanning-pulse'));

  // Final forced UI update
  throttledUiUpdate(true);
  renderResultsPage(state.currentPage);

  const elapsed = ((Date.now() - state.startTime) / 1000).toFixed(1);
  log(`Scan complete! Checked ${state.checked.toLocaleString()}, found ${state.found} carriers, ${state.errors} errors in ${elapsed}s`, 'info');

  if (state.results.length > 0) {
    dom.btnExportCsv.disabled = false;
    dom.btnExportExcel.disabled = false;
    showToast(`Scan complete! Found ${state.found} active carriers.`, 'success');
  } else {
    showToast('Scan complete. No active carriers found in this range.', 'info');
  }
}

function waitForResume() {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (!state.paused || !state.scanning) {
        clearInterval(interval);
        resolve();
      }
    }, 200);
  });
}

function togglePause() {
  if (!state.scanning) return;

  state.paused = !state.paused;
  dom.btnPause.innerHTML = state.paused
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Resume'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause';

  log(state.paused ? 'Scan paused' : 'Scan resumed', 'warn');

  if (state.paused) {
    document.querySelectorAll('.stat-card').forEach((c) => c.classList.remove('scanning-pulse'));
  } else {
    document.querySelectorAll('.stat-card').forEach((c) => c.classList.add('scanning-pulse'));
  }
}

function stopScan() {
  if (!state.scanning) return;

  state.scanning = false;
  state.paused = false;

  if (state.abortController) {
    state.abortController.abort();
  }

  log('Scan stopped by user', 'warn');
  showToast('Scan stopped.', 'info');
}

// ── UI Controls ──────────────────────────────────────────

function updateControls(scanning) {
  dom.btnStart.disabled = scanning;
  dom.btnPause.disabled = !scanning;
  dom.btnStop.disabled = !scanning;
  dom.startMc.disabled = scanning;
  dom.endMc.disabled = scanning;
  dom.batchSize.disabled = scanning;

  if (scanning) {
    dom.btnStart.innerHTML = '<span class="btn-loader"></span> Scanning...';
  } else {
    dom.btnStart.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg> Start Scan';
    dom.btnPause.innerHTML =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause';
  }
}

// ── Export Functions ──────────────────────────────────────

function exportCSV() {
  if (state.results.length === 0) {
    showToast('No results to export', 'error');
    return;
  }

  const headers = [
    'MC Number', 'Entity Type', 'USDOT Status', 'USDOT Number',
    'Operating Authority Status', 'Legal Name', 'DBA Name',
    'Physical Address', 'Phone', 'Mailing Address', 'Power Units',
    'Out of Service Date', 'MCS 150 Mileage', 'MCS 150 Form Date',
  ];

  const rows = state.results.map((r) => {
    const d = r.data || {};
    return [
      d.mc_number || 'MC-' + r.mc, d.entity_type || '', d.usdot_status || '',
      d.usdot_number || '', d.operating_authority_status || '', d.legal_name || '',
      d.dba_name || '', d.physical_address || '', d.phone || '',
      d.mailing_address || '', d.power_units || '', d.out_of_service_date || '',
      d.mcs150_mileage || '', d.mcs150_form_date || '',
    ].map((val) => `"${String(val).replace(/"/g, '""')}"`);
  });

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  downloadFile(csv, 'authorized_carriers.csv', 'text/csv');
  showToast(`Exported ${state.results.length} carriers to CSV`, 'success');
  log(`Exported ${state.results.length} carriers to CSV`, 'info');
}

function exportExcel() {
  if (state.results.length === 0) {
    showToast('No results to export', 'error');
    return;
  }

  if (typeof XLSX === 'undefined') {
    showToast('Excel library not loaded. Try CSV export instead.', 'error');
    return;
  }

  const headers = [
    'MC Number', 'Entity Type', 'USDOT Status', 'USDOT Number',
    'Operating Authority', 'Legal Name', 'DBA Name', 'Physical Address',
    'Phone', 'Mailing Address', 'Power Units', 'Out of Service Date',
    'MCS 150 Mileage', 'MCS 150 Form Date',
  ];

  const data = state.results.map((r) => {
    const d = r.data || {};
    return {
      'MC Number': d.mc_number || 'MC-' + r.mc,
      'Entity Type': d.entity_type || '',
      'USDOT Status': d.usdot_status || '',
      'USDOT Number': d.usdot_number || '',
      'Operating Authority': d.operating_authority_status || '',
      'Legal Name': d.legal_name || '',
      'DBA Name': d.dba_name || '',
      'Physical Address': d.physical_address || '',
      'Phone': d.phone || '',
      'Mailing Address': d.mailing_address || '',
      'Power Units': d.power_units || '',
      'Out of Service Date': d.out_of_service_date || '',
      'MCS 150 Mileage': d.mcs150_mileage || '',
      'MCS 150 Form Date': d.mcs150_form_date || '',
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data, { header: headers });
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 2, 15) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Authorized Carriers');

  const summaryData = [
    { Field: 'Report', Value: 'FMCSA MC Number Scan' },
    { Field: 'Generated', Value: new Date().toLocaleString() },
    { Field: 'MC Range', Value: `MC-${state.startMC} to MC-${state.endMC}` },
    { Field: 'Total Checked', Value: state.checked },
    { Field: 'Carriers Found', Value: state.found },
    { Field: 'Errors', Value: state.errors },
    { Field: 'Criteria', Value: 'Entity Type = CARRIER, Status = ACTIVE' },
  ];
  const wsSummary = XLSX.utils.json_to_sheet(summaryData);
  wsSummary['!cols'] = [{ wch: 20 }, { wch: 45 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  XLSX.writeFile(wb, 'authorized_carriers.xlsx');
  showToast(`Exported ${state.results.length} carriers to Excel`, 'success');
  log(`Exported ${state.results.length} carriers to Excel`, 'info');
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Keyboard Shortcuts ───────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.activeElement === dom.quickInput) {
    quickCheck();
  }
});

// ── Init ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  log('Application loaded', 'info');
  testConnection();
});
