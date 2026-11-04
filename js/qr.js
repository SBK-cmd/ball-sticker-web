/* QR encoder (byte mode, EC M, v1-10) — copy of qrEncode in app, for track.html */
window.qrEncode = (function(){
  function qrEncode(text) {
    const data = Array.from(new TextEncoder().encode(text));
    const T = {1:[10,[[1,16]]],2:[16,[[1,28]]],3:[26,[[1,44]]],4:[18,[[2,32]]],5:[24,[[2,43]]],6:[16,[[4,27]]],7:[18,[[4,31]]],8:[22,[[2,38],[2,39]]],9:[22,[[3,36],[2,37]]],10:[26,[[4,43],[1,44]]]};
    const AL = {1:[],2:[6,18],3:[6,22],4:[6,26],5:[6,30],6:[6,34],7:[6,22,38],8:[6,24,42],9:[6,26,46],10:[6,28,50]};
    let ver = 0, cap = 0;
    for (let v = 1; v <= 10; v++) { cap = T[v][1].reduce((a, g) => a + g[0] * g[1], 0); if (4 + (v < 10 ? 8 : 16) + data.length * 8 <= cap * 8) { ver = v; break; } }
    if (!ver) throw new Error('QR: data too long');
    // bit stream
    const bits = []; const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4); put(data.length, ver < 10 ? 8 : 16); data.forEach(b => put(b, 8));
    put(0, Math.min(4, cap * 8 - bits.length)); while (bits.length % 8) bits.push(0);
    const cw = []; for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2));
    for (let p = 0; cw.length < cap; p++) cw.push(p % 2 ? 0x11 : 0xEC);
    // Reed-Solomon over GF(256)
    const EXP = new Array(512), LOG = new Array(256); let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
    const mul = (a, b) => a && b ? EXP[LOG[a] + LOG[b]] : 0;
    const ecn = T[ver][0];
    let gen = [1]; for (let i = 0; i < ecn; i++) { const ng = new Array(gen.length + 1).fill(0); gen.forEach((g, j) => { ng[j] ^= g; ng[j + 1] ^= mul(g, EXP[i]); }); gen = ng; }
    const rs = blk => { const r = blk.concat(new Array(ecn).fill(0)); for (let i = 0; i < blk.length; i++) { const c = r[i]; if (c) for (let j = 0; j < gen.length; j++) r[i + j] ^= mul(gen[j], c); } return r.slice(blk.length); };
    const blocks = [], ecs = []; let off = 0;
    T[ver][1].forEach(([n, len]) => { for (let i = 0; i < n; i++) { const b = cw.slice(off, off + len); off += len; blocks.push(b); ecs.push(rs(b)); } });
    const out = []; const maxLen = Math.max(...blocks.map(b => b.length));
    for (let i = 0; i < maxLen; i++) blocks.forEach(b => { if (i < b.length) out.push(b[i]); });
    for (let i = 0; i < ecn; i++) ecs.forEach(e => out.push(e[i]));
    // matrix
    const N = ver * 4 + 17; const M = [], F = [];
    for (let i = 0; i < N; i++) { M.push(new Array(N).fill(false)); F.push(new Array(N).fill(false)); }
    const set = (r, c, v) => { M[r][c] = v; F[r][c] = true; };
    const finder = (r, c) => { for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) { const rr = r + i, cc = c + j; if (rr < 0 || cc < 0 || rr >= N || cc >= N) continue; const on = i >= 0 && i <= 6 && j >= 0 && j <= 6 && (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4)); set(rr, cc, on); } };
    finder(0, 0); finder(0, N - 7); finder(N - 7, 0);
    for (let i = 8; i < N - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const al = AL[ver];
    const la = al[al.length - 1];
    al.forEach(r => al.forEach(c => { if ((r === 6 && c === 6) || (r === 6 && c === la) || (r === la && c === 6)) return; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) set(r + i, c + j, Math.max(Math.abs(i), Math.abs(j)) !== 1); }));
    set(N - 8, 8, true); // dark module
    // reserve format areas
    for (let i = 0; i < 9; i++) { if (!F[8][i]) set(8, i, false); if (!F[i][8]) set(i, 8, false); }
    for (let i = 0; i < 8; i++) { if (!F[8][N - 1 - i]) set(8, N - 1 - i, false); if (!F[N - 1 - i][8]) set(N - 1 - i, 8, false); }
    if (ver >= 7) { let v = ver << 12, g = 0x1F25; for (let i = 17; i >= 12; i--) if ((v >>> i) & 1) v ^= g << (i - 12); const vb = (ver << 12) | v;
      for (let i = 0; i < 18; i++) { const b = ((vb >>> i) & 1) === 1, a = Math.floor(i / 3), c = i % 3 + N - 11; set(a, c, b); set(c, a, b); } }
    // place data
    const dbits = []; out.forEach(b => { for (let i = 7; i >= 0; i--) dbits.push((b >>> i) & 1); });
    const pos = []; let up = true;
    for (let c = N - 1; c > 0; c -= 2) { if (c === 6) c--; for (let k = 0; k < N; k++) { const r = up ? N - 1 - k : k; for (let d = 0; d < 2; d++) { const cc = c - d; if (!F[r][cc]) pos.push([r, cc]); } } up = !up; }
    const masks = [(r, c) => (r + c) % 2 === 0, r => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0, (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
      (r, c) => (r * c) % 2 + (r * c) % 3 === 0, (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0, (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0];
    const build = mk => {
      const A = M.map(row => row.slice());
      pos.forEach(([r, c], i) => { const b = i < dbits.length ? dbits[i] === 1 : false; A[r][c] = b !== masks[mk](r, c); });
      let f = (0 << 3) | mk, g = f << 10; for (let i = 14; i >= 10; i--) if ((g >>> i) & 1) g ^= 0x537 << (i - 10);
      const fb = ((f << 10) | g) ^ 0x5412;
      const bit = i => ((fb >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) A[i][8] = bit(i);
      A[7][8] = bit(6); A[8][8] = bit(7); A[8][7] = bit(8);
      for (let i = 9; i < 15; i++) A[8][14 - i] = bit(i);
      for (let i = 0; i < 8; i++) A[8][N - 1 - i] = bit(i);
      for (let i = 8; i < 15; i++) A[N - 15 + i][8] = bit(i);
      A[N - 8][8] = true; return A;
    };
    const penalty = A => { let p = 0;
      for (let r = 0; r < N; r++) { let run = 1; for (let c = 1; c < N; c++) { if (A[r][c] === A[r][c - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
      for (let c = 0; c < N; c++) { let run = 1; for (let r = 1; r < N; r++) { if (A[r][c] === A[r - 1][c]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
      for (let r = 0; r < N - 1; r++) for (let c = 0; c < N - 1; c++) { const v = A[r][c]; if (v === A[r][c + 1] && v === A[r + 1][c] && v === A[r + 1][c + 1]) p += 3; }
      let dark = 0; A.forEach(row => row.forEach(v => { if (v) dark++; })); p += Math.floor(Math.abs(dark * 100 / (N * N) - 50) / 5) * 10; return p; };
    let best = null, bp = Infinity; for (let m = 0; m < 8; m++) { const A = build(m), p = penalty(A); if (p < bp) { bp = p; best = A; } }
    return best;
  }
return qrEncode;})();
