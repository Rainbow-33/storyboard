// 规则引擎：纯函数，不依赖 DOM。
// 只做约束，不做创作 —— 剧情归模型，视听语法归这里。

export const ENUMS = {
  shot_size: ['大远景', '远景', '全景', '中景', '近景', '特写', '大特写'],
  angle: ['平视', '俯拍', '仰拍', '斜角', '主观视角'],
  composition: ['三分法', '中心构图', '对称构图', '前景遮挡', '框中框', '对角线'],
  camera_move: ['固定', '推', '拉', '摇', '移', '跟', '升降', '环绕'],
  dlg_type: ['对白', '旁白', '内心独白', '画外音'],
};

export const SPEECH_RATE = 4.5; // 中文字/秒（漫剧口播偏快）

export const SHOT_SIZE_LIMITS = {
  大远景: [4, 8],
  远景: [4, 8],
  全景: [3.5, 8],
  中景: [2.5, 6],
  近景: [2, 5],
  特写: [1.5, 4],
  大特写: [1.5, 3],
};

const STYLE_MAP = {
  电影感写实: '电影感写实短剧，自然光效，浅景深',
  日式赛璐璐: '日式赛璐璐动画，干净线条，柔和阴影',
  国漫厚涂: '国漫厚涂，体积光，浓重色调',
  竖屏条漫: '竖屏条漫分格，平涂上色，粗描边',
};

const HIGH_EMOTION = ['震惊', '愤怒', '崩溃', '受伤', '决绝', '爆发', '恐惧', '痛苦'];

export const cjkLen = (s) => (s || '').replace(/[^\u4e00-\u9fa5\u0e00-\u0e7f]/g, '').length;
export const round5 = (n) => Math.round(n * 2) / 2;
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

/** 单镜台词总字数 */
export function dialogueChars(shot) {
  return (shot.dialogue || []).reduce((n, d) => n + cjkLen(d.line_zh), 0);
}

/**
 * 时长校准：台词念不完就拉长，其余按景别区间收敛，模型给的值不动
 * 返回 { duration, reason, changed }
 */
export function calibrateDuration(shot) {
  const [min, max] = SHOT_SIZE_LIMITS[shot.shot_size] || [2, 6];
  const chars = dialogueChars(shot);
  const speech = chars ? chars / SPEECH_RATE + 0.35 : 0; // 呼吸留白
  const proposed = Number(shot.duration) || min;

  let duration = Math.max(proposed, speech);
  duration = clamp(round5(duration), min, max);

  const changed = Math.abs(duration - proposed) >= 0.5;
  let reason = '模型判断';
  if (speech > proposed) reason = `台词 ${chars} 字 ÷ ${SPEECH_RATE} 字/秒，需要 ${speech.toFixed(1)}s`;
  else if (duration !== proposed) reason = `${shot.shot_size}区间 ${min}–${max}s`;
  return { duration, reason, changed };
}

/** 运镜建议：只在"有理由"时才建议，不无脑加花活 */
export function suggestMove(shot) {
  const isClose = shot.shot_size === '特写' || shot.shot_size === '大特写';
  const hot = HIGH_EMOTION.some((w) => (shot.emotion || '').includes(w));
  if (isClose && hot && shot.camera_move === '固定') return '推';
  if ((shot.shot_size === '大远景' || shot.shot_size === '远景') && shot.camera_move === '固定') return '移';
  return null;
}

/** 这个镜头里，该角色穿的是哪套 */
export function resolveOutfit(shot, char) {
  const list = char.outfits || [];
  if (!list.length) {
    return char.costume ? { id: null, name: '默认', desc: char.costume } : null;
  }
  const want = shot.outfits?.[char.id];
  return list.find((o) => o.id === want) || list[0];
}

/** 首帧提示词：锚点原样拼进去，这是跨镜一致性的核心手段 */
export function buildImagePrompt(shot, bible, options = {}) {
  const style = STYLE_MAP[options.style] || options.style || STYLE_MAP['电影感写实'];
  const aspect = options.aspect || '9:16';
  const scene = (bible.scenes || []).find((s) => s.id === shot.scene_id);
  const chars = (shot.characters || [])
    .map((id) => (bible.characters || []).find((c) => c.id === id))
    .filter(Boolean);
  const props = (shot.props || [])
    .map((id) => (bible.props || []).find((p) => p.id === id))
    .filter(Boolean);

  const parts = [`${style}，${aspect} 画幅，电影感打光`];

  if (scene) {
    parts.push(`【场景】${scene.name}｜${scene.time}｜${scene.weather}｜${scene.light}｜${scene.palette}`);
  }
  if (chars.length) {
    parts.push(
      '【人物锚点，不可改动】' +
        chars
          .map((c) => {
            const o = resolveOutfit(shot, c);
            return `${c.name}：${c.appearance}${o && o.desc ? `；服装：${o.desc}` : ''}`;
          })
          .join('；')
    );
  }
  if (props.length) {
    parts.push('【道具】' + props.map((p) => `${p.name}：${p.look}`).join('；'));
  }
  parts.push(`【画面】${shot.image_hint || shot.visual}`);
  parts.push(`【景别】${shot.shot_size}｜${shot.angle}｜${shot.composition}`);

  const forbid = chars.flatMap((c) => c.forbidden || []);
  if (forbid.length) parts.push('【禁止出现】' + [...new Set(forbid)].join('、'));

  return parts.join('\n');
}

/**
 * 一致性检查
 * 返回 [{ level:'error'|'warn', code, title, detail, shotId }]
 */
export function checkConsistency(shots, bible, options = {}) {
  const out = [];
  const charById = new Map((bible.characters || []).map((c) => [c.id, c]));
  const knownNames = new Set((bible.characters || []).map((c) => c.name));
  const sceneIds = new Set((bible.scenes || []).map((s) => s.id));
  const push = (level, code, title, detail, shotId) => out.push({ level, code, title, detail, shotId });

  // 1. 禁用词命中 —— 角色外观被写歪
  for (const s of shots) {
    const text = `${s.visual} ${s.image_hint}`;
    for (const id of s.characters || []) {
      const c = charById.get(id);
      if (!c) continue;
      for (const f of c.forbidden || []) {
        if (f && text.includes(f)) {
          push('error', 'FORBIDDEN', `${c.name} 出现禁用特征`, `镜头描述里写了「${f}」，与 ${c.name} 的设定卡冲突`, s.id);
        }
      }
    }
  }

  // 2. 引用了不存在的角色 / 场景
  for (const s of shots) {
    for (const id of s.characters || []) {
      if (!charById.has(id)) push('error', 'UNKNOWN_CHAR', `引用了未登记角色 ${id}`, '该角色不在设定卡中，无法保证外观一致', s.id);
    }
    if (!sceneIds.has(s.scene_id)) push('error', 'UNKNOWN_SCENE', `引用了未登记场景 ${s.scene_id}`, '场景卡缺失，环境锚点无法注入', s.id);
    for (const d of s.dialogue || []) {
      if (d.speaker && !knownNames.has(d.speaker)) {
        push('error', 'UNKNOWN_SPEAKER', `台词角色「${d.speaker}」未登记`, '该角色没有设定卡，音色无法匹配', s.id);
      }
    }
  }

  // 3. 角色出场但画面描述里没提到 —— 漏画风险（代词算提到）
  for (const s of shots) {
    for (const id of s.characters || []) {
      const c = charById.get(id);
      if (!c) continue;
      const pronoun = c.voice?.gender === '女' ? '她' : c.voice?.gender === '男' ? '他' : '';
      const mentioned = s.visual.includes(c.name) || (pronoun && s.visual.includes(pronoun));
      if (!mentioned) {
        push('warn', 'MISSING_IN_VISUAL', `${c.name} 未出现在画面描述中`, '镜头挂了该角色，但 visual 没写到他/她，生成时容易漏人', s.id);
      }
    }
  }

  // 4. 道具声明了却从没出现
  for (const sc of bible.scenes || []) {
    for (const pid of sc.props || []) {
      const p = (bible.props || []).find((x) => x.id === pid);
      if (!p) continue;
      const used = shots.some((s) => (s.props || []).includes(pid));
      if (!used) push('warn', 'PROP_UNUSED', `道具「${p.name}」从未出现`, `场景卡里登记了该道具，但没有任何镜头使用它`, null);
    }
  }

  // 5. 连续三个同景别 —— 剪辑会呆
  let run = 1;
  for (let i = 1; i < shots.length; i++) {
    const a = shots[i - 1], b = shots[i];
    if (a.scene_id === b.scene_id && a.shot_size === b.shot_size) run++;
    else run = 1;
    if (run === 3) {
      push('warn', 'MONOTONE', '连续三镜同景别', `${b.shot_size} 连用三镜，节奏会塌，建议其中一镜换景别或加插入镜头`, b.id);
    }
  }

  // 6. 台词过长
  for (const s of shots) {
    for (const d of s.dialogue || []) {
      const n = cjkLen(d.line_zh);
      if (n > 30) push('warn', 'LONG_LINE', `台词 ${n} 字偏长`, `「${d.line_zh.slice(0, 12)}…」单镜头念不完，建议拆成两镜`, s.id);
    }
  }

  // 7. 总时长偏离目标
  const total = shots.reduce((n, s) => n + Number(s.duration || 0), 0);
  const target = Number(options.targetDuration || 0);
  if (target > 0 && Math.abs(total - target) / target > 0.35) {
    push('warn', 'DURATION_DRIFT', `总时长偏离目标`, `实际 ${total.toFixed(1)} 秒，目标 ${target} 秒，偏差超过 35%`, null);
  }

  // 8. 副语言台词缺失
  if (options.subLang) {
    const missing = shots.filter((s) => (s.dialogue || []).some((d) => d.line_zh && !d.line_th));
    if (missing.length) {
      push('warn', 'MISSING_L2', `${missing.length} 个镜头缺${options.subLang}台词`, `${options.subLang}模式下，TTS 和字幕都需要这一列`, missing[0].id);
    }
  }

  // 9. 统一性：服装没设 / 音色没绑，就没法跨镜统一
  for (const c of bible.characters || []) {
    const hasCostume = (c.outfits || []).some((o) => o.desc) || c.costume;
    if (!hasCostume) push('warn', 'NO_COSTUME', `${c.name} 没设服装`, '服装为空，每个镜头都可能被画成不同的衣服', null);
    if (!c.voice?.timbre) push('warn', 'NO_VOICE', `${c.name} 没绑音色`, '没有音色档案，TTS 无法跨镜保持一致', null);
  }

  return out;
}

/** 统计每个角色 / 道具被哪些镜头用到，用于「统一」面板 */
export function entityUsage(shots, bible) {
  const byChar = new Map();
  const byProp = new Map();
  for (const s of shots) {
    for (const id of s.characters || []) {
      if (!byChar.has(id)) byChar.set(id, []);
      byChar.get(id).push(s.id);
    }
    for (const id of s.props || []) {
      if (!byProp.has(id)) byProp.set(id, []);
      byProp.get(id).push(s.id);
    }
  }
  return {
    characters: (bible.characters || []).map((c) => {
      const ids = byChar.get(c.id) || [];
      return {
        ...c,
        shots: ids,
        outfits: (c.outfits || []).map((o) => ({
          ...o,
          shots: ids.filter((sid) => resolveOutfit(shots.find((s) => s.id === sid), c)?.id === o.id),
        })),
      };
    }),
    props: (bible.props || []).map((p) => ({ ...p, shots: byProp.get(p.id) || [] })),
    total: shots.length,
  };
}

export function summarize(shots, warnings) {
  const total = shots.reduce((n, s) => n + Number(s.duration || 0), 0);
  const scenes = new Set(shots.map((s) => s.scene_id)).size;
  return {
    shots: shots.length,
    scenes,
    total: Math.round(total * 10) / 10,
    errors: warnings.filter((w) => w.level === 'error').length,
    warns: warnings.filter((w) => w.level === 'warn').length,
  };
}
