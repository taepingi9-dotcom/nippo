'use strict';
(() => {
const CFG = window.APP_CONFIG || {};
const params = new URLSearchParams(location.search);
const MOCK = !CFG.LIFF_ID || !CFG.GAS_URL || params.has('mock');
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const DEFAULT_SETTINGS = { name: '', company: '', startTime: '08:00', lunchStart: '12:00', lunchEnd: '13:00', endTime: '17:00' };
const OFF_OPTIONS = [['', '休みなし'], ['1日', '1日休み'], ['午前', '午前休み'], ['午後', '午後休み']];
function normOff(v) { return v === true ? '1日' : ['1日', '午前', '午後'].includes(v) ? v : ''; }
const DEFAULT_UNITS = ['枚', '本', '個', '箱', '袋', '缶', '巻', 'kg', 'm', '㎡', 'セット'];
const TIMES = [];
for (let m = 5 * 60; m <= 24 * 60; m += 15) TIMES.push(hm(m));

const state = {
  date: ymd(new Date()),
  day: { date: '', blocks: [], crew: [] },
  settings: { ...DEFAULT_SETTINGS },
  masters: { sites: [], contents: [], people: [], materials: [], units: [] },
  dirty: false,
  printDays: [],
};

// ---------- 小さな道具 ----------
function $(s, el = document) { return el.querySelector(s); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function hm(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
function toMin(t) { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); }
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function jpDate(s) { const d = parseYmd(s); return `${d.getMonth() + 1}月${d.getDate()}日(${WD[d.getDay()]})`; }
function unique(list) { return [...new Set(list.filter(Boolean))]; }
function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

function toast(msg, ms = 2200) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms);
}
async function withLoading(fn, text = '読み込み中…') {
  $('#loadingText').textContent = text; $('#loading').hidden = false;
  try { return await fn(); }
  catch (e) { toast(e.message || String(e), 4000); throw e; }
  finally { $('#loading').hidden = true; }
}

// ---------- サーバーとのやりとり ----------
const Api = {
  async call(action, payload = {}) {
    if (MOCK) return clone(Mock[action](clone(payload)));
    const res = await fetch(CFG.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: liff.getAccessToken(), ...payload }),
    });
    if (!res.ok) throw new Error('通信エラー（' + res.status + '）');
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || 'エラーが発生しました');
    return j.data;
  },
};

// 候補リスト（よく使う現場・人・材料）。新しく使ったものほど前に並べる
function buildMasters(days) {
  const recent = (list) => { const m = new Map(); list.forEach((v, i) => { if (v) m.set(v, i); }); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]); };
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const blocks = sorted.flatMap(d => d.blocks.filter(b => b.type !== 'break'));
  const mats = blocks.flatMap(b => b.materials || []);
  const unitOf = {};
  mats.forEach(m => { if (m.name && m.unit) unitOf[m.name] = m.unit; });
  return {
    sites: recent(blocks.map(b => b.site)),
    contents: recent(blocks.map(b => b.content)),
    people: recent(sorted.flatMap(d => [...d.blocks.flatMap(b => b.people || []), ...(d.crew || []).flatMap(g => g.people || [])])),
    crewSites: recent(sorted.flatMap(d => (d.crew || []).map(g => g.site))),
    materials: recent(mats.map(m => m.name)).map(name => ({ name, unit: unitOf[name] || '' })),
    units: unique([...recent(mats.map(m => m.unit)), ...DEFAULT_UNITS]),
  };
}

// お試しモード：ブラウザ内に保存
const MOCK_KEY = 'sagyo-nippo-demo';
let mockMemory = null;
const Mock = {
  db() {
    if (!mockMemory) {
      try { mockMemory = JSON.parse(localStorage.getItem(MOCK_KEY)); } catch { mockMemory = null; }
      if (!mockMemory) { mockMemory = sampleDb(); this.store(); }
    }
    return mockMemory;
  },
  store() { try { localStorage.setItem(MOCK_KEY, JSON.stringify(mockMemory)); } catch { /* 保存できなくても動かす */ } },
  getInit() { const d = this.db(); return { settings: { ...DEFAULT_SETTINGS, ...d.settings }, masters: buildMasters(Object.values(d.days)) }; },
  getDay({ date }) { return this.db().days[date] || null; },
  getPrevDay({ date }) { const d = this.db(); const k = Object.keys(d.days).filter(x => x < date).sort().pop(); return k ? d.days[k] : null; },
  getDays({ from, to }) { const d = this.db(); return Object.keys(d.days).filter(k => k >= from && k <= to).sort().map(k => d.days[k]); },
  saveDay({ day }) {
    const d = this.db();
    if (day.blocks.length || day.crew.length) d.days[day.date] = day; else delete d.days[day.date];
    this.store();
    return { masters: buildMasters(Object.values(d.days)) };
  },
  saveSettings({ settings }) { const d = this.db(); d.settings = settings; this.store(); return { ...DEFAULT_SETTINGS, ...settings }; },
};
function sampleDb() {
  const w = (site, start, end, content, materials = []) => ({ type: 'work', site, start, end, content, people: [], materials });
  const lunch = { type: 'break', site: '', start: '12:00', end: '13:00', content: '昼休けい', people: [], materials: [] };
  return {
    settings: { ...DEFAULT_SETTINGS, name: '駒井', company: '(株)河本建築工業' },
    days: {
      '2026-10-20': {
        date: '2026-10-20',
        blocks: [w('鈴木邸', '08:00', '12:00', '地墨出し'), lunch, w('山本邸', '13:00', '16:00', '打合せ'), w('鳥羽邸', '16:00', '17:45', '外壁断熱', [{ name: '断熱材', qty: '6', unit: '枚' }])],
        crew: [
          { people: ['親方'], site: '鈴木邸→山本邸→鳥羽邸', time: '', off: '' },
          { people: ['山本'], site: '', time: '', off: '1日' },
          { people: ['吉井', '石谷'], site: '鳥羽邸', time: '1日', off: '' },
        ],
      },
      '2026-10-21': {
        date: '2026-10-21',
        blocks: [w('清水邸', '08:00', '12:00', '床フロアー張'), lunch, w('清水邸', '13:00', '16:00', '床下断熱スタイロ入', [{ name: 'スタイロフォーム', qty: '8', unit: '枚' }]), w('鳥羽邸', '16:00', '17:45', '')],
        crew: [
          { people: ['親方', '山本'], site: '清水邸', time: '1日', off: '' },
          { people: ['吉井', '石谷'], site: '鳥羽邸', time: '1日', off: '' },
        ],
      },
    },
  };
}

// ---------- 入力画面 ----------
function newWork(start, end) { return { type: 'work', site: '', start, end, content: '', people: [], materials: [] }; }
function newBreak(start, end) { return { type: 'break', site: '', start, end, content: '昼休けい', people: [], materials: [] }; }
function endAfter(start, want, plus) {
  return toMin(want) > toMin(start) ? want : hm(Math.min(toMin(start) + plus, 24 * 60));
}

function markDirty() { state.dirty = true; $('#saveBtn').classList.add('dirty'); }

function renderInput() {
  const today = ymd(new Date());
  $('#dateLabel').textContent = jpDate(state.date) + (state.date === today ? '  今日' : '');
  $('#dateInput').value = state.date;
  const blocks = state.day.blocks;
  $('#emptyHelp').hidden = blocks.length > 0;
  let workNo = 0;
  $('#blocks').innerHTML = blocks.map((b, i) => blockHtml(b, i, b.type === 'break' ? 0 : ++workNo)).join('');
  renderCrew();
  $('#saveBtn').classList.toggle('dirty', state.dirty);
  renderDatalists();
}

// 一緒に作業した人：自分の作業とは別に、皆がどこに行ったかを書く（用紙の右上）
function renderCrew() {
  const crew = state.day.crew;
  const cands = unique([...crew.flatMap(g => g.people), ...state.masters.people]).slice(0, 40);
  $('#crew').innerHTML = `<h2>一緒に作業した人・行き先 <small>用紙の右上に印刷</small></h2>
    ${crew.map((g, i) => `<div class="crewgrp${g.off ? ' off' : ''}" data-ci="${i}">
      <div class="card-head"><span class="tag">${i + 1}</span>
        <select class="offsel" data-cf="off" aria-label="休み">${OFF_OPTIONS.map(([v, t]) => `<option value="${v}"${g.off === v ? ' selected' : ''}>${t}</option>`).join('')}</select>
        <button class="x" data-cact="del">削除</button></div>
      <div class="chips">${cands.map(p => `<button class="chip${g.people.includes(p) ? ' on' : ''}" data-cact="toggle" data-name="${esc(p)}">${esc(p)}</button>`).join('')}</div>
      <div class="newperson"><input class="np" placeholder="名前を追加" aria-label="追加する名前"><button class="btn" data-cact="add">追加</button></div>
      ${g.off === '1日' ? '' : `<div class="crewrow">
        <label class="f">行き先<input data-cf="site" list="dl-crewsites" value="${esc(g.site)}" placeholder="例：鳥羽邸、鈴木邸→鳥羽邸"></label>
        <label class="f">時間<input data-cf="time" list="dl-crewtime" value="${esc(g.time)}" placeholder="1日"></label>
      </div>`}
    </div>`).join('')}
    <button class="btn ghost" data-cact="addGroup">＋ 人と行き先を追加</button>
    <p class="hint">同じ現場の人は1つにまとめます。違う現場の人や休みの人は「＋」で分けてください。一人で作業した日は空のままでOK。</p>`;
}

function onCrewField(e) {
  const el = e.target, box = el.closest('[data-ci]');
  if (!box || !el.dataset.cf) return;
  const g = state.day.crew[+box.dataset.ci];
  if (el.dataset.cf === 'off') {
    g.off = el.value;
    // 半日休みなら、出ている方の時間を入れておく
    if (g.off === '午前' && (!g.time || g.time === '1日')) g.time = '午後';
    if (g.off === '午後' && (!g.time || g.time === '1日')) g.time = '午前';
    if (!g.off && (g.time === '午前' || g.time === '午後')) g.time = '1日';
    markDirty(); renderCrew(); return;
  }
  g[el.dataset.cf] = el.value;
  markDirty();
}

function onCrewClick(e) {
  const btn = e.target.closest('[data-cact]');
  if (!btn) return;
  const crew = state.day.crew;
  if (btn.dataset.cact === 'addGroup') {
    const firstSite = (state.day.blocks.find(b => b.type !== 'break' && b.site) || {}).site || '';
    crew.push({ people: [], site: crew.length ? '' : firstSite, time: '1日', off: '' });
  } else {
    const i = +btn.closest('[data-ci]').dataset.ci, g = crew[i];
    if (btn.dataset.cact === 'del') crew.splice(i, 1);
    if (btn.dataset.cact === 'toggle') {
      const name = btn.dataset.name;
      g.people = g.people.includes(name) ? g.people.filter(p => p !== name) : [...g.people, name];
    }
    if (btn.dataset.cact === 'add') {
      const input = $('.np', btn.closest('[data-ci]'));
      const name = input.value.trim().replace(/さん$/, '');
      if (!name) { input.focus(); return; }
      if (!g.people.includes(name)) g.people.push(name);
    }
  }
  markDirty();
  renderCrew();
}

function timeSelect(field, val) {
  const opts = TIMES.includes(val) ? TIMES : [...TIMES, val].sort();
  return `<select data-f="${field}" aria-label="${field === 'start' ? '開始' : '終了'}">${opts.map(t => `<option${t === val ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
}

function blockHtml(b, i, no) {
  const times = `<div class="times">${timeSelect('start', b.start)}<span>〜</span>${timeSelect('end', b.end)}</div>`;
  if (b.type === 'break') {
    return `<div class="card block break" data-bi="${i}">
      <div class="card-head"><span class="tag gray">休憩</span>${times}<button class="x" data-act="delBlock">削除</button></div>
      <input data-f="content" value="${esc(b.content)}" placeholder="昼休けい" aria-label="休憩の名前">
    </div>`;
  }
  const hasPrevWork = state.day.blocks.slice(0, i).some(x => x.type !== 'break');
  return `<div class="card block" data-bi="${i}">
    <div class="card-head"><span class="tag">作業 ${no}</span>${times}<button class="x" data-act="delBlock">削除</button></div>
    ${hasPrevWork ? '<button class="linkbtn" data-act="sameAsPrev">↑ 前の作業と同じ内容にする</button>' : ''}
    <label class="f">現場名（業務名）<input data-f="site" list="dl-sites" value="${esc(b.site)}" placeholder="例：旧鳥羽邸"></label>
    <label class="f">作業内容<input data-f="content" list="dl-contents" value="${esc(b.content)}" placeholder="例：外壁下地"></label>
    <div class="f">使用材料
      <div class="mats">${(b.materials || []).map((m, j) => `<div class="mat" data-mi="${j}">
        <input data-mf="name" list="dl-materials" value="${esc(m.name)}" placeholder="材料名" aria-label="材料名">
        <input data-mf="qty" inputmode="decimal" value="${esc(m.qty)}" placeholder="数量" aria-label="数量">
        <input data-mf="unit" list="dl-units" value="${esc(m.unit)}" placeholder="単位" aria-label="単位">
        <button class="x" data-act="delMat" aria-label="この材料を消す">×</button></div>`).join('')}
      </div>
      <button class="linkbtn" data-act="addMat">＋ 材料を追加</button>
    </div>
  </div>`;
}

function renderDatalists() {
  const opt = (list) => list.map(v => `<option value="${esc(v)}"></option>`).join('');
  $('#dl-sites').innerHTML = opt(state.masters.sites);
  $('#dl-contents').innerHTML = opt(state.masters.contents);
  $('#dl-materials').innerHTML = opt(state.masters.materials.map(m => m.name));
  $('#dl-units').innerHTML = opt(state.masters.units);
  $('#dl-crewsites').innerHTML = opt(unique([...state.masters.sites, ...(state.masters.crewSites || [])]));
}

function onField(e) {
  const el = e.target;
  const card = el.closest('[data-bi]');
  if (!card) return;
  const b = state.day.blocks[+card.dataset.bi];
  if (el.dataset.f) {
    b[el.dataset.f] = el.value;
  } else if (el.dataset.mf) {
    const row = el.closest('[data-mi]');
    const m = b.materials[+row.dataset.mi];
    m[el.dataset.mf] = el.value;
    if (el.dataset.mf === 'name' && !m.unit) {
      const hit = state.masters.materials.find(x => x.name === el.value);
      if (hit && hit.unit) { m.unit = hit.unit; $('[data-mf=unit]', row).value = hit.unit; }
    }
  } else {
    return;
  }
  markDirty();
}

function onBlockClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const card = btn.closest('[data-bi]');
  const i = +card.dataset.bi;
  const b = state.day.blocks[i];
  switch (btn.dataset.act) {
    case 'delBlock':
      if (b.type !== 'break' && (b.site || b.content) && !confirm('この作業を削除しますか？')) return;
      state.day.blocks.splice(i, 1);
      break;
    case 'addMat':
      b.materials.push({ name: '', qty: '', unit: '' });
      markDirty(); renderInput();
      { const rows = document.querySelectorAll(`[data-bi="${i}"] [data-mf=name]`); rows[rows.length - 1]?.focus(); }
      return;
    case 'delMat':
      b.materials.splice(+btn.closest('[data-mi]').dataset.mi, 1);
      break;
    case 'sameAsPrev': {
      const prev = state.day.blocks.slice(0, i).reverse().find(x => x.type !== 'break');
      if (prev) { b.site = prev.site; b.content = prev.content; }
      break;
    }
    default: return;
  }
  markDirty();
  renderInput();
}

function addWork() {
  const bl = state.day.blocks, last = bl[bl.length - 1], s = state.settings;
  const start = last ? last.end : s.startTime;
  bl.push(newWork(start, endAfter(start, s.endTime, 120)));
  markDirty(); renderInput();
  document.querySelectorAll('.block')[bl.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function addBreak() {
  const bl = state.day.blocks, last = bl[bl.length - 1], s = state.settings;
  const start = last ? last.end : s.lunchStart;
  bl.push(newBreak(start, endAfter(start, start === s.lunchStart ? s.lunchEnd : '', 60)));
  markDirty(); renderInput();
}
function useTemplate() {
  const s = state.settings;
  state.day.blocks = [newWork(s.startTime, s.lunchStart), newBreak(s.lunchStart, s.lunchEnd), newWork(s.lunchEnd, s.endTime)];
  markDirty(); renderInput();
}
async function copyPrev() {
  const prev = await withLoading(() => Api.call('getPrevDay', { date: state.date }));
  if (!prev) { toast('コピーできる日報がありません'); return; }
  const p = normalizeDay(clone(prev));
  state.day.blocks = p.blocks.map(b => ({ ...b, people: [], materials: [] }));
  state.day.crew = p.crew;
  markDirty(); renderInput();
  toast(`${jpDate(prev.date)}の日報をコピーしました（材料は空です）`);
}

async function loadDay(date) {
  const d = await withLoading(() => Api.call('getDay', { date }));
  state.date = date;
  state.day = d ? normalizeDay(d) : { date, blocks: [], crew: [] };
  state.dirty = false;
  renderInput();
}
function normalizeDay(d) {
  d.blocks = (d.blocks || []).map(b => ({ type: 'work', site: '', content: '', ...b, people: b.people || [], materials: b.materials || [] }));
  let crew = Array.isArray(d.crew) ? d.crew : [];
  if (!crew.length) {
    // 以前の形式（作業ごとに人を選んでいた）を、現場ごとのまとまりに直す
    d.blocks.filter(b => b.type !== 'break' && b.people.length).forEach(b => {
      let g = crew.find(x => x.site === b.site);
      if (!g) { g = { people: [], site: b.site, time: '', off: '' }; crew.push(g); }
      b.people.forEach(p => { if (!g.people.includes(p)) g.people.push(p); });
    });
  }
  d.crew = crew.map(g => ({ people: g.people || [], site: g.site || '', time: g.time || '', off: normOff(g.off) }));
  return d;
}
async function changeDate(date) {
  if (!date || date === state.date) return;
  if (state.dirty && !confirm('保存していない変更があります。保存せずに移動しますか？')) { $('#dateInput').value = state.date; return; }
  await loadDay(date);
}

async function save() {
  const bl = state.day.blocks;
  for (let i = 0; i < bl.length; i++) {
    if (toMin(bl[i].end) <= toMin(bl[i].start)) { toast(`${bl[i].start}〜${bl[i].end} の時間を確認してください（終わりが始まりより前）`, 3500); return; }
  }
  bl.sort((a, b) => toMin(a.start) - toMin(b.start));
  bl.forEach(b => {
    b.site = (b.site || '').trim(); b.content = (b.content || '').trim();
    b.people = unique((b.people || []).map(p => p.trim()));
    b.materials = (b.materials || []).map(m => ({ name: (m.name || '').trim(), qty: String(m.qty || '').trim(), unit: (m.unit || '').trim() })).filter(m => m.name);
  });
  bl.forEach(b => { b.people = []; });
  const crew = state.day.crew
    .map(g => ({ people: unique(g.people.map(p => p.trim())), site: (g.site || '').trim(), time: (g.time || '').trim(), off: normOff(g.off) }))
    .filter(g => g.people.length);
  state.day.crew = crew;
  const r = await withLoading(() => Api.call('saveDay', { day: { date: state.date, blocks: bl, crew } }), '保存中…');
  state.masters = r.masters;
  state.dirty = false;
  renderInput();
  toast(bl.length || crew.length ? '保存しました' : 'この日の日報を消しました');
}

// ---------- 印刷 ----------
function setRange(kind) {
  const today = ymd(new Date());
  const dow = (parseYmd(today).getDay() + 6) % 7; // 月曜=0
  const monday = addDays(today, -dow);
  let from = today, to = today;
  if (kind === 'week') { from = monday; to = addDays(monday, 6); }
  if (kind === 'lastweek') { from = addDays(monday, -7); to = addDays(monday, -1); }
  if (kind === 'month') { from = today.slice(0, 8) + '01'; to = today; }
  $('#pFrom').value = from; $('#pTo').value = to;
}
async function fetchPrintDays() {
  const from = $('#pFrom').value, to = $('#pTo').value;
  if (!from || !to || from > to) { toast('期間を正しく選んでください'); return null; }
  const days = await withLoading(() => Api.call('getDays', { from, to }));
  state.printDays = days.map(normalizeDay).filter(d => d.blocks.length || d.crew.length);
  return state.printDays;
}
// B5横に2日分（A4縦を2枚並べた比率とほぼ同じ）、またはA4縦に1日分
const FORMATS = {
  b5: { perSheet: 2, w: 1588, h: 1125, mm: [257, 182], orientation: 'landscape' },
  a4: { perSheet: 1, w: 794, h: 1123, mm: [210, 297], orientation: 'portrait' },
};
function printFormat() { return FORMATS[$('#pFormat').value] || FORMATS.b5; }
function renderSheets(days, fmt) {
  const sheets = [];
  for (let i = 0; i < days.length; i += fmt.perSheet) {
    const el = document.createElement('div');
    el.className = 'psheet';
    el.style.width = fmt.w + 'px'; el.style.height = fmt.h + 'px';
    for (let j = 0; j < fmt.perSheet; j++) {
      const d = days[i + j];
      if (d) el.appendChild(renderPage(d, state.settings));
      else { const blank = document.createElement('div'); blank.className = 'sheet'; el.appendChild(blank); }
    }
    sheets.push(el);
  }
  return sheets;
}

async function preview() {
  const days = await fetchPrintDays();
  if (!days) return;
  $('#pdfResult').innerHTML = '';
  const box = $('#pages');
  if (!days.length) { box.innerHTML = '<p class="hint">この期間の日報はありません</p>'; return; }
  const fmt = printFormat();
  const scale = Math.min(1, (box.clientWidth || 360) / fmt.w);
  box.innerHTML = '';
  renderSheets(days, fmt).forEach(sheet => {
    const wrap = document.createElement('div');
    wrap.className = 'pagewrap';
    wrap.style.width = fmt.w * scale + 'px';
    wrap.style.height = fmt.h * scale + 'px';
    sheet.style.transform = `scale(${scale})`;
    wrap.appendChild(sheet);
    box.appendChild(wrap);
  });
}
async function makePdf() {
  const days = await fetchPrintDays();
  if (!days) return;
  if (!days.length) { toast('この期間の日報はありません'); return; }
  const fmt = printFormat();
  const [pw, ph] = fmt.orientation === 'landscape' ? [Math.max(...fmt.mm), Math.min(...fmt.mm)] : fmt.mm;
  const from = $('#pFrom').value, to = $('#pTo').value;
  const name = from === to ? `作業日報_${from}.pdf` : `作業日報_${from}_${to}.pdf`;
  const sheets = renderSheets(days, fmt);
  const result = await withLoading(async () => {
    if (document.fonts) await document.fonts.ready;
    const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: fmt.mm, orientation: fmt.orientation });
    const cap = $('#capture');
    for (let i = 0; i < sheets.length; i++) {
      $('#loadingText').textContent = `PDFを作成中… ${i + 1}/${sheets.length}`;
      cap.innerHTML = '';
      cap.appendChild(sheets[i]);
      const canvas = await html2canvas(sheets[i], { scale: fmt.perSheet === 2 ? 2 : 2.5, backgroundColor: '#ffffff', logging: false });
      if (i > 0) pdf.addPage(fmt.mm, fmt.orientation);
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, pw, ph);
    }
    cap.innerHTML = '';
    if (MOCK) { pdf.save(name); return null; }
    $('#loadingText').textContent = 'Googleドライブに保存中…';
    const b64 = pdf.output('datauristring').split(',')[1];
    return Api.call('uploadPdf', { name, data: b64 });
  }, 'PDFを作成中…');
  if (!result) { toast('PDFをダウンロードしました'); return; }
  $('#pdfResult').innerHTML = `<section class="card"><h2>PDFができました（${sheets.length}枚）</h2>
    <p class="hint">${esc(result.name)}　印刷するときは用紙サイズを${$('#pFormat').value === 'b5' ? '「B5・横」' : '「A4・縦」'}にしてください。</p>
    <button class="btn primary big" id="openPdf">PDFを開く</button></section>`;
  $('#openPdf').onclick = () => liff.openWindow({ url: result.url, external: true });
}

// 用紙1枚分。紙の業務日報と同じ並びで描く
function renderPage(day, st) {
  const H = 41, TOP = 357, L = 125, M = 335, R = 680, TT = 292, HH = 31;
  const bl = [...day.blocks].sort((a, b) => toMin(a.start) - toMin(b.start));
  const mins = bl.flatMap(b => [toMin(b.start), toMin(b.end)]);
  const startH = Math.min(8, Math.floor(Math.min(480, ...mins) / 60));
  const endH = Math.max(18, Math.ceil(Math.max(1080, ...mins) / 60));
  const span = Math.max(14, endH - startH);
  const Y = m => TOP + (m / 60 - startH) * H;
  const bottom = TOP + (span + 0.35) * H;
  const d = parseYmd(day.date);
  const parts = [];
  const add = (cls, style, html = '') => parts.push(`<div class="${cls}" style="${style}">${html}</div>`);

  add('s-title', 'left:0;top:52px;width:690px', '業務日報');
  add('s-date', 'left:95px;top:150px;width:285px',
    `<span class="n">${d.getMonth() + 1}</span>月<span class="n">${d.getDate()}</span>日（${WD[d.getDay()]}）`);
  add('s-name', 'left:420px;top:228px;width:280px', `<small>氏名</small><span>${esc(st.name)}</span>`);

  // 右上：一緒に作業した人と行き先（グループごとに線で区切る）
  const crew = (day.crew || []).filter(g => g.people.length);
  if (crew.length) {
    const AREA_W = 300, AREA_H = 170;
    // 小さい字（時間・半日休み）は0.75行として数え、全体が枠に収まる文字の大きさにする
    const destLines = g => g.off === '1日' ? 1 : 1 + (g.time ? 0.75 : 0) + (g.off ? 0.75 : 0);
    const lines = crew.reduce((n, g) => n + Math.max(g.people.length, destLines(g)) * 1.3 + 0.4, 0);
    const fs = Math.min(20, AREA_H / lines);
    const html = crew.map(g => {
      const dest = g.off === '1日' ? '<div class="s-dest off">休み</div>'
        : `<div class="s-dest">${g.time ? `<small>${esc(g.time)}</small>` : ''}<div>${esc(g.site)}</div>${g.off ? `<small class="halfoff">（${g.off}休み）</small>` : ''}</div>`;
      return `<div class="s-grp" style="font-size:${fs}px"><div class="s-ppl">${g.people.map(p => `<div>・${esc(p)}<small>さん</small></div>`).join('')}</div>
        <div class="s-brace"></div>${dest}</div>`;
    }).join('');
    add('s-workers', `left:470px;top:48px;width:${AREA_W}px;max-height:${AREA_H + 10}px`, html);
  }

  // 表の枠
  add('s-box', `left:${L}px;top:${TT}px;width:${R - L}px;height:${bottom - TT}px`);
  add('s-hline', `left:${L}px;top:${TT + HH}px;width:${R - L}px`);
  add('s-vline', `left:${M}px;top:${TT}px;height:${bottom - TT}px`);
  add('s-head', `left:${L}px;top:${TT}px;width:${M - L}px;height:${HH}px`, '業務名');
  add('s-head', `left:${M}px;top:${TT}px;width:${R - M}px;height:${HH}px`, '業務内容');
  for (let k = 0; k <= span; k++) {
    const h = startH + k, y = TOP + k * H;
    add('s-tick', `left:${L - 12}px;top:${y}px`);
    if (h <= endH) add('s-label', `left:${L - 78}px;top:${y - 10}px;width:62px`, `${h}:00`);
    if (h === endH) add('s-hline', `left:${L}px;top:${y}px;width:${R - L}px`);
    else add('s-dot', `left:${L}px;top:${y}px;width:${R - L - 22}px`);
  }

  // 中身
  let prevContent = null, prevSite = null;
  bl.forEach(b => {
    let y1 = Y(toMin(b.start)), y2 = Y(toMin(b.end));
    // 罫線に文字が重ならないよう、1時間以上の作業は真ん中あたりの行の中に文字を置く
    const arrowTop = y1, arrowH = y2 - y1;
    if (y2 - y1 >= H) {
      const row = Math.max(0, Math.ceil(((y1 + y2) / 2 - TOP) / H) - 1);
      y1 = Math.max(y1, TOP + row * H); y2 = Math.min(y2, y1 + H);
    }
    // 長い文字は小さくし、それでも入らなければ作業の時間帯いっぱいまで使う
    const fit = (text, width) => {
      const len = [...String(text || '')].reduce((n, c) => n + (c.charCodeAt(0) < 0x2000 ? 0.6 : 1), 0);
      let fs = Math.min(19, Math.max(13, width / Math.max(len, 1)));
      const lines = Math.ceil(len * fs / width);
      let top = y1, hh = y2 - y1;
      if (lines * fs * 1.25 > hh) { top = arrowTop; hh = arrowH; if (lines * fs * 1.25 > hh) fs = Math.max(10, hh / 1.25 / lines); }
      return `top:${top}px;height:${hh}px;font-size:${fs}px`;
    };
    const h = y2 - y1;
    const small = h < 30 ? ' small' : '';
    if (b.type === 'break') {
      add('s-hline', `left:${L}px;top:${arrowTop}px;width:${R - L - 22}px`);
      add('s-hline', `left:${L}px;top:${arrowTop + arrowH}px;width:${R - L - 22}px`);
      add('s-text' + small, `left:${L + 18}px;top:${y1}px;height:${h}px;width:${M - L - 24}px`, `（${esc(b.content || '休憩')}）`);
      return;
    }
    add('s-arrow', `left:${L + 26}px;top:${arrowTop + 3}px;height:${Math.max(0, arrowH - 6)}px`, arrowH >= 24 ? '<i class="up"></i><i class="dn"></i>' : '');
    const sameSite = b.site && b.site === prevSite;
    add('s-text' + small + (sameSite ? ' ditto' : ''), `left:${L + 48}px;width:${M - L - 56}px;` + (sameSite ? `top:${y1}px;height:${h}px` : fit(b.site, M - L - 56)), sameSite ? '〃' : esc(b.site));
    prevSite = b.site;
    const ditto = b.content && b.content === prevContent;
    add('s-text' + small + (ditto ? ' ditto' : ''), `left:${M + 16}px;width:${R - M - 28}px;` + (ditto ? `top:${y1}px;height:${h}px` : fit(b.content, R - M - 28)), ditto ? '〃' : esc(b.content));
    prevContent = b.content;
  });

  if (st.company) add('s-foot', `left:0;top:${bottom + 70}px;width:794px`, esc(st.company));

  const el = document.createElement('div');
  el.className = 'sheet';
  el.innerHTML = parts.join('');
  return el;
}

// ---------- 設定 ----------
function renderSettings() {
  const s = state.settings;
  const fill = (id, v) => { $(id).innerHTML = TIMES.map(t => `<option${t === v ? ' selected' : ''}>${t}</option>`).join(''); };
  $('#sName').value = s.name; $('#sCompany').value = s.company;
  fill('#sStart', s.startTime); fill('#sEnd', s.endTime); fill('#sLunchStart', s.lunchStart); fill('#sLunchEnd', s.lunchEnd);
  $('#modeHint').textContent = MOCK
    ? 'お試しモードです。データはこのブラウザにだけ保存されます。'
    : 'データは Googleスプレッドシートに保存されています。材料は「材料」「材料集計」シートで確認できます。';
}
async function saveSettings() {
  const settings = {
    name: $('#sName').value.trim(), company: $('#sCompany').value.trim(),
    startTime: $('#sStart').value, endTime: $('#sEnd').value, lunchStart: $('#sLunchStart').value, lunchEnd: $('#sLunchEnd').value,
  };
  state.settings = await withLoading(() => Api.call('saveSettings', { settings }), '保存中…');
  toast('設定を保存しました');
}

// ---------- 画面切り替え ----------
function showTab(tab) {
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + tab; });
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  if (tab === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

function bind() {
  $('#blocks').addEventListener('input', onField);
  $('#blocks').addEventListener('change', onField);
  $('#blocks').addEventListener('click', onBlockClick);
  $('#crew').addEventListener('input', onCrewField);
  $('#crew').addEventListener('change', onCrewField);
  $('#crew').addEventListener('click', onCrewClick);
  $('#crew').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('np')) { e.preventDefault(); $('[data-cact=add]', e.target.closest('[data-ci]')).click(); }
  });
  $('#prevDay').onclick = () => changeDate(addDays(state.date, -1));
  $('#nextDay').onclick = () => changeDate(addDays(state.date, 1));
  $('#dateInput').addEventListener('change', e => changeDate(e.target.value));
  $('#addWork').onclick = addWork;
  $('#addBreak').onclick = addBreak;
  $('#useTemplate').onclick = useTemplate;
  $('#copyPrev').onclick = copyPrev;
  $('#saveBtn').onclick = save;
  document.querySelectorAll('[data-range]').forEach(b => { b.onclick = () => { setRange(b.dataset.range); preview(); }; });
  $('#previewBtn').onclick = preview;
  try { const f = localStorage.getItem('nippo-format'); if (f) $('#pFormat').value = f; } catch { /* なくても動く */ }
  $('#pFormat').addEventListener('change', e => { try { localStorage.setItem('nippo-format', e.target.value); } catch { /* なくても動く */ } if ($('#pages').children.length) preview(); });
  $('#pdfBtn').onclick = makePdf;
  $('#saveSettings').onclick = saveSettings;
  document.querySelectorAll('.tabbar button').forEach(b => { b.onclick = () => showTab(b.dataset.tab); });
  window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
}

async function init() {
  if (MOCK) {
    $('#modeBadge').hidden = false;
    $('#pdfHint').textContent = 'お試しモードでは、PDFはこの端末にダウンロードされます。';
  } else {
    await liff.init({ liffId: CFG.LIFF_ID });
    if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
  }
  bind();
  const r = await withLoading(() => Api.call('getInit'));
  state.settings = { ...DEFAULT_SETTINGS, ...r.settings };
  state.masters = r.masters;
  setRange('week');
  const q = new URLSearchParams(location.search);
  const date = q.get('date') || state.date;
  await loadDay(date);
  showTab(['input', 'print', 'settings'].includes(q.get('tab')) ? q.get('tab') : 'input');
}

init().catch(e => {
  console.error(e);
  document.body.insertAdjacentHTML('afterbegin', `<div class="card" style="margin:16px;color:#c0362c">起動できませんでした：${esc(e.message || e)}<br><button class="btn" onclick="location.reload()">もう一度開く</button></div>`);
});
})();
