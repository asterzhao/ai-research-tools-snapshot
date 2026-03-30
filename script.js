/**
 * GenAI Research Tools — loads data.json and renders Timeline, Table, and AI Roles views.
 * Serve over HTTP (e.g. npx serve .) so fetch('data.json') works; file:// may be blocked.
 */
'use strict';

const TRADITIONAL_CATS = new Set(['scholarlydb', 'opendb']);

let NEEDS_DEF = [];
let catMeta = {};
let STAGES = [];
let AI_ROLE_DEFS = [];
/** @type {Array} */
let T = [];
const CONTENT_BY_ID = {};

let currentFilter = 'all';
let currentNeed = 'all';
let currentSearch = '';
let currentView = 'timeline';
let showTraditional = false;
let selectedTools = new Set();
let allExpanded = false;
let lbImages = [];
let lbIdx = 0;
let lbAnimating = false;

function hexToRgba(hex, alpha) {
  if (!hex || !hex.startsWith('#')) return `rgba(100,116,139,${alpha})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function getToolContent(id) {
  return (
    CONTENT_BY_ID[id] || {
      about: '',
      aiRole: '',
      unique: '',
      similar: '',
      coverage: '',
      limitations: '',
      screenshots: [],
    }
  );
}

function textToLines(text, mode) {
  if (!text || !text.trim()) return [];
  if (text.includes('\n')) return text.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
  if (mode === 'similar') return text.replace(/\.$/, '').split(/,\s*/).map((s) => s.trim()).filter((s) => s.length > 0);
  const items = text.split(/\.\s+(?=[A-Z])/).map((s) => s.replace(/\.$/, '').trim()).filter((s) => s.length > 2);
  return items.length > 1 ? items : [text.replace(/\.$/, '').trim()];
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function withBoldMarkdown(str = '') {
  const safe = escapeHtml(str);
  return safe.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/** Renders free-text privacy (supports **bold** and newlines). */
function privacyBodyHtml(text) {
  if (!text || !String(text).trim()) return '';
  return String(text)
    .split('\n')
    .map((line) => withBoldMarkdown(line))
    .join('<br>');
}

function linesToBulletsHtml(lines, allowBold = false) {
  if (!lines || lines.length === 0) return '<ul class="bullet-list"><li>—</li></ul>';
  return (
    '<ul class="bullet-list">' +
    lines.map((l) => `<li>${allowBold ? withBoldMarkdown(l) : escapeHtml(l)}</li>`).join('') +
    '</ul>'
  );
}

function toBullets(text, mode, allowBold = false) {
  return linesToBulletsHtml(textToLines(text, mode || 'bullets'), allowBold);
}

function similarToBullets(text) {
  return linesToBulletsHtml(textToLines(text, 'similar'), false);
}

/** "ROLE 0" … "ROLE 4a" — number line only (separate from title in UI). */
function aiRoleNumPart(def) {
  if (!def || !def.id) return '';
  const suffix = def.id.replace(/^role/i, '');
  return `ROLE ${suffix}`;
}

/** Full label for search / legacy, e.g. "ROLE 2 - Semantic & Hybrid Retrieval". */
function aiRoleTagLabel(def) {
  if (!def || !def.id) return '';
  return `${aiRoleNumPart(def)} - ${def.title}`;
}

function formatRoleDescriptionHtml(desc) {
  if (!desc || !String(desc).trim()) return '';
  return String(desc)
    .split(/\n\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p class="roles-section-desc-p">${withBoldMarkdown(p)}</p>`)
    .join('');
}

/** Popover + table: controlled role pills + free-text `ai_role` from JSON. */
function buildAiRoleHtml(t, c) {
  const roleIds = t.ai_roles || [];
  const pills = roleIds
    .map((id) => AI_ROLE_DEFS.find((r) => r.id === id))
    .filter(Boolean)
    .map(
      (def) =>
        `<span class="ai-role-pill"><span class="ai-role-pill-num">${escapeHtml(aiRoleNumPart(def))}</span><span class="ai-role-pill-name">${escapeHtml(def.title)}</span></span>`
    )
    .join('');
  const pillsHtml = pills
    ? `<div class="ai-role-pills" role="list" aria-label="AI role tags">${pills}</div>`
    : '';
  const free = c.aiRole && String(c.aiRole).trim();
  const freeHtml = free
    ? `<div class="ai-role-freetext"><div class="ai-role-freetext-label">Additional details</div><div class="ai-role-freetext-body">${escapeHtml(free).replace(/\n/g, '<br>')}</div></div>`
    : '';
  if (!pillsHtml && !freeHtml) return '<p class="ai-role-empty">—</p>';
  return pillsHtml + freeHtml;
}

function isToolVisible(t) {
  if (!showTraditional && TRADITIONAL_CATS.has(t.cat)) return false;
  if (currentFilter === 'free' && !t.free) return false;
  if (currentFilter === 'hkust' && !t.hkust) return false;
  if (currentNeed !== 'all') {
    const n = t.needs || [];
    if (!n.includes(currentNeed)) return false;
  }
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    const c = getToolContent(t.id);
    const roleBlob = (t.ai_roles || [])
      .map((rid) => AI_ROLE_DEFS.find((r) => r.id === rid))
      .filter(Boolean)
      .map((d) => `${aiRoleTagLabel(d)} ${d.title} ${d.description || ''}`)
      .join(' ');
    if (![t.name, t.privacy, c.about, c.unique, c.aiRole, c.similar, c.limitations, roleBlob].join(' ').toLowerCase().includes(q)) return false;
  }
  return true;
}

function privacyCellHtml(toolId) {
  const t = T.find((x) => x.id === toolId);
  const raw = (t?.privacy || '').trim();
  const link = t?.policy_url;
  const body = raw
    ? `<div class="privacy-text">${privacyBodyHtml(raw)}</div>`
    : '<div class="privacy-text privacy-empty">—</div>';
  return `<div>${body}${
    link
      ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener" class="policy-link">View Policy ↗</a>`
      : '<span class="policy-na">Policy not available</span>'
  }</div>`;
}

function iconHtml(t) {
  const bg = catMeta[t.cat]?.hex || '#64748b';
  if (t.logo)
    return `<img src="${escapeHtml(t.logo)}" alt="${escapeHtml(t.abbr)}" onerror="this.parentElement.innerHTML='<div class=\\'abbr-text\\' style=\\'background:${bg};color:#fff;width:100%;height:100%;display:flex;align-items:center;justify-content:center;\\'>${escapeHtml(t.abbr)}</div>'">`;
  return `<div class="abbr-text" style="background:${bg};color:#fff;width:100%;height:100%;display:flex;align-items:center;justify-content:center;">${escapeHtml(t.abbr)}</div>`;
}

function updateResultsHint() {
  const n = T.filter((t) => isToolVisible(t)).length;
  const el = document.getElementById('resultsHint');
  if (el) el.textContent = currentSearch || currentNeed !== 'all' || currentFilter !== 'all' ? `${n} tool${n !== 1 ? 's' : ''}` : '';
  updateSelectToolsCount();
}

function updateSelectToolsCount() {
  const cnt = document.getElementById('selectToolsCount');
  if (cnt) cnt.textContent = selectedTools.size;
}

window.toggleTraditional = function toggleTraditional() {
  showTraditional = !showTraditional;
  const wrap = document.getElementById('tradToggleWrap');
  if (wrap) wrap.classList.toggle('on', showTraditional);
  if (showTraditional) T.filter((t) => TRADITIONAL_CATS.has(t.cat)).forEach((t) => selectedTools.add(t.id));
  applyAll();
};

function renderNeedPills() {
  const container = document.getElementById('needPillsContainer');
  if (!container) return;
  container.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.className = 'nbtn' + (currentNeed === 'all' ? ' active' : '');
  allBtn.dataset.n = 'all';
  allBtn.textContent = 'All';
  if (currentNeed === 'all') {
    allBtn.style.background = '#1e293b';
    allBtn.style.color = '#fff';
    allBtn.style.borderColor = '#1e293b';
  }
  allBtn.onclick = () => setNeed('all');
  container.appendChild(allBtn);
  NEEDS_DEF.forEach((need) => {
    const btn = document.createElement('button');
    btn.className = 'nbtn' + (currentNeed === need.id ? ' active' : '');
    btn.dataset.n = need.id;
    btn.textContent = need.label;
    if (currentNeed === need.id) {
      btn.style.background = need.color;
      btn.style.color = '#fff';
      btn.style.borderColor = need.color;
    }
    btn.onclick = () => setNeed(need.id);
    container.appendChild(btn);
  });
}

function renderTimeline() {
  const tl = document.getElementById('timeline-view');
  if (!tl) return;
  tl.innerHTML = '';
  STAGES.forEach((s, si) => {
    const bodyId = 'sb' + si;
    const stageEl = document.createElement('div');
    stageEl.className = 'stage';
    stageEl.id = 'tlstage' + si;

    const leftDiv = document.createElement('div');
    leftDiv.className = 'stage-left';
    leftDiv.innerHTML = `<div class="stage-year">${escapeHtml(s.year)}</div><div class="stage-title">${escapeHtml(s.title)}</div><p class="stage-desc">${escapeHtml(s.desc)}</p>`;

    const nodeCol = document.createElement('div');
    nodeCol.className = 'stage-node-col';
    nodeCol.innerHTML = `<div class="node" style="background:${escapeHtml(s.nodeColor)}"></div>`;

    const contentCol = document.createElement('div');
    contentCol.className = 'stage-content-col';
    contentCol.id = bodyId;

    const rightCol = document.createElement('div');
    rightCol.className = 'stage-right-col';
    if (s.rightLabels && s.rightLabels.length > 0) {
      s.rightLabels.forEach((rl) => {
        const item = document.createElement('div');
        item.className = 'stage-output-label';
        item.style.borderLeft = `3px solid ${rl.color}`;
        item.style.background = hexToRgba(rl.color, 0.04);
        let innerHtml = `<div class="sol-title" style="color:${escapeHtml(rl.color)}">${escapeHtml(rl.title)}</div>`;
        rl.descs.forEach((d) => {
          innerHtml += `<div class="sol-desc">${escapeHtml(d)}</div>`;
        });
        item.innerHTML = innerHtml;
        rightCol.appendChild(item);
      });
    }

    stageEl.appendChild(leftDiv);
    stageEl.appendChild(nodeCol);
    stageEl.appendChild(contentCol);
    stageEl.appendChild(rightCol);
    tl.appendChild(stageEl);

    s.groups.forEach((g, gi) => {
      const sgId = bodyId + 'g' + gi;
      const sg = document.createElement('div');
      sg.className = 'sub-group';
      sg.id = sgId + 'wrap';
      const catHex = catMeta[g.cat] ? catMeta[g.cat].hex : '#64748b';
      const deepCats = new Set(['deepresearch', 'webdeepresearch', 'mcp']);
      sg.style.background = g.cat === 'libext' ? '#eff0f4' : hexToRgba(catHex, deepCats.has(g.cat) ? 0.08 : 0.07);
      sg.innerHTML = `<div class="sg-label"><span class="sdot" style="background:${escapeHtml(catHex)}"></span>${escapeHtml(g.label)}</div><div class="sg-format">${escapeHtml(g.fmt)}</div><div class="tools-row" id="${sgId}"></div>`;
      contentCol.appendChild(sg);
      const row = document.getElementById(sgId);
      T.filter((tool) => tool.cat === g.cat).forEach((tool) => {
        const tc = document.createElement('div');
        tc.className = 'tool-card' + (isToolVisible(tool) ? '' : ' hidden');
        tc.dataset.tid = tool.id;
        tc.title = tool.name;
        tc.innerHTML = `<div class="tool-icon">${iconHtml(tool)}</div><div class="tname">${escapeHtml(tool.name)}${
          tool.via ? `<br><span style="font-size:.43rem;color:#94a3b8">via ${escapeHtml(tool.via)}</span>` : ''
        }</div>${tool.badge ? `<div class="tbadge badge-${escapeHtml(tool.badge)}">${escapeHtml(tool.badgeText)}</div>` : ''}`;
        tc.addEventListener('click', () => {
          const tt = T.find((x) => x.id === tool.id);
          if (tt) openPopover(tt, tc);
        });
        row.appendChild(tc);
      });
    });
  });
  const arr = document.createElement('div');
  arr.className = 'arrow-future';
  arr.innerHTML = `<div class="arr"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg><span>What's next?</span></div>`;
  tl.appendChild(arr);
}

function applyTimelineFilters() {
  document.querySelectorAll('.tool-card').forEach((tc) => {
    const tool = T.find((x) => x.id === tc.dataset.tid);
    tc.classList.toggle('hidden', !tool || !isToolVisible(tool));
  });
  document.querySelectorAll('.sub-group').forEach((sg) => {
    const row = sg.querySelector('.tools-row');
    if (!row) return;
    sg.classList.toggle('sg-hidden', row.querySelectorAll('.tool-card:not(.hidden)').length === 0);
  });
  STAGES.forEach((_, si) => {
    const stageEl = document.getElementById('tlstage' + si);
    if (!stageEl) return;
    stageEl.classList.toggle('stage-hidden', stageEl.querySelectorAll('.sub-group:not(.sg-hidden)').length === 0);
  });
  const n = T.filter((t) => isToolVisible(t)).length;
  const hint = document.getElementById('tlHint');
  if (hint) hint.textContent = currentSearch || currentNeed !== 'all' || currentFilter !== 'all' ? `${n} tool${n !== 1 ? 's' : ''} shown` : '';
}

window.toggleToolSelector = function toggleToolSelector() {
  const c = document.getElementById('toolSelector');
  const btn = document.getElementById('selectToolsBtn');
  const actions = document.getElementById('selectorActions');
  if (!c || !btn) return;
  const open = c.classList.contains('open');
  c.classList.toggle('open', !open);
  btn.classList.toggle('open', !open);
  if (actions) actions.style.display = open ? 'none' : 'flex';
};

function renderToolSelector() {
  const sel = document.getElementById('toolSelector');
  if (!sel) return;
  sel.innerHTML = '';
  T.filter((t) => isToolVisible(t))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((t) => {
      const lbl = document.createElement('label');
      lbl.className = 'tool-checkbox-label' + (selectedTools.has(t.id) ? ' selected' : '');
      lbl.innerHTML = `<input type="checkbox" value="${escapeHtml(t.id)}" ${selectedTools.has(t.id) ? 'checked' : ''} onchange="window.toggleToolSelection('${escapeHtml(t.id)}',this.checked)">${escapeHtml(t.name)}`;
      sel.appendChild(lbl);
    });
  updateSelectToolsCount();
}

window.toggleToolSelection = function (id, checked) {
  if (checked) selectedTools.add(id);
  else selectedTools.delete(id);
  renderToolSelector();
  renderTable();
};

window.selectAllTools = function selectAllTools(sel) {
  if (sel) T.filter((t) => isToolVisible(t)).forEach((t) => selectedTools.add(t.id));
  else selectedTools.clear();
  renderToolSelector();
  renderTable();
};

function renderTable() {
  const tbody = document.getElementById('table-view');
  if (!tbody) return;
  tbody.innerHTML = '';
  STAGES.forEach((stage) => {
    let stageTools = [];
    stage.groups.forEach((g) => {
      stageTools = stageTools.concat(T.filter((t) => t.cat === g.cat && selectedTools.has(t.id) && isToolVisible(t)));
    });
    if (!stageTools.length) return;
    const sr = document.createElement('tr');
    sr.className = 'stage-row';
    sr.innerHTML = `<td colspan="3">${escapeHtml(stage.title)}<span class="stage-row-year">(${escapeHtml(stage.year)})</span></td>`;
    tbody.appendChild(sr);
    stageTools.forEach((t) => {
      const c = getToolContent(t.id);
      const cm = catMeta[t.cat];
      const tr = document.createElement('tr');
      tr.className = 'tool-row-head';
      tr.id = 'head-' + t.id;
      tr.onclick = () => toggleTableRow(t.id);
      tr.innerHTML = `
        <td class="col-tool">
          <div class="tb-tool">
            <div class="tb-icon">${iconHtml(t)}</div>
            <div class="tb-info">
              <div class="tb-name-row">
                <span class="tb-name">${escapeHtml(t.name)}</span>
                ${t.url ? `<a href="${escapeHtml(t.url)}" target="_blank" class="tb-external-link" onclick="event.stopPropagation()">↗</a>` : ''}
              </div>
              ${t.via ? `<div class="tb-cat">via ${escapeHtml(t.via)}</div>` : ''}
            </div>
            <div class="tb-chevron"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg></div>
          </div>
        </td>
        <td class="tb-text col-about">${escapeHtml(c.about || '—')}</td>
        <td class="col-privacy">${privacyCellHtml(t.id)}</td>`;
      tbody.appendChild(tr);

      let screenshotsHtml = '';
      if (c.screenshots && c.screenshots.length > 0) {
        const ssArrStr = JSON.stringify(c.screenshots).replace(/"/g, '&quot;');
        screenshotsHtml = `<div class="detail-section detail-section--full">
          <h5><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> Screenshots</h5>
          <div class="detail-screenshots">${c.screenshots
            .map(
              (src, i) =>
                `<img src="${escapeHtml(src)}" class="detail-ss-thumb" onclick="openLightbox(${ssArrStr},${i});event.stopPropagation();" alt="Screenshot ${i + 1}">`
            )
            .join('')}</div>
        </div>`;
      }

      const dtr = document.createElement('tr');
      dtr.className = 'tool-row-detail';
      dtr.id = 'detail-' + t.id;
      dtr.classList.toggle('open', allExpanded);
      if (allExpanded) tr.classList.add('expanded');
      dtr.innerHTML = `<td colspan="3"><div class="detail-panel">
        <div class="detail-grid">
        <div class="detail-section detail-section--full"><h5>Data Coverage</h5><p class="detail-text">${escapeHtml(c.coverage || '—')}</p></div>
        <div class="detail-section detail-section--unique"><h5>Unique Features</h5>${toBullets(c.unique, 'bullets', true)}</div>
        <div class="detail-section detail-section--limitations">
        <h5>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
          Limitations
        </h5>
        ${toBullets(c.limitations, 'bullets', true)}
      </div>
        <div class="detail-section detail-section--ai-role"><h5>AI's Role</h5>${buildAiRoleHtml(t, c)}</div>
        <div class="detail-section"><h5>Similar Tools</h5>${similarToBullets(c.similar)}</div>
          ${screenshotsHtml}
        </div>
        <div class="detail-footer">${
          t.url
            ? `<a class="visit-btn" href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${t.viaLibrary ? 'Visit via Library ↗' : 'Visit ' + escapeHtml(t.name) + ' ↗'}</a>`
            : '<span class="detail-url-missing">URL not yet available</span>'
        }</div>
      </div></td>`;
      tbody.appendChild(dtr);
    });
  });
}

function toggleTableRow(id) {
  const head = document.getElementById('head-' + id);
  const detail = document.getElementById('detail-' + id);
  if (!detail) return;
  const open = detail.classList.contains('open');
  detail.classList.toggle('open', !open);
  if (head) head.classList.toggle('expanded', !open);
}

window.toggleExpandAll = function toggleExpandAll() {
  allExpanded = !allExpanded;
  T.forEach((t) => {
    const head = document.getElementById('head-' + t.id);
    const detail = document.getElementById('detail-' + t.id);
    if (!detail) return;
    detail.classList.toggle('open', allExpanded);
    if (head) head.classList.toggle('expanded', allExpanded);
  });
  const txt = document.getElementById('expandToggleText');
  if (txt) txt.textContent = allExpanded ? 'Collapse All' : 'Expand All';
  const pts = document.querySelector('#expandToggleIcon polyline');
  if (pts) pts.setAttribute('points', allExpanded ? '18 15 12 9 6 15' : '6 9 12 15 18 9');
};

function renderRolesView() {
  const root = document.getElementById('roles-view');
  if (!root) return;
  root.innerHTML =
    '<p class="roles-intro">In academic research tools, <strong>“AI”</strong> can refer to both generative models that create text and non-generative models used for <strong>retrieval, ranking, classification, and metadata enrichment</strong>. These functions are not mutually exclusive. Many tools combine several of them in one workflow, and product descriptions do not always clearly explain the underlying technical setup.</p>';

  AI_ROLE_DEFS.forEach((role) => {
    const toolsHere = T.filter((t) => (t.ai_roles || []).includes(role.id) && isToolVisible(t)).sort((a, b) => a.name.localeCompare(b.name));
    const section = document.createElement('section');
    section.className = 'roles-section';
    section.innerHTML = `
      <header class="roles-section-head">
        <h2 class="roles-section-hd"><span class="roles-role-num">${escapeHtml(aiRoleNumPart(role))}</span><span class="roles-role-name">${escapeHtml(role.title)}</span></h2>
      </header>
      <div class="roles-section-inner">
        <div class="roles-col roles-col--text">
          <div class="roles-section-desc">${formatRoleDescriptionHtml(role.description)}</div>
        </div>
        <div class="roles-col roles-col--examples">
          <h3 class="roles-examples-heading">Examples</h3>
          <div class="roles-tool-grid" data-role-grid="${escapeHtml(role.id)}"></div>
        </div>
      </div>
    `;
    const grid = section.querySelector('[data-role-grid]');
    if (!toolsHere.length) {
      const empty = document.createElement('p');
      empty.className = 'roles-empty-note';
      empty.textContent = 'No tools match current filters for this role.';
      grid.appendChild(empty);
    } else {
      toolsHere.forEach((t) => {
        const card = document.createElement('div');
        card.className = 'roles-tool-card';
        card.innerHTML = `<div class="roles-tool-icon">${iconHtml(t)}</div><span class="roles-tool-name">${escapeHtml(t.name)}</span>`;
        card.addEventListener('click', () => openPopover(t, card));
        grid.appendChild(card);
      });
    }
    root.appendChild(section);
  });
}

window.onSearch = function onSearch(val) {
  currentSearch = val.trim();
  const si = document.getElementById('searchInput');
  if (si && si.value !== val) si.value = val;
  const cs = document.getElementById('clearSearch');
  if (cs) cs.style.display = currentSearch ? 'block' : 'none';
  applyAll();
};

window.clearSearch = function clearSearch() {
  currentSearch = '';
  const si = document.getElementById('searchInput');
  if (si) si.value = '';
  const cs = document.getElementById('clearSearch');
  if (cs) cs.style.display = 'none';
  applyAll();
};

window.setNeed = function setNeed(n) {
  currentNeed = n;
  const needDef = NEEDS_DEF.find((x) => x.id === n);
  const color = n === 'all' ? '#1e293b' : needDef?.color || '#1e293b';
  document.querySelectorAll('.nbtn[data-n]').forEach((b) => {
    const isActive = b.dataset.n === n;
    b.classList.toggle('active', isActive);
    if (isActive) {
      b.style.background = color;
      b.style.color = '#fff';
      b.style.borderColor = color;
    } else {
      b.style.background = '';
      b.style.color = '';
      b.style.borderColor = '';
    }
  });
  applyAll();
};

window.setFilter = function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.fbtn[data-f]').forEach((b) => b.classList.toggle('active', b.dataset.f === f));
  applyAll();
};

function applyAll() {
  updateResultsHint();
  if (currentView === 'timeline') applyTimelineFilters();
  if (currentView === 'roles') renderRolesView();
  renderToolSelector();
  renderTable();
}

const VIEW_IDS = { timeline: 'timelineView', table: 'tableView', roles: 'rolesView' };

function setView(view) {
  currentView = view;
  document.querySelectorAll('.view-tab').forEach((btn) => {
    const on = btn.dataset.view === view;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  document.querySelectorAll('.view-container').forEach((c) => {
    c.classList.remove('active');
    c.style.display = 'none';
  });
  const vcId = VIEW_IDS[view];
  const vc = vcId ? document.getElementById(vcId) : null;
  if (vc) {
    vc.classList.add('active');
    vc.style.display = 'block';
  }
  const st = document.getElementById('sidebarTableTools');
  if (st) st.style.display = view === 'table' ? 'flex' : 'none';
  if (view === 'timeline') {
    const c = document.getElementById('toolSelector');
    const btn = document.getElementById('selectToolsBtn');
    const actions = document.getElementById('selectorActions');
    if (c) c.classList.remove('open');
    if (btn) btn.classList.remove('open');
    if (actions) actions.style.display = 'none';
    renderTimeline();
    applyTimelineFilters();
  } else if (view === 'table') {
    renderToolSelector();
    renderTable();
  } else if (view === 'roles') {
    renderRolesView();
  }
}

function openPopover(t, clickedEl) {
  const cm = catMeta[t.cat] || { hex: '#64748b', label: 'Tool' };
  const c = getToolContent(t.id);
  const pop = document.getElementById('popover');
  const bg = document.getElementById('popoverBg');
  if (!pop || !bg) return;

  bg.onclick = closePopover;
  const logo = document.getElementById('popLogo');
  logo.style.background = t.logo ? '#fff' : cm.hex;
  logo.innerHTML = t.logo ? `<img src="${escapeHtml(t.logo)}" alt="${escapeHtml(t.abbr)}">` : `<span style="color:#fff;font-weight:700;font-size:.8rem;">${escapeHtml(t.abbr)}</span>`;
  document.getElementById('popTitle').textContent = t.name;
  let tags = `<span class="tag" style="background:${escapeHtml(cm.hex)}">${escapeHtml(cm.label)}</span>`;
  if (t.badge) tags += ` <span class="tag badge-${escapeHtml(t.badge)}">${escapeHtml(t.badgeText)}</span>`;
  if (t.hkust) tags += ` <span class="tag" style="background:#0EA5E9">HKUST</span>`;
  if (t.free) tags += ` <span class="tag" style="background:#10B981">Free</span>`;
  document.getElementById('popTags').innerHTML = tags;

  const popScreenshotsSection = document.getElementById('popScreenshotsSection');
  const popScreenshotsWrap = document.getElementById('popScreenshotsWrap');
  if (c.screenshots && c.screenshots.length > 0) {
    pop.classList.add('has-screenshots');
    pop.classList.remove('no-screenshots');
    popScreenshotsSection.classList.add('is-visible');
    popScreenshotsWrap.innerHTML = '';
    c.screenshots.forEach((src, i) => {
      const th = document.createElement('div');
      th.className = 'pop-ss-thumb';
      th.innerHTML = `<img src="${escapeHtml(src)}" alt="Screenshot ${i + 1}"><div class="zoom-hint">🔍 Click to enlarge</div>`;
      th.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openLightbox(c.screenshots, i);
      });
      popScreenshotsWrap.appendChild(th);
    });
  } else {
    pop.classList.remove('has-screenshots');
    pop.classList.add('no-screenshots');
    popScreenshotsSection.classList.remove('is-visible');
    popScreenshotsWrap.innerHTML = '';
  }

  document.getElementById('popAbout').textContent = c.about || '';
  const plink = t.policy_url;
  const privRaw = (t.privacy || '').trim();
  const privBlock = privRaw
    ? `<span class="privacy-text">${privacyBodyHtml(privRaw)}</span><br>`
    : '<span class="privacy-empty">—</span><br>';
  document.getElementById('popPrivacy').innerHTML = `${privBlock}${
    plink
      ? `<a href="${escapeHtml(plink)}" target="_blank" rel="noopener" class="policy-link">View Privacy Policy ↗</a>`
      : '<span class="policy-na">Policy not available</span>'
  }`;
  document.getElementById('popCoverage').textContent = c.coverage || '';
  document.getElementById('popUnique').innerHTML = toBullets(c.unique, 'bullets', true);
  document.getElementById('popLimits').innerHTML = toBullets(c.limitations, 'bullets', true);
  document.getElementById('popAiRole').innerHTML = buildAiRoleHtml(t, c);
  document.getElementById('popSimilar').innerHTML = similarToBullets(c.similar);
  document.getElementById('popLinkWrap').innerHTML = t.url
    ? `<a class="visit-btn" href="${escapeHtml(t.url)}" target="_blank" rel="noopener">${t.viaLibrary ? 'Visit via Library ↗' : 'Visit ' + escapeHtml(t.name) + ' ↗'}</a>`
    : `<p class="detail-url-missing">URL not yet available</p>`;

  bg.style.height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) + 'px';
  bg.style.display = 'block';
  bg.classList.add('active');
  pop.classList.remove('mobile-sheet');
  if (window.innerWidth < 640) pop.classList.add('mobile-sheet');
  pop.classList.add('active');
  document.body.style.overflow = 'hidden';
  const rect = clickedEl.getBoundingClientRect();
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const popHeight = pop.offsetHeight;
  const viewTop = scrollTop + 20;
  const viewBottom = scrollTop + window.innerHeight - 20;
  let topPos = rect.top + scrollTop;
  if (topPos + popHeight > viewBottom) topPos = viewBottom - popHeight;
  if (topPos < viewTop) topPos = viewTop;
  pop.style.top = topPos + 'px';
  if (window.innerWidth < 640) {
    pop.style.left = '0';
    pop.style.transform = 'none';
  }
}

window.closePopover = function closePopover() {
  const pop = document.getElementById('popover');
  const bg = document.getElementById('popoverBg');
  if (pop) {
    pop.classList.remove('active', 'mobile-sheet', 'has-screenshots', 'no-screenshots');
    pop.style.top = '';
  }
  if (bg) {
    bg.classList.remove('active');
    bg.style.display = 'none';
  }
  document.body.style.overflow = '';
  const mainContent = document.getElementById('main-content');
  if (mainContent) mainContent.classList.remove('blur-background');
};

window.openLightbox = function openLightbox(images, idx) {
  lbImages = images;
  lbIdx = idx;
  renderLightbox(false);
  const p = document.getElementById('popover');
  if (p) p.style.visibility = 'hidden';
  document.getElementById('lightbox').classList.add('active');
};

function renderLightbox(animate, dir) {
  const wrap = document.getElementById('lbImgWrap');
  const img = document.getElementById('lbImg');
  if (animate && dir !== undefined) {
    lbAnimating = true;
    wrap.className = 'lb-img-wrap ' + (dir > 0 ? 'slide-left' : 'slide-right');
    setTimeout(() => {
      img.src = lbImages[lbIdx];
      updateDots();
      updateCounter();
      wrap.className = 'lb-img-wrap ' + (dir > 0 ? 'slide-in-left' : 'slide-in-right');
      setTimeout(() => {
        wrap.className = 'lb-img-wrap';
        lbAnimating = false;
      }, 300);
    }, 280);
  } else {
    img.src = lbImages[lbIdx];
    wrap.className = 'lb-img-wrap';
    updateDots();
    updateCounter();
  }
}

function updateCounter() {
  const el = document.getElementById('lbCounter');
  if (el) el.textContent = lbIdx + 1 + ' / ' + lbImages.length;
}

function updateDots() {
  const d = document.getElementById('lbDots');
  if (lbImages.length > 1) {
    d.innerHTML = lbImages.map((_, i) => `<div class="lb-dot${i === lbIdx ? ' active' : ''}"></div>`).join('');
    d.style.display = 'flex';
  } else {
    d.innerHTML = '';
    d.style.display = 'none';
  }
}

window.lbNav = function (dir, e) {
  if (e) e.stopPropagation();
  if (lbAnimating || lbImages.length <= 1) return;
  lbIdx = (lbIdx + dir + lbImages.length) % lbImages.length;
  renderLightbox(true, dir);
};

window.closeLightbox = function closeLightbox() {
  const w = document.getElementById('lbImgWrap');
  w.className = 'lb-img-wrap';
  document.getElementById('lightbox').classList.remove('active');
  const p = document.getElementById('popover');
  if (p) p.style.visibility = 'visible';
  lbImages = [];
  lbAnimating = false;
};

document.addEventListener('keydown', (e) => {
  const lb = document.getElementById('lightbox');
  if (lb && lb.classList.contains('active')) {
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowRight' && lbImages.length > 1) {
      lbIdx = (lbIdx + 1) % lbImages.length;
      renderLightbox();
    }
    if (e.key === 'ArrowLeft' && lbImages.length > 1) {
      lbIdx = (lbIdx - 1 + lbImages.length) % lbImages.length;
      renderLightbox();
    }
    return;
  }
  if (e.key === 'Escape') closePopover();
});

function bootstrap(data) {
  NEEDS_DEF = data.needsDef || [];
  catMeta = data.catMeta || {};
  STAGES = data.stages || [];
  AI_ROLE_DEFS = data.aiRoleDefinitions || [];

  data.tools.forEach((t) => {
    CONTENT_BY_ID[t.id] = {
      about: t.about || '',
      aiRole: t.ai_role || '',
      unique: t.unique || '',
      similar: t.similar || '',
      coverage: t.coverage || '',
      limitations: t.limitations || '',
      screenshots: t.screenshots || [],
    };
  });

  T = data.tools.map((t) => ({
    id: t.id,
    name: t.name,
    cat: t.cat,
    abbr: t.abbr,
    logo: t.logo,
    free: !!t.free,
    hkust: !!t.hkust,
    viaLibrary: !!t.viaLibrary,
    url: t.url || '',
    badge: t.badge || '',
    badgeText: t.badgeText || '',
    via: t.via || '',
    needs: t.needs || [],
    privacy: t.privacy || '',
    policy_url: t.policy_url || '',
    ai_roles: t.ai_roles || [],
  }));

  selectedTools = new Set(T.filter((t) => !TRADITIONAL_CATS.has(t.cat)).map((t) => t.id));

  renderNeedPills();
  renderTimeline();
  applyTimelineFilters();
  renderToolSelector();
  renderTable();
  setView('timeline');
}

function wireViewTabs() {
  document.querySelectorAll('.view-tab').forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  wireViewTabs();
  fetch('data.json')
    .then((r) => {
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      return r.json();
    })
    .then(bootstrap)
    .catch((err) => {
      console.error(err);
      const el = document.getElementById('load-error');
      if (el) {
        el.style.display = 'block';
        el.innerHTML =
          '<strong>Could not load data.json.</strong> Open this site via a local server (e.g. <code>npx serve .</code> in this folder) so <code>fetch()</code> can load the file. ' +
          escapeHtml(String(err.message));
      }
    });
});
