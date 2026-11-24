// Word 分镜本导出：台词列名 / 外语前缀 / 附录资产表
import assert from 'node:assert';
import { buildStoryboardDocx } from '../public/export-docx.js';

const bible = {
  characters: [
    {
      id: 'C1',
      name: '莉薇娅',
      name_en: 'Livia',
      role: '女主',
      age: '26 岁',
      appearance: '黑色及肩直发、齐刘海',
      face: '眉眼清淡',
      outfits: [{ id: 'C1-01', name: '夜服', desc: '米色针织开衫' }],
    },
  ],
  props: [{ id: 'P1', name: '缺角的碗', look: '青瓷，碗沿缺口', significance: '定情信物' }],
  scenes: [{ id: 'S1', name: '皇帝私人浴室', name_en: 'Bath', time: '深夜', place: '大理石浴池' }],
};

const scenes = [
  {
    scene_id: 'S1',
    shots: [
      {
        id: 'ep01s01',
        visual: '她站在池边，水汽升起',
        dialogue: [{ speaker: '莉薇娅', line_zh: '你答应过我什么', line_th: 'เธอสัญญาอะไรกับฉัน' }],
        characters: ['C1'],
        props: ['P1'],
        camera_move: '缓慢推近',
        shot_size: '中景',
        composition: '三分法',
        sfx: '滴水声',
        duration: 3.5,
      },
    ],
  },
];

// zip 是 store 模式，直接按字节找字符串就行，不用解压
function has(bytes, s) {
  const n = new TextEncoder().encode(s);
  outer: for (let i = 0; i <= bytes.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (bytes[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

const build = (lineHeader, lineTag) =>
  buildStoryboardDocx({ title: '测试', subtitle: '副标题', scenes, bible, lineHeader, lineTag });

// 中泰：列名必须跟着走，不能永远写「中英」
let b = build('中泰台词', 'TH');
assert.ok(has(b, '中泰台词'), '中泰：表头应为「中泰台词」');
assert.ok(has(b, '[TH] เธอสัญญาอะไรกับฉัน'), '中泰：外语行要带 TH 前缀');
assert.ok(!has(b, '中英'), '中泰：不应出现「中英」');

b = build('中英台词', 'EN');
assert.ok(has(b, '中英台词') && has(b, '[EN]'), '中英：表头与前缀');
assert.ok(!has(b, '[TH]'), '中英：不应出现 TH 前缀');

b = build('台词', '');
assert.ok(has(b, '台词') && !has(b, '[TH]') && !has(b, '[EN]'), '仅中文：无外语前缀');

b = build('中英泰台词', 'TH / EN');
assert.ok(has(b, '中英泰台词') && has(b, '[TH / EN]'), '三语：表头与合并前缀');

// 实体名带英文名
b = build('台词', '');
assert.ok(has(b, '莉薇娅（Livia）'), '实体应带英文名');

// 附录：资产设定
assert.ok(has(b, '附：资产设定'), '应有资产设定附录');
assert.ok(has(b, '青瓷，碗沿缺口'), '附录应包含道具外观');
assert.ok(has(b, '角色 1 · 场景 1 · 道具 1'), '附录应统计资产数量');

console.log('docx 测试通过：台词列名 / 外语前缀 / 英文名 / 资产附录');
