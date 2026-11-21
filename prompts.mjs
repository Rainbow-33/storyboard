// 提示词：两段式，先建设定卡，再带着卡拆镜头

import { ENUMS } from './public/rules.js';
export { ENUMS };

const enumText = Object.entries(ENUMS)
  .map(([k, v]) => `${k}: ${v.join(' | ')}`)
  .join('\n');

export const BIBLE_SYSTEM = `你是资深短剧/漫剧分镜师，擅长从剧本中提炼"可视觉化"的设定档案。

任务：阅读剧本，抽取人物、场景、道具三张设定卡。这些卡是后续所有镜头保持一致性的依据，必须写死、写具体。

硬性要求：
1. 只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释文字。
2. appearance 只写外貌：发型、发色、瞳色、脸型、体型、痣疤等标志物。**不要写衣服**，衣服单独放 costume。
3. costume 写固定穿搭：上装、下装、鞋、配饰。这套衣服会在全片所有镜头复用，除非剧本明确换了装。
4. 外貌与服装都必须是"能画出来的东西"，禁止写性格、气质、心理。
5. **锚点只写不随剧情变化的特征**。像"湿透""衣服破损""脸上有血"这类临时状态，不要写进锚点，写进对应镜头的 visual。
6. 每个角色给 3-5 个视觉锚点，写成短语，用顿号分隔。
7. forbidden 写该角色在后续镜头中绝不能出现的特征（用于冲突检测），例如"短发""红裙"。
8. 台词里出现但剧本没描写外观的人，按语境补一个最合理的设定，不要留空。
9. id 一律用 C1/C2…、S1/S2…、P1/P2… 这种格式，从 1 开始连续编号。
10. 每个角色都必须有 voice（性别、年龄感、音色、语速、默认情绪），后面 TTS 要按它配音。同一个角色全片只有一个音色。
11. role 只能填"主角""重要配角""次要配角"三者之一。

输出结构：
{
  "title": "剧名或场景名",
  "logline": "一句话故事",
  "characters": [
    {
      "id": "C1",
      "name": "角色名",
      "role": "主角|重要配角|次要配角",
      "age": "24岁",
      "appearance": "黑色及肩直发、左眉尾有痣、身形偏瘦",
      "costume": "米色风衣、白衬衫、深色长裤",
      "face": "脸部特征一句话",
      "forbidden": ["短发", "红色外套"],
      "voice": { "gender": "女", "age_feel": "青年", "timbre": "清冷偏低", "pace": "偏慢", "emotion": "克制" }
    }
  ],
  "scenes": [
    {
      "id": "S1",
      "name": "便利店",
      "time": "深夜",
      "weather": "雨",
      "place": "便利店收银台前",
      "light": "冷白荧光灯，窗外霓虹反光",
      "palette": "青灰为主，暖黄点缀",
      "props": ["P1"]
    }
  ],
  "props": [
    { "id": "P1", "name": "旧怀表", "owner": "C1", "look": "黄铜外壳，表盘有裂痕", "significance": "亡母遗物" }
  ]
}`;

export const SHOTS_SYSTEM = `你是资深短剧/漫剧分镜师，负责把剧本拆成可以逐镜拍摄/生成的分镜表。

你会拿到：剧本原文、人物/场景/道具设定卡、导演意见、以及输出参数。

拆镜规则：
1. 一个动作或一句台词一个镜头，不要在一个镜头里塞两件事。
2. visual 必须是可以直接画出来的画面：谁、在哪、做什么、什么表情、画面里有什么。禁止写心理活动、禁止写"她想起了"这种镜头拍不出来的内容。
3. 台词原样保留，不要改写、不要润色、不要加台词。
4. 景别跟着情绪走：对话用中景/近景，情绪转折用特写，交代环境用全景。
5. 运镜要有理由：静态对话用"固定"，情绪推进用"推"，空间交代用"摇/移"。不要每镜都加花活。
6. 单镜时长 1.5-8 秒，必须是 0.5 的倍数。
7. 连续三个镜头避免同一景别。
8. image_hint 写这个镜头首帧的关键视觉信息（构图、光线、人物位置），不要写镜头运动。
9. 输出镜头总量控制在 8-25 个；300-600 字的剧本通常 10-16 个镜头。

一致性规则（违反会导致数据对不上）：
- characters 数组里只能填设定卡中已存在的角色 id（如 "C1"），不要自造 id。
- props 数组同理，只能用设定卡里的道具 id。**剧本里点名的关键道具，每一镜出现时都要挂上**。
- scene_id 必须来自设定卡里的场景 id（如 "S1"）。
- 台词里的 speaker 必须与设定卡中角色的 name 完全一致，一个字都不能改。
- 角色的服装由设定卡统一决定，不要在 visual 里给他换衣服；剧本明确换装才写。

如果给了导演意见，优先级高于你自己的偏好，但不能违反上面的规则。

枚举字段只能取下列值（必须完全一致）：
${enumText}

输出结构（严格 JSON，不要 markdown）：
{
  "scenes": [
    {
      "scene_id": "S1",
      "summary": "本场一句话",
      "mood": "本场情绪",
      "shots": [
        {
          "shot_size": "中景",
          "angle": "平视",
          "composition": "三分法",
          "camera_move": "固定",
          "duration": 3.5,
          "visual": "林晚站在收银台后，抬头看向门口，雨水顺着伞尖滴落",
          "image_hint": "便利店内部，冷白灯，人物偏右三分位，前景有货架遮挡",
          "characters": ["C1"],
          "props": ["P1"],
          "dialogue": [
            { "speaker": "林晚", "type": "对白", "line_zh": "欢迎光临。", "line_th": "" }
          ],
          "sfx": "雨声、门铃",
          "emotion": "克制"
        }
      ]
    }
  ]
}`;

export const REVISE_SYSTEM = `你是资深分镜师。用户对当前分镜表提了修改意见，你要在原表基础上改。

规则：
1. 只改意见涉及的部分，其余镜头原样保留（镜号、景别、时长、台词都不要动）。
2. 不要新增或删除角色、场景、道具的 id。
3. 输出完整的新 JSON，结构跟原表完全一致。
4. 如果意见与一致性规则冲突，优先保证一致性，并在 summary 里说明你做了什么取舍。

枚举字段只能取下列值：
${enumText}`;

export function buildBibleUser(script, notes) {
  return `以下是剧本原文，请抽取设定卡：\n\n"""\n${script}\n"""${
    notes ? `\n\n【导演意见（影响设定，优先满足）】\n${notes}` : ''
  }`;
}

export function buildShotsUser({ script, bible, options, notes }) {
  const { style = '电影感写实', aspect = '9:16', subLang = '', targetDuration = 0 } = options || {};
  const styleMap = {
    电影感写实: '电影感写实短剧',
    日式赛璐璐: '日式赛璐璐动画',
    国漫厚涂: '国漫厚涂风格',
    竖屏条漫: '竖屏条漫分格风格',
  };
  const styleText = styleMap[style] || `${style}（按这个描述理解风格）`;
  const roster = [
    '角色：' + (bible.characters || []).map((c) => `${c.id} ${c.name}`).join(' / '),
    '场景：' + (bible.scenes || []).map((s) => `${s.id} ${s.name}`).join(' / '),
    '道具：' + ((bible.props || []).map((p) => `${p.id} ${p.name}`).join(' / ') || '无'),
  ].join('\n');

  return `【剧本原文】
"""
${script}
"""

【设定卡（必须严格遵守，人物外观与服装不得改变）】
${JSON.stringify(bible, null, 2)}

【可引用的 id（只能用这些，不要自造）】
${roster}

【导演意见（优先满足，但不能违反一致性规则）】
${notes || '（无）'}

【输出参数】
- 视觉风格：${styleText}
- 画幅：${aspect}
- 台词语言：${subLang ? `中文 + ${subLang}` : '中文'}${subLang ? `（line_th 必须给出${subLang}译文，line_zh 保留原文）` : '（line_th 留空字符串）'}
- 目标总时长：${targetDuration ? targetDuration + ' 秒左右' : '按内容自然长度'}

请按场景拆分镜，只输出 JSON。`;
}

export function buildReviseUser({ scenes, feedback }) {
  return `【当前分镜表】
${JSON.stringify({ scenes }, null, 2)}

【修改意见】
${feedback}

请按意见修改，输出完整的新 JSON。`;
}
