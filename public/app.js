import { SAMPLES, FIXTURE } from './samples.js';
import { ENUMS, calibrateDuration, suggestMove, buildImagePrompt, checkConsistency, summarize } from './rules.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = {
  data: null,
  view: 'table',
  tab: 'bible',
  busy: false,
  loading: false,
  warnings: [],
  options: {},
  demo: false,
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const flatShots = () => (state.data?.scenes || []).flatMap((s) => s.shots);

// 每帧都重算一遍：时长校准 → 运镜建议 → 拼提示词 → 一致性检查
function recompute() {
  if (!state.data) return;
  const bible = state.data.bible;
  for (const shot of flatShots()) {
    if (!shot._manual) {
      const { duration } = calibrateDuration(shot);
      shot.duration = duration;
    }
    shot._moveHint = suggestMove(shot);
    shot._prompt = buildImagePrompt(shot, bible, state.options);
  }
  state.warnings = checkConsistency(flatShots(), bible, state.options);
}

// ---------------------------------------------------------------- 渲染
function render() {
  const has = Boolean(state.data);
  $('#emptyState').hidden = has || state.loading;
  $('#boardHead').hidden = !has;
  $('#boardBody').hidden = !has && !state.loading;
  ['btnExportCsv', 'btnExportXls', 'btnExportJson', 'btnPrint'].forEach((id) => ($('#' + id).disabled = !has));

  if (state.loading && !has) return renderSkeleton();
  if (!has) return;
  renderStats();
  renderBoard();
  renderInspector();
  renderBadge();
}

function renderStats() {
  const st = summarize(flatShots(), state.warnings);
  $('#stats').innerHTML = `
    <div class="stat"><b>${st.scenes}</b><span>场次</span></div>
    <div class="stat"><b>${st.shots}</b><span>镜头</span></div>
    <div class="stat"><b>${st.total.toFixed(1)}</b><span>总秒数</span></div>
    <div class="stat ${st.errors ? 'is-warn' : ''}"><b>${st.errors}</b><span>冲突</span></div>
    <div class="stat"><b>${st.warns}</b><span>提示</span></div>`;
}

function renderBadge() {
  const n = state.warnings.length;
  const b = $('#warnBadge');
  b.hidden = n === 0;
  b.textContent = n;
}

function opts(list, cur) {
  return list.map((v) => `<option ${v === cur ? 'selected' : ''}>${v}</option>`).join('');
}

function renderBoard() {
  const body = $('#boardBody');
  if (state.loading) return renderSkeleton();
  const scroll = body.scrollTop;
  body.innerHTML = state.view === 'table' ? tableHTML() : cardsHTML();
  body.scrollTop = scroll;
  bindBoardEvents();
}

// 生成期间先铺骨架屏，别让中间空着
function renderSkeleton() {
  const body = $('#boardBody');
  body.hidden = false;
  const row = (i) => `<div class="sk-row" style="animation-delay:${i * 60}ms">
      <div class="sk sk--id"></div>
      <div class="sk sk--tag"></div>
      <div class="sk sk--tag"></div>
      <div class="sk sk--tag"></div>
      <div class="sk sk--num"></div>
      <div class="sk sk--text">
        <div class="sk sk--l1"></div><div class="sk sk--l2"></div>
      </div>
      <div class="sk sk--text">
        <div class="sk sk--l1"></div><div class="sk sk--l2"></div>
      </div>
      <div class="sk sk--num"></div>
    </div>`;
  body.innerHTML = `<div class="skeleton" aria-busy="true" aria-label="正在拆解分镜">
    <div class="skeleton__note"><i></i>正在分析剧本，建立设定卡…</div>
    ${[0, 1, 2, 3, 4, 5].map(row).join('')}
  </div>`;
}

function tableHTML() {
  const bible = state.data.bible;
  const warnIds = new Set(state.warnings.map((w) => w.shotId).filter(Boolean));

  let rows = '';
  for (const scene of state.data.scenes) {
    const sc = bible.scenes.find((s) => s.id === scene.scene_id);
    rows += `<tr class="scene-sep"><td colspan="8">
      <span class="sid">${esc(scene.scene_id)}</span>${esc(sc?.name || '')}
      ${scene.summary ? ' · ' + esc(scene.summary) : ''}
      <span class="mood">${esc(scene.mood || '')}</span></td></tr>`;

    for (const shot of scene.shots) {
      const voice = voiceOf(shot);
      const warn = warnIds.has(shot.id) ? ' is-warn' : '';
      const dlg = (shot.dialogue || [])
        .map(
          (d) => `<span class="line"><span class="who">${esc(d.speaker)}</span>${esc(d.line_zh)}
            ${d.line_th ? `<span class="th">${esc(d.line_th)}</span>` : ''}</span>`
        )
        .join('');

      rows += `<tr class="shot${warn}" data-shot="${esc(shot.id)}">
        <td class="cell-id">${esc(shot.id)}<small>${esc(shot.angle)}</small></td>
        <td><select class="inline" data-f="shot_size">${opts(ENUMS.shot_size, shot.shot_size)}</select></td>
        <td><select class="inline" data-f="composition">${opts(ENUMS.composition, shot.composition)}</select></td>
        <td><select class="inline" data-f="camera_move">${opts(ENUMS.camera_move, shot.camera_move)}</select>
            ${shot._moveHint ? `<small style="color:#9A6B1C;font-size:9px">建议${shot._moveHint}</small>` : ''}</td>
        <td class="cell-dur"><input class="inline-num" data-f="duration" type="number" step="0.5" min="1" max="12" value="${shot.duration}"><small>s</small></td>
        <td class="cell-visual"><span contenteditable="true" data-f="visual">${esc(shot.visual)}</span><span class="emotion">${esc(shot.emotion || '')}</span></td>
        <td class="cell-dlg">${dlg || '<span class="none">—</span>'}</td>
        <td class="cell-voice">${voice ? `${esc(voice.name)}<em>${esc(voice.desc)}</em>` : '<span class="none">—</span>'}</td>
      </tr>`;
    }
  }

  return `<div class="table-wrap"><table class="shots">
    <colgroup>
      <col style="width:86px"><col style="width:82px"><col style="width:92px"><col style="width:86px">
      <col style="width:72px"><col><col style="width:210px"><col style="width:104px">
    </colgroup>
    <thead><tr>
      <th>镜号</th><th>景别</th><th>构图</th><th>运镜</th><th>时长</th><th>画面内容</th><th>台词 / 泰语</th><th>音色</th>
    </tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function voiceOf(shot) {
  const d = (shot.dialogue || [])[0];
  if (!d) return null;
  const c = (state.data.bible.characters || []).find((x) => x.name === d.speaker);
  if (!c) return { name: d.speaker, desc: '未匹配音色' };
  const v = c.voice || {};
  const desc = [v.gender, v.timbre, v.pace].filter(Boolean).join(' · ');
  return { name: c.name, desc: desc || '待定' };
}

function cardsHTML() {
  let html = '<div class="cards">';
  let i = 0;
  for (const scene of state.data.scenes) {
    for (const shot of scene.shots) {
      const voice = voiceOf(shot);
      const dlg = (shot.dialogue || [])
        .map((d) => `<div><span class="who">${esc(d.speaker)}</span>${esc(d.line_zh)}${d.line_th ? `<span class="th">${esc(d.line_th)}</span>` : ''}</div>`)
        .join('');
      html += `<article class="shotcard" style="animation-delay:${Math.min(i++ * 18, 400)}ms">
        <div class="shotcard__frame"><span class="frame-mark">${esc(shot.shot_size)} · ${esc(shot.angle)}</span></div>
        <div class="shotcard__meta"><b>${esc(shot.id)}</b><span>${shot.duration.toFixed(1)}s</span></div>
        <div class="shotcard__body">
          <p>${esc(shot.visual)}</p>
          ${dlg ? `<div class="shotcard__dlg">${dlg}</div>` : ''}
          <div class="shotcard__tags">
            <span class="tag tag--size">${esc(shot.composition)}</span>
            <span class="tag tag--move">${esc(shot.camera_move)}</span>
            ${voice ? `<span class="tag">${esc(voice.desc)}</span>` : ''}
          </div>
          <details style="margin-top:8px">
            <summary style="font-size:10px;color:#8A8377;cursor:pointer;letter-spacing:.06em">首帧提示词</summary>
            <pre style="white-space:pre-wrap;font-family:var(--mono);font-size:10px;line-height:1.6;color:#4A453C;margin:6px 0 0">${esc(shot._prompt)}</pre>
          </details>
        </div>
      </article>`;
    }
  }
  return html + '</div>';
}

// 编辑后刷新周边，但不重建表格（否则输入焦点会丢）
function afterEdit() {
  recompute();
  renderStats();
  renderBadge();
  refreshRowWarn();
  if (state.tab === 'check') renderInspector();
}

function refreshRowWarn() {
  const warnIds = new Set(state.warnings.map((w) => w.shotId).filter(Boolean));
  $$('#boardBody tr.shot').forEach((tr) => tr.classList.toggle('is-warn', warnIds.has(tr.dataset.shot)));
}

function bindBoardEvents() {
  $$('#boardBody select[data-f]').forEach((el) => {
    el.addEventListener('change', () => {
      const shot = findShot(el.closest('tr').dataset.shot);
      if (!shot) return;
      shot[el.dataset.f] = el.value;
      if (el.dataset.f === 'shot_size') delete shot._manual;
      afterEdit();
      el.closest('tr').querySelector('[data-f="duration"]').value = shot.duration;
      el.closest('tr').querySelector('.cell-id').innerHTML = `${esc(shot.id)}<small>${esc(shot.angle)}</small>`;
    });
  });

  $$('#boardBody input[data-f="duration"]').forEach((el) => {
    el.addEventListener('change', () => {
      const shot = findShot(el.closest('tr').dataset.shot);
      if (!shot) return;
      shot.duration = Math.max(1, Math.min(12, Number(el.value) || 3));
      shot._manual = true;
      el.value = shot.duration;
      afterEdit();
    });
  });

  $$('#boardBody [contenteditable]').forEach((el) => {
    el.addEventListener('blur', () => {
      const shot = findShot(el.closest('tr').dataset.shot);
      if (!shot) return;
      const text = el.textContent.trim();
      if (shot.visual === text) return;
      shot.visual = text;
      afterEdit();
    });
  });
}

function findShot(id) {
  return flatShots().find((s) => s.id === id);
}

// ---------------------------------------------------------------- 检视器
function renderInspector() {
  const body = $('#inspectorBody');
  if (!state.data) {
    body.innerHTML = '<p class="placeholder-note">生成后显示人物、场景、道具设定卡。</p>';
    return;
  }
  body.innerHTML = state.tab === 'bible' ? bibleHTML() : checkHTML();
  if (state.tab === 'bible') bindBibleEvents();
}

function bibleHTML() {
  const b = state.data.bible;
  let h = '';

  h += `<div class="ent"><div class="ent__head"><span class="ent__id">CAST</span><span class="ent__name">人物</span></div>`;
  for (const c of b.characters) {
    h += `<div class="card">
      <div class="ent__head"><span class="ent__id">${esc(c.id)}</span><span class="ent__name">${esc(c.name)}</span><span class="ent__role">${esc(c.role)} · ${esc(c.age)}</span></div>
      <p class="card__line" contenteditable="true" data-char="${esc(c.id)}" data-field="appearance"><b>锚点</b>${esc(c.appearance)}</p>
      ${c.face ? `<p class="card__line"><b>面部</b>${esc(c.face)}</p>` : ''}
      <div class="card__voice">${['gender', 'age_feel', 'timbre', 'pace', 'emotion']
        .filter((k) => c.voice?.[k])
        .map((k) => `<span>${esc(c.voice[k])}</span>`)
        .join('')}</div>
      ${c.forbidden?.length ? `<div class="card__forbid">${c.forbidden.map((f) => `<em>禁 ${esc(f)}</em>`).join('')}</div>` : ''}
    </div>`;
  }
  h += `</div>`;

  h += `<div class="ent"><div class="ent__head"><span class="ent__id">SCENE</span><span class="ent__name">场景</span></div>`;
  for (const s of b.scenes) {
    h += `<div class="card">
      <div class="ent__head"><span class="ent__id">${esc(s.id)}</span><span class="ent__name">${esc(s.name)}</span><span class="ent__role">${esc(s.time)}</span></div>
      <p class="card__line"><b>光线</b>${esc(s.light)}</p>
      <p class="card__line"><b>色调</b>${esc(s.palette)}</p>
    </div>`;
  }
  h += `</div>`;

  if (b.props?.length) {
    h += `<div class="ent"><div class="ent__head"><span class="ent__id">PROP</span><span class="ent__name">道具</span></div>`;
    for (const p of b.props) {
      h += `<div class="card">
        <div class="ent__head"><span class="ent__id">${esc(p.id)}</span><span class="ent__name">${esc(p.name)}</span></div>
        <p class="card__line"><b>外观</b>${esc(p.look)}</p>
        ${p.significance ? `<p class="card__line"><b>意义</b>${esc(p.significance)}</p>` : ''}
      </div>`;
    }
    h += `</div>`;
  }

  h += `<p class="placeholder-note" style="margin-top:14px">提示：锚点可直接改，改完所有镜头的首帧提示词会同步更新。</p>`;
  return h;
}

function bindBibleEvents() {
  $$('#inspectorBody [contenteditable][data-char]').forEach((el) => {
    el.addEventListener('blur', () => {
      const c = state.data.bible.characters.find((x) => x.id === el.dataset.char);
      if (!c) return;
      c.appearance = el.textContent.trim();
      afterEdit();
    });
  });
}

function checkHTML() {
  if (!state.warnings.length) {
    return `<div class="ok-block"><div class="mark">✓</div><p>没有发现一致性问题。<br/>角色外观、场景归属、道具使用都与设定卡对齐。</p></div>`;
  }
  const icon = { error: '✕', warn: '!' };
  return state.warnings
    .map(
      (w) => `<div class="check-item ${w.level === 'error' ? 'is-error' : ''}">
        <div class="check-item__t">${icon[w.level]} ${esc(w.title)}<span>${esc(w.shotId || '全局')}</span></div>
        <div class="check-item__d">${esc(w.detail)}</div>
      </div>`
    )
    .join('');
}

// ---------------------------------------------------------------- 交互
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add('is-on'));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    t.classList.remove('is-on');
    setTimeout(() => (t.hidden = true), 250);
  }, 2600);
}

function setStatus(kind, text) {
  const el = $('#statusChip');
  el.hidden = false;
  el.className = `status-pill ${kind}`;
  el.innerHTML = `<i></i>${esc(text)}`;
}

function setBusy(b) {
  state.busy = b;
  const btn = $('#btnGenerate');
  btn.disabled = b;
  btn.classList.toggle('is-busy', b);
  btn.querySelector('span').textContent = b ? '拆解中…' : '拆解分镜';
}

function step(name) {
  $$('#progress .progress__step').forEach((el) => {
    const order = ['bible', 'shots', 'done'];
    const cur = order.indexOf(name);
    const mine = order.indexOf(el.dataset.step);
    el.classList.toggle('is-active', mine === cur);
    el.classList.toggle('is-done', mine < cur);
  });
}

async function generate() {
  const script = $('#script').value.trim();
  if (script.length < 20) return toast('剧本太短，至少 20 个字');
  if (state.busy) return;

  state.options = {
    style: $('#optStyle').value,
    aspect: $('#optAspect').value,
    lang: $('#optLang').value,
    targetDuration: Number($('#optDur').value),
  };

  setBusy(true);
  state.loading = true;
  render();
  $('#progress').hidden = false;
  step('bible');

  const t0 = Date.now();
  const tick = setInterval(() => {
    setStatus('is-busy', `正在拆解 · ${Math.round((Date.now() - t0) / 1000)}s`);
  }, 500);
  setStatus('is-busy', '正在拆解 · 0s');

  try {
    const r1 = await fetch('/api/bible', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script }),
    });
    const d1 = await r1.json();
    if (!r1.ok) throw Object.assign(new Error(d1.error || '抽取设定卡失败'), { code: d1.code });

    step('shots');
    const r2 = await fetch('/api/shots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script, bible: d1.bible, options: state.options }),
    });
    const d2 = await r2.json();
    if (!r2.ok) throw Object.assign(new Error(d2.error || '拆解分镜失败'), { code: d2.code });

    const count = (d2.scenes || []).reduce((n, s) => n + s.shots.length, 0);
    if (!count) throw new Error('模型没有拆出任何镜头，换个剧本片段试试');

    state.data = { bible: d1.bible, scenes: d2.scenes, timing: { bible: d1.ms, shots: d2.ms } };
    state.demo = false;
    state.loading = false;
    step('done');
    recompute();
    render();
    const total = summarize(flatShots(), state.warnings).total;
    setStatus('', `模型 · ${total.toFixed(1)}s`);
    toast(`完成：${count} 镜 / ${total.toFixed(1)} 秒 · 用时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (err) {
    state.loading = false;
    if (err.code === 'NO_KEY' || /fetch|Failed/i.test(err.message)) {
      loadDemo('未配置 API Key，已载入内置示例');
    } else {
      render();
      toast('失败：' + err.message);
      setStatus('is-demo', '出错');
    }
  } finally {
    clearInterval(tick);
    setBusy(false);
    setTimeout(() => ($('#progress').hidden = true), 600);
  }
}

function loadDemo(msg) {
  state.data = JSON.parse(JSON.stringify(FIXTURE));
  state.demo = true;
  state.options = { style: '写实', aspect: '9:16', lang: '双语', targetDuration: 0 };
  if (!$('#script').value.trim()) $('#script').value = SAMPLES[0].text;
  $('#scriptCount').textContent = `${$('#script').value.length} 字`;
  recompute();
  render();
  setStatus('is-demo', '演示模式 · 内置示例');
  if (msg) toast(msg);
}

// ---------------------------------------------------------------- 导出
function rowsForExport() {
  return flatShots().map((s) => {
    const v = voiceOf(s);
    return {
      镜号: s.id,
      场次: s.scene_id,
      景别: s.shot_size,
      机位: s.angle,
      构图: s.composition,
      运镜: s.camera_move,
      '时长(秒)': s.duration,
      画面内容: s.visual,
      角色: (s.characters || []).join(' / '),
      道具: (s.props || []).join(' / '),
      台词: (s.dialogue || []).map((d) => `${d.speaker}：${d.line_zh}`).join(' / '),
      泰语: (s.dialogue || []).map((d) => d.line_th).filter(Boolean).join(' / '),
      音色: v ? `${v.name}｜${v.desc}` : '',
      音效: s.sfx,
      情绪: s.emotion,
      首帧提示词: s._prompt,
    };
  });
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportCsv() {
  const rows = rowsForExport();
  const head = Object.keys(rows[0]);
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [head.map(cell).join(','), ...rows.map((r) => head.map((h) => cell(r[h])).join(','))].join('\r\n');
  download(`分镜表_${Date.now()}.csv`, '\uFEFF' + csv, 'text/csv;charset=utf-8');
  toast('已导出 CSV（Excel 可直接打开）');
}

// Excel 能直接打开的 HTML 工作簿，带基本表格样式
function exportXls() {
  const rows = rowsForExport();
  const head = Object.keys(rows[0]);
  const th = head.map((h) => `<th style="background:#F2EDE2;border:1px solid #D5CCB8;padding:6px;font-size:11px">${esc(h)}</th>`).join('');
  const tr = rows
    .map(
      (r) =>
        '<tr>' +
        head
          .map((h) => `<td style="border:1px solid #E4DCCA;padding:6px;font-size:11px;vertical-align:top">${esc(r[h])}</td>`)
          .join('') +
        '</tr>'
    )
    .join('');
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>分镜表</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet>
</x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>
<body><table style="border-collapse:collapse">${'<tr>' + th + '</tr>'}${tr}</table></body></html>`;
  download(`分镜表_${Date.now()}.xls`, html, 'application/vnd.ms-excel');
  toast('已导出 Excel');
}

function exportJson() {
  const payload = {
    generatedAt: new Date().toISOString(),
    mode: state.demo ? 'demo' : 'model',
    options: state.options,
    bible: state.data.bible,
    scenes: state.data.scenes,
    shots: flatShots().map((s) => ({
      ...s,
      image_prompt: s._prompt,
    })),
    stats: summarize(flatShots(), state.warnings),
    warnings: state.warnings,
  };
  download(`storyboard_${Date.now()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  toast('已导出 JSON（可直接喂给图生视频 / TTS）');
}

// ---------------------------------------------------------------- 初始化
function init() {
  $('#samples').innerHTML = SAMPLES.map(
    (s) => `<button class="chip" data-sample="${s.id}" title="${esc(s.tag)}">${esc(s.name)}</button>`
  ).join('');

  $$('#samples .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = SAMPLES.find((x) => x.id === btn.dataset.sample);
      $('#script').value = s.text;
      $('#scriptCount').textContent = `${s.text.length} 字`;
      $$('#samples .chip').forEach((b) => b.classList.remove('is-on'));
      btn.classList.add('is-on');
      $('#script').focus();
    });
  });

  $('#script').addEventListener('input', (e) => {
    $('#scriptCount').textContent = `${e.target.value.length} 字`;
  });

  $('#btnGenerate').addEventListener('click', generate);

  $('#btnTrySample').addEventListener('click', () => {
    const s = SAMPLES[0];
    $('#script').value = s.text;
    $('#scriptCount').textContent = `${s.text.length} 字`;
    $$('#samples .chip').forEach((b) => b.classList.toggle('is-on', b.dataset.sample === s.id));
    generate();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      generate();
    }
  });

  $('#viewSwitch').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.view = b.dataset.view;
    $$('#viewSwitch button').forEach((x) => x.classList.toggle('is-active', x === b));
    renderBoard();
  });

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.tab = b.dataset.tab;
    $$('#tabs button').forEach((x) => x.classList.toggle('is-active', x === b));
    renderInspector();
  });

  $('#btnExportCsv').addEventListener('click', exportCsv);
  $('#btnExportXls').addEventListener('click', exportXls);
  $('#btnExportJson').addEventListener('click', exportJson);
  $('#btnPrint').addEventListener('click', () => window.print());

  // 打印只能打表格，卡片视图先切回来
  window.addEventListener('beforeprint', () => {
    if (state.view !== 'table') {
      state.view = 'table';
      $$('#viewSwitch button').forEach((x) => x.classList.toggle('is-active', x.dataset.view === 'table'));
      renderBoard();
    }
  });

  // 快捷键提示按平台切换
  const kbd = $('#btnGenerate kbd');
  if (!/Mac|iPhone/i.test(navigator.platform)) kbd.textContent = 'Ctrl ↵';

  // 探测后端状态：没配 Key 直接进入演示模式，HR 打开就能看到东西
  fetch('/api/health')
    .then((r) => r.json())
    .then((h) => {
      if (h.hasKey) {
        setStatus('', `模型 · ${h.model}`);
      } else {
        loadDemo();
      }
    })
    .catch(() => {
      setStatus('is-demo', '离线模式');
    });
}

// 暴露给测试与调试（无浏览器环境下也能驱动页面）
window.__SB = {
  state,
  get shots() { return flatShots(); },
  render,
  recompute,
};

init();
