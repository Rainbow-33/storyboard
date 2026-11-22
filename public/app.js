import { SAMPLES, FIXTURE } from './samples.js';
import { ENUMS, calibrateDuration, suggestMove, buildImagePrompt, checkConsistency, summarize, entityUsage } from './rules.js';
import { docxToText } from './docx.js';
import { buildStoryboardDocx } from './export-docx.js';

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
  selectedShot: null,
  images: {},      // "shot:S1-01" / "char:C1" -> /thumbs/xxx.png
  promptEdits: {}, // 手动改过的提示词，优先于自动生成的那句
  detailKey: null,
  detailKind: null,
  detailRefs: [],
  episode: '01',
  episodeName: '',
  episodes: [],
  currentEpId: null,
  bibleDirty: false, // 设定卡被手动改过 → 下次拆解直接拿它当约束
};

const STORE_IMAGES = 'sb.images';
const STORE_PROMPTS = 'sb.promptEdits';

function loadStore() {
  try {
    state.images = JSON.parse(localStorage.getItem(STORE_IMAGES) || '{}') || {};
    state.promptEdits = JSON.parse(localStorage.getItem(STORE_PROMPTS) || '{}') || {};
  } catch {
    state.images = {};
    state.promptEdits = {};
  }
}

function saveStore() {
  try {
    localStorage.setItem(STORE_IMAGES, JSON.stringify(state.images));
    localStorage.setItem(STORE_PROMPTS, JSON.stringify(state.promptEdits));
  } catch {
    /* 存储满了就算了，图还在服务端 */
  }
}

// ---------------------------------------------------------------- 分集管理
const STORE_EPS = 'sb.episodes';
const STORE_CUR = 'sb.currentEp';

function epSaveCurrent() {
  const ep = state.episodes.find((e) => e.id === state.currentEpId);
  if (!ep) return;
  ep.no = ($('#epNo').value || '01').trim() || '01';
  ep.name = ($('#epName').value || '').trim();
  ep.script = $('#script').value;
  ep.notes = $('#notes').value;
  ep.data = state.data || null;
  ep.images = state.images;
  ep.promptEdits = state.promptEdits;
  try {
    localStorage.setItem(STORE_EPS, JSON.stringify(state.episodes));
    localStorage.setItem(STORE_CUR, state.currentEpId);
  } catch {
    toast('集太多，本地存不下了（图片仍存服务端）');
  }
}

function epRenderSelect() {
  const sel = $('#epSelect');
  sel.innerHTML = state.episodes
    .map((e) => `<option value="${esc(e.id)}">ep${esc(e.no)}${e.name ? ' · ' + esc(e.name) : ''}${e.data ? '' : '（空）'}</option>`)
    .join('');
  sel.value = state.currentEpId;
}

function epLoad(id) {
  const ep = state.episodes.find((e) => e.id === id);
  if (!ep) return;
  state.currentEpId = id;
  state.episode = ep.no || '01';
  state.episodeName = ep.name || '';
  state.data = ep.data ? JSON.parse(JSON.stringify(ep.data)) : null;
  state.images = ep.images || {};
  state.promptEdits = ep.promptEdits || {};
  state.bibleDirty = false;
  $('#epNo').value = state.episode;
  $('#epName').value = state.episodeName;
  $('#script').value = ep.script || '';
  $('#scriptCount').textContent = `${(ep.script || '').length} 字`;
  $('#notes').value = ep.notes || '';
  $('#fileChip').hidden = true;
  if (state.data) recompute();
  render();
  epRenderSelect();
}

function initEpisodes() {
  try {
    state.episodes = JSON.parse(localStorage.getItem(STORE_EPS) || '[]') || [];
  } catch {
    state.episodes = [];
  }
  if (!state.episodes.length) {
    state.episodes = [{ id: 'e' + Date.now(), no: '01', name: '', script: '', notes: '', data: null }];
  }
  const saved = (() => {
    try {
      return localStorage.getItem(STORE_CUR);
    } catch {
      return null;
    }
  })();
  const cur = state.episodes.find((e) => e.id === saved) ? saved : state.episodes[0].id;
  epLoad(cur);
}

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
  ['btnExportCsv', 'btnExportXls', 'btnExportJson', 'btnExportDocx', 'btnPrint'].forEach((id) => ($('#' + id).disabled = !has));
  $('#feedbackBox').hidden = !has;

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
let skeletonTimer = null;
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
    <div class="skeleton__note"><i></i><span id="skNote">正在分析剧本…</span></div>
    ${[0, 1, 2, 3, 4, 5].map(row).join('')}
  </div>`;

  clearInterval(skeletonTimer);
  skeletonTimer = setInterval(() => {
    const el = document.getElementById('skNote');
    if (!el || !state.loading) {
      clearInterval(skeletonTimer);
      return;
    }
    const sec = Math.round((Date.now() - (state.loadStart || Date.now())) / 1000);
    el.textContent =
      sec < 60
        ? `正在拆解… ${sec}s（通常 40–90 秒）`
        : `正在拆解… ${sec}s（仍在处理，请稍候）`;
  }, 500);
}

function tableHTML() {
  const bible = state.data.bible;
  const warnIds = new Set(state.warnings.map((w) => w.shotId).filter(Boolean));

  let rows = '';
  for (const scene of state.data.scenes) {
    const sc = bible.scenes.find((s) => s.id === scene.scene_id);
    rows += `<tr class="scene-sep"><td colspan="7"><div class="scene-sep__inner">
      <span class="sid">${esc(scene.scene_id)}</span>
      <span class="sname">${esc(sc?.name || '')}</span>
      <span class="ssum">${esc(scene.summary || '')}</span>
      <span class="mood">${esc(scene.mood || '')}</span>
    </div></td></tr>`;

    for (const shot of scene.shots) {
      const voice = voiceOf(shot);
      const warn = warnIds.has(shot.id) ? ' is-warn' : '';
      const sel = shot.id === state.selectedShot ? ' is-selected' : '';
      const dlg = (shot.dialogue || [])
        .map(
          (d) => `<span class="line"><span class="who">${esc(d.speaker)}</span>${esc(d.line_zh)}
            ${d.line_th ? `<span class="th">${esc(d.line_th)}</span>` : ''}</span>`
        )
        .join('');

      rows += `<tr class="shot${warn}${sel}" data-shot="${esc(shot.id)}">
        <td class="cell-id">${esc(displayId(shot))}<small>${esc(shot.id)} · ${esc(shot.angle)}</small></td>
        <td class="cell-visual"><span contenteditable="true" data-f="visual">${esc(shot.visual)}</span><span class="emotion">${esc(shot.emotion || '')}</span></td>
        <td class="cell-dlg">${dlg || '<span class="none">—</span>'}${
          voice ? `<div class="cell-voice"><b>音色</b>${esc(voice.name)} · ${esc(voice.desc)}</div>` : ''
        }</td>
        <td class="cell-cam">
          <select class="inline" data-f="camera_move">${opts(ENUMS.camera_move, shot.camera_move)}</select>
          <select class="inline" data-f="shot_size">${opts(ENUMS.shot_size, shot.shot_size)}</select>
          <select class="inline" data-f="composition">${opts(ENUMS.composition, shot.composition)}</select>
          ${shot._moveHint ? `<small class="hint-move">建议${esc(shot._moveHint)}</small>` : ''}
        </td>
        <td class="cell-ent">${entHTML(shot)}</td>
        <td class="cell-note">${noteHTML(shot)}</td>
        <td class="cell-dur"><input class="inline-num" data-f="duration" type="number" step="0.5" min="1" max="12" value="${shot.duration}"><small>s</small></td>
      </tr>`;
    }
  }

  return `<div class="table-wrap"><table class="shots">
    <colgroup>
      <col class="c-id"><col class="c-vis"><col class="c-dlg"><col class="c-move">
      <col class="c-ent"><col class="c-note"><col class="c-dur">
    </colgroup>
    <thead><tr>
      <th>镜头号</th><th>画面描述</th><th>中英双语台词</th><th>运镜方式 / 景别</th><th>人物 / 场景 / 道具</th><th>备注（音效 / 首帧）</th><th>建议时长</th>
    </tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

// 镜头号按「集 + 全场连续编号」显示，如 ep01s03；内部 id（S1-03）留在小字里做定位
function shotNoMap() {
  const m = new Map();
  let i = 0;
  for (const sc of state.data?.scenes || []) for (const s of sc.shots) m.set(s.id, ++i);
  return m;
}

function displayId(shot) {
  const ep = String(state.episode || '01').padStart(2, '0');
  const n = shotNoMap().get(shot.id) || 1;
  return `ep${ep}s${String(n).padStart(2, '0')}`;
}

function entHTML(shot) {
  const b = state.data.bible;
  const chars = (shot.characters || []).map((id) => b.characters.find((c) => c.id === id)).filter(Boolean);
  const props = (shot.props || []).map((id) => (b.props || []).find((p) => p.id === id)).filter(Boolean);
  const sc = b.scenes.find((s) => s.id === shot.scene_id);
  const one = (x) => `${esc(x.name)}${x.name_en ? `<i>${esc(x.name_en)}</i>` : ''}`;
  const line = (label, arr) => (arr.length ? `<div><b>${label}</b>${arr.map(one).join('、')}</div>` : '');
  const html =
    line('人物', chars) +
    (sc ? `<div><b>场景</b>${one(sc)}</div>` : '') +
    line('道具', props);
  return html || '<span class="none">—</span>';
}

function noteHTML(shot) {
  const cont = String(shot.continuity || '').replace(/^首帧承接[:：]\s*/, '');
  return (
    [
      shot.sfx ? `<div><b>音效</b>${esc(shot.sfx)}</div>` : '',
      cont ? `<div><b>首帧</b>${esc(cont)}</div>` : '',
    ].join('') || '<span class="none">—</span>'
  );
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
      const shotImg = state.images[`shot:${shot.id}`];
      html += `<article class="shotcard" style="animation-delay:${Math.min(i++ * 18, 400)}ms">
        <div class="shotcard__frame" data-detail="shot:${esc(shot.id)}">${shotImg ? `<img src="${esc(shotImg)}" alt="" loading="lazy" />` : `<span class="frame-cta">生成预览</span>`}<span class="frame-mark">${esc(shot.shot_size)} · ${esc(shot.angle)}</span></div>
        <div class="shotcard__meta"><b>${esc(displayId(shot))}</b><span>${shot.duration.toFixed(1)}s</span></div>
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
// dirtyBible：改的是设定卡，下一次拆解直接拿它当约束
function afterEdit(dirtyBible = false) {
  if (dirtyBible) state.bibleDirty = true;
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
  // 点一行 = 选中该镜头（供「统一」面板挂道具用）；双击 = 进二级页面出图
  $$('#boardBody tr.shot').forEach((tr) => {
    tr.addEventListener('dblclick', (e) => {
      if (e.target.closest('input, select, [contenteditable], button')) return;
      openDetail(`shot:${tr.dataset.shot}`);
    });
    tr.addEventListener('click', (e) => {
      if (e.target.closest('input, select, [contenteditable], button')) return;
      state.selectedShot = tr.dataset.shot;
      refreshSelection();
      if (state.tab === 'unity') renderInspector();
    });
  });

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
  body.innerHTML = state.tab === 'bible' ? bibleHTML() : state.tab === 'unity' ? unityHTML() : checkHTML();
  if (state.tab === 'bible') bindBibleEvents();
  if (state.tab === 'unity') bindUnityEvents();
}

function bibleHTML() {
  const b = state.data.bible;
  let h = '';

  h += `<div class="ent"><div class="ent__head"><span class="ent__id">CAST</span><span class="ent__name">人物</span></div>`;
  for (const c of b.characters) {
    h += `<div class="card">
      <div class="ent__head"><span class="ent__id">${esc(c.id)}</span><span class="ent__name">${esc(c.name)}</span><span class="ent__role">${esc(c.role)} · ${esc(c.age)}</span></div>
      ${figHTML(`char:${c.id}`)}
      <p class="card__line" contenteditable="true" data-char="${esc(c.id)}" data-field="appearance"><b>锚点</b>${esc(c.appearance)}</p>
      ${c.face ? `<p class="card__line"><b>面部</b>${esc(c.face)}</p>` : ''}
      <div class="card__voice">${['gender', 'age_feel', 'timbre', 'pace', 'emotion']
        .filter((k) => c.voice?.[k])
        .map((k) => `<span>${esc(c.voice[k])}</span>`)
        .join('')}</div>
      ${c.forbidden?.length ? `<div class="card__forbid">${c.forbidden.map((f) => `<em>禁 ${esc(f)}</em>`).join('')}</div>` : ''}
      ${(c.outfits || [])
        .map(
          (o) => `<div class="card__outfit">
            <div class="ent__head"><span class="ent__id">${esc(o.id)}</span><span class="ent__name">${esc(o.name)}</span></div>
            ${figHTML(`outfit:${o.id}`)}
            <p class="card__line" contenteditable="true" data-outfit="${esc(o.id)}">${esc(o.desc)}</p>
          </div>`
        )
        .join('')}
    </div>`;
  }
  h += `</div>`;

  h += `<div class="ent"><div class="ent__head"><span class="ent__id">SCENE</span><span class="ent__name">场景</span></div>`;
  for (const s of b.scenes) {
    h += `<div class="card">
      <div class="ent__head"><span class="ent__id">${esc(s.id)}</span><span class="ent__name">${esc(s.name)}</span><span class="ent__role">${esc(s.time)}${s.weather ? ' · ' + esc(s.weather) : ''}</span></div>
      ${figHTML(`scene:${s.id}`)}
      ${s.place ? `<p class="card__line" contenteditable="true" data-scene="${esc(s.id)}"><b>空间</b>${esc(s.place)}</p>` : ''}
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
        ${figHTML(`prop:${p.id}`)}
        <p class="card__line"><b>外观</b>${esc(p.look)}</p>
        ${p.significance ? `<p class="card__line"><b>意义</b>${esc(p.significance)}</p>` : ''}
      </div>`;
    }
    h += `</div>`;
  }

  h += `<p class="placeholder-note" style="margin-top:14px">提示：锚点可直接改，改完所有镜头的首帧提示词会同步更新。</p>`;
  return h;
}

const TIMBRES = ['清冷偏低', '低沉沙哑', '温柔', '甜美', '活泼', '苍老', '浑厚', '中性'];

function unityHTML() {
  const { characters, props, total } = entityUsage(flatShots(), state.data.bible);
  const target = state.selectedShot;
  let h = '<p class="placeholder-note" style="margin-bottom:10px">这些设定会原样注入每个引用它的镜头，跨镜保持一致。</p>';

  for (const c of characters) {
    const cur = c.voice?.timbre || '';
    const list = TIMBRES.includes(cur) || !cur ? TIMBRES : [cur, ...TIMBRES];
    h += `<div class="uni">
      <div class="uni__head"><span class="ent__id">${esc(c.id)}</span><span class="uni__name">${esc(c.name)}</span>
        <span class="uni__count">${c.shots.length}/${total} 镜</span></div>
      <div class="uni__row"><b>外观</b>${esc(c.appearance)}</div>
      <div class="uni__row"><b>服装</b></div>
      ${(c.outfits || [])
        .map(
          (o) => `<div class="uni__outfit">
          <div class="uni__ohead"><span class="uni__oname">${esc(o.name)}</span><span class="uni__odesc">${esc(o.desc)}</span></div>
          <div class="uni__shots">${o.shots.map((id) => `<span class="uni__shot" data-goto="${id}">${id}</span>`).join('') || '<span class="uni__empty">未使用</span>'}</div>
          ${target ? `<button class="btn btn--ghost uni__set" data-setfit="${esc(c.id)}|${esc(o.id)}">套用到 ${esc(target)}</button>` : ''}
        </div>`
        )
        .join('')}
      <div class="uni__row" style="display:flex;align-items:center;gap:6px;margin-top:6px">
        <b>音色</b>
        <select class="inline" data-voice="${esc(c.id)}" style="width:auto;flex:1">${list
          .map((t) => `<option ${t === cur ? 'selected' : ''}>${esc(t)}</option>`)
          .join('')}</select>
      </div>
    </div>`;
  }

  h += `<div class="ent__head" style="margin:16px 0 8px"><span class="ent__id">PROP</span><span class="ent__name">道具</span></div>`;
  for (const p of props) {
    h += `<div class="uni">
      <div class="uni__head"><span class="ent__id">${esc(p.id)}</span><span class="uni__name">${esc(p.name)}</span>
        <span class="uni__count">${p.shots.length} 镜</span></div>
      <div class="uni__row"><b>外观</b>${esc(p.look)}</div>
      <div class="uni__shots">${
        p.shots.map((id) => `<span class="uni__shot" data-goto="${id}">${id}</span>`).join('') ||
        '<span class="uni__empty">还没用上</span>'
      }</div>
      <button class="btn btn--ghost" data-addprop="${esc(p.id)}" style="margin-top:7px;font-size:10px;padding:3px 8px">${
        target ? `加到 ${esc(target)}` : '选中一个镜头再加'
      }</button>
    </div>`;
  }
  return h;
}

function bindUnityEvents() {
  $$('#inspectorBody [data-goto]').forEach((el) => {
    el.addEventListener('click', () => {
      state.selectedShot = el.dataset.goto;
      refreshSelection();
      toast('已选中 ' + el.dataset.goto);
    });
  });

  $$('#inspectorBody [data-voice]').forEach((el) => {
    el.addEventListener('change', () => {
      const c = state.data.bible.characters.find((x) => x.id === el.dataset.voice);
      if (!c) return;
      c.voice = { ...(c.voice || {}), timbre: el.value };
      afterEdit();
      renderBoard();
      renderInspector();
      toast(`${c.name} 的音色已改为「${el.value}」`);
    });
  });

  $$('#inspectorBody [data-setfit]').forEach((el) => {
    el.addEventListener('click', () => {
      const [cid, oid] = el.dataset.setfit.split('|');
      if (!state.selectedShot) return toast('先在表格里点一行，选中一个镜头');
      const shot = findShot(state.selectedShot);
      if (!shot) return;
      if (!shot.characters.includes(cid)) return toast('这个镜头里没有该角色');
      shot.outfits = { ...(shot.outfits || {}), [cid]: oid };
      afterEdit();
      renderBoard();
      renderInspector();
      toast(`${displayId(shot)} 已改用这套服装`);
    });
  });

  $$('#inspectorBody [data-addprop]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.addprop;
      if (!state.selectedShot) return toast('先在表格里点一行，选中一个镜头');
      const shot = findShot(state.selectedShot);
      if (!shot) return;
      if (shot.props.includes(id)) return toast('这个镜头已经有该道具了');
      shot.props.push(id);
      afterEdit();
      renderInspector();
      toast(`已把 ${id} 加到 ${displayId(shot)}`);
    });
  });
}

function refreshSelection() {
  $$('#boardBody tr.shot').forEach((tr) => tr.classList.toggle('is-selected', tr.dataset.shot === state.selectedShot));
}

function bindBibleEvents() {
  $$('#inspectorBody [contenteditable][data-char]').forEach((el) => {
    el.addEventListener('blur', () => {
      const c = state.data.bible.characters.find((x) => x.id === el.dataset.char);
      if (!c) return;
      c.appearance = el.textContent.trim();
      afterEdit(true);
    });
  });

  // 服装描述：改完就是下次出图 / 重生成的新约束
  $$('#inspectorBody [contenteditable][data-outfit]').forEach((el) => {
    el.addEventListener('blur', () => {
      for (const c of state.data.bible.characters) {
        const o = (c.outfits || []).find((x) => x.id === el.dataset.outfit);
        if (o) {
          o.desc = el.textContent.trim();
          afterEdit(true);
          return;
        }
      }
    });
  });

  // 场景空间描述
  $$('#inspectorBody [contenteditable][data-scene]').forEach((el) => {
    el.addEventListener('blur', () => {
      const s = state.data.bible.scenes.find((x) => x.id === el.dataset.scene);
      if (!s) return;
      s.place = el.textContent.trim();
      afterEdit(true);
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

// 下拉里有「自定义…」时，取输入框里的值
function pick(selId, customId, fallback) {
  const el = $(selId);
  if (el.value === '__custom') return ($(customId).value || '').trim() || fallback;
  return el.value;
}

function readOptions() {
  return {
    style: pick('#optStyle', '#optStyleCustom', '电影感写实'),
    aspect: pick('#optAspect', '#optAspectCustom', '9:16'),
    subLang: pick('#optLang', '#optLangCustom', ''),
    targetDuration: Number(pick('#optDur', '#optDurCustom', '0')) || 0,
  };
}

// 统一的 POST：带超时，超过就明确报错，而不是一直转圈
async function postJson(url, body, timeoutMs = 300000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const j = await r.json();
    if (!r.ok) throw Object.assign(new Error(j.error || '请求失败'), { code: j.code });
    return j;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw Object.assign(new Error(`超过 ${timeoutMs / 1000} 秒没有响应，请稍后重试`), { code: 'TIMEOUT' });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function generate() {
  const script = $('#script').value.trim();
  if (script.length < 20) return toast('剧本太短，至少 20 个字');
  if (state.busy) return;

  state.options = readOptions();
  const notes = $('#notes').value.trim();

  setBusy(true);
  state.loading = true;
  state.loadStart = Date.now();
  render();
  $('#progress').hidden = false;
  step('bible');

  const t0 = Date.now();
  const tick = setInterval(() => {
    setStatus('is-busy', `正在拆解 · ${Math.round((Date.now() - t0) / 1000)}s`);
  }, 500);
  setStatus('is-busy', '正在拆解 · 0s');

  try {
    // 设定卡被手动改过：不再重新抽取，直接拿改过的卡当约束重拆
    const reuseBible = state.data?.bible && state.bibleDirty;
    const d1 = reuseBible
      ? { bible: state.data.bible, ms: 0 }
      : await postJson('/api/bible', { script, notes });
    if (reuseBible) toast('已按修改后的设定卡重新拆解');

    step('shots');
    const d2 = await postJson('/api/shots', { script, bible: d1.bible, options: state.options, notes });

    const count = (d2.scenes || []).reduce((n, s) => n + s.shots.length, 0);
    if (!count) throw new Error('没有拆出镜头，请换一段剧本重试');

    state.data = { bible: d1.bible, scenes: d2.scenes, timing: { bible: d1.ms, shots: d2.ms } };
    state.bibleDirty = false;
    state.demo = false;
    state.loading = false;
    $('#demoNote').hidden = true;
    step('done');
    recompute();
    render();
    epSaveCurrent();
    const total = summarize(flatShots(), state.warnings).total;
    setStatus('', `${total.toFixed(1)} 秒`);
    toast(`完成：${count} 镜 / ${total.toFixed(1)} 秒 · 用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
  } catch (err) {
    state.loading = false;
    if (err.code === 'NO_KEY') {
      loadDemo('未配置密钥，已载入内置示例');
      return;
    }
    render();
    const isNetwork = /fetch|network|ECONN|timeout|没有响应/i.test(err.message);
    toast(isNetwork ? err.message : '生成失败：' + err.message);
    setStatus('is-demo', isNetwork ? '连接中断' : '出错');
  } finally {
    clearInterval(tick);
    setBusy(false);
    setTimeout(() => ($('#progress').hidden = true), 600);
  }
}

function loadDemo(msg) {
  state.data = JSON.parse(JSON.stringify(FIXTURE));
  state.demo = true;
  state.options = { style: '电影感写实', aspect: '9:16', subLang: '泰语', targetDuration: 0 };
  $('#demoNote').hidden = false;
  const demoText = SAMPLES.find((s) => s.id === 'reunion')?.text || SAMPLES[0].text;
  if (!$('#script').value.trim()) $('#script').value = demoText;
  $('#scriptCount').textContent = `${$('#script').value.length} 字`;
  recompute();
  render();
  setStatus('is-demo', '演示模式 · 内置示例');
  if (msg) toast(msg);
}

// 按导演意见在原表上重做，其余镜头保持不动
async function revise() {
  const feedback = $('#feedback').value.trim();
  if (!feedback) return toast('先写一句修改意见');
  if (!state.data || state.busy) return;

  setBusy(true);
  state.loading = true;
  state.loadStart = Date.now();
  render();
  setStatus('is-busy', '正在改');
  const btn = $('#btnRevise');
  btn.disabled = true;
  btn.textContent = '重做中…';

  try {
    const d = await postJson('/api/revise', {
      scenes: state.data.scenes,
      feedback,
      bible: state.data.bible,
    });

    state.data.scenes = d.scenes;
    state.loading = false;
    recompute();
    render();
    $('#feedback').value = '';
    const st = summarize(flatShots(), state.warnings);
    setStatus('', `${st.total.toFixed(1)} 秒`);
    toast(`已按意见重做：${st.shots} 镜 / ${st.total.toFixed(1)} 秒`);
  } catch (err) {
    state.loading = false;
    render();
    toast('重做失败：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '按意见重做';
    setBusy(false);
  }
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

// 真正的 .docx：自己拼 OOXML 再打 zip，不依赖库
function exportDocx() {
  if (!state.data) return;
  const langLabel = state.options.subLang ? state.options.subLang.slice(0, 2) : 'EN';
  const ep = String(state.episode || '01').padStart(2, '0');
  const scenes = state.data.scenes.map((sc) => ({
    ...sc,
    shots: sc.shots.map((s) => ({ ...s, id: displayId(s) })),
  }));
  const bytes = buildStoryboardDocx({
    title: '分镜本 · ' + (state.data.bible.title || '未命名'),
    subtitle: `ep${ep}${state.episodeName ? ' ' + state.episodeName : ''} · ${new Date().toLocaleDateString('zh-CN')} · ${flatShots().length} 个镜头 · ${state.options.style || ''}`,
    scenes,
    bible: state.data.bible,
    langLabel,
  });
  download(
    `分镜本_${Date.now()}.docx`,
    bytes,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );
  toast('已导出 Word 分镜本（.docx）');
}

// ---------------------------------------------------------------- 读剧本文件
// 只认 .txt 和 .docx；docx 的解析放在 docx.js（node 下也能直接测）。
const MAX_FILE_MB = 2;

async function loadScriptFile(file) {
  const name = file.name || '';
  const lower = name.toLowerCase();
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    toast(`文件偏大（${(file.size / 1048576).toFixed(1)} MB），先切一段再传`);
    return;
  }
  try {
    let text;
    if (lower.endsWith('.txt')) {
      text = await file.text();
    } else if (lower.endsWith('.docx')) {
      text = await docxToText(await file.arrayBuffer());
    } else if (lower.endsWith('.doc')) {
      throw new Error('老版 .doc 读不了，用 Word / WPS 另存成 .docx');
    } else {
      throw new Error('只支持 .docx 和 .txt');
    }
    text = (text || '').replace(/\r\n/g, '\n').trim();
    if (!text) throw new Error('没读到文字，可能是扫描件或空文档');

    $('#script').value = text;
    $('#scriptCount').textContent = `${text.length} 字`;
    $('#fileName').textContent = name;
    $('#fileMeta').textContent = `${Math.max(1, Math.round(file.size / 1024))} KB · ${text.length} 字`;
    $('#fileChip').hidden = false;
    toast(`已读入 ${name}（${text.length} 字）`);
  } catch (err) {
    toast('读文件失败：' + err.message);
  }
}

// 载入示例：剧本 + 该示例自带的导演意见（有些示例靠这句话把镜头压到预算内）
function applySample(s) {
  if (!s) return;
  $('#script').value = s.text;
  $('#scriptCount').textContent = `${s.text.length} 字`;
  $('#fileChip').hidden = true;
  $('#notes').value = s.notes || '';
  $('#notesBox').open = Boolean(s.notes);
}

// ---------------------------------------------------------------- 二级页面：详情与出图
const KIND_LABEL = { shot: '镜头', char: '人物', outfit: '服装', scene: '场景', prop: '道具' };

function findEntity(kind, id) {
  const b = state.data?.bible || {};
  if (kind === 'shot') return flatShots().find((s) => s.id === id) || null;
  if (kind === 'char') return (b.characters || []).find((c) => c.id === id) || null;
  if (kind === 'scene') return (b.scenes || []).find((s) => s.id === id) || null;
  if (kind === 'prop') return (b.props || []).find((p) => p.id === id) || null;
  if (kind === 'outfit') {
    for (const c of b.characters || []) {
      const o = (c.outfits || []).find((x) => x.id === id);
      if (o) return { ...o, owner: c };
    }
  }
  return null;
}

// 设定卡 / 镜头的画面提示词：镜头用规则引擎拼好的那句，设定卡按卡片字段拼
function promptFor(kind, id) {
  const o = state.options || {};
  const style = o.style || '电影感写实';
  const head = `${style}，泰国漫剧视觉设定`;
  const e = findEntity(kind, id);
  if (!e) return '';

  if (kind === 'shot') return e._prompt || '';
  if (kind === 'char') {
    const outfit = (e.outfits || [])[0];
    return [
      `${head}，角色三视图设定图：同一个人物并排三个角度——正面全身、四分之三侧面全身、正侧面全身，三个角度等高并列，纯浅灰背景，无文字、无边框、无标签。`,
      `人物：${e.name}，${e.age || ''}。外貌：${e.appearance}。`,
      e.face ? `面部：${e.face}。` : '',
      `服装：${outfit ? outfit.desc : '日常便装'}。`,
      `三个角度必须画成同一个人：脸型、五官、发型、疤、服装细节完全一致；不要换装，不要出现第二个角色。`,
      e.forbidden?.length ? `不要出现：${e.forbidden.join('、')}。` : '',
    ].filter(Boolean).join('\n');
  }
  if (kind === 'outfit') {
    return [
      `${head}，服装三视图设定图：同一套衣服并排三个视图——正面平铺、背面平铺、面料与刺绣细节特写，纯浅灰背景，无文字。`,
      `这套衣服：${e.name}。${e.desc}`,
      `三个视图必须是同一套衣服：版型、面料、颜色、纹样、扣子、磨损细节完全一致。`,
      `画面里不要出现人脸、五官、头颅、真人模特、手部特写，也不要出现品牌 logo 和文字。`,
    ].join('\n');
  }
  if (kind === 'scene') {
    return [
      `${head}，场景多角度设定图：同一个空间的三个视角并排——全景主视角、反打视角（从相反方向看）、以及一个关键陈设的特写。`,
      `地点：${e.name}。时间：${e.time || ''}，天气：${e.weather || ''}。`,
      e.place ? `空间与陈设：${e.place}` : '',
      e.light ? `光线：${e.light}` : '',
      e.palette ? `色调：${e.palette}` : '',
      `三个视角必须是同一个空间：墙、地面、家具位置、光源方向都要对得上，不能画成三个不同的地方。画面里不要出现人物。`,
    ].filter(Boolean).join('\n');
  }
  if (kind === 'prop') {
    return [
      `${head}，道具四视图设定图：同一件东西并排四个视图——正面、侧面、俯视、细节特写，纯浅灰背景，无文字。`,
      `${e.name}：${e.look || ''}`,
      e.significance ? `用途：${e.significance}` : '',
      `四个视图必须是同一件东西：尺寸比例、颜色、缺口和磨损位置完全一致。`,
    ].filter(Boolean).join('\n');
  }
  return '';
}

function figHTML(key) {
  const url = state.images[key];
  const inner = url ? `<img src="${esc(url)}" alt="" loading="lazy" />` : `<span>生成参考图</span>`;
  return `<div class="card__fig" data-detail="${esc(key)}">${inner}</div>`;
}

// 这个镜头能当参照图的设定卡：人物 → 场景 → 本镜穿的那套服装 → 道具（最多 3 张，够用又不至于拖慢出图）
function refItemsFor(shot) {
  const b = state.data.bible;
  const items = [];
  const chars = (shot.characters || [])
    .map((cid) => (b.characters || []).find((x) => x.id === cid))
    .filter(Boolean)
    .slice(0, 2);

  // 人物图里已经穿着默认那套衣服，所以人物图优先占位
  for (const c of chars) {
    items.push({ key: `char:${c.id}`, label: c.name, url: state.images[`char:${c.id}`] || '' });
  }

  const sc = (b.scenes || []).find((s) => s.id === shot.scene_id);
  if (sc) items.push({ key: `scene:${sc.id}`, label: sc.name, url: state.images[`scene:${sc.id}`] || '' });

  // 本镜如果穿了非默认的那套，把服装图也带上（服装图无脸，只当衣料样式参照）
  for (const c of chars) {
    const oid = (shot.outfits || {})[c.id];
    const isDefault = !oid || oid === (c.outfits || [])[0]?.id;
    if (isDefault) continue;
    const o = (c.outfits || []).find((x) => x.id === oid);
    if (o && state.images[`outfit:${o.id}`]) {
      items.push({ key: `outfit:${o.id}`, label: o.name, url: state.images[`outfit:${o.id}`] });
      break;
    }
  }

  for (const pid of shot.props || []) {
    const p = (b.props || []).find((x) => x.id === pid);
    if (p) items.push({ key: `prop:${p.id}`, label: p.name, url: state.images[`prop:${p.id}`] || '' });
  }
  return items.slice(0, 3);
}

// 镜头页底部那排参照图：有图的当锚点，没图的点一下跳去生成
function renderRefs() {
  const box = $('#detailRefs');
  if (state.detailKind !== 'shot' || !state.detailKey) {
    box.hidden = true;
    box.innerHTML = '';
    state.detailRefs = [];
    return;
  }
  const shot = findEntity('shot', state.detailKey.split(':')[1]);
  const items = shot ? refItemsFor(shot) : [];
  if (!items.length) {
    box.hidden = true;
    box.innerHTML = '';
    state.detailRefs = [];
    return;
  }
  box.hidden = false;
  box.innerHTML =
    '<span class="detail__refs__label">参照图</span>' +
    items
      .map(
        (it) =>
          `<span class="refchip ${it.url ? '' : 'is-missing'}" data-detail="${esc(it.key)}" title="${
            it.url ? '带着这张图出图，点它去改' : '还没出图，点我先去生成'
          }">${it.url ? `<img src="${esc(it.url)}" alt="" />` : '＋'}${esc(it.label)}</span>`
      )
      .join('');
  state.detailRefs = items.filter((i) => i.url).map((i) => i.url);
}

function renderDetailFig() {
  const key = state.detailKey;
  const url = key ? state.images[key] : '';
  $('#detailFig').innerHTML = url
    ? `<img src="${esc(url)}" alt="" />`
    : `<span class="detail__empty">还没有图，点下面的「生成预览」</span>`;
}

function openDetail(key) {
  if (!state.data) return;
  const [kind, id] = String(key).split(':');
  const e = findEntity(kind, id);
  if (!e) return toast('找不到这一条');
  state.detailKey = key;
  state.detailKind = kind;
  $('#detailKind').textContent = KIND_LABEL[kind] || kind;
  const name = kind === 'outfit' ? `${e.name}（${e.owner.name}）` : e.name || '';
  $('#detailTitle').textContent = `${id}${name ? ' · ' + name : ''}`;
  $('#detailPrompt').value = state.promptEdits[key] || promptFor(kind, id);
  $('#detailRevise').value = '';
  $('#detailTip').textContent =
    kind === 'outfit'
      ? '服装设定图仅呈现服装，人物长相见对应人物卡。多视图出图约 60–90 秒。'
      : '多视图出图约 60–90 秒。';
  renderDetailFig();
  renderRefs();
  $('#detail').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  $('#detail').hidden = true;
  document.body.style.overflow = '';
  state.detailKey = null;
  state.detailKind = null;
  state.detailRefs = [];
}

async function generateDetailImage() {
  const key = state.detailKey;
  if (!key) return;
  const prompt = $('#detailPrompt').value.trim();
  if (!prompt) return toast('先写提示词');
  const btn = $('#detailGen');
  if (btn.disabled) return;

  btn.disabled = true;
  btn.textContent = '生成中…';
  $('#detailTip').textContent = state.detailRefs.length
    ? `正在生成：使用 ${state.detailRefs.length} 张参照图，约 40–60 秒。`
    : '正在生成，多视图约 60–90 秒。';
  try {
    const d = await postJson(
      '/api/image',
      {
        prompt,
        revise: $('#detailRevise').value.trim(),
        aspect: state.options.aspect || '9:16',
        refs: state.detailRefs,
      },
      420000
    );
    state.images[key] = d.url;
    if (d.rewritten && d.prompt) {
      state.promptEdits[key] = d.prompt;
      $('#detailPrompt').value = d.prompt;
      $('#detailRevise').value = '';
    }
    saveStore();
    renderDetailFig();
    render();
    toast(
      `${d.rewritten ? '已按建议更新提示词并生成' : '生成完成'} · 用时 ${Math.round(d.ms / 1000)} 秒${
        Array.isArray(d.refs) && d.refs.length ? ` · 参照图 ${d.refs.length} 张` : ''
      }`
    );
  } catch (err) {
    toast('生成失败：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '生成预览';
    $('#detailTip').textContent =
      state.detailKind === 'outfit'
        ? '服装设定图仅呈现服装，人物长相见对应人物卡。多视图出图约 60–90 秒。'
        : '多视图出图约 60–90 秒。';
  }
}

// ---------------------------------------------------------------- 初始化
function init() {
  loadStore();
  initEpisodes();

  // 分集：切换 / 新建 / 改集号集名
  $('#epSelect').addEventListener('change', (e) => {
    epSaveCurrent();
    epLoad(e.target.value);
  });
  $('#btnEpNew').addEventListener('click', () => {
    epSaveCurrent();
    const nextNo = String(state.episodes.length + 1).padStart(2, '0');
    const ep = { id: 'e' + Date.now(), no: nextNo, name: '', script: '', notes: '', data: null };
    state.episodes.push(ep);
    epLoad(ep.id);
    $('#script').focus();
    toast(`已新建 ep${nextNo}，贴剧本再点拆解`);
  });
  ['epNo', 'epName'].forEach((id) => {
    $('#' + id).addEventListener('input', () => {
      state.episode = ($('#epNo').value || '01').trim() || '01';
      state.episodeName = $('#epName').value.trim();
      epRenderSelect();
      renderBoard();
    });
  });

  // 二级页面：卡片 / 行 → 详情与出图
  $('#detailClose').addEventListener('click', closeDetail);
  $('#detail').addEventListener('click', (e) => {
    if (e.target.dataset.close) closeDetail();
  });
  $('#detailGen').addEventListener('click', generateDetailImage);
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-detail]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    openDetail(el.dataset.detail);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#detail').hidden) closeDetail();
  });
  $('#samples').innerHTML = SAMPLES.map(
    (s) => `<button class="chip" data-sample="${s.id}" title="${esc(s.tag)}">${esc(s.name)}</button>`
  ).join('');

  $$('#samples .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = SAMPLES.find((x) => x.id === btn.dataset.sample);
      applySample(s);
      $('#script').focus();
    });
  });

  // 「自定义…」选中时露出输入框
  [
    ['#optStyle', '#optStyleCustom'],
    ['#optAspect', '#optAspectCustom'],
    ['#optLang', '#optLangCustom'],
    ['#optDur', '#optDurCustom'],
  ].forEach(([selId, customId]) => {
    const sel = $(selId);
    const inp = $(customId);
    sel.addEventListener('change', () => {
      inp.hidden = sel.value !== '__custom';
      if (!inp.hidden) inp.focus();
    });
  });

  // 上传文件（主入口）+ 拖拽
  const uploader = $('#uploader');
  const fileInput = $('#fileInput');
  const pickFile = () => fileInput.click();

  uploader.addEventListener('click', pickFile);
  uploader.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile(); }
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) loadScriptFile(f);
    fileInput.value = '';
  });
  ['dragenter', 'dragover'].forEach((t) =>
    uploader.addEventListener(t, (e) => { e.preventDefault(); uploader.classList.add('is-over'); })
  );
  ['dragleave', 'drop'].forEach((t) =>
    uploader.addEventListener(t, (e) => { e.preventDefault(); uploader.classList.remove('is-over'); })
  );
  uploader.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadScriptFile(f);
  });
  $('#btnClearFile').addEventListener('click', () => {
    $('#fileChip').hidden = true;
    $('#script').value = '';
    $('#scriptCount').textContent = '0 字';
  });

  $('#script').addEventListener('input', (e) => {
    $('#scriptCount').textContent = `${e.target.value.length} 字`;
  });

  $('#btnGenerate').addEventListener('click', generate);
  $('#btnRevise').addEventListener('click', revise);

  $('#btnTrySample').addEventListener('click', () => {
    applySample(SAMPLES[0]);
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
  $('#btnExportDocx').addEventListener('click', exportDocx);
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

  // 探测后端状态：没配 Key 时直接进演示模式，打开就能看到东西
  fetch('/api/health')
    .then((r) => r.json())
    .then((h) => {
      if (h.hasKey) {
        setStatus('', '就绪');
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
