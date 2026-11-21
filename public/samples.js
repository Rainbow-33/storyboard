// 内置示例剧本 + 离线兜底数据
// 内置示例剧本：打开页面点一下就能跑，不用自己写

export const SAMPLES = [
  {
    id: 'brooch',
    name: '蓝宝石胸针',
    tag: '豪门 · 反转',
    text: `内景 曼谷别墅 书房 夜

吊灯只开了一半。Mint 跪在地毯上，Supatra 的鞋跟踩住她的手背。

Supatra：胸针在哪儿？

Mint：我没拿。

Supatra 抬手，把一杯红酒倒在她头顶。

门被推开。Nadech 站在门口，西装外套搭在手臂上，看见这一幕，停住。

Nadech：放开她。

Supatra：她偷了老夫人的蓝宝石胸针。

Nadech 走过去，弯腰，把 Mint 的下巴抬起来看了一眼。

Nadech：胸针是她的。

Supatra：什么？

Nadech：三十年前，我母亲拿走了她母亲的胸针。

他从内袋掏出一枚蓝宝石胸针，放进 Mint 掌心。

外景 别墅庭院 夜 雨

Mint 站在雨里，五指收拢，握着那枚胸针。

Nadech 撑伞走到她身后半步，停下。

Nadech：你可以恨我。

Mint：我知道。

Nadech：但你得先活着。

Mint 转过身，第一次直视他。

Mint：那你为什么现在才说。`,
  },
  {
    id: 'reunion',
    name: '雨夜重逢',
    tag: '都市 · 虐恋',
    text: `内景 便利店 深夜

雨敲着玻璃。林晚趴在收银台上，账本压在手肘下。

门铃响。周衍站在门口，浑身湿透，头发滴着水。他手里攥着一只旧怀表。

周衍：还你。

林晚没有接。她的目光落在怀表上，停了三秒。

林晚：扔了吧。

周衍：你妈的。

林晚（顿）：……你说什么。

周衍把怀表放在收银台上，转身走进雨里。门铃第二次响。

林晚伸手，指尖碰到表壳的裂痕。`,
  },
  {
    id: 'revenge',
    name: '会议室对峙',
    tag: '复仇 · 打脸',
    text: `内景 会议室 白天

长桌尽头，沈屿把一份文件推到桌中央。继母的手停在半空。

沈屿：遗嘱是伪造的。公证处的笔迹鉴定，昨天下午出的。

继母：你血口喷人。

沈屿：我查了三个月。你们换掉的那支钢笔，还在我父亲的抽屉里。

继母站起来，椅子在地上刮出刺耳的声音。

继母：你父亲不会这么对我。

沈屿：他当然不会。所以你们才要在他昏迷的时候动手。

落地窗外，整座城市的玻璃幕墙反射着光。沈屿合上文件。

沈屿：董事会十点开始。您还有二十分钟。`,
  },
  {
    id: 'campus',
    name: '天台的信',
    tag: '校园 · 误会',
    text: `外景 教学楼天台 傍晚

风很大。苏念把一封信塞进陈屿手里，又一把抢回来。

苏念：算了，当我没给。

陈屿：你给了又抢，什么意思。

苏念：意思是我不该写。

她背过身，把信揉成一团。陈屿从后面握住她的手腕，很轻。

陈屿：给我。

苏念：里面是空白的。

陈屿：那我也要。

夕阳落在铁栏杆上，影子拉得很长。信在他掌心慢慢松开。`,
  },
];

// 离线演示数据：未配置 Key 时使用，保证任何情况下都能演
export const FIXTURE = {
  source: 'demo',
  model: '内置示例',
  bible: {
    title: '雨夜重逢',
    logline: '分手五年后，他把一只旧怀表还给了她。',
    characters: [
      {
        id: 'C1',
        name: '林晚',
        role: '女主',
        age: '26岁',
        appearance: '黑色及肩直发、齐刘海、米色针织开衫、内搭白衬衫、身形偏瘦',
        face: '眉眼清淡，下巴偏尖，左眉尾有一颗小痣',
        forbidden: ['短发', '红色外套', '长发披肩'],
        voice: { gender: '女', age_feel: '青年', timbre: '清冷偏细', pace: '偏慢', emotion: '克制' },
      },
      {
        id: 'C2',
        name: '周衍',
        role: '男主',
        age: '28岁',
        appearance: '黑色短发、深灰色衬衫、黑色长裤、肩宽、湿发贴额',
        face: '眉骨高，下颌线明显，眼下有青色',
        forbidden: ['长发', '西装外套', '笑容'],
        voice: { gender: '男', age_feel: '青年', timbre: '低沉沙哑', pace: '偏慢', emotion: '压抑' },
      },
    ],
    scenes: [
      {
        id: 'S1',
        name: '便利店',
        time: '深夜 23:40',
        weather: '大雨',
        place: '便利店收银台与店门口',
        light: '冷白荧光灯，玻璃门外有蓝色霓虹反光',
        palette: '青灰为主，收银台暖黄点缀',
        props: ['P1'],
      },
    ],
    props: [
      { id: 'P1', name: '旧怀表', owner: 'C1', look: '黄铜外壳，表盘有一道斜向裂痕，表链发黑', significance: '母亲的遗物' },
    ],
  },
  scenes: [
    {
      scene_id: 'S1',
      summary: '周衍冒雨把怀表还给林晚，林晚拒收，他放下就走。',
      mood: '压抑、克制、未说破的旧账',
      shots: [
        {
          id: 'S1-01',
          scene_id: 'S1',
          shot_size: '大远景',
          angle: '俯拍',
          composition: '三分法',
          camera_move: '固定',
          duration: 4,
          visual: '暴雨中的街角，便利店招牌亮着，整条街只有这一块暖光，雨在地面砸出白雾。',
          image_hint: '高角度俯拍街道，便利店在画面右下三分位，霓虹与雨幕形成冷蓝色块',
          characters: [],
          props: [],
          dialogue: [],
          sfx: '暴雨、远处车辆',
          emotion: '孤寂',
        },
        {
          id: 'S1-02',
          scene_id: 'S1',
          shot_size: '全景',
          angle: '平视',
          composition: '中心构图',
          camera_move: '推',
          duration: 4,
          visual: '便利店内，林晚趴在收银台上，账本压在手肘下，日光灯把她的影子拉在货架边。',
          image_hint: '对称构图，人物居中偏下，货架形成纵深，冷白顶光',
          characters: ['C1'],
          props: [],
          dialogue: [],
          sfx: '冰柜低鸣',
          emotion: '疲惫',
        },
        {
          id: 'S1-03',
          scene_id: 'S1',
          shot_size: '近景',
          angle: '平视',
          composition: '框中框',
          camera_move: '固定',
          duration: 2.5,
          visual: '门被推开，门框框住周衍的半个身子，雨水顺着他的头发滴到肩线。',
          image_hint: '门框作为前景框，人物在框内偏右，门外蓝色霓虹逆光勾边',
          characters: ['C2'],
          props: [],
          dialogue: [],
          sfx: '门铃',
          emotion: '闯入',
        },
        {
          id: 'S1-04',
          scene_id: 'S1',
          shot_size: '中景',
          angle: '平视',
          composition: '三分法',
          camera_move: '固定',
          duration: 3.5,
          visual: '周衍站在门口，深灰衬衫湿透贴在身上，右手攥着旧怀表，抬眼看她。',
          image_hint: '人物偏左三分位，右手在画面下方，湿发贴额，顶光在肩线留高光',
          characters: ['C2'],
          props: ['P1'],
          dialogue: [{ speaker: '周衍', type: '对白', line_zh: '还你。', line_th: 'คืนให้' }],
          sfx: '雨声、门铃余响',
          emotion: '压抑',
        },
        {
          id: 'S1-05',
          scene_id: 'S1',
          shot_size: '特写',
          angle: '俯拍',
          composition: '中心构图',
          camera_move: '推',
          duration: 2,
          visual: '他摊开手掌，旧怀表的表盘上有一道斜向裂痕，雨水在黄铜壳上聚成水珠。',
          image_hint: '手掌特写，表盘居中，裂痕从左上斜向右下，冷光下水珠高光',
          characters: ['C2'],
          props: ['P1'],
          dialogue: [],
          sfx: '雨滴声',
          emotion: '沉重',
        },
        {
          id: 'S1-06',
          scene_id: 'S1',
          shot_size: '近景',
          angle: '平视',
          composition: '三分法',
          camera_move: '固定',
          duration: 3,
          visual: '林晚没有伸手。她的视线落在怀表上，睫毛动了一下，嘴唇抿紧。',
          image_hint: '人物偏右，视线向下看画外，冷白侧光，背景虚化的冷柜灯',
          characters: ['C1'],
          props: ['P1'],
          dialogue: [],
          sfx: '寂静、雨声变远',
          emotion: '克制',
        },
        {
          id: 'S1-07',
          scene_id: 'S1',
          shot_size: '近景',
          angle: '平视',
          composition: '中心构图',
          camera_move: '固定',
          duration: 2.5,
          visual: '林晚抬起眼，语气很平，像在说一件无关的事。',
          image_hint: '正面近景，人物居中，背景干净，顶光在鼻梁投下短影',
          characters: ['C1'],
          props: [],
          dialogue: [{ speaker: '林晚', type: '对白', line_zh: '扔了吧。', line_th: 'ทิ้งไปเถอะ' }],
          sfx: '',
          emotion: '冷淡',
        },
        {
          id: 'S1-08',
          scene_id: 'S1',
          shot_size: '特写',
          angle: '平视',
          composition: '三分法',
          camera_move: '固定',
          duration: 2.5,
          visual: '周衍的脸，雨水顺着下颌线滑下来，他喉咙动了一下，说出那句话。',
          image_hint: '面部特写偏左，湿发贴额，冷侧光，眼神直视镜头方向',
          characters: ['C2'],
          props: [],
          dialogue: [{ speaker: '周衍', type: '对白', line_zh: '你妈的。', line_th: 'แม่คุณ' }],
          sfx: '',
          emotion: '受伤',
        },
        {
          id: 'S1-09',
          scene_id: 'S1',
          shot_size: '中景',
          angle: '平视',
          composition: '前景遮挡',
          camera_move: '跟',
          duration: 4,
          visual: '他把怀表放在收银台上，转身推门走进雨里。门铃第二次响，门慢慢合上。',
          image_hint: '越过收银台货架拍摄，人物向右出画，门外雨幕被门缝切开',
          characters: ['C2'],
          props: ['P1'],
          dialogue: [],
          sfx: '门铃、雨声涌入又闷住',
          emotion: '决绝',
        },
        {
          id: 'S1-10',
          scene_id: 'S1',
          shot_size: '大特写',
          angle: '俯拍',
          composition: '对角线',
          camera_move: '推',
          duration: 3,
          visual: '林晚的指尖停在表壳裂痕上，指腹压下去，裂痕把灯光切成两半。',
          image_hint: '指尖与表壳的极近特写，裂痕沿对角线，暖黄光在指甲边缘反光',
          characters: ['C1'],
          props: ['P1'],
          dialogue: [],
          sfx: '雨声',
          emotion: '松动',
        },
      ],
    },
  ],
  timing: { bible: 0, shots: 0, total: 0 },
};
