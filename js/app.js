/* =============================================
   AUTOMATE HR — APP LOGIC
   Connects to n8n webhooks & manages state
   ============================================= */

// ---- STATE ----
const state = {
  employees: [],
  todayRecords: [],
  warnings: [],
  trendData: [],
  config: {
    webhookUrl: '',
    dataUrl: '',
    overrideUrl: ''
  },
  excuseTarget: null,
  autoRefreshTimer: null
};

// ---- INIT ----
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  setupNav();
  // setupUploadZone();
  updateDateTime();
  setInterval(updateDateTime, 60000);
  refreshDashboard(); // Try loading processed data or fallback to mock
  startAutoRefresh();
});

// ---- NAVIGATION ----
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      item.classList.add('active');
      document.getElementById(`page-${page}`).classList.add('active');
    });
  });
}

// ---- DATETIME ----
function updateDateTime() {
  const now = new Date();
  document.getElementById('todayDate').textContent =
    now.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('currentMonth').textContent =
    now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  document.getElementById('lastRefresh').textContent =
    'Refreshed ' + now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ---- AUTO REFRESH ----
function startAutoRefresh() {
  if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = setInterval(() => {
    refreshDashboard();
  }, 10000); // Refresh every 10 seconds for real-time updates
}

// ---- FETCH LIVE DATA FROM n8n ----
async function refreshDashboard() {
  if (!state.config.dataUrl) {
    try {
      showToast('Fetching from Google Sheets...', 'info');
      await fetchFromGoogleSheets();
      return;
    } catch (e) {
      console.log('Failed to fetch from Google Sheets:', e);
    }
    
    try {
      const res = await fetch('processed_data.json');
      if (res.ok) {
        const data = await res.json();
        state.employees = data.employees || [];
        state.todayRecords = data.todayRecords || [];
        state.warnings = data.warnings || [];
        state.trendData = data.trend || [];
        renderAll();
        updateDateTime();
        showToast('Data loaded from processed_data.json!', 'success');
        return;
      }
    } catch (e) {
      console.log('No processed_data.json found or fetch failed.');
    }
    loadMockData();
    return;
  }
  await fetchDashboardData();
}

async function fetchFromGoogleSheets() {
  const sheet1_url = "https://docs.google.com/spreadsheets/d/1yzJiY6ghIcSfvIl6e8sTtbM51nfac3X4jFZvJZdtZaA/export?format=csv&gid=0&t=" + new Date().getTime();
  const processed_url = "https://docs.google.com/spreadsheets/d/1yzJiY6ghIcSfvIl6e8sTtbM51nfac3X4jFZvJZdtZaA/export?format=csv&gid=1386553414&t=" + new Date().getTime();

  const [res1, res2] = await Promise.all([
    fetch(sheet1_url),
    fetch(processed_url)
  ]);

  if (!res1.ok || !res2.ok) {
    throw new Error('Failed to fetch sheets');
  }

  const csv1 = await res1.text();
  const csv2 = await res2.text();

  const df_sheet1 = parseCSV(csv1);
  const df_processed = parseCSV(csv2);

  // Process Employees
  const employees_list = [];
  df_sheet1.forEach(row => {
    const emp_id = row['Employee ID'];
    if (!emp_id) return;
    
    const emp_processed = df_processed.filter(r => r['Employee ID'] === emp_id && r['Is Late'] === 'Yes');
    
    let last_warning = null;
    if (emp_processed.length > 0) {
      last_warning = emp_processed.reduce((max, r) => r['Date'] > max ? r['Date'] : max, emp_processed[0]['Date']);
    }

    employees_list.push({
      "employeeId": emp_id,
      "name": row['Employee Name'] || '',
      "lateCount": parseInt(row['Strike Count']) || 0,
      "lastWarningDate": last_warning,
      "month": "May 2026"
    });
  });

  // Process Today's Records
  const today_records = [];
  const today = new Date().toISOString().split('T')[0];
  df_sheet1.forEach(row => {
    const emp_id = row['Employee ID'];
    if (!emp_id) return;

    const check_in = row['Check-in Time'];
    let is_late_flag = "NO";
    if (check_in && check_in !== '—') {
      try {
        const t_obj = new Date('1970-01-01 ' + check_in);
        const threshold = new Date('1970-01-01 11:00:00');
        if (t_obj > threshold) {
          is_late_flag = "YES";
        }
      } catch (e) {
        console.error('Time parse error:', e);
      }
    }

    today_records.push({
      "employeeId": emp_id,
      "name": row['Employee Name'] || '',
      "date": today,
      "checkIn": check_in || "—",
      "checkOut": row['Check-out Time'] || "—",
      "lateFlag": is_late_flag
    });
  });

  // Process Warnings
  const warnings = [];
  const warn_df = df_processed.filter(r => r['Action Taken'] === 'Warning Sent');
  warn_df.forEach(row => {
    const lc = parseInt(row['Strike Count']) || 1;
    const level = Math.min(lc, 4);
    let msg = "";
    if (level === 1) msg = "Friendly Reminder: You were late.";
    else if (level === 2) msg = "Serious Warning: Second late arrival.";
    else if (level === 3) msg = "Final Warning + HR Meeting: Third late arrival.";
    else msg = "Manager Escalation: 4 or more late arrivals.";

    warnings.push({
      "dateSent": row['Date'] || '',
      "employeeName": row['Employee Name'] || '',
      "strikeLevel": level,
      "emailPreview": msg,
      "calendarLink": level >= 3 ? "#" : null
    });
  });

  // Process Trend
  const trend_map = {};
  df_processed.forEach(row => {
    if (row['Is Late'] === 'Yes') {
      const date = row['Date'];
      if (date) {
        trend_map[date] = (trend_map[date] || 0) + 1;
      }
    }
  });

  const trend = Object.keys(trend_map).map(date => ({
    date: date,
    count: trend_map[date]
  })).sort((a, b) => a.date.localeCompare(b.date)).slice(-7);

  state.employees = employees_list;
  state.todayRecords = today_records;
  state.warnings = warnings;
  state.trendData = trend;

  renderAll();
  updateDateTime();
  showToast('Data synced from Google Sheets!', 'success');
}

function parseCSV(csvText) {
  const lines = csvText.split('\n');
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const obj = {};
    const currentline = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = currentline[j] || '';
    }
    result.push(obj);
  }
  return result;
}

async function fetchDashboardData() {
  try {
    const btn = document.querySelector('.btn-refresh');
    btn.textContent = '↻ Loading...';
    btn.disabled = true;

    const res = await fetch(state.config.dataUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Expected n8n response shape:
    // {
    //   employees: [ { employeeId, name, lateCount, lastWarningDate, month } ],
    //   todayRecords: [ { employeeId, name, checkIn, checkOut, lateFlag } ],
    //   warnings: [ { dateSent, employeeName, strikeLevel, emailPreview, calendarLink } ],
    //   trend: [ { date, count } ]  // last 7 days
    // }

    state.employees = data.employees || [];
    state.todayRecords = data.todayRecords || [];
    state.warnings = data.warnings || [];
    state.trendData = data.trend || [];

    renderAll();
    updateDateTime();

    btn.textContent = '↻ Refresh';
    btn.disabled = false;
  } catch (err) {
    console.error('Fetch error:', err);
    showToast('Could not reach n8n endpoint. Showing last data.', 'error');
    const btn = document.querySelector('.btn-refresh');
    btn.textContent = '↻ Refresh';
    btn.disabled = false;
  }
}

// ---- RENDER ALL ----
function renderAll() {
  renderKPIs();
  renderLeaderboard();
  renderTodayTable();
  renderEmployeeTable();
  renderWarningTable();
  drawTrendChart();
}

// ---- KPI CARDS ----
function renderKPIs() {
  const lateToday = state.todayRecords.filter(r => r.lateFlag === 'YES').length;
  const onTimeToday = state.todayRecords.filter(r => r.lateFlag === 'NO').length;
  const critical = state.employees.filter(e => e.lateCount >= 3).length;
  const atRisk = state.employees.filter(e => e.lateCount === 2).length;

  animateCount('kpiLate', lateToday);
  animateCount('kpiOnTime', onTimeToday);
  animateCount('kpiCritical', critical);
  animateCount('kpiAtRisk', atRisk);

  document.getElementById('recordCount').textContent = `${state.todayRecords.length} records`;
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  let start = 0;
  const step = Math.max(1, Math.floor(target / 20));
  const timer = setInterval(() => {
    start += step;
    if (start >= target) { start = target; clearInterval(timer); }
    el.textContent = start;
  }, 30);
}

// ---- LEADERBOARD ----
function renderLeaderboard() {
  const sorted = [...state.employees].sort((a, b) => b.lateCount - a.lateCount).slice(0, 8);
  const el = document.getElementById('leaderboard');

  if (!sorted.length) {
    el.innerHTML = '<div class="empty-state">No employee data</div>';
    return;
  }

  el.innerHTML = sorted.map((emp, i) => `
    <div class="lb-row">
      <span class="lb-rank">${i + 1}</span>
      <div style="flex:1">
        <div class="lb-name">${emp.name}</div>
        <div class="lb-id">${emp.employeeId}</div>
      </div>
      <div class="lb-strikes">
        ${[1,2,3].map(s => `
          <div class="strike-dot ${s <= emp.lateCount ? (emp.lateCount >= 3 ? 'filled' : 'filled amber') : ''}"></div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

// ---- TODAY TABLE ----
function renderTodayTable() {
  const tbody = document.getElementById('todayTbody');
  if (!state.todayRecords.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No records for today</td></tr>';
    return;
  }

  tbody.innerHTML = state.todayRecords.map(r => {
    const emp = state.employees.find(e => e.employeeId === r.employeeId);
    const strikes = emp ? emp.lateCount : '—';
    const checkOut = r.checkOut || '<span class="badge badge-missing">MISSING</span>';

    return `
      <tr>
        <td class="mono">${r.employeeId}</td>
        <td>${r.name}</td>
        <td class="mono">${r.checkIn || '—'}</td>
        <td class="mono">${r.checkOut || '<span class="badge badge-missing">MISSING</span>'}</td>
        <td><span class="badge badge-${r.lateFlag === 'YES' ? 'late' : 'ontime'}">${r.lateFlag === 'YES' ? 'LATE' : 'ON TIME'}</span></td>
        <td>${renderStrikeDots(strikes)}</td>
        <td>
          <button class="btn-secondary btn-sm" onclick="openEditModal('${r.employeeId}')">Edit</button>
          ${r.lateFlag === 'YES' ? `<button class="btn-secondary btn-sm" onclick="openExcuseModal('${r.employeeId}','${r.name}','${r.date}')">Excuse</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

function renderStrikeDots(count) {
  const n = parseInt(count) || 0;
  return [1,2,3].map(s =>
    `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:3px;background:${s<=n?(n>=3?'var(--red)':'var(--amber)'):'var(--border)'};${s<=n?'box-shadow:0 0 4px '+(n>=3?'var(--red)':'var(--amber)'):''}"></span>`
  ).join('');
}

// ---- EMPLOYEE TABLE ----
let empFilter = '';
function filterEmployees() {
  empFilter = document.getElementById('empSearch').value.toLowerCase();
  renderEmployeeTable();
}

function renderEmployeeTable() {
  const tbody = document.getElementById('empTbody');
  const filtered = state.employees.filter(e =>
    !empFilter ||
    e.name.toLowerCase().includes(empFilter) ||
    e.employeeId.toLowerCase().includes(empFilter)
  );

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No employees found</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(emp => {
    const badge = emp.lateCount >= 3 ? 'critical' : emp.lateCount === 2 ? 'atrisk' : 'safe';
    const badgeLabel = emp.lateCount >= 3 ? 'CRITICAL' : emp.lateCount === 2 ? 'AT RISK' : 'SAFE';
    return `
      <tr>
        <td class="mono">${emp.employeeId}</td>
        <td>${emp.name}</td>
        <td style="font-family:var(--font-display);font-size:20px;font-weight:800;color:${emp.lateCount>=3?'var(--red)':emp.lateCount===2?'var(--amber)':'var(--green)'}">
          ${emp.lateCount}
        </td>
        <td class="mono">${emp.lastWarningDate || '—'}</td>
        <td class="mono">${emp.month || '—'}</td>
        <td><span class="badge badge-${badge}">${badgeLabel}</span></td>
        <td><button class="btn-secondary btn-sm" onclick="manualExcuse('${emp.employeeId}','${emp.name}')">Override</button></td>
      </tr>
    `;
  }).join('');
}

// ---- WARNING TABLE ----
function renderWarningTable() {
  const tbody = document.getElementById('warningTbody');
  if (!state.warnings.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No warnings logged yet</td></tr>';
    return;
  }

  tbody.innerHTML = state.warnings.map(w => `
    <tr>
      <td class="mono">${w.dateSent}</td>
      <td>${w.employeeName}</td>
      <td>
        <span class="badge badge-${w.strikeLevel>=3?'critical':w.strikeLevel===2?'atrisk':'atrisk'}">
          Strike ${w.strikeLevel}
        </span>
      </td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-dim);font-size:12px">
        ${w.emailPreview || '—'}
      </td>
      <td>
        ${w.calendarLink ? `<a href="${w.calendarLink}" target="_blank" style="color:var(--accent);font-family:var(--font-mono);font-size:11px">📅 View</a>` : '—'}
      </td>
    </tr>
  `).join('');
}

// ---- TREND CHART (pure canvas, no lib) ----
function drawTrendChart() {
  const canvas = document.getElementById('trendChart');
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 400;
  const H = 220;
  canvas.width = W;
  canvas.height = H;

  const data = state.trendData.length ? state.trendData : generateFakeTrend();
  const max = Math.max(...data.map(d => d.count), 1);
  const pad = { top: 20, right: 20, bottom: 40, left: 30 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;

  ctx.clearRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = '#1e1e1e';
  ctx.lineWidth = 1;
  [0, 0.25, 0.5, 0.75, 1].forEach(t => {
    const y = pad.top + chartH * (1 - t);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
  });

  // Bars
  const barW = (chartW / data.length) * 0.55;
  data.forEach((d, i) => {
    const x = pad.left + (i + 0.5) * (chartW / data.length);
    const barH = (d.count / max) * chartH;
    const y = pad.top + chartH - barH;

    // Gradient fill
    const grad = ctx.createLinearGradient(0, y, 0, y + barH);
    grad.addColorStop(0, '#c8f135');
    grad.addColorStop(1, 'rgba(200,241,53,0.15)');
    ctx.fillStyle = grad;

    const r = 3;
    ctx.beginPath();
    ctx.moveTo(x - barW/2 + r, y);
    ctx.lineTo(x + barW/2 - r, y);
    ctx.arcTo(x + barW/2, y, x + barW/2, y + r, r);
    ctx.lineTo(x + barW/2, y + barH);
    ctx.lineTo(x - barW/2, y + barH);
    ctx.arcTo(x - barW/2, y, x - barW/2 + r, y, r);
    ctx.closePath();
    ctx.fill();

    // Count label
    if (d.count > 0) {
      ctx.fillStyle = '#c8f135';
      ctx.font = '600 11px DM Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(d.count, x, y - 5);
    }

    // Date label
    ctx.fillStyle = '#555';
    ctx.font = '10px DM Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(d.date, x, H - 10);
  });
}

function generateFakeTrend() {
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return days.map(d => ({ date: d, count: Math.floor(Math.random() * 8) }));
}

// ---- UPLOAD ZONE ----
function setupUploadZone() {
  const zone = document.getElementById('uploadZone');
  const input = document.getElementById('fileInput');

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) processUpload(file);
  });
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    if (input.files[0]) processUpload(input.files[0]);
  });
}

async function processUpload(file) {
  const allowed = ['.xlsx', '.xls', '.csv'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!allowed.includes(ext)) {
    showToast('Invalid file type. Use .xlsx, .xls or .csv', 'error');
    return;
  }

  const statusDiv = document.getElementById('uploadStatus');
  const stepsDiv = document.getElementById('pipelineSteps');
  statusDiv.style.display = 'block';

  const steps = [
    { id: 's1', label: 'Validating file format', icon: '◈' },
    { id: 's2', label: 'Sending to n8n Webhook', icon: '↑' },
    { id: 's3', label: 'Processing attendance records', icon: '⚙' },
    { id: 's4', label: 'Calculating late flags & strikes', icon: '⚑' },
    { id: 's5', label: 'AI generating warning emails', icon: '✦' },
    { id: 's6', label: 'Sending emails & scheduling meetings', icon: '✉' },
    { id: 's7', label: 'Updating Google Sheets', icon: '✓' },
  ];

  stepsDiv.innerHTML = steps.map(s =>
    `<div class="p-step pending" id="${s.id}">
      <div class="p-step-icon">${s.icon}</div>
      <div class="p-step-text">${s.label}</div>
      <div class="p-step-status">Pending</div>
    </div>`
  ).join('');

  // Simulate step progression or actually POST to n8n
  const webhookUrl = state.config.webhookUrl;

  for (let i = 0; i < steps.length; i++) {
    await sleep(i === 1 ? 600 : 400 + Math.random() * 400);
    setStepStatus(steps[i].id, 'running', 'Processing...');

    if (i === 1 && webhookUrl) {
      // Actually send to n8n
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('filename', file.name);

        const res = await fetch(webhookUrl, { method: 'POST', body: formData });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setStepStatus(steps[i].id, 'done', 'Sent ✓');
      } catch (err) {
        setStepStatus(steps[i].id, 'error', 'Failed: ' + err.message);
        showToast('n8n webhook error: ' + err.message, 'error');
        // Continue simulation anyway
      }
    } else {
      await sleep(300);
      setStepStatus(steps[i].id, 'done', 'Done ✓');
    }
  }

  showToast('Pipeline completed! Refreshing data...', 'success');
  setTimeout(refreshDashboard, 1500);
}

function setStepStatus(id, status, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `p-step ${status}`;
  el.querySelector('.p-step-status').textContent = text;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- EXCUSE MODAL ----
let excuseData = {};

function openExcuseModal(empId, name, date) {
  excuseData = { empId, name, date };
  document.getElementById('excuseEmpName').textContent = name;
  document.getElementById('excuseDate').textContent = date;
  document.getElementById('excuseReason').value = '';
  document.getElementById('excuseModal').style.display = 'flex';
}

function manualExcuse(empId, name) {
  openExcuseModal(empId, name, 'Manual override');
}

function closeModal() {
  document.getElementById('excuseModal').style.display = 'none';
}

async function submitExcuse() {
  const reason = document.getElementById('excuseReason').value.trim();
  if (!reason) { showToast('Please enter a reason', 'error'); return; }

  const payload = { ...excuseData, reason, excusedAt: new Date().toISOString() };

  if (state.config.overrideUrl) {
    try {
      await fetch(state.config.overrideUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.warn('Override webhook failed:', e);
    }
  }

  // Update local state
  const rec = state.todayRecords.find(r => r.employeeId === excuseData.empId);
  if (rec) rec.lateFlag = 'EXCUSED';

  closeModal();
  showToast(`${excuseData.name} marked as Excused`, 'success');
  renderTodayTable();
}

// ---- EDIT MODAL ----
function openEditModal(empId) {
  const emp = state.todayRecords.find(r => r.employeeId === empId);
  const empInfo = state.employees.find(e => e.employeeId === empId);
  if (!emp) return;
  
  document.getElementById('editEmpName').textContent = emp.name;
  document.getElementById('editEmpId').value = empId;
  document.getElementById('editCheckIn').value = emp.checkIn !== '—' ? emp.checkIn : '';
  document.getElementById('editCheckOut').value = emp.checkOut !== '—' ? emp.checkOut : '';
  document.getElementById('editStrikes').value = empInfo ? empInfo.lateCount : 0;
  
  document.getElementById('editModal').style.display = 'flex';
}

function closeEditModal() {
  document.getElementById('editModal').style.display = 'none';
}

async function submitEdit() {
  const empId = document.getElementById('editEmpId').value;
  const checkIn = document.getElementById('editCheckIn').value.trim();
  const checkOut = document.getElementById('editCheckOut').value.trim();
  const strikes = document.getElementById('editStrikes').value.trim();
  
  const payload = {
    employeeId: empId,
    checkIn: checkIn,
    checkOut: checkOut,
    strikes: strikes,
    updatedAt: new Date().toISOString()
  };
  
  let url = state.config.overrideUrl;
  if (!url) {
    showToast('No Override URL configured in Config. Saving locally only.', 'warning');
  } else {
    try {
      showToast('Sending update...', 'info');
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast('Update sent successfully!', 'success');
    } catch (e) {
      showToast('Failed to send update: ' + e.message, 'error');
      console.error(e);
    }
  }
  
  // Update local state
  const rec = state.todayRecords.find(r => r.employeeId === empId);
  if (rec) {
    rec.checkIn = checkIn || '—';
    rec.checkOut = checkOut || '—';
    
    let is_late_flag = "NO";
    if (checkIn && checkIn !== '—') {
      try {
        const t_obj = new Date('1970-01-01 ' + checkIn);
        const threshold = new Date('1970-01-01 11:00:00');
        if (t_obj > threshold) {
          is_late_flag = "YES";
        }
      } catch (e) {}
    }
    rec.lateFlag = is_late_flag;
  }
  
  const empInfo = state.employees.find(e => e.employeeId === empId);
  if (empInfo) {
    empInfo.lateCount = parseInt(strikes) || 0;
  }
  
  closeEditModal();
  renderAll();
}

// ---- CONFIG ----
function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem('automate_config') || '{}');
    state.config = { ...state.config, ...saved };
    if (saved.webhookUrl) document.getElementById('cfgWebhook').value = saved.webhookUrl;
    if (saved.dataUrl) document.getElementById('cfgDataUrl').value = saved.dataUrl;
    if (saved.overrideUrl) document.getElementById('cfgOverrideUrl').value = saved.overrideUrl;
    if (saved.webhookUrl) document.getElementById('webhookUrl').value = saved.webhookUrl;
  } catch (e) {}
}

function saveConfig() {
  state.config.webhookUrl = document.getElementById('cfgWebhook').value.trim();
  state.config.dataUrl = document.getElementById('cfgDataUrl').value.trim();
  state.config.overrideUrl = document.getElementById('cfgOverrideUrl').value.trim();
  localStorage.setItem('automate_config', JSON.stringify(state.config));
  document.getElementById('configSaveMsg').textContent = '✓ Configuration saved';
  showToast('Configuration saved!', 'success');
  startAutoRefresh();
}

function saveWebhook() {
  state.config.webhookUrl = document.getElementById('webhookUrl').value.trim();
  localStorage.setItem('automate_config', JSON.stringify(state.config));
  showToast('Webhook URL saved', 'success');
}

async function testWebhook(type) {
  const url = type === 'webhook' ? state.config.webhookUrl : state.config.dataUrl;
  const el = document.getElementById('testResults');
  if (!url) { el.textContent = '✗ No URL configured for ' + type; return; }
  el.textContent = 'Testing ' + url + '...';
  try {
    const res = await fetch(url, { method: type === 'data' ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: type === 'webhook' ? JSON.stringify({ test: true }) : undefined });
    el.textContent = `✓ ${type} responded with HTTP ${res.status}`;
  } catch (e) {
    el.textContent = `✗ ${type} unreachable: ${e.message}`;
  }
}

// ---- MOCK DATA ----
function loadMockData() {
  if (typeof processedData !== 'undefined') {
    state.employees = processedData.employees;
    state.todayRecords = processedData.todayRecords;
    state.warnings = processedData.warnings;
    state.trendData = processedData.trend;
    renderAll();
    updateDateTime();
    showToast('Processed data loaded from Excel!', 'success');
  } else {
    state.employees = [
      { employeeId: 'EMP-001', name: 'Priya Sharma', lateCount: 3, lastWarningDate: '2025-07-10', month: 'July 2025' },
      { employeeId: 'EMP-002', name: 'Rahul Mehta', lateCount: 2, lastWarningDate: '2025-07-08', month: 'July 2025' },
      { employeeId: 'EMP-003', name: 'Ananya Singh', lateCount: 2, lastWarningDate: '2025-07-07', month: 'July 2025' },
      { employeeId: 'EMP-004', name: 'Vikram Nair', lateCount: 1, lastWarningDate: '2025-07-03', month: 'July 2025' },
      { employeeId: 'EMP-005', name: 'Sonia Patel', lateCount: 1, lastWarningDate: '2025-07-05', month: 'July 2025' },
      { employeeId: 'EMP-006', name: 'Arjun Kapoor', lateCount: 0, lastWarningDate: null, month: 'July 2025' },
      { employeeId: 'EMP-007', name: 'Meera Iyer', lateCount: 0, lastWarningDate: null, month: 'July 2025' },
      { employeeId: 'EMP-008', name: 'Karan Bose', lateCount: 3, lastWarningDate: '2025-07-11', month: 'July 2025' },
    ];

    const today = new Date().toISOString().split('T')[0];
    state.todayRecords = [
      { employeeId: 'EMP-001', name: 'Priya Sharma', date: today, checkIn: '11:32 AM', checkOut: '06:15 PM', lateFlag: 'YES' },
      { employeeId: 'EMP-002', name: 'Rahul Mehta', date: today, checkIn: '11:15 AM', checkOut: '05:45 PM', lateFlag: 'YES' },
      { employeeId: 'EMP-003', name: 'Ananya Singh', date: today, checkIn: '09:50 AM', checkOut: '06:00 PM', lateFlag: 'NO' },
      { employeeId: 'EMP-004', name: 'Vikram Nair', date: today, checkIn: '10:05 AM', checkOut: null, lateFlag: 'NO' },
      { employeeId: 'EMP-005', name: 'Sonia Patel', date: today, checkIn: '11:45 AM', checkOut: '05:30 PM', lateFlag: 'YES' },
      { employeeId: 'EMP-006', name: 'Arjun Kapoor', date: today, checkIn: '09:30 AM', checkOut: '06:30 PM', lateFlag: 'NO' },
      { employeeId: 'EMP-007', name: 'Meera Iyer', date: today, checkIn: '10:00 AM', checkOut: '05:00 PM', lateFlag: 'NO' },
      { employeeId: 'EMP-008', name: 'Karan Bose', date: today, checkIn: '11:58 AM', checkOut: '06:45 PM', lateFlag: 'YES' },
    ];

    state.warnings = [
      { dateSent: '2025-07-10', employeeName: 'Priya Sharma', strikeLevel: 3, emailPreview: 'Final warning: This is your third late arrival this month. A meeting has been scheduled...', calendarLink: '#' },
      { dateSent: '2025-07-11', employeeName: 'Karan Bose', strikeLevel: 3, emailPreview: 'Final warning: Consistent late arrivals have been noted. HR meeting scheduled for 5 PM...', calendarLink: '#' },
      { dateSent: '2025-07-08', employeeName: 'Rahul Mehta', strikeLevel: 2, emailPreview: 'Second warning: We have noted 2 late arrivals this month. Please ensure timely check-in...', calendarLink: null },
      { dateSent: '2025-07-07', employeeName: 'Ananya Singh', strikeLevel: 2, emailPreview: 'Second notice regarding your attendance. This is your second late arrival this month...', calendarLink: null },
    ];

    state.trendData = [
      { date: 'Mon', count: 3 },
      { date: 'Tue', count: 1 },
      { date: 'Wed', count: 5 },
      { date: 'Thu', count: 2 },
      { date: 'Fri', count: 4 },
      { date: 'Sat', count: 1 },
      { date: 'Sun', count: 0 },
    ];

    renderAll();
    updateDateTime();
    showToast('Mock data loaded — connect n8n in Config to go live', 'info');
  }
}

function clearData() {
  state.employees = [];
  state.todayRecords = [];
  state.warnings = [];
  state.trendData = [];
  renderAll();
  showToast('Data cleared', 'info');
}

// ---- TOAST ----
function showToast(msg, type = 'info') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();

  const colors = { success: 'var(--green)', error: 'var(--red)', info: 'var(--accent)' };
  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.textContent = msg;
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '28px',
    right: '28px',
    background: 'var(--surface)',
    border: `1px solid ${colors[type]}`,
    color: colors[type],
    padding: '12px 20px',
    borderRadius: '8px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    zIndex: '9999',
    boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
    animation: 'fadeIn 0.2s ease'
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

// Resize chart on window resize
window.addEventListener('resize', () => drawTrendChart());
