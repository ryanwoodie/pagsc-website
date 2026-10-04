/**
 * A small QR code encoder for the certificates (byte mode, error correction level M, versions 1 to 10).
 * Pure JavaScript, no Google services, so it runs in the tests too. Follows the method of
 * Project Nayuki's QR Code generator (MIT licence), cut down to what a URL on a certificate needs.
 *
 * qrMatrix('https://…') -> array of rows, each an array of booleans (true = dark), without the quiet zone.
 */

var QR_M = {
  ECC_PER_BLOCK: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  BLOCKS: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
};

function qrMatrix(text) {
  var bytes = qrUtf8(String(text));
  var ver = 0, dataCap = 0;
  for (var v = 1; v <= 10; v++) {
    dataCap = qrDataCodewords(v);
    var bitsNeeded = 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
    if (bitsNeeded <= dataCap * 8) { ver = v; break; }
  }
  if (!ver) throw new Error('Text too long for a QR code: ' + bytes.length + ' bytes');

  // Data bits: mode, length, bytes, terminator, padding.
  var bits = [];
  var push = function (val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(4, 4);
  push(bytes.length, ver < 10 ? 8 : 16);
  bytes.forEach(function (b) { push(b, 8); });
  push(0, Math.min(4, dataCap * 8 - bits.length));
  push(0, (8 - bits.length % 8) % 8);
  for (var pad = 0xEC; bits.length < dataCap * 8; pad ^= 0xEC ^ 0x11) push(pad, 8);
  var data = [];
  for (var k = 0; k < bits.length; k += 8) {
    var byte = 0;
    for (var j = 0; j < 8; j++) byte = (byte << 1) | bits[k + j];
    data.push(byte);
  }

  var codewords = qrAddEcc(data, ver);
  var size = ver * 4 + 17;
  var q = { size: size, mod: [], fn: [] };
  for (var y = 0; y < size; y++) {
    q.mod.push(new Array(size).fill(false));
    q.fn.push(new Array(size).fill(false));
  }
  qrDrawFunctionPatterns(q, ver);
  qrDrawCodewords(q, codewords);

  // Choose the mask with the lowest penalty.
  var best = -1, bestScore = Infinity;
  for (var m = 0; m < 8; m++) {
    qrApplyMask(q, m);
    qrDrawFormat(q, m);
    var score = qrPenalty(q);
    if (score < bestScore) { bestScore = score; best = m; }
    qrApplyMask(q, m); // undo
  }
  qrApplyMask(q, best);
  qrDrawFormat(q, best);
  return q.mod;
}

function qrUtf8(s) {
  var out = [];
  var enc = unescape(encodeURIComponent(s));
  for (var i = 0; i < enc.length; i++) out.push(enc.charCodeAt(i));
  return out;
}

function qrRawModules(ver) {
  var result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    var n = Math.floor(ver / 7) + 2;
    result -= (25 * n - 10) * n - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function qrDataCodewords(ver) {
  return Math.floor(qrRawModules(ver) / 8) - QR_M.ECC_PER_BLOCK[ver] * QR_M.BLOCKS[ver];
}

function qrAlignmentPositions(ver) {
  if (ver === 1) return [];
  var n = Math.floor(ver / 7) + 2;
  var step = Math.floor((ver * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  var result = [6];
  for (var pos = ver * 4 + 17 - 7; result.length < n; pos -= step) result.splice(1, 0, pos);
  return result;
}

function qrSet(q, x, y, dark) {
  q.mod[y][x] = dark;
  q.fn[y][x] = true;
}

function qrDrawFunctionPatterns(q, ver) {
  var size = q.size;
  for (var i = 0; i < size; i++) {
    qrSet(q, 6, i, i % 2 === 0);
    qrSet(q, i, 6, i % 2 === 0);
  }
  [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
    for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
      var d = Math.max(Math.abs(dx), Math.abs(dy)), x = c[0] + dx, y = c[1] + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) qrSet(q, x, y, d !== 2 && d !== 4);
    }
  });
  var pos = qrAlignmentPositions(ver), last = pos.length - 1;
  for (var a = 0; a < pos.length; a++) for (var b = 0; b < pos.length; b++) {
    if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) continue;
    for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++) {
      qrSet(q, pos[a] + dx2, pos[b] + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
    }
  }
  qrDrawFormat(q, 0); // reserve the format areas; redrawn once the mask is chosen
  if (ver >= 7) {
    var rem = ver;
    for (var r = 0; r < 12; r++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var vbits = (ver << 12) | rem;
    for (var k = 0; k < 18; k++) {
      var bit = ((vbits >>> k) & 1) !== 0, p = size - 11 + k % 3, s = Math.floor(k / 3);
      qrSet(q, p, s, bit);
      qrSet(q, s, p, bit);
    }
  }
}

/** Format bits for level M (00) and the mask, in both copies, plus the dark module. */
function qrDrawFormat(q, mask) {
  var data = (0 << 3) | mask;
  var rem = data;
  for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  var bits = ((data << 10) | rem) ^ 0x5412;
  var bit = function (n) { return ((bits >>> n) & 1) !== 0; };
  var size = q.size;
  for (var a = 0; a <= 5; a++) qrSet(q, 8, a, bit(a));
  qrSet(q, 8, 7, bit(6));
  qrSet(q, 8, 8, bit(7));
  qrSet(q, 7, 8, bit(8));
  for (var b = 9; b < 15; b++) qrSet(q, 14 - b, 8, bit(b));
  for (var c = 0; c < 8; c++) qrSet(q, size - 1 - c, 8, bit(c));
  for (var d = 8; d < 15; d++) qrSet(q, 8, size - 15 + d, bit(d));
  qrSet(q, 8, size - 8, true);
}

function qrGfMul(x, y) {
  var z = 0;
  for (var i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11D);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xFF;
}

function qrRsDivisor(degree) {
  var result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  var root = 1;
  for (var i = 0; i < degree; i++) {
    for (var j = 0; j < result.length; j++) {
      result[j] = qrGfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = qrGfMul(root, 0x02);
  }
  return result;
}

function qrRsRemainder(data, divisor) {
  var result = divisor.map(function () { return 0; });
  data.forEach(function (b) {
    var factor = b ^ result.shift();
    result.push(0);
    divisor.forEach(function (coef, i) { result[i] ^= qrGfMul(coef, factor); });
  });
  return result;
}

/** Split into blocks, add Reed-Solomon codewords, interleave. */
function qrAddEcc(data, ver) {
  var numBlocks = QR_M.BLOCKS[ver], eccLen = QR_M.ECC_PER_BLOCK[ver];
  var raw = Math.floor(qrRawModules(ver) / 8);
  var numShort = numBlocks - raw % numBlocks;
  var shortLen = Math.floor(raw / numBlocks);
  var divisor = qrRsDivisor(eccLen);
  var blocks = [];
  for (var i = 0, k = 0; i < numBlocks; i++) {
    var dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    var ecc = qrRsRemainder(dat, divisor);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  var result = [];
  for (var c = 0; c < blocks[0].length; c++) {
    for (var b = 0; b < blocks.length; b++) {
      if (c !== shortLen - eccLen || b >= numShort) result.push(blocks[b][c]);
    }
  }
  return result;
}

function qrDrawCodewords(q, data) {
  var size = q.size, i = 0;
  for (var right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (var vert = 0; vert < size; vert++) {
      for (var j = 0; j < 2; j++) {
        var x = right - j;
        var upward = ((right + 1) & 2) === 0;
        var y = upward ? size - 1 - vert : vert;
        if (!q.fn[y][x] && i < data.length * 8) {
          q.mod[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }
}

function qrApplyMask(q, mask) {
  for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) {
    var inv;
    switch (mask) {
      case 0: inv = (x + y) % 2 === 0; break;
      case 1: inv = y % 2 === 0; break;
      case 2: inv = x % 3 === 0; break;
      case 3: inv = (x + y) % 3 === 0; break;
      case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
      case 5: inv = x * y % 2 + x * y % 3 === 0; break;
      case 6: inv = (x * y % 2 + x * y % 3) % 2 === 0; break;
      default: inv = ((x + y) % 2 + x * y % 3) % 2 === 0;
    }
    if (inv && !q.fn[y][x]) q.mod[y][x] = !q.mod[y][x];
  }
}

/** The standard penalty rules: runs, 2x2 blocks, finder-like patterns, dark/light balance. */
function qrPenalty(q) {
  var size = q.size, m = q.mod, score = 0, dark = 0;
  var line = function (get) {
    var s = 0;
    for (var a = 0; a < size; a++) {
      var run = 1;
      for (var b = 1; b <= size; b++) {
        if (b < size && get(a, b) === get(a, b - 1)) { run++; continue; }
        if (run >= 5) s += run - 2;
        run = 1;
      }
      for (var c = 0; c + 10 < size + 4; c++) {
        // 1:1:3:1:1 dark pattern with four light modules on one side (outside counts as light)
        var at = function (i) { return i >= 0 && i < size ? get(a, i) : false; };
        var core = at(c) && !at(c + 1) && at(c + 2) && at(c + 3) && at(c + 4) && !at(c + 5) && at(c + 6);
        if (!core) continue;
        var before = !at(c - 1) && !at(c - 2) && !at(c - 3) && !at(c - 4);
        var after = !at(c + 7) && !at(c + 8) && !at(c + 9) && !at(c + 10);
        if (before || after) s += 40;
      }
    }
    return s;
  };
  score += line(function (r, c) { return m[r][c]; });
  score += line(function (c, r) { return m[r][c]; });
  for (var y = 0; y < size; y++) for (var x = 0; x < size; x++) {
    if (m[y][x]) dark++;
    if (y + 1 < size && x + 1 < size && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
  }
  var total = size * size;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}
