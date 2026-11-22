// 读 .docx 正文用的最小解析器：docx 就是个 zip，取 word/document.xml 解压后去标签。
// 不装任何库，用浏览器自带的 DecompressionStream（Chrome/Edge 103+）。
// 单独成模块是为了能在 node 里直接跑测试，不牵扯 DOM。

export async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('浏览器版本太旧，请用新版 Chrome / Edge 打开');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function xmlToText(xml) {
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function docxToText(buf) {
  // 浏览器传 ArrayBuffer，node 传 Buffer 都认
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  // 从文件尾部找 zip 中央目录结束标记（EOCD）
  let eocd = -1;
  const floor = Math.max(0, u8.length - 66000);
  for (let i = u8.length - 22; i >= floor; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 .docx（也支持 .txt）');

  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);

  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nameLen));

    if (name === 'word/document.xml') {
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = u8.subarray(start, start + compSize);
      let bytes;
      if (method === 0) bytes = raw;
      else if (method === 8) bytes = await inflateRaw(raw);
      else throw new Error(`不支持的压缩方式（${method}）`);
      return xmlToText(new TextDecoder('utf-8').decode(bytes));
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('docx 里没找到正文，可能文件已损坏');
}
