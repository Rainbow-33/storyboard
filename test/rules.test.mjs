import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calibrateDuration, buildImagePrompt, checkConsistency, suggestMove, summarize, entityUsage } from '../public/rules.js';

const bible = {
  characters: [
    { id: 'C1', name: '林晚', voice: { gender: '女' }, appearance: '黑色及肩直发、米色风衣', forbidden: ['短发'] },
  ],
  scenes: [{ id: 'S1', name: '便利店', time: '深夜', weather: '雨', light: '冷白灯', palette: '青灰', props: ['P1'] }],
  props: [{ id: 'P1', name: '旧怀表', look: '黄铜，有裂痕' }],
};

const shot = (o = {}) => ({
  id: 'S1-01', scene_id: 'S1', shot_size: '中景', angle: '平视', composition: '三分法',
  camera_move: '固定', duration: 3, visual: '林晚站在收银台后', image_hint: '中景，居中', characters: ['C1'],
  props: [], dialogue: [], sfx: '', emotion: '克制', ...o,
});

test('台词说不完时，时长被拉到说得完为止', () => {
  const s = shot({
    shot_size: '中景',
    duration: 2,
    dialogue: [{ speaker: '林晚', type: '对白', line_zh: '你以为五年过去了我就不会再想起那天晚上下的那场雨吗' }],
  });
  const { duration, changed, reason } = calibrateDuration(s);
  assert.ok(duration > 2, '应当被拉长');
  assert.ok(changed);
  assert.match(reason, /字\/秒/);
  assert.ok(duration <= 6, '中景上限 6s');
});

test('超短时长被抬到景别下限', () => {
  const { duration } = calibrateDuration(shot({ shot_size: '全景', duration: 0.5 }));
  assert.equal(duration, 3.5);
});

test('模型给的合理时长不会被乱改', () => {
  const { duration, changed } = calibrateDuration(shot({ shot_size: '中景', duration: 3 }));
  assert.equal(duration, 3);
  assert.equal(changed, false);
});

test('禁用词命中报错', () => {
  const warns = checkConsistency([shot({ visual: '林晚留着短发站在柜台后' })], bible);
  assert.equal(warns.filter((w) => w.code === 'FORBIDDEN').length, 1);
  assert.equal(warns[0].level, 'error');
});

test('连续三镜同景别报警', () => {
  const shots = [
    shot({ id: 'A', shot_size: '中景' }),
    shot({ id: 'B', shot_size: '中景' }),
    shot({ id: 'C', shot_size: '中景' }),
  ];
  const warns = checkConsistency(shots, bible);
  assert.ok(warns.some((w) => w.code === 'MONOTONE'));
});

test('未登记角色 / 台词角色未登记 都报错', () => {
  const warns = checkConsistency(
    [shot({ characters: ['C9'], dialogue: [{ speaker: '路人甲', type: '对白', line_zh: '喂' }] })],
    bible
  );
  assert.ok(warns.some((w) => w.code === 'UNKNOWN_CHAR'));
  assert.ok(warns.some((w) => w.code === 'UNKNOWN_SPEAKER'));
});

test('代词算作角色已提及，不误报漏画', () => {
  const warns = checkConsistency([shot({ visual: '她低头看着表盘' })], bible);
  assert.equal(warns.filter((w) => w.code === 'MISSING_IN_VISUAL').length, 0);
});

test('首帧提示词必须包含人物锚点与禁止项', () => {
  const p = buildImagePrompt(shot({}), bible, { style: '写实', aspect: '9:16' });
  assert.ok(p.includes('黑色及肩直发'));
  assert.ok(p.includes('禁止出现'));
  assert.ok(p.includes('9:16'));
});

test('情绪高点 + 特写 + 固定机位 → 建议推镜', () => {
  assert.equal(suggestMove(shot({ shot_size: '特写', emotion: '崩溃', camera_move: '固定' })), '推');
  assert.equal(suggestMove(shot({ shot_size: '中景', emotion: '崩溃', camera_move: '固定' })), null);
});

test('汇总数字正确', () => {
  const shots = [shot({ id: 'A', duration: 3 }), shot({ id: 'B', duration: 4.5 })];
  const st = summarize(shots, checkConsistency(shots, bible));
  assert.equal(st.shots, 2);
  assert.equal(st.total, 7.5);
});

test('服装单独成字段，并注入首帧提示词', () => {
  const b = { ...bible, characters: [{ ...bible.characters[0], costume: '米色风衣、深色长裤' }] };
  const p = buildImagePrompt(shot({}), b, { style: '电影感写实', aspect: '9:16' });
  assert.ok(p.includes('服装：米色风衣、深色长裤'));
});

test('没设服装 / 没绑音色要报警', () => {
  const warns = checkConsistency([shot({})], bible);
  assert.ok(warns.some((w) => w.code === 'NO_COSTUME'));
  assert.ok(warns.some((w) => w.code === 'NO_VOICE'));
});

test('统一面板统计每个角色和道具覆盖了哪些镜头', () => {
  const shots = [
    shot({ id: 'A', characters: ['C1'], props: ['P1'] }),
    shot({ id: 'B', characters: ['C1'] }),
  ];
  const u = entityUsage(shots, bible);
  assert.deepEqual(u.characters[0].shots, ['A', 'B']);
  assert.deepEqual(u.props[0].shots, ['A']);
  assert.equal(u.total, 2);
});
