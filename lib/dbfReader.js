const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const DEFAULT_ENC = 'win1252';

// Mapping of the DBF "language driver" byte (header offset 0x1D) to the
// matching iconv-lite codec. dBase, FoxPro and Visual Objects all wrote
// this byte to declare which code page their character columns use.
// Reference: https://en.wikipedia.org/wiki/.dbf#Language_driver_byte
const LANG_DRIVER_ENC = {
  0x01: 'cp437',   // DOS USA
  0x02: 'cp850',   // DOS International / Multilingual Latin-1
  0x03: 'win1252', // Windows ANSI
  0x04: 'macroman',// Mac Roman
  0x08: 'cp865',   // DOS Nordic
  0x09: 'cp437',   // DOS Russian (best-effort)
  0x0a: 'cp850',   // alt CP850
  0x0b: 'cp437',
  0x0d: 'cp437',
  0x0e: 'cp852',
  0x0f: 'cp852',
  0x10: 'cp852',
  0x11: 'cp852',
  0x12: 'cp866',
  0x13: 'cp932',
  0x14: 'cp850',
  0x15: 'cp858',
  0x16: 'cp850',
  0x17: 'cp865',
  0x18: 'cp437',
  0x19: 'cp437',
  0x1a: 'cp850',
  0x1b: 'cp437',
  0x1c: 'cp863',
  0x1d: 'cp850',
  0x1f: 'cp852',
  0x22: 'cp852',
  0x23: 'cp852',
  0x24: 'cp860',
  0x25: 'cp850',
  0x26: 'cp866',
  0x37: 'cp850',   // ESRI Shape additional
  0x40: 'cp852',
  0x4d: 'cp936',
  0x4e: 'cp949',
  0x4f: 'cp950',
  0x50: 'cp874',
  0x57: 'win1252', // ANSI (FoxPro variant)
  0x58: 'win1252', // Western European Windows
  0x59: 'cp850',
  0x64: 'cp852',
  0x65: 'cp866',
  0x66: 'cp865',
  0x67: 'cp861',
  0x68: 'cp895',
  0x69: 'cp620',
  0x6a: 'cp737',
  0x6b: 'cp857',
  0x78: 'cp950',
  0x79: 'cp949',
  0x7a: 'cp936',
  0x7b: 'cp932',
  0x7c: 'cp874',
  0x7d: 'win1255',
  0x7e: 'win1256',
  0xc8: 'win1250',
  0xc9: 'win1251',
  0xca: 'win1254',
  0xcb: 'win1253',
};

function detectEncoding(headerBuf) {
  const lang = headerBuf[29];
  return LANG_DRIVER_ENC[lang] || null;
}

function parseHeader(buf) {
  const version = buf[0];
  const recordCount = buf.readUInt32LE(4);
  const headerLength = buf.readUInt16LE(8);
  const recordLength = buf.readUInt16LE(10);
  const languageDriver = buf[29];
  const declaredEncoding = detectEncoding(buf);
  const fields = [];
  let off = 32;
  while (off < headerLength && buf[off] !== 0x0d) {
    const rawName = buf.slice(off, off + 11).toString('ascii');
    const term = rawName.indexOf('\0');
    const name = (term >= 0 ? rawName.slice(0, term) : rawName).trim();
    const type = String.fromCharCode(buf[off + 11]);
    // Field size: dBase III used 1 byte at offset 16, but FoxPro 2.x and
    // Visual Objects can store C-field sizes >255 by treating bytes 16-17
    // as a 16-bit little-endian value. The byte at 17 is "decimal places"
    // only for N/F fields; for C it's the high byte of the size.
    const sizeLo = buf[off + 16];
    const sizeHi = buf[off + 17];
    let size, dec;
    if (type === 'C') {
      size = (sizeHi << 8) | sizeLo;
      dec = 0;
    } else {
      size = sizeLo;
      dec = sizeHi;
    }
    fields.push({ name, type, size, dec });
    off += 32;
  }
  return { version, recordCount, headerLength, recordLength, fields, languageDriver, declaredEncoding };
}

function parse8CharDate(str) {
  if (!str || str.trim() === '' || str[0] === ' ') return null;
  const y = Number(str.slice(0, 4));
  const m = Number(str.slice(4, 6));
  const d = Number(str.slice(6, 8));
  if (!y || !m || !d) return null;
  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

function trimStr(s) {
  return s.replace(/\u0000+/g, '').replace(/\s+$/g, '');
}

function parseField(field, buf, offset, enc) {
  const { type, size } = field;
  switch (type) {
    case 'C': {
      return trimStr(iconv.decode(buf.slice(offset, offset + size), enc));
    }
    case 'N':
    case 'F': {
      const s = iconv.decode(buf.slice(offset, offset + size), enc).trim();
      if (!s) return null;
      const n = parseFloat(s);
      return isNaN(n) ? null : n;
    }
    case 'L': {
      const c = String.fromCharCode(buf[offset]);
      if ('TtYy'.includes(c)) return true;
      if ('FfNn'.includes(c)) return false;
      return null;
    }
    case 'D': {
      const s = iconv.decode(buf.slice(offset, offset + size), enc);
      return parse8CharDate(s);
    }
    case 'I': {
      return buf.readInt32LE(offset);
    }
    case 'B': {
      return buf.readDoubleLE(offset);
    }
    case 'M': {
      const s = iconv.decode(buf.slice(offset, offset + size), enc).trim();
      if (size === 4) return buf.readUInt32LE(offset);
      if (!s) return 0;
      const n = parseInt(s, 10);
      return isNaN(n) ? 0 : n;
    }
    default:
      return iconv.decode(buf.slice(offset, offset + size), enc);
  }
}

function readMemoBlock(memoFd, blockIndex, blockSize, memoSize, version) {
  if (!memoFd || !blockIndex || blockIndex * blockSize >= memoSize) return null;
  const headerBuf = Buffer.alloc(8);
  try {
    fs.readSync(memoFd, headerBuf, 0, 8, blockIndex * blockSize);
  } catch { return null; }
  if (version === 0x30 || version === 0xf5 || version === 0x07) {
    const blockType = headerBuf.readUInt32BE(0);
    const textLen = headerBuf.readUInt32BE(4);
    if (textLen === 0 || textLen > 10 * 1024 * 1024) return null;
    const dataBuf = Buffer.alloc(textLen);
    try {
      fs.readSync(memoFd, dataBuf, 0, textLen, blockIndex * blockSize + 8);
    } catch { return null; }
    if (blockType === 1) return dataBuf;
    return dataBuf;
  }
  const startOff = blockIndex * blockSize;
  const chunks = [];
  let readSoFar = 0;
  const scratch = Buffer.alloc(blockSize);
  while (true) {
    try {
      const pos = startOff + readSoFar;
      if (pos >= memoSize) break;
      const toRead = Math.min(blockSize, memoSize - pos);
      fs.readSync(memoFd, scratch, 0, toRead, pos);
    } catch { break; }
    const term = scratch.indexOf(Buffer.from([0x1a, 0x1a]));
    if (term >= 0) {
      chunks.push(Buffer.from(scratch.slice(0, term)));
      break;
    }
    chunks.push(Buffer.from(scratch));
    readSoFar += blockSize;
    if (readSoFar > 5 * 1024 * 1024) break;
  }
  return Buffer.concat(chunks);
}

function openMemo(dbfPath) {
  const dir = path.dirname(dbfPath);
  const base = path.basename(dbfPath, path.extname(dbfPath));
  for (const ext of ['.fpt', '.FPT', '.dbt', '.DBT']) {
    const candidate = path.join(dir, base + ext);
    if (fs.existsSync(candidate)) {
      const fd = fs.openSync(candidate, 'r');
      const size = fs.fstatSync(fd).size;
      const header = Buffer.alloc(8);
      try { fs.readSync(fd, header, 0, 8, 0); } catch {}
      let blockSize = header.readUInt16BE(6) || 512;
      if (ext.toLowerCase() === '.dbt') blockSize = 512;
      return { fd, size, blockSize };
    }
  }
  return null;
}

async function readAllRecords(filePath, { encoding } = {}) {
  const stat = fs.statSync(filePath);
  const fd = fs.openSync(filePath, 'r');
  const headerBuf = Buffer.alloc(Math.min(4096, stat.size));
  fs.readSync(fd, headerBuf, 0, headerBuf.length, 0);
  const meta = parseHeader(headerBuf);
  // Pick the codec: explicit override > file's declared language driver >
  // win1252 fallback. Different KIAS tables actually use different code
  // pages (e.g. FO_Scode is CP850, FO_AKTION is Win1252).
  const enc = encoding || meta.declaredEncoding || DEFAULT_ENC;
  const memo = openMemo(filePath);
  const out = [];
  const recordBuf = Buffer.alloc(meta.recordLength);
  try {
    for (let i = 0; i < meta.recordCount; i++) {
      const pos = meta.headerLength + i * meta.recordLength;
      try {
        fs.readSync(fd, recordBuf, 0, meta.recordLength, pos);
      } catch {
        continue;
      }
      const flag = recordBuf[0];
      if (flag === 0x2a) continue;
      let offset = 1;
      const rec = {};
      for (const f of meta.fields) {
        if (f.type === 'M') {
          const blockIndex = parseField(f, recordBuf, offset, enc);
          if (blockIndex && memo) {
            const mb = readMemoBlock(memo.fd, blockIndex, memo.blockSize, memo.size, meta.version);
            rec[f.name] = mb ? trimStr(iconv.decode(mb, enc)) : null;
          } else {
            rec[f.name] = null;
          }
        } else {
          rec[f.name] = parseField(f, recordBuf, offset, enc);
        }
        offset += f.size;
      }
      out.push(rec);
    }
  } finally {
    fs.closeSync(fd);
    if (memo) fs.closeSync(memo.fd);
  }
  return { meta, records: out };
}

module.exports = { readAllRecords, parseHeader };
