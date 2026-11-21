import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BIBLE_SYSTEM, SHOTS_SYSTEM, REVISE_SYSTEM, buildBibleUser, buildShotsUser, buildReviseUser, ENUMS } from './prompts.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC = join(__dirname, 'public');
const PORT = Number(process.env.PORT || 7788);

// ---------- .env ----------
function loadEnv() {
  const p = join(__dirname, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const val = m[2].replace(/^["']|["']$/g, '').trim();
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}
loadEnv();

const API_KEY = process.env.DEEPSEEK_API_KEY || process.env.ZHIPU_API_KEY || process.env.LLM_API_KEY || '';
const BASE_URL =
  process.env.LLM_BASE_URL ||
  (process.env.DEEPSEEK_API_KEY
    ? 'https://api.deepseek.com/chat/completions'
    : 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
const MODEL = process.env.LLM_MODEL || (process.env.DEEPSEEK_API_KEY ? 'deepseek-chat' : 'glm-4-flash');

// ---------- 模型调用 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 网络抖动重试 2 次；401/400 这类确定性错误不重试
async function callModel(messages, opts = {}) {
  if (!API_KEY) throw Object.assign(new Error('未配置 API Key'), { code: 'NO_KEY' });
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      return await callModelOnce(messages, opts);
    } catch (err) {
      lastErr = err;
      const retriable = /fetch failed|ECONNRESET|ETIMEDOUT|aborted|socket/i.test(err.message);
      if (!retriable || i === 2) throw err;
      await sleep(700 * (i + 1));
    }
  }
  throw lastErr;
}

async function callModelOnce(messages, { temperature = 0.6, maxTokens = 8000 } = {}) {
  if (!API_KEY) throw Object.assign(new Error('未配置 API Key'), { code: 'NO_KEY' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(BASE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`模型返回 ${res.status}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text);
    return data.choices?.[0]?.message?.content ?? '';
  } finally {
    clearTimeout(timer);
  }
}

// ---------- JSON 抽取与修复 ----------
function extractJson(raw) {
  let s = String(raw).trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

async function callJson(messages, opts) {
  let raw = await callModel(messages, opts);
  try {
    return extractJson(raw);
  } catch {
    // 一次修复重试
    const fixed = await callModel(
      [
        ...messages,
        { role: 'assistant', content: raw.slice(0, 6000) },
        { role: 'user', content: '上面的输出不是合法 JSON。请只输出修正后的合法 JSON，不要任何解释、不要 markdown 代码块。' },
      ],
      { ...opts, temperature: 0.1 }
    );
    return extractJson(fixed);
  }
}

// ---------- 校验 ----------
const pick = (arr, v, fallback) => (arr.includes(v) ? v : fallback);

// 模型偶尔会给出重复 id，重复会让镜号串台，这里强制唯一
function uniqueId(base, taken) {
  let id = base;
  let i = 2;
  while (taken.has(id)) id = `${base}_${i++}`;
  taken.add(id);
  return id;
}

function normalizeBible(b) {
  const usedC = new Set();
  const usedS = new Set();
  const usedP = new Set();
  const characters = (b.characters || []).map((c, i) => {
    const id = uniqueId(c.id || `C${i + 1}`, usedC);
    const raw = Array.isArray(c.outfits) && c.outfits.length ? c.outfits : null;
    const outfits = raw
      ? raw.map((o, j) => ({
          id: o.id || `${id}-O${j + 1}`,
          name: o.name || `造型${j + 1}`,
          desc: o.desc || o.costume || '',
        }))
      : [{ id: `${id}-O1`, name: '默认', desc: c.costume || '' }];
    return {
      id,
      name: c.name || `角色${i + 1}`,
      role: c.role || '配角',
      age: c.age || '',
      appearance: c.appearance || '',
      costume: outfits[0].desc,
      outfits,
      face: c.face || '',
      forbidden: Array.isArray(c.forbidden) ? c.forbidden.filter(Boolean) : [],
      voice: c.voice || {},
    };
  });
  const scenes = (b.scenes || []).map((s, i) => ({
    id: uniqueId(s.id || `S${i + 1}`, usedS),
    name: s.name || `场景${i + 1}`,
    time: s.time || '',
    weather: s.weather || '',
    place: s.place || '',
    light: s.light || '',
    palette: s.palette || '',
    props: Array.isArray(s.props) ? s.props : [],
  }));
  const props = (b.props || []).map((p, i) => ({
    id: uniqueId(p.id || `P${i + 1}`, usedP),
    name: p.name || `道具${i + 1}`,
    owner: p.owner || '',
    look: p.look || '',
    significance: p.significance || '',
  }));
  return { title: b.title || '', logline: b.logline || '', characters, scenes, props };
}

function normalizeShots(raw, bible) {
  const scenes = Array.isArray(raw.scenes) ? raw.scenes : [];
  const usedScene = new Set();
  const outfitOf = (cid, want) => {
    const c = (bible.characters || []).find((x) => x.id === cid);
    if (!c) return null;
    const list = c.outfits || [];
    return (list.find((o) => o.id === want) || list[0])?.id || null;
  };
  return scenes.map((sc, si) => {
    const sceneId = uniqueId(sc.scene_id || bible.scenes[si]?.id || `S${si + 1}`, usedScene);
    const shots = (sc.shots || []).map((s, i) => ({
      id: `${sceneId}-${String(i + 1).padStart(2, '0')}`,
      scene_id: sceneId,
      shot_size: pick(ENUMS.shot_size, s.shot_size, '中景'),
      angle: pick(ENUMS.angle, s.angle, '平视'),
      composition: pick(ENUMS.composition, s.composition, '三分法'),
      camera_move: pick(ENUMS.camera_move, s.camera_move, '固定'),
      duration: Math.min(8, Math.max(1.5, Number(s.duration) || 3)),
      visual: s.visual || '',
      image_hint: s.image_hint || '',
      characters: Array.isArray(s.characters) ? s.characters : [],
      props: Array.isArray(s.props) ? s.props : [],
      outfits: (() => {
        const m = {};
        const chars = Array.isArray(s.characters) ? s.characters : [];
        const given = s.outfits && typeof s.outfits === 'object' ? s.outfits : {};
        for (const cid of chars) {
          const id = outfitOf(cid, given[cid]);
          if (id) m[cid] = id;
        }
        return m;
      })(),
      dialogue: (Array.isArray(s.dialogue) ? s.dialogue : [])
        .filter((d) => d && (d.line_zh || d.line_th))
        .map((d) => ({
          speaker: d.speaker || '',
          type: pick(ENUMS.dlg_type, d.type, '对白'),
          line_zh: d.line_zh || '',
          line_th: d.line_th || '',
        })),
      sfx: s.sfx || '',
      emotion: s.emotion || '',
      locked: false,
    }));
    return { scene_id: sceneId, summary: sc.summary || '', mood: sc.mood || '', shots };
  });
}

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 2_000_000) throw new Error('请求体过大');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  try {
    if (url.pathname === '/api/health') {
      return send(res, 200, { ok: true, hasKey: Boolean(API_KEY), model: API_KEY ? MODEL : null });
    }

    // 第一步：抽取设定卡（人物 / 场景 / 道具）
    if (url.pathname === '/api/bible' && req.method === 'POST') {
      const { script, notes } = await readBody(req);
      if (!script || script.trim().length < 20) return send(res, 400, { error: '剧本太短，至少 20 个字' });
      if (script.length > 12000) return send(res, 400, { error: '剧本过长，建议 6000 字以内分段处理' });

      const t0 = Date.now();
      const raw = await callJson(
        [
          { role: 'system', content: BIBLE_SYSTEM },
          { role: 'user', content: buildBibleUser(script, notes) },
        ],
        { temperature: 0.3, maxTokens: 4000 }
      );
      return send(res, 200, { bible: normalizeBible(raw), ms: Date.now() - t0 });
    }

    // 第二步：带着设定卡拆镜头
    if (url.pathname === '/api/shots' && req.method === 'POST') {
      const { script, bible, options, notes } = await readBody(req);
      if (!script) return send(res, 400, { error: '缺少剧本' });
      if (!bible || !bible.characters) return send(res, 400, { error: '缺少设定卡，请先完成第一步' });

      const t0 = Date.now();
      const raw = await callJson(
        [
          { role: 'system', content: SHOTS_SYSTEM },
          { role: 'user', content: buildShotsUser({ script, bible, options, notes }) },
        ],
        { temperature: 0.7, maxTokens: 8000 }
      );
      return send(res, 200, { scenes: normalizeShots(raw, bible), ms: Date.now() - t0 });
    }

    // 第三步（可选）：按导演意见重做
    if (url.pathname === '/api/revise' && req.method === 'POST') {
      const { scenes, feedback, bible } = await readBody(req);
      if (!feedback || !feedback.trim()) return send(res, 400, { error: '请先写修改意见' });
      if (!Array.isArray(scenes) || !scenes.length) return send(res, 400, { error: '没有可修改的分镜表' });
      if (!bible || !bible.characters) return send(res, 400, { error: '缺少设定卡' });

      const t0 = Date.now();
      const raw = await callJson(
        [
          { role: 'system', content: REVISE_SYSTEM },
          { role: 'user', content: buildReviseUser({ scenes, feedback }) },
        ],
        { temperature: 0.5, maxTokens: 8000 }
      );
      return send(res, 200, { scenes: normalizeShots(raw, bible), ms: Date.now() - t0 });
    }

    // 静态文件
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/index.html';
    const filePath = normalize(join(PUBLIC, path));
    if (!filePath.startsWith(PUBLIC)) return send(res, 403, { error: 'forbidden' });

    const st = await stat(filePath).catch(() => null);
    if (!st || !st.isFile()) return send(res, 404, { error: 'not found' });
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(content);
  } catch (err) {
    console.error('[error]', err.message);
    const code = err.code === 'NO_KEY' ? 503 : 500;
    send(res, code, {
      error: err.message || '服务器错误',
      code: err.code || 'INTERNAL',
    });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  分镜台 running →  http://127.0.0.1:${PORT}`);
  console.log(`  模型：${API_KEY ? MODEL : '未配置（前端将进入演示模式）'}\n`);
});
