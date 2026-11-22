import { createServer } from 'node:http';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

// LLM_API_KEY 一旦填了，就走中转站那套（GPT）；没填就退回 DeepSeek，界面照常能演示
const GPT_MODE = Boolean(process.env.LLM_API_KEY);
const API_KEY = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.ZHIPU_API_KEY || '';
const RAW_BASE = GPT_MODE
  ? process.env.LLM_BASE_URL || 'https://api.openai-next.com/v1'
  : process.env.DEEPSEEK_API_KEY
    ? 'https://api.deepseek.com'
    : 'https://open.bigmodel.cn/api/paas/v4';
// .env 里写成 .../v1 或 .../v1/chat/completions 都认
const BASE_ROOT = RAW_BASE.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
const CHAT_URL = `${BASE_ROOT}/chat/completions`;
const MODELS_URL = `${BASE_ROOT}/models`;
const MODEL =
  (GPT_MODE && process.env.LLM_MODEL) ||
  (GPT_MODE ? 'gpt-5.6-sol' : process.env.DEEPSEEK_API_KEY ? 'deepseek-chat' : 'glm-4-flash');
// 图片模型（设定卡参考图 / 镜头预览图）
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'gpt-image-2';
// 中转站前面挡着 Cloudflare，单次请求超过 100 秒会被掐（524）。medium 比默认快一半左右。
const IMAGE_QUALITY = process.env.IMAGE_QUALITY || 'medium';
const THUMBS = join(PUBLIC, 'thumbs');
const IMAGE_SIZES = { '9:16': '1024x1536', '16:9': '1536x1024', '1:1': '1024x1024' };

// ---------- 模型调用 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 网络抖动重试 2 次；401/400 这类确定性错误不重试
async function callModel(messages, opts = {}) {
  if (!API_KEY) throw Object.assign(new Error('未配置密钥'), { code: 'NO_KEY' });
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

async function callModelOnce(messages, { temperature = 0.6, maxTokens = 8000, json = true } = {}) {
  if (!API_KEY) throw Object.assign(new Error('未配置密钥'), { code: 'NO_KEY' });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const body = { model: MODEL, messages, temperature, max_tokens: maxTokens };
    if (json) body.response_format = { type: 'json_object' };
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`请求失败（${res.status}）：${text.slice(0, 300)}`);
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
      name_en: c.name_en || '',
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
    name_en: s.name_en || '',
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
    name_en: p.name_en || '',
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
      continuity: s.continuity || '',
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
      return send(res, 200, {
        ok: true,
        hasKey: Boolean(API_KEY),
        model: API_KEY ? MODEL : null,
        base: BASE_ROOT,
        imageModel: IMAGE_MODEL || null,
      });
    }

    // 自检：列出这个 key 到底能用哪些模型（换中转站后先跑这个，别猜模型名）
    if (url.pathname === '/api/models') {
      if (!API_KEY) return send(res, 200, { ok: false, error: '未配置密钥' });
      try {
        const r = await fetch(MODELS_URL, { headers: { Authorization: `Bearer ${API_KEY}` } });
        const t = await r.text();
        if (!r.ok) return send(res, 200, { ok: false, status: r.status, error: t.slice(0, 400) });
        let data;
        try {
          data = JSON.parse(t);
        } catch {
          return send(res, 200, { ok: false, error: '返回的不是 JSON：' + t.slice(0, 200) });
        }
        const ids = (data.data || data.models || [])
          .map((m) => (typeof m === 'string' ? m : m.id || m.name))
          .filter(Boolean)
          .sort();
        return send(res, 200, {
          ok: true,
          base: BASE_ROOT,
          current: MODEL,
          imageModel: IMAGE_MODEL || null,
          count: ids.length,
          ids,
        });
      } catch (err) {
        return send(res, 200, { ok: false, error: String(err.message || err) });
      }
    }

    // 出图：设定卡参考图 / 镜头预览图（走同一个图片模型，结果落盘缓存）
    if (url.pathname === '/api/image' && req.method === 'POST') {
      const { prompt, revise, aspect, refs } = await readBody(req);
      if (!prompt || !String(prompt).trim()) return send(res, 400, { error: '缺少画面提示词' });

      const t0 = Date.now();
      let finalPrompt = String(prompt).trim();
      let rewritten = false;

      // 「建议修改」：先让文本模型把提示词改写一遍，而不是硬拼在末尾
      const advice = (revise || '').trim();
      if (advice) {
        const sys =
          '你是分镜画面提示词编辑。用户会对现有画面提示词提出修改要求，你输出改写后的提示词。' +
          '规则：只输出改写后的提示词本身，不要解释、不要引号、不要 markdown；' +
          '保留原提示词里没有被要求改的部分；新要求与原文冲突时以新要求为准，并删掉冲突的描述；长度不超过原文 1.3 倍。';
        try {
          const out = await callModel(
            [
              { role: 'system', content: sys },
              { role: 'user', content: `原提示词：\n${finalPrompt}\n\n修改要求：\n${advice}\n\n只输出改写后的提示词。` },
            ],
            { temperature: 0.4, maxTokens: 800, json: false }
          );
          const cleaned = String(out || '').trim().replace(/^[,:"'「]|[,:"'」]$/g, '').trim();
          if (cleaned) {
            finalPrompt = cleaned;
            rewritten = true;
          }
        } catch {
          /* 改写失败就直接按原提示词出图，不卡住流程 */
        }
      }

      const size = IMAGE_SIZES[aspect] || IMAGE_SIZES['9:16'];

      // 参照图：只认自己生成过的缩略图，最多 4 张（人物/服装/场景/道具）
      const refFiles = (Array.isArray(refs) ? refs : [])
        .map((r) => String(r || '').replace(/^\/thumbs\//, '').replace(/^thumbs\//, ''))
        .filter((n) => /^img-[a-f0-9]{6,}\.png$/.test(n))
        .filter((n) => existsSync(join(THUMBS, n)))
        .slice(0, 3);

      const hash = createHash('sha1')
        .update(`${IMAGE_MODEL}|${size}|${refFiles.join(',')}|${finalPrompt}`)
        .digest('hex')
        .slice(0, 12);
      const name = `img-${hash}.png`;
      const file = join(THUMBS, name);
      const cached = existsSync(file);

      if (!cached) {
        if (!API_KEY) throw Object.assign(new Error('未配置密钥'), { code: 'NO_KEY' });
        const genPrompt = refFiles.length
          ? `${finalPrompt}\n\n（参考图约束：严格沿用参考图里的人物长相、发型、服装、场景陈设与道具外观，不要改成别的样子；只按上面的画面要求重新构图和打光。）`
          : finalPrompt;

        // 中转站前面挡着 Cloudflare，单次请求超过 100 秒会回 524（一个 HTML 错误页）。
        // 遇到 5xx / 429 就重试，通常第二次能过。
        let text = '';
        let data = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          let r;
          if (refFiles.length) {
            const fd = new FormData();
            fd.append('model', IMAGE_MODEL);
            fd.append('prompt', genPrompt);
            fd.append('size', size);
            fd.append('n', '1');
            fd.append('quality', IMAGE_QUALITY);
            for (let i = 0; i < refFiles.length; i++) {
              const b = await readFile(join(THUMBS, refFiles[i]));
              fd.append('image', new Blob([b], { type: 'image/png' }), `ref${i + 1}.png`);
            }
            r = await fetch(`${BASE_ROOT}/images/edits`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${API_KEY}` },
              body: fd,
              signal: AbortSignal.timeout(150000),
            });
          } else {
            r = await fetch(`${BASE_ROOT}/images/generations`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
              body: JSON.stringify({ model: IMAGE_MODEL, prompt: genPrompt, size, n: 1, quality: IMAGE_QUALITY }),
              signal: AbortSignal.timeout(150000),
            });
          }

          text = await r.text();
          if (r.ok) {
            try {
              data = JSON.parse(text);
            } catch {
              throw new Error('出图接口返回异常：' + text.slice(0, 200));
            }
            break;
          }
          const retriable = [429, 502, 503, 504, 524].includes(r.status);
          if (!retriable || attempt === 2) throw new Error(`出图失败（${r.status}）：${text.slice(0, 200)}`);
          console.warn(`[image] ${r.status}，第 ${attempt + 1} 次重试`);
          await sleep(1200 * (attempt + 1));
        }
        if (!data) throw new Error('出图失败：多次重试后仍未返回结果');
        const item = data.data?.[0] || {};
        let buf;
        if (item.b64_json) buf = Buffer.from(item.b64_json, 'base64');
        else if (item.url) {
          const ir = await fetch(item.url, { signal: AbortSignal.timeout(120000) });
          if (!ir.ok) throw new Error(`图片下载失败 ${ir.status}`);
          buf = Buffer.from(await ir.arrayBuffer());
        } else {
          throw new Error('出图接口未返回图片：' + JSON.stringify(data).slice(0, 200));
        }
        await mkdir(THUMBS, { recursive: true });
        await writeFile(file, buf);
      }

      return send(res, 200, {
        ok: true,
        url: `/thumbs/${name}`,
        prompt: finalPrompt,
        rewritten,
        cached,
        model: IMAGE_MODEL,
        size,
        refs: refFiles,
        ms: Date.now() - t0,
      });
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
  console.log(`  模型：${API_KEY ? MODEL : '未配置（前端将进入演示模式）'}`);
  console.log(`  地址：${BASE_ROOT}`);
  console.log(`  自检：http://127.0.0.1:${PORT}/api/models  ← 换中转站后先看这里\n`);
});
