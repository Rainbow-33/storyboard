// 把分镜表导出成真正的 .docx（不是把 HTML 改后缀）
// 做法：自己拼一个最小 OOXML 包，再用 store（不压缩）方式打成 zip。
// 纯浏览器/纯 node 都能跑，不依赖任何库。

const enc = new TextEncoder();

// ---------------- CRC32 ----------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------- ZIP（store，不压缩） ----------------
function zipStore(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.data;
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true); // version needed
    dv.setUint16(6, 0x0800, true); // UTF-8 文件名
    dv.setUint16(8, 0, true); // store
    dv.setUint16(10, 0, true); // time
    dv.setUint16(12, 0x21, true); // date（1980-01-01）
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, name.length, true);
    dv.setUint16(28, 0, true);
    local.set(name, 30);

    chunks.push(local, data);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of [...chunks, ...central, eocd]) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

// ---------------- OOXML ----------------
const xmlEsc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// 一行文本 → 若干 w:p（按 \n 拆段）
function paras(text, { bold = false, size = 20, color = '1C1A16', align } = {}) {
  const lines = String(text ?? '').split('\n');
  return lines
    .map((line) => {
      const run = line
        ? `<w:r><w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/><w:color w:val="${color}"/></w:rPr><w:t xml:space="preserve">${xmlEsc(line)}</w:t></w:r>`
        : '';
      const pPr = align ? `<w:pPr><w:jc w:val="${align}"/></w:pPr>` : '';
      return `<w:p>${pPr}${run}</w:p>`;
    })
    .join('');
}

// 台词列名跟着「台词」选项走：仅中文 / 中泰 / 中英 / 中英泰 / 自定义
// 列宽合计 10200 dxa = A4 可用宽度（11906 - 左右边距 850×2），再多就会被打出纸边
function colsFor(lineHeader) {
  return [
    { key: 'id', label: '镜头号', w: 820 },
    { key: 'visual', label: '画面描述', w: 2280 },
    { key: 'line', label: lineHeader, w: 1780 },
    { key: 'camera', label: '运镜方式 / 景别', w: 1740 },
    { key: 'entities', label: '人物 / 场景 / 道具', w: 1560 },
    { key: 'note', label: '备注（音效 / 首帧 / 表演）', w: 1480 },
    { key: 'duration', label: '时长', w: 540 },
  ];
}

function cell(text, { head = false, w = 1000 } = {}) {
  const shade = head ? '<w:shd w:val="clear" w:color="auto" w:fill="3A3630"/>' : '';
  return `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${w}"/>${shade}<w:tcMar><w:top w:w="60" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar></w:tcPr>${
    head
      ? paras(text, { bold: true, size: 17, color: 'FFFFFF' })
      : paras(text, { size: 17 })
  }</w:tc>`;
}

// 表格外壳：固定列宽 + 细边框，正文和附录共用
function tbl(widths, rowsXml) {
  return `<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="${widths.reduce((a, b) => a + b, 0)}"/><w:tblBorders>${[
    'top',
    'left',
    'bottom',
    'right',
    'insideH',
    'insideV',
  ]
    .map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="B9B0A0"/>`)
    .join('')}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${widths
    .map((w) => `<w:gridCol w:w="${w}"/>`)
    .join('')}</w:tblGrid>${rowsXml}</w:tbl>`;
}

function headRow(headers, widths) {
  return `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers
    .map((h, i) => cell(h, { head: true, w: widths[i] }))
    .join('')}</w:tr>`;
}

function bodyRow(values, widths) {
  return `<w:tr>${values.map((v, i) => cell(v ?? '', { w: widths[i] })).join('')}</w:tr>`;
}

export function buildStoryboardDocx({ title, subtitle, scenes, bible, lineHeader = '台词', lineTag = '' }) {
  const COLS = colsFor(lineHeader);
  const findChar = (id) => (bible.characters || []).find((c) => c.id === id);
  const findProp = (id) => (bible.props || []).find((p) => p.id === id);
  const findScene = (id) => (bible.scenes || []).find((s) => s.id === id);

  let body = '';

  // 标题区
  body += paras(title || '分镜本', { bold: true, size: 40 });
  if (subtitle) body += paras(subtitle, { size: 18, color: '6B6459' });
  body += '<w:p/>';

  // 表头
  let rows = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${COLS.map((c) => cell(c.label, { head: true, w: c.w })).join('')}</w:tr>`;

  for (const scene of scenes) {
    const sc = findScene(scene.scene_id);
    rows += `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="${COLS.length}"/><w:shd w:val="clear" w:color="auto" w:fill="EFE9DB"/></w:tcPr>${paras(
      `场次 ${scene.scene_id}${sc ? ' · ' + sc.name : ''}${sc?.time ? ' · ' + sc.time : ''}`,
      { bold: true, size: 17 }
    )}</w:tc></w:tr>`;

    for (const shot of scene.shots) {
      const dlg = (shot.dialogue || [])
        .map((d) => `${d.speaker}：${d.line_zh}${d.line_th ? `\n${lineTag ? `[${lineTag}] ` : ''}${d.line_th}` : ''}`)
        .join('\n');

      const nm = (x) => `${x.name}${x.name_en ? `（${x.name_en}）` : ''}`;
      const ents = [
        ...(shot.characters || []).map((id) => {
          const c = findChar(id);
          return c ? `人物：${nm(c)}` : '';
        }),
        sc ? `场景：${nm(sc)}` : '',
        ...(shot.props || []).map((id) => {
          const p = findProp(id);
          return p ? `道具：${nm(p)}` : '';
        }),
      ]
        .filter(Boolean)
        .join('\n');

      const cont = String(shot.continuity || '').replace(/^首帧承接[:：]\s*/, '');
      const note = [shot.sfx ? `音效：${shot.sfx}` : '', cont ? `首帧：${cont}` : '', shot.emotion ? `表演：${shot.emotion}` : '']
        .filter(Boolean)
        .join('\n');

      const vals = {
        id: shot.id,
        visual: shot.visual,
        line: dlg,
        camera: [shot.camera_move, shot.shot_size, shot.composition].filter(Boolean).join('；'),
        entities: ents,
        note,
        duration: `${Number(shot.duration || 0).toFixed(1)} s`,
      };
      rows += `<w:tr>${COLS.map((c) => cell(vals[c.key], { w: c.w })).join('')}</w:tr>`;
    }
  }

  body += tbl(
    COLS.map((c) => c.w),
    rows
  );

  // 附录：资产设定（角色 / 场景 / 道具），一页交给美术和配音参考
  const chars = bible.characters || [];
  const scns = bible.scenes || [];
  const propsArr = bible.props || [];
  if (chars.length || scns.length || propsArr.length) {
    const nm = (x) => `${x.name}${x.name_en ? `（${x.name_en}）` : ''}`;
    body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    body += paras('附：资产设定', { bold: true, size: 32 });
    body += paras(
      `角色 ${chars.length} · 场景 ${scns.length} · 道具 ${propsArr.length}　这些设定会原样注入每个引用它的镜头，跨镜保持一致`,
      { size: 16, color: '6B6459' }
    );
    body += '<w:p/>';

    if (chars.length) {
      const W = [900, 1900, 1500, 3500, 2400];
      const rowsX =
        headRow(['编号', '角色', '身份 / 年龄', '外观锚点', '服装'], W) +
        chars
          .map((c) =>
            bodyRow(
              [
                c.id,
                nm(c),
                [c.role, c.age].filter(Boolean).join(' / '),
                [c.appearance, c.face ? `面部：${c.face}` : ''].filter(Boolean).join('\n'),
                (c.outfits || []).map((o) => `${o.name}：${o.desc}`).join('\n'),
              ],
              W
            )
          )
          .join('');
      body += paras('角色', { bold: true, size: 20 });
      body += tbl(W, rowsX);
      body += '<w:p/>';
    }

    if (scns.length) {
      const W = [900, 1900, 1400, 4000, 2000];
      const rowsX =
        headRow(['编号', '场景', '时间 / 天气', '空间与陈设', '光线 / 色调'], W) +
        scns
          .map((s) =>
            bodyRow(
              [
                s.id,
                nm(s),
                [s.time, s.weather].filter(Boolean).join(' / '),
                s.place,
                [s.light, s.palette].filter(Boolean).join('\n'),
              ],
              W
            )
          )
          .join('');
      body += paras('场景', { bold: true, size: 20 });
      body += tbl(W, rowsX);
      body += '<w:p/>';
    }

    if (propsArr.length) {
      const W = [900, 1900, 4800, 2600];
      const rowsX =
        headRow(['编号', '道具', '外观', '剧情作用'], W) +
        propsArr
          .map((p) => bodyRow([p.id, nm(p), p.look, p.significance], W))
          .join('');
      body += paras('道具', { bold: true, size: 20 });
      body += tbl(W, rowsX);
    }
  }

  // 页脚信息 + 页面设置
  body += '<w:p/>';
  body += paras(`由分镜台生成 · ${new Date().toLocaleString('zh-CN')}`, { size: 15, color: '8C8577' });
  body += `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="850" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: 'word/document.xml', data: enc.encode(document) },
  ]);
}
