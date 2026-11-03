// Sign Tools — ExtendScript (Illustrator side). ES3 only: no forEach/map/indexOf on arrays, no JSON, no trim.
var MM = 72 / 25.4;

function st_q(s) {
    s = String(s);
    var o = '"';
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i), k = s.charCodeAt(i);
        if (c === '"') o += '\\"';
        else if (c === '\\') o += '\\\\';
        else if (k < 32 || k > 126) { var h = k.toString(16); while (h.length < 4) h = '0' + h; o += '\\u' + h; }
        else o += c;
    }
    return o + '"';
}
function st_ok(msg) { return '{"ok":true,"msg":' + st_q(msg) + '}'; }
function st_err(msg) { return '{"error":' + st_q(msg) + '}'; }

// ไฟล์ Large Canvas: ตัวเลขในสคริปต์ = ขนาดจริง ÷ scaleFactor (ปกติ 10) → ต้องแปลงทุกครั้ง
var ST_SF = 1;
function st_doc() {
    if (app.documents.length === 0) throw new Error('ยังไม่มีเอกสารเปิดอยู่');
    var d = app.activeDocument;
    ST_SF = 1;
    try { if (d.scaleFactor && d.scaleFactor > 0) ST_SF = d.scaleFactor; } catch (e) {}
    return d;
}
function U(mm) { return mm * MM / ST_SF; }      // มม. → หน่วยสคริปต์
function P(pt) { return pt / ST_SF; }            // pt จริง → หน่วยสคริปต์
function st_writableLayer(doc) {
    var L = doc.activeLayer;
    if (L.locked || !L.visible) throw new Error('เลเยอร์ที่ใช้งานอยู่ถูกล็อกหรือซ่อนอยู่');
    return L;
}

// สีจากค่า RGB 0-255 (แปลงเป็น CMYK อัตโนมัติถ้าเอกสารเป็น CMYK)
function st_color(doc, rgb, cmyk) {
    var c;
    if (doc.documentColorSpace === DocumentColorSpace.CMYK) {
        c = new CMYKColor(); c.cyan = cmyk[0]; c.magenta = cmyk[1]; c.yellow = cmyk[2]; c.black = cmyk[3];
    } else {
        c = new RGBColor(); c.red = rgb[0]; c.green = rgb[1]; c.blue = rgb[2];
    }
    return c;
}

function st_unionBounds(items) {
    var b = null;
    for (var i = 0; i < items.length; i++) {
        var g = items[i].geometricBounds;
        if (!b) b = [g[0], g[1], g[2], g[3]];
        else { b[0] = Math.min(b[0], g[0]); b[1] = Math.max(b[1], g[1]); b[2] = Math.max(b[2], g[2]); b[3] = Math.min(b[3], g[3]); }
    }
    return b;
}

// artboard ที่มีจุดกึ่งกลางของ bounds อยู่ข้างใน
function st_artboardOf(doc, b) {
    var cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    for (var i = 0; i < doc.artboards.length; i++) {
        var r = doc.artboards[i].artboardRect;
        if (cx >= r[0] && cx <= r[2] && cy <= r[1] && cy >= r[3]) return i;
    }
    return doc.artboards.getActiveArtboardIndex();
}

function st_selection(doc) {
    var sel = doc.selection, out = [];
    if (!sel || typeof sel.length === 'undefined') return out;
    for (var i = 0; i < sel.length; i++) out.push(sel[i]);
    return out;
}

function st_collectText(items, out) {
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.typename === 'TextFrame') out.push(it);
        else if (it.typename === 'GroupItem') {
            var kids = [];
            for (var j = 0; j < it.pageItems.length; j++) kids.push(it.pageItems[j]);
            st_collectText(kids, out);
        }
    }
    return out;
}

function st_pad(n, digits) {
    var neg = n < 0, s = String(Math.abs(n));
    while (s.length < digits) s = '0' + s;
    return (neg ? '-' : '') + s;
}

function st_sortItems(arr, order) {
    // คำนวณค่าอ้างอิงตำแหน่งครั้งเดียว
    var a = [];
    for (var i = 0; i < arr.length; i++) {
        var g = arr[i].geometricBounds;
        a.push({ it: arr[i], x: (g[0] + g[2]) / 2, y: (g[1] + g[3]) / 2, h: Math.abs(g[1] - g[3]), w: Math.abs(g[2] - g[0]) });
    }
    var tol = 0;
    for (var k = 0; k < a.length; k++) tol += (order === 'tb' ? a[k].w : a[k].h);
    tol = a.length ? tol / a.length / 2 : 0;
    a.sort(function (p, q) {
        if (order === 'tb') {                       // คอลัมน์ซ้าย→ขวา แต่ละคอลัมน์บน→ล่าง
            if (Math.abs(p.x - q.x) > tol) return p.x - q.x;
            return q.y - p.y;
        }
        if (Math.abs(p.y - q.y) > tol) return q.y - p.y; // แถวบน→ล่าง แต่ละแถวซ้าย→ขวา
        return p.x - q.x;
    });
    var out = [];
    for (var m = 0; m < a.length; m++) out.push(a[m].it);
    return out;
}

// ---------------- 1) รันเลข ----------------
function st_runNumber(o) {
    try {
        var doc = st_doc(), sel = st_selection(doc);
        var frames = st_collectText(sel, []);
        if (!frames.length) return st_err('เลือกกล่องข้อความก่อน');
        var fmt = function (k) { return o.prefix + st_pad(o.start + k * o.step, o.digits) + o.suffix; };

        if (o.mode === 'ab') {
            if (frames.length !== 1) return st_err('โหมดทุก artboard: เลือกกล่องข้อความต้นแบบ 1 กล่อง');
            var tpl = frames[0], src = st_artboardOf(doc, tpl.geometricBounds);
            var sr = doc.artboards[src].artboardRect, n = 0;
            for (var i = 0; i < o.range.length; i++) {
                var t = o.range[i];
                if (t < 0 || t >= doc.artboards.length) continue;
                var tf = tpl;
                if (t !== src) {
                    var r = doc.artboards[t].artboardRect;
                    tf = tpl.duplicate();
                    tf.translate(r[0] - sr[0], r[1] - sr[1]);
                }
                tf.contents = fmt(n);
                n++;
            }
            return st_ok('ใส่เลข ' + n + ' artboard แล้ว (' + fmt(0) + ' – ' + fmt(n - 1) + ')');
        }

        var list = (o.order === 'sel') ? frames : st_sortItems(frames, o.order);
        for (var j = 0; j < list.length; j++) list[j].contents = fmt(j);
        return st_ok('ใส่เลข ' + list.length + ' กล่องแล้ว (' + fmt(0) + ' – ' + fmt(list.length - 1) + ')');
    } catch (e) { return st_err(e.message); }
}

// ---------------- 2) ก็อปไปทุก artboard ----------------
function st_duplicate(o) {
    try {
        var doc = st_doc(), sel = st_selection(doc);
        if (!sel.length) return st_err('เลือกวัตถุที่จะก็อปก่อน');
        var src = st_artboardOf(doc, st_unionBounds(sel));
        var sr = doc.artboards[src].artboardRect, n = 0;
        for (var i = 0; i < o.range.length; i++) {
            var t = o.range[i];
            if (t === src || t < 0 || t >= doc.artboards.length) continue;
            var r = doc.artboards[t].artboardRect;
            for (var j = 0; j < sel.length; j++) {
                var d = sel[j].duplicate();
                d.translate(r[0] - sr[0], r[1] - sr[1]);
            }
            n++;
        }
        return st_ok('ก็อปไป ' + n + ' artboard แล้ว (ต้นฉบับอยู่ artboard ' + (src + 1) + ')');
    } catch (e) { return st_err(e.message); }
}

// ---------------- 3) QR Code ----------------
// o.rows = ["0101..", ...] (ไม่รวมขอบ), o.sizeMM = ขนาดรวมขอบ, o.quiet = จำนวนช่องขอบ, o.bg = ใส่พื้นขาว
function st_qr(o) {
    try {
        var doc = st_doc(), layer = st_writableLayer(doc);
        var n = o.rows.length, total = n + o.quiet * 2;
        var size = U(o.sizeMM), m = size / total;
        var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
        var left = (ab[0] + ab[2]) / 2 - size / 2, top = (ab[1] + ab[3]) / 2 + size / 2;

        var grp = layer.groupItems.add();
        grp.name = 'QR Code';
        if (o.bg) {
            var bg = grp.pathItems.rectangle(top, left, size, size);
            bg.stroked = false; bg.filled = true;
            bg.fillColor = st_color(doc, [255, 255, 255], [0, 0, 0, 0]);
            bg.name = 'QR background';
        }
        var ink = st_color(doc, [0, 0, 0], [0, 0, 0, 100]);
        var cp = grp.compoundPathItems.add();
        cp.name = 'QR modules';
        for (var r = 0; r < n; r++) {
            var row = o.rows[r], c = 0;
            while (c < n) {
                if (row.charAt(c) === '1') {
                    var s = c;
                    while (c < n && row.charAt(c) === '1') c++;
                    // ขยายเล็กน้อยกันเส้นขาวระหว่างช่องเวลา render
                    var p = cp.pathItems.rectangle(top - (r + o.quiet) * m, left + (s + o.quiet) * m, (c - s) * m, m + 0.01);
                    p.stroked = false; p.filled = true; p.fillColor = ink;
                } else c++;
            }
        }
        if (o.caption) {
            var cap = grp.textFrames.add();
            cap.contents = o.caption;
            var ca = cap.textRange.characterAttributes;
            ca.size = Math.max(P(6), size * 0.075); ca.fillColor = ink;
            var tf = st_thaiFont(); if (tf) { try { ca.textFont = tf; } catch (ef) {} }
            try { cap.textRange.paragraphAttributes.justification = Justification.CENTER; } catch (ej) {}
            cap.left = left + size / 2 - cap.width / 2;
            cap.top = top - size - size * 0.03;
        }
        grp.selected = true;
        return st_ok('วาง QR ' + o.sizeMM + ' มม. (' + n + '×' + n + ' ช่อง) กลาง artboard แล้ว');
    } catch (e) { return st_err(e.message); }
}

// ---------------- 4) เส้นบอกขนาด ----------------
function st_fmtLen(pt, o) {
    var f = { 'mm': 25.4 / 72, 'cm': 2.54 / 72, 'in': 1 / 72, 'm': 0.0254 / 72 }[o.unit];
    var v = pt * ST_SF * f * o.scale, p = Math.pow(10, o.decimals);
    var s = (Math.round(v * p) / p).toFixed(o.decimals);
    return s + (o.showUnit ? ' ' + (o.unitText || o.unit) : '');
}

function st_line(grp, pts, col, w) {
    var p = grp.pathItems.add();
    p.setEntirePath(pts);
    p.filled = false; p.stroked = true; p.strokeColor = col; p.strokeWidth = w;
    return p;
}
function st_tri(grp, pts, col) {
    var p = grp.pathItems.add();
    p.setEntirePath(pts); p.closed = true;
    p.stroked = false; p.filled = true; p.fillColor = col;
    return p;
}
function st_label(grp, txt, o, col) {
    var t = grp.textFrames.add();
    t.contents = txt;
    t.textRange.characterAttributes.size = P(o.textPt);
    t.textRange.characterAttributes.fillColor = col;
    if (/[\u0E00-\u0E7F]/.test(txt)) { var f = st_thaiFont(); if (f) { try { t.textRange.characterAttributes.textFont = f; } catch (e) {} } }
    return t;
}

function st_dimOne(doc, layer, b, o, col) {
    var g = layer.groupItems.add();
    g.name = 'Dimension';
    var off = U(o.offsetMM), gap = U(1), ext = U(1.5), a = P(Math.max(1.2, o.lineW * 6)), lw = P(o.lineW);
    var L = b[0], T = b[1], R = b[2], B = b[3];

    if (o.which !== 'h') { // ความกว้าง — เหนือวัตถุ
        var y = T + off;
        st_line(g, [[L, T + gap], [L, y + ext]], col, lw);
        st_line(g, [[R, T + gap], [R, y + ext]], col, lw);
        st_line(g, [[L, y], [R, y]], col, lw);
        st_tri(g, [[L, y], [L + a, y + a / 3], [L + a, y - a / 3]], col);
        st_tri(g, [[R, y], [R - a, y + a / 3], [R - a, y - a / 3]], col);
        var tw = st_label(g, st_fmtLen(R - L, o), o, col);
        tw.left = (L + R) / 2 - tw.width / 2;
        tw.top = y + gap + tw.height;
    }
    if (o.which !== 'w') { // ความสูง — ขวาของวัตถุ
        var x = R + off;
        st_line(g, [[R + gap, T], [x + ext, T]], col, lw);
        st_line(g, [[R + gap, B], [x + ext, B]], col, lw);
        st_line(g, [[x, T], [x, B]], col, lw);
        st_tri(g, [[x, T], [x - a / 3, T - a], [x + a / 3, T - a]], col);
        st_tri(g, [[x, B], [x - a / 3, B + a], [x + a / 3, B + a]], col);
        var th = st_label(g, st_fmtLen(T - B, o), o, col);
        th.rotate(90);
        th.left = x + gap;
        th.top = (T + B) / 2 + th.height / 2;
    }
    return g;
}

function st_dimension(o) {
    try {
        var doc = st_doc(), layer = st_writableLayer(doc), sel = st_selection(doc);
        if (!sel.length) return st_err('เลือกวัตถุที่จะวัดก่อน');
        var col = null, made = [];
        if (o.swatch) { try { col = doc.swatches.getByName(o.swatch).color; } catch (e1) { col = null; } }
        if (!col) col = st_color(doc, o.rgb, o.cmyk);
        if (o.each) for (var i = 0; i < sel.length; i++) made.push(st_dimOne(doc, layer, sel[i].geometricBounds, o, col));
        else made.push(st_dimOne(doc, layer, st_unionBounds(sel), o, col));
        return st_ok('ใส่เส้นบอกขนาด ' + made.length + ' ชุดแล้ว');
    } catch (e) { return st_err(e.message); }
}

function st_info() {
    try {
        if (app.documents.length === 0) return '{"artboards":0}';
        var d = app.activeDocument;
        return '{"artboards":' + d.artboards.length + ',"active":' + d.artboards.getActiveArtboardIndex() + '}';
    } catch (e) { return st_err(e.message); }
}
// Thai Font Preview — ExtendScript (Illustrator side)
function tfp_q(s) {
    s = String(s);
    var o = '"';
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i), k = s.charCodeAt(i);
        if (c === '"') o += '\\"';
        else if (c === '\\') o += '\\\\';
        else if (k < 32 || k > 126) { var h = k.toString(16); while (h.length < 4) h = '0' + h; o += '\\u' + h; }
        else o += c;
    }
    return o + '"';
}
function tfp_err(msg) { return '{"error":' + tfp_q(msg) + '}'; }
function tfp_ok(msg) { return '{"ok":true,"msg":' + tfp_q(msg) + '}'; }

// ---------- ฟอนต์ที่ติดตั้ง ----------
function tfp_listFonts() {
    try {
        var f = app.textFonts, out = [];
        for (var i = 0; i < f.length; i++) {
            try {
                var t = f[i];
                out.push('{"n":' + tfp_q(t.name) + ',"f":' + tfp_q(t.family) + ',"s":' + tfp_q(t.style) + '}');
            } catch (e) {}
        }
        return '{"fonts":[' + out.join(',') + ']}';
    } catch (e) { return tfp_err(e.message); }
}

// หา TextFrame ทั้งหมดในสิ่งที่เลือก (รวมในกลุ่ม / clipping group)
function tfp_collect(item, out) {
    if (!item) return;
    var t = item.typename;
    if (t === 'TextFrame') { if (!item.locked) out.push(item); }
    else if (t === 'GroupItem') {
        for (var i = 0; i < item.pageItems.length; i++) tfp_collect(item.pageItems[i], out);
    }
}
function tfp_font(name) {
    try { return app.textFonts.getByName(name); } catch (e) {}
    for (var i = 0; i < app.textFonts.length; i++) if (app.textFonts[i].name === name) return app.textFonts[i];
    throw new Error('ไม่พบฟอนต์ ' + name);
}

// กดฟอนต์ = เปลี่ยนฟอนต์ของข้อความที่เลือกทันที
//  - ลากคลุมตัวอักษรอยู่ (Type tool) → เปลี่ยนเฉพาะตัวที่คลุม
//  - เลือกกล่องข้อความ / กลุ่ม → เปลี่ยนทั้งกล่อง
//  - ไม่ได้เลือกอะไร → วางข้อความตัวอย่างใหม่
function tfp_applyFont(fontName, sample, size) {
    try {
        if (app.documents.length === 0) return tfp_err('ยังไม่มีเอกสารเปิดอยู่');
        var doc = app.activeDocument, font = tfp_font(fontName), sel = doc.selection;

        if (sel && sel.typename === 'TextRange') {
            if (sel.length === 0) {
                // แค่วางเคอร์เซอร์ → ใช้กับทั้งกล่องนั้น
                sel.story.textRange.characterAttributes.textFont = font;
                return tfp_ok('เปลี่ยนเป็น ' + font.family + ' ' + font.style);
            }
            sel.characterAttributes.textFont = font;
            return tfp_ok('เปลี่ยน ' + sel.length + ' ตัวอักษรเป็น ' + font.family + ' ' + font.style);
        }

        var frames = [], hasSel = sel && sel.length > 0;
        if (hasSel) for (var i = 0; i < sel.length; i++) tfp_collect(sel[i], frames);
        if (frames.length) {
            for (var j = 0; j < frames.length; j++) frames[j].textRange.characterAttributes.textFont = font;
            return tfp_ok('เปลี่ยน ' + frames.length + ' กล่องเป็น ' + font.family + ' ' + font.style);
        }
        if (hasSel) return tfp_err('ที่เลือกไว้ไม่มีข้อความ (อาจถูก Create Outlines หรือล็อกอยู่)');

        var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
        var tf = doc.textFrames.add();
        tf.contents = sample;
        tf.textRange.characterAttributes.textFont = font;
        tf.textRange.characterAttributes.size = size;
        tf.left = ab[0] + 20;
        tf.top = ab[1] - 20;
        tf.selected = true;
        return tfp_ok('วางข้อความตัวอย่างแล้ว (เลือกไว้ กดฟอนต์อื่นต่อได้เลย)');
    } catch (e) { return tfp_err(e.message); }
}

// ฟอนต์ของข้อความที่เลือกตอนนี้ (ไว้ไฮไลต์ในรายการ)
function tfp_currentFont() {
    try {
        if (app.documents.length === 0) return '{"font":null}';
        var sel = app.activeDocument.selection, tr = null;
        if (sel && sel.typename === 'TextRange') tr = sel.length ? sel : sel.story.textRange;
        else if (sel && sel.length) { var f = []; for (var i = 0; i < sel.length && !f.length; i++) tfp_collect(sel[i], f); if (f.length) tr = f[0].textRange; }
        if (!tr || !tr.characters.length) return '{"font":null}';
        return '{"font":' + tfp_q(tr.characters[0].characterAttributes.textFont.name) + '}';
    } catch (e) { return '{"font":null}'; }
}

// ---------- ตัวที่วาดเอง (artboard ละ 1 ตัว) ----------
function tfp_exportGlyphs() {
    try {
        if (app.documents.length === 0) return tfp_err('ยังไม่มีเอกสารเปิดอยู่');
        var doc = app.activeDocument, abs = doc.artboards;
        var key = String(doc.name).replace(/[^A-Za-z0-9_-]/g, '_');
        var folder = new Folder(Folder.temp + '/tfp_glyphs_' + key);
        if (!folder.exists) folder.create();
        var old = folder.getFiles('*.png');
        for (var d = 0; d < old.length; d++) { try { old[d].remove(); } catch (e) {} }

        var maxH = 1;
        for (var i = 0; i < abs.length; i++) {
            var r = abs[i].artboardRect, h = r[1] - r[3];
            if (h > maxH) maxH = h;
        }
        var scale = Math.min(800, Math.max(20, 220 / maxH * 100));
        var opts = new ExportOptionsPNG24();
        opts.antiAliasing = true;
        opts.transparency = true;
        opts.artBoardClipping = true;
        opts.horizontalScale = scale;
        opts.verticalScale = scale;

        var orig = abs.getActiveArtboardIndex(), out = [];
        for (var j = 0; j < abs.length; j++) {
            abs.setActiveArtboardIndex(j);
            var rr = abs[j].artboardRect;
            var file = new File(folder.fsName + '/g' + j + '.png');
            doc.exportFile(file, ExportType.PNG24, opts);
            out.push('{"i":' + j + ',"name":' + tfp_q(abs[j].name) + ',"w":' + (rr[2] - rr[0]) +
                     ',"h":' + (rr[1] - rr[3]) + ',"path":' + tfp_q(file.fsName) + '}');
        }
        abs.setActiveArtboardIndex(orig);
        return '{"doc":' + tfp_q(doc.name) + ',"glyphs":[' + out.join(',') + ']}';
    } catch (e) { return tfp_err(e.message); }
}

// ---------- สวอตช์ของเอกสาร (สำหรับเลือกสีเส้นบอกขนาด) ----------
function st_hex2(n) { n = Math.max(0, Math.min(255, Math.round(n))); var h = n.toString(16); return h.length < 2 ? '0' + h : h; }
function st_colorHex(c) {
    var t = c.typename;
    if (t === 'RGBColor') return '#' + st_hex2(c.red) + st_hex2(c.green) + st_hex2(c.blue);
    if (t === 'CMYKColor') { var k = 1 - c.black / 100;
        return '#' + st_hex2(255 * (1 - c.cyan / 100) * k) + st_hex2(255 * (1 - c.magenta / 100) * k) + st_hex2(255 * (1 - c.yellow / 100) * k); }
    if (t === 'GrayColor') { var g = 255 * (1 - c.gray / 100); return '#' + st_hex2(g) + st_hex2(g) + st_hex2(g); }
    if (t === 'SpotColor') return st_colorHex(c.spot.color);
    return null;   // gradient / pattern / none
}
function st_swatches() {
    try {
        if (app.documents.length === 0) return '{"swatches":[],"doc":null}';
        var doc = app.activeDocument, sw = doc.swatches, out = [];
        for (var i = 0; i < sw.length && out.length < 300; i++) {
            try {
                var s = sw[i], nm = s.name;
                if (nm.charAt(0) === '[') continue;            // [None], [Registration]
                var hx = st_colorHex(s.color);
                if (!hx) continue;
                out.push('{"n":' + st_q(nm) + ',"h":"' + hx + '","spot":' + (s.color.typename === 'SpotColor' ? 'true' : 'false') + '}');
            } catch (e) {}
        }
        return '{"doc":' + st_q(doc.name) + ',"swatches":[' + out.join(',') + ']}';
    } catch (e) { return st_err(e.message); }
}

// =====================================================================
//  เรียงสติ๊กเกอร์ + เส้น kiss cut
// =====================================================================
function st_isCutColor(c) {
    try { return c && c.typename === 'SpotColor' && /cut/i.test(c.spot.name); } catch (e) { return false; }
}
// สีชมพูแบบเส้นตัด (RGB ff00ff / CMYK 0,100,0,0) — ใช้กับเส้นที่ไม่มีพื้น
function st_isMagenta(c) {
    try {
        if (c.typename === 'RGBColor') return c.red > 220 && c.green < 40 && c.blue > 180;
        if (c.typename === 'CMYKColor') return c.cyan < 8 && c.magenta > 90 && c.yellow < 8 && c.black < 8;
        if (c.typename === 'SpotColor') return st_isMagenta(c.spot.color);
    } catch (e) {}
    return false;
}
function st_cutLayerName(it) { try { return /cut|ไดคัท|ไดคัต|daicut/i.test(it.layer.name); } catch (e) { return false; } }
// เส้นตัดที่ผู้ใช้วาดเอง: สวอตช์ชื่อมี "cut" · หรืออยู่ในเลเยอร์ชื่อมี cut · หรือเส้นชมพูไม่มีพื้น
function st_isCutPath(p) {
    try {
        if (!p.stroked) return false;
        if (st_isCutColor(p.strokeColor)) return true;
        if (p.filled) return false;
        return st_cutLayerName(p) || st_isMagenta(p.strokeColor);
    } catch (e) { return false; }
}
function st_findCuts(item, out) {
    var t = item.typename;
    if (t === 'PathItem') { if (!item.clipping && st_isCutPath(item)) out.push(item); }
    else if (t === 'CompoundPathItem') { if (item.pathItems.length && st_isCutPath(item.pathItems[0])) out.push(item); }
    else if (t === 'GroupItem') { for (var i = 0; i < item.pageItems.length; i++) st_findCuts(item.pageItems[i], out); }
    return out;
}
// ชิ้นนี้เป็นเส้นตัดล้วน (ไม่มีงานพิมพ์) ไหม
function st_isCutOnly(item) {
    var t = item.typename;
    if (t === 'PathItem' || t === 'CompoundPathItem') return st_findCuts(item, []).length > 0;
    if (t === 'GroupItem') {
        if (!item.pageItems.length) return false;
        for (var i = 0; i < item.pageItems.length; i++) if (!st_isCutOnly(item.pageItems[i])) return false;
        return true;
    }
    return false;
}
function st_overlap(a, b) {
    var w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[1], b[1]) - Math.max(a[3], b[3]);
    return w > 0 && h > 0 ? w * h : 0;
}
// จับคู่: งาน + เส้นตัดที่วาดเองแยกชิ้น (เช่นอยู่คนละเลเยอร์) → 1 ลาย
function st_designs(sel) {
    var arts = [], cuts = [], i, j;
    for (i = 0; i < sel.length; i++) { if (st_isCutOnly(sel[i])) cuts.push(sel[i]); else arts.push({ art: sel[i], cuts: [] }); }
    if (!arts.length) throw new Error('เลือกมีแต่เส้นตัด — เลือกตัวงานด้วย');
    for (i = 0; i < cuts.length; i++) {
        var cb = cuts[i].geometricBounds, best = -1, bo = 0;
        for (j = 0; j < arts.length; j++) { var ov = st_overlap(cb, arts[j].art.visibleBounds); if (ov > bo) { bo = ov; best = j; } }
        if (best >= 0) arts[best].cuts.push(cuts[i]);
    }
    return arts;
}
function st_hasRaster(item) {
    var t = item.typename;
    if (t === 'RasterItem' || t === 'PlacedItem') return true;
    if (t === 'GroupItem') for (var i = 0; i < item.pageItems.length; i++) if (st_hasRaster(item.pageItems[i])) return true;
    return false;
}
function st_artBounds(it) {           // ขอบงาน ไม่นับเส้นตัดที่อยู่ในกลุ่ม
    var c = st_findCuts(it, []);
    if (!c.length || it.typename !== 'GroupItem') return it.visibleBounds;
    var keep = [];
    (function walk(g) { for (var i = 0; i < g.pageItems.length; i++) { var x = g.pageItems[i]; if (x.typename === 'GroupItem' && !x.clipped) walk(x); else if (!st_findCuts(x, []).length || x.typename === 'GroupItem') keep.push(x); } })(it);
    return keep.length ? st_unionBounds(keep) : it.visibleBounds;
}
function st_bnd(b) { return '[' + b[0] + ',' + b[1] + ',' + b[2] + ',' + b[3] + ']'; }

// อ่านสติ๊กเกอร์ที่เลือก (ไม่แก้ไขเอกสาร)
function st_stkRead() {
    try {
        var doc = st_doc(), sel = st_selection(doc), out = [];
        if (!sel.length) return st_err('เลือกสติ๊กเกอร์ก่อน (เลือกได้หลายตัว แต่ละตัวควรเป็น 1 กลุ่ม)');
        if (sel.length > 30) return st_err('เลือกได้ไม่เกิน 30 ลายต่อครั้ง');
        var ds = st_designs(sel);
        for (var i = 0; i < ds.length; i++) {
            var it = ds[i].art, cuts = st_findCuts(it, []).concat(ds[i].cuts), cb = cuts.length ? st_unionBounds(cuts) : null;
            out.push('{"i":' + i + ',"name":' + st_q(it.name || (it.typename === 'GroupItem' ? 'กลุ่ม ' + (i + 1) : 'ชิ้นที่ ' + (i + 1))) +
                ',"vb":' + st_bnd(st_artBounds(it)) + ',"cut":' + (cb ? st_bnd(cb) : 'null') + ',"raster":' + (st_hasRaster(it) ? 'true' : 'false') +
                ',"ownCuts":' + cuts.length + '}');
        }
        return '{"sf":' + ST_SF + ',"items":[' + out.join(',') + ']}';
    } catch (e) { return st_err(e.message); }
}

function st_spotSwatch(doc, name, rgb, cmyk) {
    for (var i = 0; i < doc.spots.length; i++) { try { if (doc.spots[i].name === name) return doc.spots[i]; } catch (e) {} }
    var sp = doc.spots.add();
    sp.name = name;
    sp.colorType = ColorModel.SPOT;
    sp.color = st_color(doc, rgb, cmyk);
    return sp;
}
function st_cutSwatch(doc) { return st_spotSwatch(doc, 'CutContour', [236, 0, 140], [0, 100, 0, 0]); }
function st_spotColor(sw) { var c = new SpotColor(); c.spot = sw; c.tint = 100; return c; }

// เส้นไดคัท (ตัดขาด) รอบเส้น kiss: d = { shape:'rect'|'same', offMM, radMM }
function st_dieCut(doc, art, cut, o, dest, dieColor) {
    var d = o.die, k = o.cutType;
    if (d.shape === 'rect') return st_shapeCut(doc, cut.geometricBounds, { cutType: 'rect', offsetMM: d.offMM, radiusMM: d.radMM }, dest, dieColor);
    if (k === 'circle' || k === 'ellipse' || k === 'rect')     // รูปทรงเรขาคณิต → วาดใหม่ให้ใหญ่ขึ้น (แม่นกว่า)
        return st_shapeCut(doc, art.visibleBounds, { cutType: k, offsetMM: o.offsetMM + d.offMM, radiusMM: o.radiusMM + d.offMM }, dest, dieColor);
    // ไดคัทตามรูป / เส้นวาดเอง → offset path จากเส้น kiss
    var w = cut.duplicate(dest, ElementPlacement.PLACEATEND), ps = st_collectPaths(w, []), i;
    var blk = st_color(doc, [0, 0, 0], [0, 0, 0, 100]);
    for (i = 0; i < ps.length; i++) { ps[i].closed = true; ps[i].stroked = false; ps[i].filled = true; ps[i].fillColor = blk; }
    doc.selection = null; w.selected = true;
    app.executeMenuCommand('group');
    var u = doc.selection[0];
    u.applyEffect('<LiveEffect name="Adobe Offset Path"><Dict data="R mlim 4 R ofst ' + U(d.offMM) + ' I jntp 0 "/></LiveEffect>');
    doc.selection = null; u.selected = true;
    app.executeMenuCommand('expandStyle');
    app.executeMenuCommand('group');
    app.executeMenuCommand('Live Pathfinder Add');
    app.executeMenuCommand('expandStyle');
    u = doc.selection[0];
    var paths = st_collectPaths(u, []), keep = [];
    for (i = 0; i < paths.length; i++) {
        var gb = paths[i].geometricBounds, inner = false;
        for (var j = 0; j < paths.length && !inner; j++) if (i !== j && st_inside(gb, paths[j].geometricBounds)) inner = true;
        if (!inner && Math.abs(paths[i].area) > 1) keep.push(paths[i]);
    }
    if (!keep.length) throw new Error('ทำเส้นไดคัทไม่ได้');
    var g = dest.groupItems.add();
    for (i = 0; i < keep.length; i++) { var c = keep[i].duplicate(g, ElementPlacement.PLACEATEND); st_styleCut(c, dieColor); }
    doc.selection = null;
    try { u.remove(); } catch (e1) {}
    try { w.remove(); } catch (e2) {}
    return g;
}

// เครดิตร้าน: ไฟล์โลโก้ (ai/pdf/eps/png/jpg/svg) หรือข้อความ → กลุ่มกว้าง wMM
function st_makeCredit(doc, cr, dest) {
    var g = dest.groupItems.add(), f = cr.file ? new File(cr.file) : null;
    if (f && f.exists) {
        if (/\.svg$/i.test(f.name)) { var sg = g.groupItems.createFromFile(f); }
        else { var pl = g.placedItems.add(); pl.file = f; try { pl.embed(); } catch (ee) {} }
    } else {
        if (cr.file) throw new Error('ไม่พบไฟล์เครดิต: ' + cr.file);
        st_txt(g, cr.text || 'บอล สติ๊กเกอร์', P(10), st_color(doc, [0, 0, 0], [0, 0, 0, 100]));
    }
    var vb = g.visibleBounds, gw = vb[2] - vb[0];
    if (gw > 0.001) { var sc = U(cr.wMM) / gw * 100; g.resize(sc, sc); }
    g.name = 'เครดิตร้าน';
    return g;
}
function st_putCredit(item, box, cr) {
    var vb = item.visibleBounds, w = vb[2] - vb[0], h = vb[1] - vb[3], ins = U(cr.inMM), x, y;
    var p = cr.pos || 'tl';
    x = (p === 'tr' || p === 'br') ? box[2] - ins - w : (p === 'bc' || p === 'tc') ? (box[0] + box[2]) / 2 - w / 2 : box[0] + ins;
    y = (p === 'bl' || p === 'br' || p === 'bc') ? box[3] + ins + h : box[1] - ins;
    item.translate(x - vb[0], y - vb[1]);
}
function st_styleCut(p, cutColor) {
    if (p.typename === 'CompoundPathItem') { for (var i = 0; i < p.pathItems.length; i++) st_styleCut(p.pathItems[i], cutColor); return; }
    if (p.typename === 'GroupItem') { for (var j = 0; j < p.pageItems.length; j++) st_styleCut(p.pageItems[j], cutColor); return; }
    p.filled = false; p.stroked = true; p.strokeColor = cutColor; p.strokeWidth = P(0.25);
    try { p.strokeOverprint = true; } catch (e) {}
}
// เลเยอร์เส้นตัด: เห็นได้ แต่ไม่พิมพ์ (ไม่ต้องปิดตา) · สีเลเยอร์ชมพู
function st_noPrint(L) {
    try { L.visible = true; L.printable = false; } catch (e) {}
    try { var c = new RGBColor(); c.red = 255; c.green = 0; c.blue = 200; L.color = c; } catch (e2) {}
}
// ลำดับเลเยอร์: Slug › CutContour › DieCut › งาน (CutContour อยู่บน DieCut เสมอ → ตัด kiss ก่อน)
function st_orderCutLayers(doc) {
    var names = ['DieCut', 'Die Cut', 'CutContour', 'Kiss Cut', 'Slug'];
    for (var i = 0; i < names.length; i++) {
        try { var L = doc.layers.getByName(names[i]); if (names[i] !== 'Slug') st_noPrint(L); L.zOrder(ZOrderMethod.BRINGTOFRONT); } catch (e) {}
    }
}
function st_hasLayer(doc, name) { try { doc.layers.getByName(name); return true; } catch (e) { return false; } }
function st_layer(doc, name, top) {
    var L;
    try { L = doc.layers.getByName(name); } catch (e) { L = doc.layers.add(); L.name = name; }
    L.locked = false; L.visible = true;
    if (top) { try { L.zOrder(ZOrderMethod.BRINGTOFRONT); } catch (e2) {} }
    return L;
}
function st_collectPaths(item, out) {
    if (item.typename === 'PathItem') out.push(item);
    else if (item.typename === 'CompoundPathItem') { for (var i = 0; i < item.pathItems.length; i++) out.push(item.pathItems[i]); }
    else if (item.typename === 'GroupItem') { for (var j = 0; j < item.pageItems.length; j++) st_collectPaths(item.pageItems[j], out); }
    return out;
}
function st_inside(a, b) { return a[0] >= b[0] - 0.01 && a[1] <= b[1] + 0.01 && a[2] <= b[2] + 0.01 && a[3] >= b[3] - 0.01 && !(a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]); }

function st_findType(x, type, out) {
    if (x.typename === type) out.push(x);
    else if (x.typename === 'GroupItem') for (var k = 0; k < x.pageItems.length; k++) st_findType(x.pageItems[k], type, out);
    return out;
}
// ไดคัทตามรูป: ทำสำเนา → แปลงตัวหนังสือ/ภาพ/เส้นเป็นรูปทรง → รวม → ขยายออก → เหลือแต่ขอบนอก

// เกลาเส้นให้เรียบ: สุ่มจุดตามเส้นจริง → เฉลี่ยลบขั้นบันไดพิกเซล → ลดจุด (Douglas-Peucker) → ใส่มือจับแบบ Catmull-Rom (โค้งต่อเนื่อง)
function st_smoothPath(p, tol) {
    if (p.typename !== 'PathItem' || !p.closed || p.pathPoints.length < 4) return;
    var pp = p.pathPoints, n = pp.length, pts = [], i, j, k;
    for (i = 0; i < n; i++) {
        var A = pp[i], B = pp[(i + 1) % n], a0 = A.anchor, a1 = A.rightDirection, b2 = B.leftDirection, b3 = B.anchor;
        for (j = 0; j < 6; j++) {
            var t = j / 6, u = 1 - t;
            pts.push([u * u * u * a0[0] + 3 * u * u * t * a1[0] + 3 * u * t * t * b2[0] + t * t * t * b3[0], u * u * u * a0[1] + 3 * u * u * t * a1[1] + 3 * u * t * t * b2[1] + t * t * t * b3[1]]);
        }
    }
    // สุ่มใหม่ให้ระยะเท่ากันทุก 0.25 มม. → การเฉลี่ยได้ผลเท่ากันทั้งเส้น ไม่ขึ้นกับความถี่ของจุดเดิม
    var stepU = U(0.25), rs = [pts[0]], acc = 0;
    for (i = 1; i <= pts.length; i++) {
        var P0 = pts[i - 1], P1 = pts[i % pts.length], sl = Math.sqrt((P1[0] - P0[0]) * (P1[0] - P0[0]) + (P1[1] - P0[1]) * (P1[1] - P0[1]));
        while (acc + sl >= stepU && sl > 0) { var f = (stepU - acc) / sl; P0 = [P0[0] + (P1[0] - P0[0]) * f, P0[1] + (P1[1] - P0[1]) * f]; rs.push(P0); sl -= (stepU - acc); acc = 0; }
        acc += sl;
    }
    if (rs.length > 8) pts = rs;
    var m = pts.length;
    for (k = 0; k < 8; k++) {      // เฉลี่ย 1-2-1 แปดรอบ (เรียบในช่วงราว 0.5 มม. — ลบขั้นพิกเซลและรอยหยัก)
        var q = [];
        for (i = 0; i < m; i++) { var L = pts[(i - 1 + m) % m], C = pts[i], R = pts[(i + 1) % m]; q.push([(L[0] + 2 * C[0] + R[0]) / 4, (L[1] + 2 * C[1] + R[1]) / 4]); }
        pts = q;
    }
    // Douglas-Peucker แบบเส้นปิด: แบ่งที่จุด 0 กับจุดไกลสุด
    var far = 0, fd = -1;
    for (i = 1; i < m; i++) { var d0 = (pts[i][0] - pts[0][0]) * (pts[i][0] - pts[0][0]) + (pts[i][1] - pts[0][1]) * (pts[i][1] - pts[0][1]); if (d0 > fd) { fd = d0; far = i; } }
    function dp(a, b, out) {
        var A = pts[a], B = pts[b % m], dx = B[0] - A[0], dy = B[1] - A[1], len = Math.sqrt(dx * dx + dy * dy) || 1e-9, best = -1, bi = -1;
        for (var x = a + 1; x < b; x++) { var P0 = pts[x % m], dd = Math.abs(dy * (P0[0] - A[0]) - dx * (P0[1] - A[1])) / len; if (dd > best) { best = dd; bi = x; } }
        if (best > tol) { dp(a, bi, out); dp(bi, b, out); } else out.push(A);
    }
    var res = [];
    dp(0, far, res); dp(far, m, res);
    if (res.length < 3) return;
    var N = res.length;
    p.setEntirePath(res);
    var np = p.pathPoints;
    for (i = 0; i < N; i++) {
        var Pm = res[(i - 1 + N) % N], Pn = res[(i + 1) % N], tx = (Pn[0] - Pm[0]) / 6, ty = (Pn[1] - Pm[1]) / 6, Pc = res[i];
        np[i].leftDirection = [Pc[0] - tx, Pc[1] - ty]; np[i].rightDirection = [Pc[0] + tx, Pc[1] + ty];
        try { np[i].pointType = PointType.SMOOTH; } catch (e) {}
    }
    p.closed = true;
}
function st_contourCut(doc, art, offPt, dest, cutColor) {
    var work = art.duplicate(dest, ElementPlacement.PLACEATEND);
    var i, list, traced = false;
    // ตัวหนังสือ → outline
    list = st_findType(work, 'TextFrame', []);
    for (i = 0; i < list.length; i++) list[i].createOutline();
    // มีภาพ → ย่อทั้งชิ้นเป็นภาพ ~150 ppi (พื้นขาว) ก่อน trace — ภาพ Gigapixel ความละเอียดเต็มทำให้ Illustrator ค้าง/เด้ง
    if (st_hasRaster(work)) {
        traced = true;
        var vb = work.visibleBounds, longIn = Math.max(vb[2] - vb[0], vb[1] - vb[3]) * ST_SF / 72;
        var ppi = Math.max(36, Math.min(150, 1500 / Math.max(longIn, 0.1)));
        var ro = new RasterizeOptions();
        ro.resolution = ppi; ro.transparency = false; ro.antiAliasingMethod = AntiAliasingMethod.ARTOPTIMIZED;
        try { ro.padding = P(2); } catch (ep) {}
        var flat = doc.rasterize(work, vb, ro);
        try { work.remove(); } catch (er) {}
        work = flat;
        var pi = work.trace(), to = pi.tracing.tracingOptions;
        to.tracingMode = TracingModeType.TRACINGMODEBLACKANDWHITE;
        to.threshold = 250; to.ignoreWhite = true; to.fills = true; to.strokes = false;
        try { to.pathFidelity = 85; to.cornerFidelity = 75; to.noiseFidelity = 8; } catch (eo) {}
        app.redraw();
        var ex = pi.tracing.expandTracing();
        work = ex || (doc.selection.length ? doc.selection[0] : pi);
    }
    doc.selection = null; work.selected = true;
    app.executeMenuCommand('expandStyle');
    app.executeMenuCommand('outline');
    app.executeMenuCommand('group');
    app.executeMenuCommand('Live Pathfinder Add');
    app.executeMenuCommand('expandStyle');
    var u = doc.selection[0];
    if (Math.abs(offPt) > 0.01) {   // ติดลบ = หดเข้าในงาน
        u.applyEffect('<LiveEffect name="Adobe Offset Path"><Dict data="R mlim 4 R ofst ' + offPt + ' I jntp 0 "/></LiveEffect>');
        doc.selection = null; u.selected = true;
        app.executeMenuCommand('expandStyle');
        app.executeMenuCommand('group');
        app.executeMenuCommand('Live Pathfinder Add');
        app.executeMenuCommand('expandStyle');
        u = doc.selection[0];
    }
    // เก็บเฉพาะเส้นรอบนอก (ตัดรูด้านใน เช่น ช่องในตัว O ทิ้ง)
    var paths = st_collectPaths(u, []), keep = [];
    for (i = 0; i < paths.length; i++) {
        var gb = paths[i].geometricBounds, inner = false;
        for (var j = 0; j < paths.length && !inner; j++) if (i !== j && st_inside(gb, paths[j].geometricBounds)) inner = true;
        if (!inner && Math.abs(paths[i].area) > 1) keep.push(paths[i]);
    }
    if (!keep.length) throw new Error('หาขอบไม่เจอ');
    var cut = dest.groupItems.add();
    for (i = 0; i < keep.length; i++) {
        var c = keep[i].duplicate(cut, ElementPlacement.PLACEATEND);
        if (traced) { try { st_smoothPath(c, P(0.12 * MM)); } catch (esm) {} }   // เส้นจากภาพ → เกลาให้เรียบ ไม่เป็นขั้นบันไดพิกเซล
        st_styleCut(c, cutColor);
    }
    doc.selection = null;
    u.remove();
    try { work.remove(); } catch (e) {}
    return cut;
}

function st_shapeCut(doc, b, o, dest, cutColor) {
    var off = U(o.offsetMM), L = b[0] - off, T = b[1] + off, W = (b[2] - b[0]) + 2 * off, H = (b[1] - b[3]) + 2 * off, p;
    if (o.cutType === 'circle') {
        var d = Math.max(W, H), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        p = dest.pathItems.ellipse(cy + d / 2, cx - d / 2, d, d);
    } else if (o.cutType === 'ellipse') {
        p = dest.pathItems.ellipse(T, L, W, H);
    } else {
        var rr = Math.max(0, Math.min(U(o.radiusMM), W / 2, H / 2));
        p = rr > 0.01 ? dest.pathItems.roundedRectangle(T, L, W, H, rr, rr) : dest.pathItems.rectangle(T, L, W, H);
    }
    st_styleCut(p, cutColor);
    var g = dest.groupItems.add();
    p.move(g, ElementPlacement.PLACEATEND);
    return g;
}

// สร้างแผ่นงาน: o = { cutType, offsetMM, radiusMM, sheetW, sheetH (pt), sheets:[[{d,x,y,r}]] }

// =====================================================================
//  มาร์ค Cutting Master 5 (แกะจากไฟล์ที่ CM5 สร้าง): ตัว L ทึบ K100 overprint · หนา 1 · แขน 15 มม. จากจุดกลาง · ห่างงาน 3 มม.
//  เลเยอร์ reg_1/reg_2/color/margin (ล็อก) เก็บค่าตั้งในชื่อ · Segment Area Type1 = แบ่งช่วงทุก 250 มม. จากล่างขึ้นบน
// =====================================================================
var ST_CM5 = { margin: 3, thick: 1, len: 15, step: 250 };
function st_cm5Names(seg) {
    return ['margin 0.000000 0.000000 0.000000 0.000000', 'color 0 0 0 255 0 0 0 0 255 17.007874', 'reg_2 0.00 0.00 0.00 0.00 25.00 25.00 25.00 25.00',
        'reg_1 ' + (seg ? 7 : 1) + ' 1 3.00 1.00 15.00 250.00 1 2 0 1 0.00'];
}
function st_cm5Clear(doc) {
    for (var i = doc.layers.length - 1; i >= 0; i--) {
        var L = doc.layers[i];
        if (/^(reg_1|reg_2) [\d. ]+$|^color [\d. ]+$|^margin [\d. ]+$/.test(L.name)) { try { L.locked = false; L.remove(); } catch (e) {} }
    }
}
function st_cm5Layers(doc, seg) {
    st_cm5Clear(doc);
    var names = st_cm5Names(seg), out = {}, i;
    for (i = names.length - 1; i >= 0; i--) {            // reg_1 ล่างสุด → margin บนสุด (เหมือน CM5)
        var L = doc.layers.add(); L.name = names[i]; L.zOrder(ZOrderMethod.BRINGTOFRONT);
        try { L.printable = true; L.visible = true; } catch (e) {}
        out[names[i].split(' ')[0]] = L;
    }
    return out;
}
// วาดตัว L ที่จุดกลาง (cx,cy) แขนชี้ออกด้าน sx (−1 ซ้าย / +1 ขวา), sy (−1 ล่าง / +1 บน)
function st_cm5L(layer, cx, cy, sx, sy, col) {
    var l = U(ST_CM5.len), h = U(ST_CM5.thick) / 2;
    var loc = [[-l, h], [h, h], [h, -l], [-h, -l], [-h, -h], [-l, -h]], pts = [];
    for (var i = 0; i < loc.length; i++) pts.push([cx - sx * loc[i][0], cy - sy * loc[i][1]]);
    var p = layer.pathItems.add(); p.setEntirePath(pts); p.closed = true;
    p.filled = true; p.fillColor = col; p.stroked = false;
    try { p.fillOverprint = true; } catch (e) {}
    return p;
}
// b = ขอบงานของแผ่น [L,T,R,B] · ab = artboard ของแผ่น → วาดมาร์ค + ขยาย artboard พอดีมาร์ค
function st_cm5Sheet(doc, layer, ab, b, seg, col) {
    var m = U(ST_CM5.margin), l = U(ST_CM5.len), step = U(ST_CM5.step);
    var xL = b[0] - m, xR = b[2] + m, yB = b[3] - m, yT = b[1] + m, cuts = [yB], y = yB + step;

    // จำนวนช่วง = ปัดเศษ (ความยาว ÷ 25 ซม.) แบบเดียวกับ CM5: เศษไม่ถึงครึ่งช่วงรวมเข้าช่วงบนสุด · เกินครึ่งเป็นช่วงใหม่
    if (seg) { var nSeg = Math.max(1, Math.round((yT - yB) / step)); for (var q = 1; q < nSeg; q++) cuts.push(yB + q * step); }
    cuts.push(yT);
    for (var i = 0; i + 1 < cuts.length; i++) {
        var a = cuts[i], c = cuts[i + 1];
        st_cm5L(layer, xL, a, -1, -1, col); st_cm5L(layer, xR, a, 1, -1, col);
        st_cm5L(layer, xL, c, -1, 1, col); st_cm5L(layer, xR, c, 1, 1, col);
    }
    ab.artboardRect = [xL - l, yT + l, xR + l, yB - l];
    // จุดเริ่มพิกัด = มุมด้านในของมาร์คซ้ายล่าง (แบบ "Align document origin with Registration Marks")
    try { var r = ab.artboardRect, h = U(ST_CM5.thick) / 2; ab.rulerOrigin = [xL + h - r[0], r[1] - (yB + h)]; } catch (e) {}
    return cuts.length - 1;
}
function st_emptyArtboards(doc) {          // index ของ artboard ที่ไม่มีชิ้นงานอยู่ข้างในเลย
    var boxes = [], i;
    (function walk(c) {
        var j;
        for (j = 0; j < c.pageItems.length; j++) { try { var it = c.pageItems[j]; if (!it.hidden) boxes.push(it.visibleBounds); } catch (e) {} }
        for (j = 0; j < c.layers.length; j++) walk(c.layers[j]);
    })({ pageItems: [], layers: doc.layers });
    var out = [];
    for (i = 0; i < doc.artboards.length; i++) {
        var r = doc.artboards[i].artboardRect, used = false;
        for (var k = 0; k < boxes.length && !used; k++) { var b = boxes[k]; if (b[0] < r[2] && b[2] > r[0] && b[3] < r[1] && b[1] > r[3]) used = true; }
        if (!used) out.push(i);
    }
    return out;
}

// บันทึกขั้นล่าสุดลงไฟล์ — ถ้า Illustrator เด้งระหว่างสร้าง จะรู้ว่าค้างที่ขั้นไหน (แผงอ่านตอนเปิดครั้งถัดไป)
function st_bcFile() { var d = new Folder(Folder.userData + '/SignTools'); if (!d.exists) d.create(); return new File(d.fsName + '/laststep.txt'); }
function st_bc(s) { try { var f = st_bcFile(); f.encoding = 'UTF-8'; f.open('w'); f.write((new Date()).toString() + ' | ' + s); f.close(); } catch (e) {} }
function st_bcClear() { try { var f = st_bcFile(); if (f.exists) f.remove(); } catch (e) {} }
function st_lastCrash() { try { var f = st_bcFile(); if (!f.exists) return '{"none":true}'; f.encoding = 'UTF-8'; f.open('r'); var t = f.read(); f.close(); f.remove(); return '{"step":' + st_q(t) + '}'; } catch (e) { return '{"none":true}'; } }
// หาที่ว่างบน canvas ของ Illustrator (16383 pt ≈ 5.78 ม. ต่อด้าน · กึ่งกลางที่ artboard แรก) ให้ artboard ใหม่ขนาด W×H
// ลองตำแหน่งที่อยากได้ก่อน (ต่อขวาของ artboard เดิม) · ไม่พอ → ไล่หาช่องว่างจากบนซ้ายลงมา · ไม่ชนของเดิม (+เผื่อมาร์ค CM5)
function st_freeSpot(doc, W, H, L0, T0, gap) {
    var lim = 8100, pad = U(20) + gap;          // หน่วยสคริปต์ (ไฟล์ Large Canvas ก็จำกัดที่ค่าเดียวกัน)
    var r0 = doc.artboards[0].artboardRect, cx = (r0[0] + r0[2]) / 2, cy = (r0[1] + r0[3]) / 2;
    var minX = cx - lim, maxX = cx + lim, maxY = cy + lim, minY = cy - lim, boxes = [], i;
    for (i = 0; i < doc.artboards.length; i++) boxes.push(doc.artboards[i].artboardRect);
    function ok(L, T) {
        if (L - pad < minX || L + W + pad > maxX || T + pad > maxY || T - H - pad < minY) return false;
        for (var k = 0; k < boxes.length; k++) { var b = boxes[k]; if (L - pad < b[2] && L + W + pad > b[0] && T + pad > b[3] && T - H - pad < b[1]) return false; }
        return true;
    }
    if (ok(L0, T0)) return [L0, T0];
    var step = Math.max(U(50), Math.min(W, H) / 4);
    for (var T = maxY - pad; T - H - pad >= minY; T -= step)
        for (var L = minX + pad; L + W + pad <= maxX; L += step) if (ok(L, T)) return [L, T];
    return null;
}
function st_stkPlace(o) {
    var doc, stage = null, warn = [], step = 'เริ่ม', newABs = [], newLayers = [], newSyms = [], tmp = null;
    try {
        doc = st_doc();
        var sel = st_designs(st_selection(doc));
        if (sel.length !== o.count) return st_err('รายการที่เลือกเปลี่ยนไป — กด "อ่านสติ๊กเกอร์" ใหม่อีกครั้ง');
        step = 'สร้างสวอตช์ CutContour'; st_bc(step);
        var cutColor = new SpotColor(); cutColor.spot = st_cutSwatch(doc); cutColor.tint = 100;
        var dieColor = o.die ? st_spotColor(st_spotSwatch(doc, 'DieCut', [0, 166, 81], [100, 0, 100, 0])) : null;
        try { var pvl = doc.layers.getByName('ตัวอย่างเส้นตัด'); pvl.locked = false; pvl.remove(); } catch (epv) {}
        stage = doc.layers.add(); stage.name = 'ST_staging';
        var units = [], i, k, credit = null, crSym = null;
        if (o.credit) {
            step = 'เตรียมเครดิตร้าน'; st_bc(step);
            credit = st_makeCredit(doc, o.credit, stage);
            if (o.symbol !== false) { try { crSym = doc.symbols.add(credit); newSyms.push(crSym); } catch (ecs) { crSym = null; } }
        }

        // 1) เตรียมชิ้นต้นแบบ: งาน + เส้นตัด
        for (i = 0; i < sel.length; i++) {
            step = 'เตรียมลายที่ ' + (i + 1); st_bc(step);
            var src = sel[i].art, art = src.duplicate(stage, ElementPlacement.PLACEATEND), cut = null;
            // รูปแบบลิงก์ (Linked File) → ฝังในสำเนาก่อน: ทำ Symbol/ก็อปภาพลิงก์หลายร้อยดวงทำให้ Illustrator เด้ง (ต้นฉบับยังเป็นลิงก์เหมือนเดิม)
            var lk = st_findType(art, 'PlacedItem', []);
            if (lk.length) { step = 'ฝังรูปลิงก์ลายที่ ' + (i + 1); st_bc(step); for (k = 0; k < lk.length; k++) { try { lk[k].embed(); } catch (eem) { warn.push((i + 1) + ': ฝังรูปลิงก์ไม่ได้ (' + eem.message + ')'); } } }
            // เส้นตัดที่วาดเอง (ในกลุ่ม + ชิ้นแยก) ไม่ใช่งานพิมพ์ → แยกออกจากงานเสมอ
            var own = st_findCuts(art, []), ext = sel[i].cuts;
            if (o.cutType === 'own') {
                if (!own.length && !ext.length) { warn.push((i + 1) + ': ไม่พบเส้นตัดที่วาดเอง (สวอตช์/เลเยอร์ชื่อ Cut หรือเส้นชมพูไม่มีพื้น) → ใช้สี่เหลี่ยมมุมมนแทน'); }
                else {
                    cut = stage.groupItems.add();
                    for (k = 0; k < own.length; k++) { own[k].move(cut, ElementPlacement.PLACEATEND); }
                    for (k = 0; k < ext.length; k++) { ext[k].duplicate(cut, ElementPlacement.PLACEATEND); }
                    st_styleCut(cut, cutColor);
                }
            } else {
                for (k = own.length - 1; k >= 0; k--) { try { own[k].remove(); } catch (er) {} }
            }
            if (o.cutType === 'own') {
            } else if (o.cutType === 'contour') {
                try { cut = st_contourCut(doc, art, U(o.offsetMM), stage, cutColor); }
                catch (ec) { warn.push((i + 1) + ': ทำไดคัทตามรูปไม่ได้ (' + ec.message + ') → ใช้สี่เหลี่ยมมุมมนแทน'); cut = null; }
            }
            if (!cut) cut = st_shapeCut(doc, art.visibleBounds, (o.cutType === 'own' || o.cutType === 'contour') ? { cutType: 'rect', offsetMM: o.offsetMM, radiusMM: Math.max(o.radiusMM, 2) } : o, stage, cutColor);
            var sym = null;
            // งานมีภาพ (หรือเลือกไว้) → ทำเป็น Symbol: ทุกดวงอ้างภาพชุดเดียว ไฟล์ไม่บวม ไม่ค้าง
            if (o.symbol !== false && (o.symbol === true || st_hasRaster(art))) {
                step = 'สร้าง Symbol ลายที่ ' + (i + 1); st_bc(step);
                try { sym = doc.symbols.add(art); newSyms.push(sym); try { sym.name = 'ST ' + (src.name || ('ลาย ' + (i + 1))) + ' ' + (new Date()).getTime() % 100000; } catch (en) {} }
                catch (es) { sym = null; warn.push((i + 1) + ': ทำ Symbol ไม่ได้ → วางแบบก็อปปกติ'); }
            }
            var die = null;
            if (o.die) {
                step = 'ทำเส้นไดคัทลายที่ ' + (i + 1); st_bc(step);
                try { die = st_dieCut(doc, art, cut, o, stage, dieColor); }
                catch (ed) { warn.push((i + 1) + ': ทำไดคัทตามรูปไม่ได้ (' + ed.message + ') → ใช้สี่เหลี่ยมมุมมน'); die = st_shapeCut(doc, cut.geometricBounds, { cutType: 'rect', offsetMM: o.die.offMM, radiusMM: Math.max(o.die.radMM, 2) }, stage, dieColor); }
            }
            units.push({ art: art, cut: cut, sym: sym, die: die });
        }

        // 2) เลเยอร์ + artboard ต่อแผ่น (วางต่อทางขวาของ artboard เดิม)
        step = 'สร้างเลเยอร์'; st_bc(step);
        var hadPrint = st_hasLayer(doc, 'Print'), hadCut = st_hasLayer(doc, 'Kiss Cut');
        var printL = st_layer(doc, 'Print', false), cutL = st_layer(doc, 'Kiss Cut', true), dieL = null;
        if (!hadPrint) newLayers.push(printL);
        if (!hadCut) newLayers.push(cutL);
        if (o.die) { var hadDie = st_hasLayer(doc, 'DieCut'); dieL = st_layer(doc, 'DieCut', true); if (!hadDie) newLayers.push(dieL); }
        var marksL = null;
        if (o.marks) { var hadMarks = st_hasLayer(doc, 'Marks'); marksL = st_layer(doc, 'Marks', false); if (!hadMarks) newLayers.push(marksL); }
        var right = -Infinity, top0 = 0;
        for (i = 0; i < doc.artboards.length; i++) { var ar = doc.artboards[i].artboardRect; if (ar[2] > right) { right = ar[2]; top0 = ar[1]; } }
        var emptyABs = o.delEmptyAB ? st_emptyArtboards(doc) : [];
        var gapAB = P(40), made = 0, abFirst = doc.artboards.length, cm5L = null, cm5Seg = false, cm5Col = null, cm5N = [];
        for (var s = 0; s < o.sheets.length; s++) {
            var SH = (o.sheetHs && o.sheetHs[s]) || o.sheetH;
            var spot = st_freeSpot(doc, o.sheetW, SH, right + gapAB + s * (o.sheetW + gapAB), top0, gapAB);
            if (!spot) throw new Error('พื้นที่ทำงานของ Illustrator ไม่พอวางแผ่นที่ ' + (s + 1) + ' (กว้างสุด ~5.7 ม.) — ลดขนาดแผ่น หรือแบ่งทำทีละแผ่น / ลบ artboard เก่าที่ไม่ใช้');
            var L = spot[0], T = spot[1];
            step = 'สร้าง artboard แผ่นที่ ' + (s + 1); st_bc(step);
            var ab = doc.artboards.add([L, T, L + o.sheetW, T - SH]);
            newABs.push(ab);
            ab.name = 'Sheet ' + (s + 1);
            if (o.marks) { step = 'ใส่มาร์คแผ่นที่ ' + (s + 1); st_bc(step); st_drawMarks(doc, marksL, L, T, o.sheetW, SH, o.marks); }
            if (o.notes && o.notes[s]) {
                step = 'ใส่ข้อความจำนวนแผ่นที่ ' + (s + 1); st_bc(step);
                var nL = st_layer(doc, 'Slug', true), nt = st_txt(nL, o.notes[s].text, P(9), st_color(doc, [0, 0, 0], [0, 0, 0, 100]));
                nt.name = 'ST จำนวน';
                nt.left = L + o.notes[s].x; nt.top = T - o.notes[s].y + nt.height / 2;
            }
            var list = o.sheets[s], sb = null;
            var grow = function (it) { try { var v = it.visibleBounds; if (!sb) sb = [v[0], v[1], v[2], v[3]]; else { sb[0] = Math.min(sb[0], v[0]); sb[1] = Math.max(sb[1], v[1]); sb[2] = Math.max(sb[2], v[2]); sb[3] = Math.min(sb[3], v[3]); } } catch (eg) {} };
            for (k = 0; k < list.length; k++) {
                step = 'วางดวงที่ ' + (k + 1) + ' แผ่นที่ ' + (s + 1); if (k % 10 === 0) st_bc(step);
                var pl = list[k], u = units[pl.d];
                if (!u) throw new Error('ข้อมูลลายไม่ตรง — กดอ่านสติ๊กเกอร์ใหม่');
                tmp = printL.groupItems.add();
                var a2, c2;
                if (u.sym) { a2 = tmp.symbolItems.add(u.sym); a2.position = u.art.position; }
                else a2 = u.art.duplicate(tmp, ElementPlacement.PLACEATEND);
                c2 = u.cut.duplicate(tmp, ElementPlacement.PLACEATEND);
                var d2 = u.die ? u.die.duplicate(tmp, ElementPlacement.PLACEATEND) : null, cr2 = null;
                if (credit) {
                    if (crSym) cr2 = tmp.symbolItems.add(crSym); else cr2 = credit.duplicate(tmp, ElementPlacement.PLACEATEND);
                    st_putCredit(cr2, (d2 || c2).geometricBounds, o.credit);
                }
                if (pl.r) tmp.rotate(90);
                var cb = (d2 || c2).geometricBounds;
                tmp.translate((L + pl.x) - cb[0], (T - pl.y) - cb[1]);
                grow(a2); grow(c2); if (d2) grow(d2); if (cr2) grow(cr2);
                if (d2 && o.die && o.die.only) { c2.remove(); c2 = null; }   // Die Cut อย่างเดียว: ไม่เก็บเส้น kiss
                else c2.move(cutL, ElementPlacement.PLACEATEND);
                if (d2) d2.move(dieL, ElementPlacement.PLACEATEND);
                a2.move(printL, ElementPlacement.PLACEATEND);
                if (cr2) cr2.move(printL, ElementPlacement.PLACEATEND);
                tmp.remove(); tmp = null;
                made++;
            }
            if (o.cm5 && sb) {
                step = 'ใส่มาร์ค CM5 แผ่นที่ ' + (s + 1); st_bc(step);
                if (!cm5L) {
                    var maxH = 0; for (var q = 0; q < o.sheetHs2.length; q++) maxH = Math.max(maxH, o.sheetHs2[q]);
                    cm5Seg = maxH > U(o.cm5.thrMM || 500);
                    cm5L = st_cm5Layers(doc, cm5Seg);
                    cm5Col = st_color(doc, [0, 0, 0], [0, 0, 0, 100]);
                }
                cm5N.push(st_cm5Sheet(doc, cm5L.reg_1, ab, sb, cm5Seg, cm5Col));
            }
        }
        if (cm5L) { for (var ln in cm5L) { try { cm5L[ln].locked = true; } catch (elk) {} } }
        stage.remove(); stage = null;
        st_orderCutLayers(doc);
        doc.selection = null;
        // ลบ artboard เดิมที่ว่าง (ไม่มีงานอยู่ข้างใน) — งานต้นฉบับยังอยู่ ไม่ถูกลบ
        var removed = 0;
        for (i = emptyABs.length - 1; i >= 0; i--) { try { if (doc.artboards.length > 1) { doc.artboards.remove(emptyABs[i]); removed++; } } catch (er2) {} }
        abFirst -= removed;
        try { doc.artboards.setActiveArtboardIndex(abFirst); } catch (ea) {}
        if (removed) warn.push('ลบ artboard เดิมที่ว่าง ' + removed + ' อัน');
        if (cm5L) warn.push('มาร์ค CM5: ' + (cm5Seg ? 'Segment Area Type1 ทุก 25 ซม. (' + cm5N.join(', ') + ' ช่วง)' : '4 Points Type1') + (o.sheets.length > 1 ? ' · หลายแผ่นในไฟล์เดียว — ลองส่งตัดทีละแผ่นก่อน' : ''));
        st_bcClear();
        var H0 = (o.sheetHs && o.sheetHs[0]) || o.sheetH;
        var mk = o.marks ? ' · มาร์คห่างกัน X ' + Math.round((o.sheetW * ST_SF / MM - 2 * o.marks.insetMM) * 10) / 10 + ' × Y ' + Math.round((H0 * ST_SF / MM - 2 * o.marks.insetMM) * 10) / 10 + ' มม.' : '';
        var sz = ' · แผ่น ' + Math.round(o.sheetW * ST_SF / MM) / 10 + '×' + Math.round(H0 * ST_SF / MM) / 10 + ' ซม.';
        return '{"ok":true,"msg":' + st_q('สร้าง ' + o.sheets.length + ' แผ่น · รวม ' + made + ' ดวง' + sz + mk) + ',"warn":[' +
            (function () { var w = []; for (var x = 0; x < warn.length; x++) w.push(st_q(warn[x])); return w.join(','); })() + ']}';
    } catch (e) {
        // ย้อนกลับ: ลบของที่เพิ่งสร้าง ไม่ให้เหลือแผ่นว่าง
        try { if (tmp) tmp.remove(); } catch (e1) {}
        try { if (stage) stage.remove(); } catch (e2) {}
        for (var r = newABs.length - 1; r >= 0; r--) { try { newABs[r].remove(); } catch (e3) {} }
        for (var q = 0; q < newLayers.length; q++) { try { if (newLayers[q].pageItems.length === 0) newLayers[q].remove(); } catch (e4) {} }
        for (var y = 0; y < newSyms.length; y++) { try { newSyms[y].remove(); } catch (e5) {} }
        st_bcClear();
        return st_err('ขั้น "' + step + '": ' + e.message + (e.line ? ' (บรรทัด ' + e.line + ')' : ''));
    }
}

// =====================================================================
//  Extract: สร้างเส้นตัดจากงานที่เลือกอยู่แล้ว (ไม่ย้ายงาน) — Kiss Cut (สี Spot ชมพู CutContour · เลเยอร์ Kiss Cut · ไม่พิมพ์)
//  + Die Cut เลือกได้: ตามเส้น Kiss / สี่เหลี่ยม / สี่เหลี่ยมมุมมน (ห่างจาก Kiss กี่ มม.) + มาร์ค CM5 รอบงานทั้งหมด
//  o = { kiss:{on, shape:'contour'|'rect'|'round', offMM, radMM}, die:{shape:'none'|'same'|'rect'|'round', offMM, radMM}, marks:{on, thrMM} }
// =====================================================================
function st_extract(o) {
    var doc, stage = null, warn = [], step = 'เริ่ม', newLayers = [], madeK = 0, madeD = 0, i, k;
    try {
        doc = st_doc();
        var sel = st_designs(st_selection(doc));
        if (sel.length > 60) return st_err('เลือกงานได้ไม่เกิน 60 ดวงต่อครั้ง (เลือก ' + sel.length + ') — แบ่งทำเป็นชุดๆ');
        var dieOn = o.die && o.die.shape !== 'none', kissOn = !!(o.kiss && o.kiss.on);
        if (!kissOn && !dieOn) return st_err('ต้องเลือกทำ Kiss Cut หรือ Die Cut อย่างน้อยหนึ่งอย่าง');
        step = 'สร้างสวอตช์'; st_bc(step);
        var cutColor = st_spotColor(st_cutSwatch(doc));
        var dieColor = dieOn ? st_spotColor(st_spotSwatch(doc, 'DieCut', [0, 166, 81], [100, 0, 100, 0])) : null;
        stage = doc.layers.add(); stage.name = 'ST_staging';
        var hadK = st_hasLayer(doc, 'Kiss Cut'), dieName = st_hasLayer(doc, 'Die Cut') ? 'Die Cut' : 'DieCut', hadD = st_hasLayer(doc, dieName);
        var kissL = kissOn ? st_layer(doc, 'Kiss Cut', true) : null, dieL = dieOn ? st_layer(doc, dieName, true) : null;
        if (kissL && !hadK) newLayers.push(kissL);
        if (dieL && !hadD) newLayers.push(dieL);
        var kOff = U(o.kiss.offMM || 0), ub = null, oldCuts = 0;
        for (i = 0; i < sel.length; i++) {
            step = 'ทำเส้นตัดดวงที่ ' + (i + 1) + ' จาก ' + sel.length; st_bc(step);
            var art = sel[i].art, work = null, own = st_findCuts(art, []);
            oldCuts += own.length + sel[i].cuts.length;
            if (own.length) {            // มีเส้นตัดเดิมฝังในกลุ่ม → ทำสำเนาที่ไม่มีเส้นนั้นไว้หาขอบ (ต้นฉบับไม่ถูกแตะ)
                work = art.duplicate(stage, ElementPlacement.PLACEATEND);
                var ow = st_findCuts(work, []);
                for (k = ow.length - 1; k >= 0; k--) { try { ow[k].remove(); } catch (er) {} }
                art = work;
            }
            var cut = null, vb = art.visibleBounds;
            if (o.kiss.shape === 'contour') {
                try { cut = st_contourCut(doc, art, kOff, stage, cutColor); }
                catch (ec) { warn.push((i + 1) + ': ทำเส้นตามรูปไม่ได้ (' + ec.message + ') → ใช้สี่เหลี่ยมมุมมนแทน'); cut = null; }
            }
            if (!cut) cut = st_shapeCut(doc, vb, { cutType: 'rect', offsetMM: o.kiss.offMM || 0, radiusMM: (o.kiss.shape === 'rect' ? 0 : Math.max(o.kiss.radMM || 0, o.kiss.shape === 'contour' ? 2 : 0)) }, stage, cutColor);
            var die = null;
            if (dieOn) {
                step = 'ทำไดคัทดวงที่ ' + (i + 1); st_bc(step);
                var dopt = { cutType: 'contour', offsetMM: o.kiss.offMM || 0, radiusMM: o.kiss.radMM || 0,
                    die: { shape: o.die.shape === 'same' ? 'same' : 'rect', offMM: o.die.offMM || 0, radMM: o.die.shape === 'round' ? (o.die.radMM || 0) : 0 } };
                try { die = st_dieCut(doc, art, cut, dopt, stage, dieColor); }
                catch (ed) { warn.push((i + 1) + ': ทำไดคัทตามเส้นไม่ได้ (' + ed.message + ') → ใช้สี่เหลี่ยมมุมมน'); die = st_shapeCut(doc, cut.geometricBounds, { cutType: 'rect', offsetMM: o.die.offMM || 0, radiusMM: Math.max(o.die.radMM || 0, 2) }, stage, dieColor); }
            }
            var gb = (die || cut).geometricBounds;
            if (!ub) ub = [gb[0], gb[1], gb[2], gb[3]]; else { ub[0] = Math.min(ub[0], gb[0]); ub[1] = Math.max(ub[1], gb[1]); ub[2] = Math.max(ub[2], gb[2]); ub[3] = Math.min(ub[3], gb[3]); }
            if (kissOn) { cut.move(kissL, ElementPlacement.PLACEATEND); madeK++; } else { try { cut.remove(); } catch (e0) {} }
            if (die) { die.move(dieL, ElementPlacement.PLACEATEND); madeD++; }
            if (work) { try { work.remove(); } catch (e1) {} }
        }
        try { stage.remove(); } catch (es) {} stage = null;
        var mkMsg = '';
        if (o.marks && o.marks.on && ub) {
            step = 'ใส่มาร์ค CM5'; st_bc(step);
            var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()];
            var seg = (ub[1] - ub[3]) > U(o.marks.thrMM || 500);
            var cm5L = st_cm5Layers(doc, seg), col = st_color(doc, [0, 0, 0], [0, 0, 0, 100]);
            var nseg = st_cm5Sheet(doc, cm5L.reg_1, ab, ub, seg, col);
            for (var ln in cm5L) { try { cm5L[ln].locked = true; } catch (elk) {} }
            mkMsg = ' · มาร์ค CM5 ' + (seg ? 'Segment ' + nseg + ' ช่วง' : '4 Points') + ' (artboard ปรับให้พอดีมาร์ค)';
        }
        st_orderCutLayers(doc);
        doc.selection = null;
        if (oldCuts) warn.push('งานที่เลือกมีเส้นตัดเดิม ' + oldCuts + ' เส้น — ไม่ได้ลบ (ถ้าไม่ใช้ให้ลบเอง ไม่งั้นจะตัดซ้ำ)');
        st_bcClear();
        return '{"ok":true,"msg":' + st_q('สร้าง Kiss Cut ' + madeK + ' เส้น' + (dieOn ? ' · Die Cut ' + madeD + ' เส้น' : '') + mkMsg) + ',"warn":[' +
            (function () { var w = []; for (var x = 0; x < warn.length; x++) w.push(st_q(warn[x])); return w.join(','); })() + ']}';
    } catch (e) {
        try { if (stage) stage.remove(); } catch (e2) {}
        for (var q = 0; q < newLayers.length; q++) { try { if (newLayers[q].pageItems.length === 0) newLayers[q].remove(); } catch (e3) {} }
        st_bcClear();
        return st_err('ขั้น "' + step + '": ' + e.message + (e.line ? ' (บรรทัด ' + e.line + ')' : ''));
    }
}

// มาร์คอ่านตำแหน่งตัว L 4 มุม (สไตล์ Graphtec ARMS / Mimaki) — วาดในเลเยอร์ Marks
// m = { insetMM: ระยะจากขอบกระดาษถึงมุมมาร์ค, lenMM: ความยาวขา, wMM: ความหนา }
function st_drawMarks(doc, layer, L, T, W, H, m) {
    var ins = U(m.insetMM), len = U(m.lenMM), w = U(m.wMM), col = st_color(doc, [0, 0, 0], [0, 0, 0, 100]);
    var x0 = L + ins, x1 = L + W - ins, y0 = T - ins, y1 = T - H + ins;   // มุมนอกของมาร์คทั้ง 4
    // แต่ละมุม: [มุม x, มุม y, ทิศ x (+1 ขวา/-1 ซ้าย), ทิศ y (+1 ขึ้น/-1 ลง)]
    var corners = [[x0, y0, 1, -1], [x1, y0, -1, -1], [x0, y1, 1, 1], [x1, y1, -1, 1]];
    var g = layer.groupItems.add(); g.name = 'Registration marks';
    for (var i = 0; i < corners.length; i++) {
        var c = corners[i], cx = c[0], cy = c[1], dx = c[2], dy = c[3];
        var p = g.pathItems.add();
        p.setEntirePath([[cx, cy], [cx + dx * len, cy], [cx + dx * len, cy + dy * w], [cx + dx * w, cy + dy * w], [cx + dx * w, cy + dy * len], [cx, cy + dy * len]]);
        p.closed = true; p.stroked = false; p.filled = true; p.fillColor = col;
    }
    return g;
}

// =====================================================================
//  ส่งตัด: อ่านเส้นตัดเป็นพิกัด มม. จริง (y ขึ้น) ให้แผงแปลงเป็นคำสั่ง Graphtec
//  มีของเลือกอยู่ → ใช้ทุกเส้นที่เลือก · ไม่ได้เลือก → เส้นสี CutContour ทั้งหมดใน artboard ที่เปิดอยู่
// =====================================================================
function st_cutCollect(item, out, info) {
    var t = item.typename;
    if (t === 'PathItem') { if (!item.guides && !(item.clipping && !item.stroked)) out.push(item); }
    else if (t === 'CompoundPathItem') { for (var i = 0; i < item.pathItems.length; i++) out.push(item.pathItems[i]); }
    else if (t === 'GroupItem') { for (var j = 0; j < item.pageItems.length; j++) st_cutCollect(item.pageItems[j], out, info); }
    else if (t === 'TextFrame') info.text++;
    else info.other++;
    return out;
}
function st_layerVisible(it) {
    try { var L = it.layer; while (L) { if (!L.visible) return false; L = (L.parent && L.parent.typename === 'Layer') ? L.parent : null; } } catch (e) {}
    return !it.hidden;
}

// มาร์ค CM5: หาเลเยอร์ "reg_1 …" แล้วเก็บชิ้นมาร์คทุกชิ้น (รวมที่อยู่ในกลุ่ม/เลเยอร์ย่อย — ไฟล์เก่าอาจจัดไว้แบบนั้น)
function st_markItems(c, out) {
    var i, n;
    try { n = c.pageItems.length; } catch (e) { n = 0; }
    for (i = 0; i < n; i++) {
        var it = c.pageItems[i], t = it.typename;
        if (t === 'GroupItem') st_markItems(it, out);
        else if (t === 'PathItem' || t === 'CompoundPathItem') { try { if (!it.guides) out.push(it); } catch (e1) { out.push(it); } }
    }
    try { for (i = 0; i < c.layers.length; i++) st_markItems(c.layers[i], out); } catch (e2) {}
    return out;
}
// ผลสแกน: why = ok | nolayer | hidden | empty | outside | few
function st_markScan(doc) {
    var res = { why: 'nolayer', code: 0, name: '', items: [], inAb: [], direct: 0 }, L = null, hid = null, i;
    for (i = 0; i < doc.layers.length; i++) {
        var m = /^reg_1 (\d+) /.exec(doc.layers[i].name);
        if (!m) continue;
        if (doc.layers[i].visible) { L = doc.layers[i]; res.code = parseInt(m[1], 10); break; }
        if (!hid) { hid = doc.layers[i]; res.code = parseInt(m[1], 10); }
    }
    if (!L) { if (hid) { res.why = 'hidden'; res.name = hid.name; } return res; }
    res.name = L.name;
    try { res.direct = L.pathItems.length; } catch (e) {}
    st_markItems(L, res.items);
    if (!res.items.length) { res.why = 'empty'; return res; }
    var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
    for (i = 0; i < res.items.length; i++) {
        var b = res.items[i].geometricBounds, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        if (cx < ab[0] || cx > ab[2] || cy > ab[1] || cy < ab[3]) continue;
        res.inAb.push(res.items[i]);
    }
    res.why = !res.inAb.length ? 'outside' : (res.inAb.length < 4 ? 'few' : 'ok');
    return res;
}
var st_lastMkWhy = '';
// มาร์ค CM5 ใน artboard ที่เปิดอยู่ → จุดกลางมาร์ค (มม.) สำหรับส่งตัดแบบอ่านมาร์ค
function st_cutMarks(doc) {
    try {
        var sc = st_markScan(doc), i, U0 = null;
        st_lastMkWhy = sc.why;
        if (sc.why !== 'ok') return null;
        for (i = 0; i < sc.inAb.length; i++) {
            var b = sc.inAb[i].geometricBounds;
            if (!U0) U0 = [b[0], b[1], b[2], b[3]]; else { U0[0] = Math.min(U0[0], b[0]); U0[1] = Math.max(U0[1], b[1]); U0[2] = Math.max(U0[2], b[2]); U0[3] = Math.min(U0[3], b[3]); }
        }
        var code = sc.code, n = sc.inAb.length;
        var k = ST_SF / MM, len = 15;
        var ox = U0[0] * k + len, oy = U0[3] * k + len, rx = U0[2] * k - len, ty = U0[1] * k - len;
        return '{"style":' + code + ',"seg":' + (code === 7 ? 'true' : 'false') + ',"stepMM":250,"n":' + n + ',"ox":' + ox + ',"oy":' + oy + ',"dx":' + (ty - oy) + ',"dy":' + (rx - ox) + ',"lenMM":' + len + '}';
    } catch (e) { return null; }
}
// ปุ่ม "ตรวจมาร์ค": ส่งจุดมาร์คทุกจุด + artboard (มม. พิกัดเดียวกับเส้นตัด) ไว้วาดพรีวิว พร้อมสาเหตุถ้าอ่านไม่ได้
function st_markCheck() {
    try {
        var doc = st_doc(), sc = st_markScan(doc), k = ST_SF / MM, i, pts = [];
        var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
        for (i = 0; i < sc.items.length; i++) {
            var b = sc.items[i].geometricBounds, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
            var inn = !(cx < ab[0] || cx > ab[2] || cy > ab[1] || cy < ab[3]);
            pts.push('[' + Math.round(cx * k * 100) / 100 + ',' + Math.round(cy * k * 100) / 100 + ',' + (inn ? 1 : 0) + ']');
        }
        return '{"why":"' + sc.why + '","style":' + sc.code + ',"name":"' + sc.name.replace(/"/g, '') + '","total":' + sc.items.length + ',"inAb":' + sc.inAb.length + ',"direct":' + sc.direct +
            ',"ab":[' + [ab[0] * k, ab[1] * k, ab[2] * k, ab[3] * k].join(',') + '],"marks":[' + pts.join(',') + ']}';
    } catch (e) { return st_err(e.message); }
}
function st_cutRead() {
    try {
        var doc = st_doc(), sel = st_selection(doc), paths = [], info = { text: 0, other: 0 }, src, i;
        if (sel.length) {
            for (i = 0; i < sel.length; i++) st_cutCollect(sel[i], paths, info);
            src = 'sel';
        } else {
            var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
            for (i = 0; i < doc.pathItems.length; i++) {
                var p = doc.pathItems[i];
                try {
                    if (!p.stroked || !st_isCutColor(p.strokeColor) || p.guides) continue;
                    if (!st_layerVisible(p)) continue;
                    var b = p.geometricBounds, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
                    if (cx < ab[0] || cx > ab[2] || cy > ab[1] || cy < ab[3]) continue;
                    paths.push(p);
                } catch (e1) {}
            }
            src = 'cut';
        }
        var k = ST_SF / MM, out = [], npts = 0;
        for (i = 0; i < paths.length; i++) {
            var pp = paths[i].pathPoints, pts = [];
            if (pp.length < 2) continue;
            for (var j = 0; j < pp.length; j++) {
                var q = pp[j], a = q.anchor, l = q.leftDirection, r = q.rightDirection;
                pts.push(Math.round(a[0] * k * 1000) / 1000 + ',' + Math.round(a[1] * k * 1000) / 1000 + ',' +
                    Math.round(l[0] * k * 1000) / 1000 + ',' + Math.round(l[1] * k * 1000) / 1000 + ',' +
                    Math.round(r[0] * k * 1000) / 1000 + ',' + Math.round(r[1] * k * 1000) / 1000);
            }
            npts += pp.length;
            var kd = 'kiss'; try { if (paths[i].stroked && paths[i].strokeColor.typename === 'SpotColor' && /die/i.test(paths[i].strokeColor.spot.name)) kd = 'die'; else if (/die/i.test(paths[i].layer.name)) kd = 'die'; } catch (ek) {}
            out.push('{"c":' + (paths[i].closed ? 1 : 0) + ',"k":"' + kd + '","p":[' + pts.join(',') + ']}');
        }
        var mk = st_cutMarks(doc);
        return '{"mkWhy":"' + st_lastMkWhy + '","src":"' + src + '","text":' + info.text + ',"other":' + info.other + ',"n":' + out.length + ',"pts":' + npts + ',"paths":[' + out.join(',') + ']' + (mk ? ',"marks":' + mk : '') + '}';
    } catch (e) { return st_err(e.message); }
}


// =====================================================================
//  ฟอนต์ไทยสำหรับข้อความที่สคริปต์สร้าง (ลายน้ำ / ขอบแผ่น / คำบรรยาย QR)
// =====================================================================
var ST_TF = null;
function st_thaiFont() {
    if (ST_TF) return ST_TF;
    var names = ['Thonburi', 'Tahoma', 'SukhumvitSet-Text', 'Sukhumvit Set', 'LeelawadeeUI', 'Leelawadee', 'Prompt-Regular', 'Kanit-Regular', 'THSarabunNew', 'Ayuthaya'];
    for (var i = 0; i < names.length; i++) { try { ST_TF = app.textFonts.getByName(names[i]); if (ST_TF) return ST_TF; } catch (e) {} }
    return null;
}
function st_txt(parent, s, pt, col) {
    var t = parent.textFrames.add();
    t.contents = s;
    var a = t.textRange.characterAttributes;
    a.size = pt; a.fillColor = col;
    var f = st_thaiFont(); if (f) { try { a.textFont = f; } catch (e) {} }
    return t;
}
function st_mmOf(v) { return Math.round(v * ST_SF / MM * 10) / 10; }

// ข้อมูลเอกสารที่เปิดอยู่ (ชื่อไฟล์, ที่อยู่, artboard)
function st_docInfo() {
    try {
        var doc = st_doc(), path = '', abs = [];
        try { var f0 = doc.fullName; path = (f0 && f0.exists) ? f0.fsName : ''; } catch (e) { path = ''; }
        for (var i = 0; i < doc.artboards.length; i++) {
            var r = doc.artboards[i].artboardRect;
            abs.push('{"i":' + i + ',"name":' + st_q(doc.artboards[i].name) + ',"w":' + st_mmOf(r[2] - r[0]) + ',"h":' + st_mmOf(r[1] - r[3]) + '}');
        }
        return '{"name":' + st_q(doc.name) + ',"path":' + st_q(path) + ',"active":' + doc.artboards.getActiveArtboardIndex() + ',"artboards":[' + abs.join(',') + ']}';
    } catch (e) { return st_err(e.message); }
}
function st_openFile(path) {
    try {
        var f = new File(path);
        if (!f.exists) return st_err('ไม่พบไฟล์: ' + path);
        for (var i = 0; i < app.documents.length; i++) {
            try { if (app.documents[i].fullName.fsName === f.fsName) { app.activeDocument = app.documents[i]; return st_ok('สลับไปที่ไฟล์แล้ว'); } } catch (e1) {}
        }
        app.open(f);
        return st_ok('เปิดไฟล์แล้ว');
    } catch (e) { return st_err(e.message); }
}

// ---------------- ข้อความกำกับขอบแผ่น ----------------
// o = { items:[{i, text}], pt: ขนาดตัวอักษร (pt จริง), offMM: ระยะจากขอบ, pos:'bottom'|'top' }
function st_slug(o) {
    try {
        var doc = st_doc(), L = st_layer(doc, 'Slug', true), col = st_color(doc, [0, 0, 0], [0, 0, 0, 100]), n = 0, i, k;
        var off = U(o.offMM), pt = P(o.pt);
        for (k = 0; k < o.items.length; k++) {
            var it = o.items[k];
            if (it.i < 0 || it.i >= doc.artboards.length) continue;
            var ab = doc.artboards[it.i].artboardRect, tag = 'ST slug ' + it.i;
            for (i = L.textFrames.length - 1; i >= 0; i--) { if (L.textFrames[i].name === tag) L.textFrames[i].remove(); }
            var t = st_txt(L, it.text, pt, col);
            t.name = tag;
            t.left = ab[0] + off;
            t.top = o.pos === 'top' ? ab[1] - off : ab[3] + off + t.height;
            n++;
        }
        return st_ok('ใส่ข้อความขอบแผ่น ' + n + ' artboard (เลเยอร์ Slug) · กดซ้ำได้ ข้อความเดิมจะถูกแทนที่');
    } catch (e) { return st_err(e.message); }
}

// ---------------- ภาพตัวอย่างให้ลูกค้า (JPG + ลายน้ำ) ----------------
// o = { which:'active'|'all', text, opacity(0-100), px (ด้านยาว), size:bool, sizeText:[..ต่อ artboard], open:bool }
function st_preview(o) {
    var doc, wl = null, keep = 0, undoC = null;
    try {
        doc = st_doc(); keep = doc.artboards.getActiveArtboardIndex();
        var base = doc.name.replace(/\.[^.]+$/, ''), folder;
        try { var f0 = doc.fullName; folder = (f0 && f0.exists) ? f0.parent : null; } catch (e0) { folder = null; }
        if (!folder) folder = Folder.desktop;
        var out = new Folder(folder.fsName + '/ตัวอย่างลูกค้า');
        if (!out.exists) out.create();
        var list = [], i;
        if (o.which === 'all') { for (i = 0; i < doc.artboards.length; i++) list.push(i); } else list.push(keep);
        var files = [];
        undoC = st_hideCuts(doc);
        for (var n = 0; n < list.length; n++) {
            var ai = list[n], ab = doc.artboards[ai].artboardRect, W = ab[2] - ab[0], H = ab[1] - ab[3];
            wl = doc.layers.add(); wl.name = 'ST_watermark';
            var g = wl.groupItems.add(), gray = st_color(doc, [110, 110, 110], [0, 0, 0, 60]);
            if (o.text) {
                var big = Math.max(W, H), fs = big / 14, step = big / 3.2, cnt = 0;
                for (var y = ab[3] - step; y < ab[1] + step && cnt < 60; y += step * 0.55) {
                    for (var x = ab[0] - step; x < ab[2] + step && cnt < 60; x += step) {
                        var t = st_txt(g, o.text, fs, gray);
                        t.rotate(30);
                        t.left = x + ((Math.round((y - ab[3]) / (step * 0.55)) % 2) ? step / 2 : 0); t.top = y;
                        cnt++;
                    }
                }
                g.opacity = Math.max(5, Math.min(100, o.opacity));
            }
            if (o.size && o.sizeText && o.sizeText[ai]) {
                var g2 = wl.groupItems.add(), lbl = st_txt(g2, o.sizeText[ai], Math.max(W, H) / 40, st_color(doc, [255, 255, 255], [0, 0, 0, 0]));
                var pad = lbl.height * 0.35, bx = ab[2] - lbl.width - pad * 3, by = ab[3] + lbl.height + pad * 3;
                var bg = g2.pathItems.rectangle(by + pad, bx - pad, lbl.width + pad * 2, lbl.height + pad * 2);
                bg.stroked = false; bg.filled = true; bg.fillColor = st_color(doc, [30, 35, 51], [0, 0, 0, 90]); bg.opacity = 80;
                bg.zOrder(ZOrderMethod.SENDTOBACK);
                lbl.left = bx; lbl.top = by;
            }
            doc.artboards.setActiveArtboardIndex(ai);
            var opt = new ExportOptionsJPEG();
            var sc = Math.max(1, Math.min(776, o.px / Math.max(W, H) * 100));
            opt.artBoardClipping = true; opt.antiAliasing = true; opt.qualitySetting = 85;
            opt.horizontalScale = sc; opt.verticalScale = sc;
            var name = base + '_ตัวอย่าง' + (list.length > 1 ? '_' + (ai + 1) : '') + '.jpg';
            var f = new File(out.fsName + '/' + name);
            doc.exportFile(f, ExportType.JPEG, opt);
            wl.remove(); wl = null;
            files.push(st_q(f.fsName));
        }
        st_restoreCuts(undoC); undoC = null;
        doc.artboards.setActiveArtboardIndex(keep);
        if (o.open) { try { out.execute(); } catch (e2) {} }
        return '{"ok":true,"msg":' + st_q('บันทึก ' + files.length + ' ภาพที่โฟลเดอร์ "ตัวอย่างลูกค้า"') + ',"folder":' + st_q(out.fsName) + ',"files":[' + files.join(',') + ']}';
    } catch (e) {
        try { if (wl) wl.remove(); } catch (e3) {}
        st_restoreCuts(undoC);
        try { doc.artboards.setActiveArtboardIndex(keep); } catch (e4) {}
        return st_err(e.message + (e.line ? ' (บรรทัด ' + e.line + ')' : ''));
    }
}

// เลือกไฟล์ (โลโก้เครดิตร้าน)
function st_pickFile(title) {
    try {
        var f = File.openDialog(title || 'เลือกไฟล์');
        if (!f) return '{"cancel":true}';
        return '{"ok":true,"path":' + st_q(f.fsName) + ',"name":' + st_q(decodeURI(f.name)) + '}';
    } catch (e) { return st_err(e.message); }
}

// =====================================================================
//  แยกสีงานตัด (สติ๊กเกอร์ตัดหลายสี) — 1 สี = 1 เลเยอร์ + มาร์คจัดตำแหน่ง + กรอบลอก
// =====================================================================
function st_r1(v) { return Math.round(v * 10) / 10; }
function st_colKey(c) {
    try {
        var t = c.typename;
        if (t === 'RGBColor') return 'rgb:' + Math.round(c.red) + ',' + Math.round(c.green) + ',' + Math.round(c.blue);
        if (t === 'CMYKColor') return 'cmyk:' + st_r1(c.cyan) + ',' + st_r1(c.magenta) + ',' + st_r1(c.yellow) + ',' + st_r1(c.black);
        if (t === 'GrayColor') return 'gray:' + st_r1(c.gray);
        if (t === 'SpotColor') return 'spot:' + c.spot.name + ':' + st_r1(c.tint);
        if (t === 'GradientColor') return 'grad:' + c.gradient.name;
        if (t === 'PatternColor') return 'pat:' + c.pattern.name;
    } catch (e) {}
    return null;
}
function st_colName(c) {
    try {
        var t = c.typename;
        if (t === 'SpotColor') { var nm = c.spot.name; if (nm && !/unnamed|ไม่มีชื่อ|^\[/i.test(nm)) return nm; var hx = st_colorHex(c); return hx ? hx.toUpperCase() : nm; }
        if (t === 'CMYKColor') return 'C' + Math.round(c.cyan) + ' M' + Math.round(c.magenta) + ' Y' + Math.round(c.yellow) + ' K' + Math.round(c.black);
        if (t === 'GradientColor') return 'ไล่สี ' + c.gradient.name;
        if (t === 'PatternColor') return 'ลาย ' + c.pattern.name;
        var h = st_colorHex(c); return h ? h.toUpperCase() : '?';
    } catch (e) { return '?'; }
}
function st_isWhiteKey(k) { return k === 'rgb:255,255,255' || k === 'cmyk:0,0,0,0' || k === 'gray:0'; }
// สีของชิ้น (พื้นก่อน ไม่มีพื้นใช้เส้น)
function st_shapeColor(it) {
    var p = it.typename === 'CompoundPathItem' ? (it.pathItems.length ? it.pathItems[0] : null) : it;
    if (!p) return null;
    try { if (p.filled) return p.fillColor; } catch (e) {}
    try { if (p.stroked && p.strokeWidth > 0) return p.strokeColor; } catch (e2) {}
    return null;
}
function st_leafShapes(item, out, info) {
    var t = item.typename;
    if (t === 'PathItem') { if (!item.guides && !(item.clipping)) out.push(item); }
    else if (t === 'CompoundPathItem') out.push(item);
    else if (t === 'GroupItem') { for (var i = 0; i < item.pageItems.length; i++) st_leafShapes(item.pageItems[i], out, info); }
    else if (t === 'TextFrame') info.text++;
    else if (t === 'RasterItem' || t === 'PlacedItem') info.raster++;
    else info.other++;
    return out;
}
function st_sepCollect(sel) {
    var shapes = [], info = { text: 0, raster: 0, other: 0 }, map = {}, list = [], i;
    for (i = 0; i < sel.length; i++) st_leafShapes(sel[i], shapes, info);
    for (i = 0; i < shapes.length; i++) {
        var c = st_shapeColor(shapes[i]), k = c ? st_colKey(c) : null;
        if (!k) continue;
        if (!map[k]) { map[k] = { key: k, name: st_colName(c), hex: st_colorHex(c) || '#888888', n: 0, items: [], grad: /^(grad|pat):/.test(k) }; list.push(map[k]); }
        map[k].n++; map[k].items.push(shapes[i]);
    }
    return { list: list, info: info };
}
function st_sepRead() {
    try {
        var doc = st_doc(), sel = st_selection(doc);
        if (!sel.length) return st_err('เลือกงานตัดที่จะแยกสีก่อน');
        var r = st_sepCollect(sel), out = [];
        for (var i = 0; i < r.list.length; i++) {
            var c = r.list[i];
            out.push('{"key":' + st_q(c.key) + ',"name":' + st_q(c.name) + ',"hex":' + st_q(c.hex) + ',"n":' + c.n + ',"white":' + (st_isWhiteKey(c.key) ? 'true' : 'false') + ',"grad":' + (c.grad ? 'true' : 'false') + '}');
        }
        return '{"colors":[' + out.join(',') + '],"text":' + r.info.text + ',"raster":' + r.info.raster + '}';
    } catch (e) { return st_err(e.message); }
}
function st_sepMenu(cmd) { try { app.executeMenuCommand(cmd); return true; } catch (e) { return false; } }
function st_sepUnite(doc, items) {          // รวมชิ้นสีเดียวกันเป็นรูปเดียว
    if (items.length < 2) return items;
    doc.selection = null;
    for (var i = 0; i < items.length; i++) items[i].selected = true;
    st_sepMenu('group'); st_sepMenu('Live Pathfinder Add'); st_sepMenu('expandStyle');
    var out = [];
    for (var j = 0; j < doc.selection.length; j++) st_leafShapes(doc.selection[j], out, { text: 0, raster: 0, other: 0 });
    return out.length ? out : items;
}
// o = { mode:'knock'|'stack', layout:'side'|'place', exclude:[keys], marks:{lenMM,offMM}|null, weed:{padMM}|null, gapMM }
function st_selAll(doc, L) { doc.selection = null; for (var i = 0; i < L.pageItems.length; i++) { try { L.pageItems[i].selected = true; } catch (e) {} } }
function st_sepRun(o) {
    var doc, tmp = null, baseLayer = null, baseColor = null, baseName = '', baseHex = '', step = 'เริ่ม', made = [];
    try {
        doc = st_doc();
        var sel = st_selection(doc);
        if (!sel.length) return st_err('เลือกงานตัดที่จะแยกสีก่อน');
        var warn = [], i, k;
        var B = st_unionBounds(sel), W = B[2] - B[0];
        step = 'เตรียมงาน';
        tmp = doc.layers.add(); tmp.name = 'ST_sep_tmp';
        var work = tmp.groupItems.add();
        for (i = sel.length - 1; i >= 0; i--) sel[i].duplicate(work, ElementPlacement.PLACEATBEGINNING);
        var tf = st_findType(work, 'TextFrame', []);
        for (i = 0; i < tf.length; i++) { try { tf[i].createOutline(); } catch (et) {} }
        var rs = st_findType(work, 'RasterItem', []).concat(st_findType(work, 'PlacedItem', []));
        if (rs.length) warn.push('ข้ามรูปภาพ ' + rs.length + ' ชิ้น (ตัดไม่ได้)');
        for (i = 0; i < rs.length; i++) { try { rs[i].remove(); } catch (er) {} }
        // คลิปปิ้งมาสก์ → ตัดส่วนที่ซ่อนทิ้งจริง (Pathfinder Crop) ไม่ให้ส่วนที่มองไม่เห็นถูกตัดด้วย
        step = 'ตัดส่วนเกินคลิปปิ้งมาสก์';
        var clips = [];
        (function findClip(g) { for (var a = 0; a < g.groupItems.length; a++) { findClip(g.groupItems[a]); if (g.groupItems[a].clipped) clips.push(g.groupItems[a]); } })(work);
        for (i = 0; i < clips.length; i++) {
            try { doc.selection = null; clips[i].selected = true; st_sepMenu('expandStyle'); st_sepMenu('OffsetPath v22'); st_sepMenu('Live Pathfinder Crop'); st_sepMenu('expandStyle'); }
            catch (ec) { warn.push('คลิปปิ้งมาสก์ ' + (i + 1) + ' ตัดส่วนเกินไม่ได้'); }
        }
        st_selAll(doc, tmp);
        step = 'แปลงเส้นขอบเป็นพื้น';
        st_sepMenu('expandStyle');
        st_sepMenu('OffsetPath v22');          // Outline Stroke
        // โหมดพื้นเต็ม: สีพื้น = เงารวมของงานทั้งชิ้น (รวมทุกสี) ไว้รองใต้สีอื่น
        var baseShapes = null;
        if (o.mode === 'base' && o.base) {
            step = 'ทำพื้นเต็มรูป';
            var bl = doc.layers.add(); bl.name = 'ST_sep_base';
            for (i = 0; i < tmp.pageItems.length; i++) tmp.pageItems[i].duplicate(bl, ElementPlacement.PLACEATEND);
            var exb = {}; for (i = 0; i < (o.exclude || []).length; i++) exb[o.exclude[i]] = true;
            var bls = []; for (i = 0; i < bl.pageItems.length; i++) st_leafShapes(bl.pageItems[i], bls, { text: 0, raster: 0, other: 0 });
            for (i = bls.length - 1; i >= 0; i--) {
                var bcol = st_shapeColor(bls[i]), bk = bcol ? st_colKey(bcol) : null;
                if (bk === o.base && !baseColor) { baseColor = bcol; baseName = st_colName(bcol); baseHex = st_colorHex(bcol) || '#888888'; }
                if (bk && exb[bk]) { try { bls[i].remove(); } catch (ex1) {} }
            }
            if (!baseColor) throw new Error('ไม่พบสีพื้นที่เลือกในงาน');
            if (!bl.pageItems.length) throw new Error('ไม่มีชิ้นงานสำหรับทำพื้น');
            st_selAll(doc, bl);
            st_sepMenu('group'); st_sepMenu('Live Pathfinder Add'); st_sepMenu('expandStyle');
            baseShapes = []; var tb = []; for (i = 0; i < bl.pageItems.length; i++) tb.push(bl.pageItems[i]);
            for (i = 0; i < tb.length; i++) st_leafShapes(tb[i], baseShapes, { text: 0, raster: 0, other: 0 });
            baseLayer = bl;
        }
        if (o.mode === 'knock' || o.mode === 'base') {
            step = 'ตัดส่วนที่ซ้อนกันออก (Pathfinder Merge)';
            st_selAll(doc, tmp);
            if (!st_sepMenu('Live Pathfinder Merge')) throw new Error('Pathfinder Merge ไม่ทำงาน');
            st_sepMenu('expandStyle');
        }
        step = 'จัดกลุ่มตามสี';
        var tops = []; for (i = 0; i < tmp.pageItems.length; i++) tops.push(tmp.pageItems[i]);
        var r = st_sepCollect(tops), colors = [], ex = {};
        for (i = 0; i < (o.exclude || []).length; i++) ex[o.exclude[i]] = true;
        for (i = 0; i < r.list.length; i++) { if (!ex[r.list[i].key] && !(baseShapes && r.list[i].key === o.base)) colors.push(r.list[i]); }
        if (baseShapes) {      // ใส่สีพื้นเป็นชั้นแรก (ล่างสุด) — สีให้ตรงกับที่เลือก
            var fc = baseColor;
            for (i = 0; i < baseShapes.length; i++) { try { var bp = baseShapes[i].typename === 'CompoundPathItem' ? baseShapes[i].pathItems : [baseShapes[i]]; for (var z = 0; z < bp.length; z++) { bp[z].filled = true; bp[z].fillColor = fc; bp[z].stroked = false; } } catch (ef) {} }
            colors.unshift({ key: o.base, name: baseName + ' (พื้น)', hex: baseHex, n: baseShapes.length, items: baseShapes, grad: /^(grad|pat):/.test(o.base) });
        }
        if (!colors.length) throw new Error('ไม่มีสีให้แยก (ทุกสีถูกเอาออก)');
        var black = st_color(doc, [0, 0, 0], [0, 0, 0, 100]);
        var mk = o.marks, len = mk ? U(mk.lenMM) : 0, moff = mk ? U(mk.offMM) : 0, pad = o.weed ? U(o.weed.padMM) : 0;
        var boxL = B[0] - (mk ? moff + len : 0) - pad, boxR = B[2] + (mk ? moff + len : 0) + pad, boxW = boxR - boxL;
        var gap = U(o.gapMM || 20);
        var midY = (B[1] + B[3]) / 2;
        var labL = null;
        for (k = 0; k < colors.length; k++) {
            var c = colors[k];
            step = 'สร้างเลเยอร์สี ' + (k + 1) + ' (' + c.name + ')';
            if (c.grad) warn.push(c.name + ': สีไล่/ลาย ตัดเป็นสีเดียว');
            var L = doc.layers.add(); L.name = 'สี ' + (k + 1) + ' · ' + c.name; made.push(L);
            var g = L.groupItems.add(); g.name = 'แยกสี ' + c.name;
            var items = c.items;
            if (o.mode === 'stack') items = st_sepUnite(doc, items);
            for (i = 0; i < items.length; i++) items[i].move(g, ElementPlacement.PLACEATEND);
            if (mk) {
                var pts = [[B[0] - moff - len / 2, midY], [B[2] + moff + len / 2, midY]];
                for (i = 0; i < pts.length; i++) {
                    var px = pts[i][0], py = pts[i][1];
                    st_line(g, [[px - len / 2, py], [px + len / 2, py]], black, P(0.5)).name = 'มาร์ค';
                    st_line(g, [[px, py - len / 2], [px, py + len / 2]], black, P(0.5)).name = 'มาร์ค';
                }
            }
            if (o.weed) {
                var wb = g.pathItems.rectangle(B[1] + pad, boxL, boxW, (B[1] - B[3]) + 2 * pad);
                wb.filled = false; wb.stroked = true; wb.strokeColor = black; wb.strokeWidth = P(0.5); wb.name = 'กรอบลอก';
            }
            var dx = o.layout === 'side' ? (B[2] + gap - boxL) + k * (boxW + gap) : 0;
            if (dx) g.translate(dx, 0);
            if (o.layout === 'side' && o.label) {
                if (!labL) { labL = doc.layers.add(); labL.name = 'ป้ายชื่อสี (ไม่ตัด)'; made.push(labL); }
                var t = st_txt(labL, 'สี ' + (k + 1) + '/' + colors.length + ' · ' + c.name + ' · ' + c.n + ' ชิ้น', P(10), black);
                t.left = boxL + dx; t.top = B[3] - pad - P(6);
            }
        }
        step = 'เก็บกวาด';
        tmp.remove(); tmp = null;
        if (baseLayer) { try { baseLayer.remove(); } catch (eb) {} baseLayer = null; }
        if (labL) { try { labL.printable = false; labL.zOrder(ZOrderMethod.BRINGTOFRONT); } catch (el) {} }
        doc.selection = null;
        return '{"ok":true,"msg":' + st_q('แยกได้ ' + colors.length + ' สี · ' + colors.length + ' เลเยอร์') + ',"warn":[' +
            (function () { var w = []; for (var x = 0; x < warn.length; x++) w.push(st_q(warn[x])); return w.join(','); })() + ']}';
    } catch (e) {
        try { if (tmp) tmp.remove(); } catch (e1) {}
        try { if (baseLayer) baseLayer.remove(); } catch (e3) {}
        for (var q = made.length - 1; q >= 0; q--) { try { made[q].remove(); } catch (e2) {} }
        return st_err('ขั้น "' + step + '": ' + e.message + (e.line ? ' (บรรทัด ' + e.line + ')' : ''));
    }
}

// =====================================================================
//  ทำเงา / ขอบ (Drop · Box · Perspective · Cast · Edge) — ผลเป็นเวกเตอร์ตัดได้ วางใต้งาน
// =====================================================================
function st_shMenu(cmd) { try { app.executeMenuCommand(cmd); return true; } catch (e) { return false; } }
function st_shTop(doc) { return doc.selection && doc.selection.length ? doc.selection[0] : null; }
// เงารวมของงาน: ตัวหนังสือ→เส้น · เส้นขอบ→พื้น · คลิปมาสก์ตัดส่วนเกิน · รวมเป็นรูปเดียว (รูในตัวอักษรยังอยู่)
function st_shSil(doc, sel, L, warn) {
    var g = L.groupItems.add(), i;
    for (i = sel.length - 1; i >= 0; i--) sel[i].duplicate(g, ElementPlacement.PLACEATBEGINNING);
    var tf = st_findType(g, 'TextFrame', []);
    for (i = 0; i < tf.length; i++) { try { tf[i].createOutline(); } catch (et) {} }
    var rs = st_findType(g, 'RasterItem', []).concat(st_findType(g, 'PlacedItem', []));
    if (rs.length) warn.push('ข้ามรูปภาพ ' + rs.length + ' ชิ้น (ทำเงาได้เฉพาะเวกเตอร์/ตัวหนังสือ)');
    for (i = 0; i < rs.length; i++) { try { rs[i].remove(); } catch (er) {} }
    var clips = [];
    (function findClip(x) { for (var a = 0; a < x.groupItems.length; a++) { findClip(x.groupItems[a]); if (x.groupItems[a].clipped) clips.push(x.groupItems[a]); } })(g);
    for (i = 0; i < clips.length; i++) { doc.selection = null; clips[i].selected = true; st_shMenu('expandStyle'); st_shMenu('OffsetPath v22'); st_shMenu('Live Pathfinder Crop'); st_shMenu('expandStyle'); }
    st_selAll(doc, L);
    st_shMenu('expandStyle'); st_shMenu('OffsetPath v22');
    st_selAll(doc, L);
    st_shMenu('group'); st_shMenu('Live Pathfinder Add'); st_shMenu('expandStyle');
    var u = st_shTop(doc);
    if (!u || !st_collectPaths(u, []).length) throw new Error('ไม่พบรูปทรงในงานที่เลือก');
    return u;
}
function st_shUnite(doc, items) {
    doc.selection = null;
    for (var i = 0; i < items.length; i++) items[i].selected = true;
    st_shMenu('group'); st_shMenu('Live Pathfinder Add'); st_shMenu('expandStyle');
    return st_shTop(doc);
}
function st_shMap(item, T) {                 // ย้ายทุกจุด (anchor + มือจับ) ด้วยฟังก์ชัน T — ใช้ได้กับการแปลงแบบ affine ทุกแบบ
    var ps = st_collectPaths(item, []);
    for (var i = 0; i < ps.length; i++) {
        var pp = ps[i].pathPoints;
        for (var j = 0; j < pp.length; j++) {
            var q = pp[j], a = T(q.anchor), l = T(q.leftDirection), r = T(q.rightDirection);
            q.anchor = a; q.leftDirection = l; q.rightDirection = r;
        }
    }
}
function st_shFill(item, col) {
    var ps = st_collectPaths(item, []);
    for (var i = 0; i < ps.length; i++) { ps[i].filled = true; ps[i].fillColor = col; ps[i].stroked = false; }
}
function st_shBz(p, t) {
    var u = 1 - t;
    return [u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0],
            u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1]];
}
function st_shSplit(p, t) {
    function m(a, b) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
    var a = m(p[0], p[1]), b = m(p[1], p[2]), c = m(p[2], p[3]), d = m(a, b), e = m(b, c), f = m(d, e);
    return [[p[0], a, d, f], [f, e, c, p[3]]];
}
// แถบกวาด: ส่วนโค้งแต่ละช่วง + ตัวมันหลังแปลง T + เส้นตรงเชื่อมปลาย → รวมกับรูปต้น/รูปปลาย = รูปทรงยื่น (extrude) แบบแม่น
function st_shRibbons(doc, sil, T, G) {
    var ps = st_collectPaths(sil, []), n = 0, eps = 1e-6;
    function cr(u, d) { return u[0] * d[1] - u[1] * d[0]; }
    function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
    for (var i = 0; i < ps.length; i++) {
        var pp = ps[i].pathPoints, cnt = pp.length;
        for (var j = 0; j < cnt; j++) {
            if (j === cnt - 1 && !ps[i].closed) break;
            var A = pp[j], B = pp[(j + 1) % cnt];
            var seg = [A.anchor, A.rightDirection, B.leftDirection, B.anchor];
            var mid = st_shBz(seg, 0.5), tm = T(mid), d = sub(tm, mid);
            if (Math.abs(d[0]) + Math.abs(d[1]) < 1e-4) continue;
            // แบ่งช่วงตรงจุดที่เส้นสัมผัสขนานกับทิศยื่น → แต่ละชิ้นเป็นแถบไม่บิด
            var fa = cr(sub(seg[1], seg[0]), d), fb = cr(sub(seg[2], seg[1]), d), fc = cr(sub(seg[3], seg[2]), d);
            var qa = fa - 2 * fb + fc, qb = 2 * (fb - fa), qc = fa, ts = [];
            if (Math.abs(qa) < eps) { if (Math.abs(qb) > eps) ts.push(-qc / qb); }
            else { var disc = qb * qb - 4 * qa * qc; if (disc >= 0) { var sq = Math.sqrt(disc); ts.push((-qb - sq) / (2 * qa)); ts.push((-qb + sq) / (2 * qa)); } }
            var tt = [];
            for (var k = 0; k < ts.length; k++) if (ts[k] > 0.001 && ts[k] < 0.999) tt.push(ts[k]);
            tt.sort(function (x, y) { return x - y; });
            var pieces = [], rest = seg, done = 0;
            for (k = 0; k < tt.length; k++) { var two = st_shSplit(rest, (tt[k] - done) / (1 - done)); pieces.push(two[0]); rest = two[1]; done = tt[k]; }
            pieces.push(rest);
            for (k = 0; k < pieces.length; k++) {
                var s = pieces[k], s3 = T(s[3]), s0 = T(s[0]);
                if (Math.abs(s[0][0] - s[3][0]) + Math.abs(s[0][1] - s[3][1]) < 1e-3) continue;
                var r = G.pathItems.add();
                r.setEntirePath([s[0], s[3], s3, s0]);
                var q = r.pathPoints;
                q[0].leftDirection = s[0]; q[0].rightDirection = s[1];
                q[1].leftDirection = s[2]; q[1].rightDirection = s[3];
                q[2].leftDirection = s3; q[2].rightDirection = T(s[2]);
                q[3].leftDirection = T(s[1]); q[3].rightDirection = s0;
                r.closed = true; r.filled = true; r.stroked = false;
                n++;
            }
        }
    }
    return n;
}
function st_shOffset(doc, item, mm, join) {   // ขยาย/หดรูปทรง แล้วรวมให้เป็นรูปเดียว
    item.applyEffect('<LiveEffect name="Adobe Offset Path"><Dict data="R mlim 4 R ofst ' + U(mm) + ' I jntp ' + (join === 'miter' ? 2 : 0) + ' "/></LiveEffect>');
    doc.selection = null; item.selected = true;
    st_shMenu('expandStyle');
    return st_shUnite(doc, [st_shTop(doc)]);
}
function st_shFillHoles(doc, item) {         // ปิดรูด้านใน (ช่องในตัว O, A, ก)
    var paths = st_collectPaths(item, []), G = item.parent.groupItems.add(), i;
    for (i = 0; i < paths.length; i++) {
        var gb = paths[i].geometricBounds, inner = false;
        for (var j = 0; j < paths.length && !inner; j++) if (i !== j && st_inside(gb, paths[j].geometricBounds)) inner = true;
        if (!inner && Math.abs(paths[i].area) > 0.01) { var c = paths[i].duplicate(G, ElementPlacement.PLACEATEND); c.filled = true; }
    }
    item.remove();
    return G.pageItems.length > 1 ? st_shUnite(doc, [G]) : G;
}
// o = { type, dxMM, dyMM (ลง = +), scale (%) , angle (°), len (%), widthMM, join, holes, knock, gapMM, rgb, cmyk, layer }
function st_shadow(o) {
    var doc, L = null, step = 'เริ่ม', junk = [];
    try {
        doc = st_doc();
        var sel = st_selection(doc), warn = [], i;
        if (!sel.length) return st_err('เลือกตัวหนังสือหรืองานที่จะทำเงาก่อน');
        var anchor = sel[sel.length - 1];
        step = 'เตรียมงาน';
        L = doc.layers.add(); L.name = 'ST_shadow_tmp';
        var sil = st_shSil(doc, sel, L, warn), res, t = o.type, n = 0;
        var B = sil.geometricBounds, cx = (B[0] + B[2]) / 2, cy = (B[1] + B[3]) / 2, y0 = B[3];
        var dx = U(o.dxMM || 0), dy = -U(o.dyMM || 0);
        step = 'สร้างเงา';
        if (t === 'drop') {
            if (!dx && !dy) throw new Error('ใส่ระยะเลื่อนเงาก่อน');
            res = sil.duplicate(L, ElementPlacement.PLACEATEND);
            st_shMap(res, function (p) { return [p[0] + dx, p[1] + dy]; });
        } else if (t === 'box' || t === 'persp') {
            var s = t === 'persp' ? Math.max(0.05, Math.min(3, (o.scale || 70) / 100)) : 1;
            if (!dx && !dy && s === 1) throw new Error('ใส่ระยะยื่นของเงาก่อน');
            var T = function (p) { return [cx + s * (p[0] - cx) + dx, cy + s * (p[1] - cy) + dy]; };
            var G = L.groupItems.add();
            sil.duplicate(G, ElementPlacement.PLACEATEND);
            var far = sil.duplicate(G, ElementPlacement.PLACEATEND); st_shMap(far, T);
            n = st_shRibbons(doc, sil, T, G);
            if (n > 6000) warn.push('งานซับซ้อนมาก (' + n + ' ช่วง) อาจใช้เวลานาน');
            step = 'รวมรูปทรงเงา';
            res = st_shUnite(doc, [G]);
        } else if (t === 'cast') {
            var h = (o.len == null ? 80 : o.len) / 100, an = (o.angle == null ? 30 : o.angle) * Math.PI / 180;
            var kx = h * Math.cos(an), ky = h * Math.sin(an);
            if (Math.abs(ky) < 0.01) ky = ky < 0 ? -0.01 : 0.01;
            res = sil.duplicate(L, ElementPlacement.PLACEATEND);
            st_shMap(res, function (p) { var e = p[1] - y0; return [p[0] + e * kx, y0 + e * ky]; });
        } else if (t === 'edge') {
            if (!(o.widthMM > 0)) throw new Error('ใส่ความหนาขอบก่อน');
            res = sil.duplicate(L, ElementPlacement.PLACEATEND);
            doc.selection = null; res.selected = true;
            step = 'ขยายขอบ';
            res = st_shOffset(doc, res, o.widthMM, o.join);
        } else throw new Error('ไม่รู้จักแบบเงา');
        if (!res) throw new Error('สร้างเงาไม่สำเร็จ');
        if (o.holes) { step = 'ปิดรูด้านใน'; res = st_shFillHoles(doc, res); }
        if (o.knock) {
            step = 'หักส่วนที่ทับตัวงาน';
            var k = sil.duplicate(L, ElementPlacement.PLACEATBEGINNING);
            if (o.gapMM > 0) { doc.selection = null; k.selected = true; k = st_shOffset(doc, k, o.gapMM, 'round'); }
            k.zOrder(ZOrderMethod.BRINGTOFRONT); res.zOrder(ZOrderMethod.SENDTOBACK);
            doc.selection = null; res.selected = true; k.selected = true;
            if (!st_shMenu('Live Pathfinder Subtract')) throw new Error('Pathfinder Minus Front ไม่ทำงาน');
            st_shMenu('expandStyle');
            res = st_shTop(doc);
            if (!res || !st_collectPaths(res, []).length) throw new Error('เงาถูกตัวงานบังหมด — เพิ่มระยะเงา');
        }
        step = 'ลงสี + วางใต้งาน';
        var col = st_color(doc, o.rgb || [0, 0, 0], o.cmyk || [0, 0, 0, 100]);
        st_shFill(res, col);
        var NAMES = { drop: 'Drop', box: 'Box', persp: 'Perspective', cast: 'Cast', edge: 'Edge' };
        if (o.layer) {
            var SL = st_layer(doc, 'เงา', false), al = anchor.layer;
            try { if (SL !== al) SL.move(al, ElementPlacement.PLACEAFTER); } catch (em) {}
            res.move(SL, ElementPlacement.PLACEATBEGINNING);
        } else res.move(anchor, ElementPlacement.PLACEAFTER);
        res.name = 'เงา · ' + NAMES[t];
        doc.selection = null;
        L.remove(); L = null;
        for (i = 0; i < sel.length; i++) { try { sel[i].selected = true; } catch (es) {} }
        var gb = res.geometricBounds;
        return '{"ok":true,"msg":' + st_q((t === 'edge' ? 'ทำขอบ' : 'ทำเงา ' + NAMES[t]) + ' แล้ว · ' + st_mmOf(gb[2] - gb[0]) + ' × ' + st_mmOf(gb[1] - gb[3]) + ' มม.') + ',"warn":[' +
            (function () { var w = []; for (var x = 0; x < warn.length; x++) w.push(st_q(warn[x])); return w.join(','); })() + ']}';
    } catch (e) {
        try { if (L) L.remove(); } catch (e1) {}
        return st_err('ขั้น "' + step + '": ' + e.message + (e.line ? ' (บรรทัด ' + e.line + ')' : ''));
    }
}

// =====================================================================
//  ส่งออกไม่ให้เส้นตัดติดไปด้วย: ซ่อนเลเยอร์ตัด/ไม่พิมพ์ + เส้นตัดที่ปนอยู่ในเลเยอร์งาน → ส่งออก → คืนค่าเดิม
// =====================================================================
function st_hideCuts(doc) {
    var undo = { layers: [], items: [] }, i;
    for (i = 0; i < doc.layers.length; i++) {
        var L = doc.layers[i];
        if (!L.visible || /^(reg_|color |margin )/i.test(L.name)) continue;      // เลเยอร์มาร์คของ Cutting Master ต้องพิมพ์
        var cutName = /^(cutcontour|kiss ?cut|die ?cut|slug|ป้ายชื่อสี)/i.test(L.name) || /cut|ไดคัท|ไดคัต/i.test(L.name);
        if (cutName || L.printable === false) { L.visible = false; undo.layers.push(L); }
    }
    for (i = 0; i < doc.layers.length; i++) {
        var M = doc.layers[i];
        if (!M.visible) continue;
        var wasLocked = M.locked;
        for (var j = 0; j < M.pageItems.length; j++) {
            var cs = st_findCuts(M.pageItems[j], []);
            for (var k = 0; k < cs.length; k++) {
                try { if (!cs[k].hidden) { cs[k].hidden = true; undo.items.push(cs[k]); } } catch (eh) {}
            }
        }
        if (wasLocked) M.locked = true;
    }
    return undo;
}
function st_restoreCuts(undo) {
    if (!undo) return;
    for (var i = 0; i < undo.items.length; i++) { try { undo.items[i].hidden = false; } catch (e) {} }
    for (var j = 0; j < undo.layers.length; j++) { try { undo.layers[j].visible = true; } catch (e2) {} }
}
// ไฟล์พิมพ์ TIFF / JPG ไม่มีเส้นตัด · o = { fmt:'tif'|'jpg', ppi, cmyk:bool, which:'active'|'all', open }
// ส่งออก TIFF/JPG: Symbol ที่มีภาพ + clipping หลายร้อยดวงทำให้ Illustrator ขึ้น "Clipping path limit reached for TIFF preview"
// → ชั่วคราว: แปลงแต่ละ Symbol เป็นภาพ (rasterize ครั้งเดียวต่อแบบ) แล้วสลับทุกดวงไปใช้ Symbol ภาพ · ส่งออกเสร็จสลับกลับ
function st_symRaster(doc, ppi, rec) {
    var i, used = {}, list = [];
    if (!doc.symbolItems.length) return rec;
    for (i = 0; i < doc.symbolItems.length; i++) {
        var si = doc.symbolItems[i];
        try { if (si.hidden || !st_layerVisible(si)) continue; } catch (e0) {}
        var nm = si.symbol.name;
        if (!used[nm]) { used[nm] = { sym: si.symbol, items: [] }; list.push(nm); }
        used[nm].items.push(si);
    }
    if (!list.length) return rec;
    var L = doc.layers.add(); L.name = 'ST_tmp_raster'; rec.layer = L;
    var ro = new RasterizeOptions();
    ro.resolution = ppi; ro.transparency = true; ro.antiAliasingMethod = AntiAliasingMethod.ARTOPTIMIZED;
    try { ro.colorModel = RasterizationColorModel.DEFAULTCOLORMODEL; } catch (e1) {}
    for (i = 0; i < list.length; i++) {
        var u = used[list[i]];
        st_bc('แปลง Symbol เป็นภาพ ' + (i + 1) + '/' + list.length);
        var inst = L.symbolItems.add(u.sym), r = doc.rasterize(inst, inst.visibleBounds, ro);
        var ns = doc.symbols.add(r); rec.syms.push(ns);
        try { r.remove(); } catch (e2) {}
        try { if (inst && inst.typename) inst.remove(); } catch (e3) {}
        for (var k = 0; k < u.items.length; k++) {
            var it = u.items[k], b0 = it.visibleBounds, pos = it.position;
            it.symbol = ns;
            var b1 = it.visibleBounds;      // วางให้ตรงกลางเดิม
            it.translate(((b0[0] + b0[2]) - (b1[0] + b1[2])) / 2, ((b0[1] + b0[3]) - (b1[1] + b1[3])) / 2);
            rec.swaps.push({ it: it, sym: u.sym, pos: pos });
        }
    }
    return rec;
}
function st_symRestore(rec) {
    if (!rec) return;
    var i;
    for (i = rec.swaps.length - 1; i >= 0; i--) { var w = rec.swaps[i]; try { w.it.symbol = w.sym; w.it.position = w.pos; } catch (e) {} }
    for (i = 0; i < rec.syms.length; i++) { try { rec.syms[i].remove(); } catch (e1) {} }
    try { if (rec.layer) rec.layer.remove(); } catch (e2) {}
}
// กรอบมาร์ค CM5 (เลเยอร์ reg_…) ใน artboard นี้ = ขอบแผ่นที่จะพิมพ์จริง
function st_markRect(doc, ab) {
    var U = null, n = 0;
    for (var i = 0; i < doc.layers.length; i++) {
        var L = doc.layers[i];
        if (!/^reg_/.test(L.name) || !L.visible) continue;
        for (var j = 0; j < L.pathItems.length; j++) {
            var b = L.pathItems[j].visibleBounds, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
            if (cx < ab[0] || cx > ab[2] || cy > ab[1] || cy < ab[3]) continue;
            n++;
            if (!U) U = [b[0], b[1], b[2], b[3]]; else { U[0] = Math.min(U[0], b[0]); U[1] = Math.max(U[1], b[1]); U[2] = Math.max(U[2], b[2]); U[3] = Math.min(U[3], b[3]); }
        }
    }
    if (n < 4 || !U) return null;
    if (U[0] <= ab[0] + 0.01 && U[1] >= ab[1] - 0.01 && U[2] >= ab[2] - 0.01 && U[3] <= ab[3] + 0.01) return null;   // พอดีอยู่แล้ว
    return U;
}
function st_abRestore(doc, list) { for (var i = 0; i < (list || []).length; i++) { try { doc.artboards[list[i][0]].artboardRect = list[i][1]; } catch (e) {} } }
function st_exportPrint(o) {
    var doc, undo = null, keep = 0, srec = null, uil = null, abFix = [];
    try {
        doc = st_doc(); keep = doc.artboards.getActiveArtboardIndex();
        var base = doc.name.replace(/\.[^.]+$/, ''), folder;
        try { var f0 = doc.fullName; folder = (f0 && f0.exists) ? f0.parent : null; } catch (e0) { folder = null; }
        if (!folder) folder = Folder.desktop;
        var out = new Folder(folder.fsName + '/ไฟล์พิมพ์');
        if (!out.exists) out.create();
        var ppi = Math.max(36, Math.min(1200, o.ppi || 300)), list = [], i;
        if (o.which === 'all') { for (i = 0; i < doc.artboards.length; i++) list.push(i); } else list.push(keep);
        // ตรวจขนาดก่อน — ไฟล์ใหญ่เกินทำ Illustrator ค้าง
        for (i = 0; i < list.length; i++) {
            var r0 = doc.artboards[list[i]].artboardRect, wIn = (r0[2] - r0[0]) * ST_SF / 72, hIn = (r0[1] - r0[3]) * ST_SF / 72;
            var px = wIn * ppi * hIn * ppi;
            if (px > 400e6) return st_err('artboard ' + (list[i] + 1) + ' ใหญ่เกินไปที่ ' + ppi + ' ppi (' + Math.round(wIn * ppi) + '×' + Math.round(hIn * ppi) + ' px) — ลด ppi ลง');
        }
        undo = st_hideCuts(doc);
        try { uil = app.userInteractionLevel; app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS; } catch (eu) {}
        srec = { swaps: [], syms: [], layer: null };
        try { st_symRaster(doc, ppi, srec); } catch (esr) { st_symRestore(srec); srec = null; }   // แปลงไม่ได้ → ส่งออกแบบเดิม
        var files = [];
        for (var n = 0; n < list.length; n++) {
            var ai = list[n];
            doc.artboards.setActiveArtboardIndex(ai);
            var abRect0 = doc.artboards[ai].artboardRect, mkR = st_markRect(doc, abRect0);
            if (mkR) { doc.artboards[ai].artboardRect = mkR; abFix.push([ai, abRect0]); }   // มีมาร์ค → ส่งออกเฉพาะกรอบมาร์ค (ของนอกแผ่น เช่น ต้นฉบับ ไม่ติดไป)
            var name = base + (list.length > 1 || doc.artboards.length > 1 ? '_' + (ai + 1) : '') + '_' + ppi + 'ppi.' + (o.fmt === 'jpg' ? 'jpg' : 'tif');
            var f = new File(out.fsName + '/' + name);
            if (o.fmt === 'jpg') {
                var oj = new ExportOptionsJPEG(), sc = ppi / 72 * 100 * ST_SF;
                if (sc > 776) throw new Error('JPG ส่งออกได้สูงสุด ~' + Math.floor(776 * 72 / 100 / ST_SF) + ' ppi — ใช้ TIFF แทน');
                oj.artBoardClipping = true; oj.antiAliasing = true; oj.qualitySetting = 100;
                oj.horizontalScale = sc; oj.verticalScale = sc;
                doc.exportFile(f, ExportType.JPEG, oj);
            } else {
                var ot = new ExportOptionsTIFF();
                ot.resolution = ppi;
                ot.imageColorSpace = o.cmyk ? ImageColorSpace.CMYK : ImageColorSpace.RGB;
                ot.antiAliasing = AntiAliasingMethod.ARTOPTIMIZED;
                ot.lZWCompression = true;
                ot.artBoardClipping = true;
                try { ot.saveMultipleArtboards = true; ot.artboardRange = String(ai + 1); } catch (er) {}
                doc.exportFile(f, ExportType.TIFF, ot);
            }
            files.push(st_q(f.fsName));
        }
        st_abRestore(doc, abFix); abFix = [];
        st_symRestore(srec); srec = null; st_bcClear();
        try { if (uil !== null) app.userInteractionLevel = uil; } catch (eu2) {}
        st_restoreCuts(undo); undo = null;
        doc.artboards.setActiveArtboardIndex(keep);
        if (o.open) { try { out.execute(); } catch (e2) {} }
        return '{"ok":true,"msg":' + st_q('บันทึก ' + files.length + ' ไฟล์ (ไม่มีเส้นตัด) ที่โฟลเดอร์ "ไฟล์พิมพ์"') + ',"folder":' + st_q(out.fsName) + ',"files":[' + files.join(',') + ']}';
    } catch (e) {
        st_abRestore(doc, abFix);
        st_symRestore(srec); st_bcClear();
        try { if (uil !== null) app.userInteractionLevel = uil; } catch (eu3) {}
        st_restoreCuts(undo);
        try { doc.artboards.setActiveArtboardIndex(keep); } catch (e4) {}
        return st_err(e.message + (e.line ? ' (บรรทัด ' + e.line + ')' : ''));
    }
}

// =====================================================================
//  ตั้งชื่อไฟล์จากข้อความในงาน
// =====================================================================
function st_nmClean(s) {
    s = String(s).replace(/[\r\n\t\u0003]+/g, ' ').replace(/[\\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ');
    return s.replace(/^\s+|\s+$/g, '');
}
// o = { which:'active'|'all' } → { items:[{t, s(ความสูงบรรทัด มม.)}], size:"60x60cm", name, saved, outlined }
function st_nmSkipLayer(it) {
    try {
        var L = it.layer;
        while (L) {
            if (L.printable === false || /^(slug|marks|cutcontour|kiss ?cut|die ?cut|ตัวอย่างเส้นตัด|ป้ายชื่อสี)/i.test(L.name)) return true;
            L = L.parent && L.parent.typename === 'Layer' ? L.parent : null;
        }
    } catch (e) {}
    return false;
}
function st_nameScan(o) {
    try {
        var doc = st_doc(), ai = doc.artboards.getActiveArtboardIndex(), ab = doc.artboards[ai].artboardRect;
        var map = {}, list = [], i, j;
        for (i = 0; i < doc.textFrames.length; i++) {
            var tf = doc.textFrames[i];
            try { if (tf.hidden || !tf.layer.visible) continue; } catch (eh) {}
            if (st_nmSkipLayer(tf)) continue;          // ข้อความที่แผงสร้างเอง (จำนวนดวง ขอบแผ่น ป้ายสี) / เลเยอร์ไม่พิมพ์
            var gb = tf.geometricBounds;
            if (o.which !== 'all' && (gb[2] < ab[0] || gb[0] > ab[2] || gb[1] < ab[3] || gb[3] > ab[1])) continue;
            var lines = String(tf.contents).split(/[\r\n\u0003]+/), real = [];
            for (j = 0; j < lines.length; j++) { var c = st_nmClean(lines[j]); if (c) real.push(c); }
            if (!real.length) continue;
            var lh = (gb[1] - gb[3]) / real.length;          // ความสูงต่อบรรทัด (รวมสเกล/หมุนแล้ว)
            for (j = 0; j < real.length; j++) {
                var k = real[j].toLowerCase();
                if (map[k]) { if (lh > map[k].h) map[k].h = lh; continue; }
                map[k] = { t: real[j], h: lh, y: gb[1] - j * lh };
                list.push(map[k]);
            }
        }
        list.sort(function (a, b) { return b.h - a.h; });
        var out = [];
        for (i = 0; i < list.length && i < 30; i++) out.push('{"t":' + st_q(list[i].t.slice(0, 80)) + ',"s":' + Math.round(list[i].h * ST_SF / MM * 10) / 10 + '}');
        var W = (ab[2] - ab[0]) * ST_SF / MM / 10, H = (ab[1] - ab[3]) * ST_SF / MM / 10;
        function f(v) { return Math.round(v * 10) / 10; }
        var hasPath = false; try { hasPath = !!(doc.fullName && doc.fullName.exists); } catch (ep) {}
        return '{"items":[' + out.join(',') + '],"size":' + st_q(f(W) + 'x' + f(H) + 'cm') + ',"name":' + st_q(doc.name.replace(/\.[^.]+$/, '')) + ',"hasPath":' + (hasPath ? 'true' : 'false') + '}';
    } catch (e) { return st_err(e.message); }
}
// o = { name } → บันทึกเป็น .ai ชื่อใหม่ (โฟลเดอร์เดิม หรือเดสก์ท็อปถ้ายังไม่เคยบันทึก) · ชื่อซ้ำ → เติม (2) (3)
function st_nameSave(o) {
    try {
        var doc = st_doc(), name = st_nmClean(o.name || '').slice(0, 150);
        if (!name) return st_err('ยังไม่มีชื่อไฟล์');
        var folder = null; try { if (doc.fullName && doc.fullName.exists) folder = doc.fullName.parent; } catch (e0) {}
        if (!folder) folder = Folder.desktop;
        var f = new File(folder.fsName + '/' + name + '.ai'), n = 2;
        try { if (doc.fullName && doc.fullName.fsName === f.fsName) return st_ok('ชื่อนี้อยู่แล้ว'); } catch (e1) {}
        while (f.exists && n < 100) { f = new File(folder.fsName + '/' + name + ' (' + n + ').ai'); n++; }
        var so = new IllustratorSaveOptions();
        try { so.pdfCompatible = true; so.embedLinkedFiles = false; } catch (e2) {}
        doc.saveAs(f, so);
        return '{"ok":true,"msg":' + st_q('บันทึกเป็น "' + decodeURI(f.name) + '"') + ',"path":' + st_q(f.fsName) + '}';
    } catch (e) { return st_err(e.message); }
}

// =====================================================================
//  ดูเส้นตัดบนงานก่อน (ไม่สร้างแผ่น) — เลเยอร์ "ตัวอย่างเส้นตัด" ไม่พิมพ์ · กดใหม่ = แทนของเดิม
// =====================================================================
var ST_PV = 'ตัวอย่างเส้นตัด';
function st_stkPreviewClear() {
    try { var doc = st_doc(); try { var L = doc.layers.getByName(ST_PV); L.locked = false; L.remove(); return st_ok('ลบตัวอย่างเส้นตัดแล้ว'); } catch (e) { return st_ok('ไม่มีตัวอย่างค้างอยู่'); } }
    catch (e2) { return st_err(e2.message); }
}
function st_stkPreview(o) {
    var doc, stage = null, step = 'เริ่ม', warn = [];
    try {
        doc = st_doc();
        var raw = st_selection(doc);
        if (!raw.length) return st_err('เลือกสติ๊กเกอร์ก่อน');
        var sel = st_designs(raw), i, k;
        try { var old = doc.layers.getByName(ST_PV); old.locked = false; old.remove(); } catch (e0) {}
        var cutColor = new SpotColor(); cutColor.spot = st_cutSwatch(doc); cutColor.tint = 100;
        var dieColor = o.die ? st_spotColor(st_spotSwatch(doc, 'DieCut', [0, 166, 81], [100, 0, 100, 0])) : null;
        stage = doc.layers.add(); stage.name = 'ST_preview_tmp';
        var PV = doc.layers.add(); PV.name = ST_PV;
        var sizes = [];
        for (i = 0; i < sel.length; i++) {
            step = 'เส้นตัดลายที่ ' + (i + 1);
            var art = sel[i].art.duplicate(stage, ElementPlacement.PLACEATEND), cut = null;
            var own = st_findCuts(art, []), ext = sel[i].cuts;
            if (o.cutType === 'own') {
                if (own.length || ext.length) {
                    cut = stage.groupItems.add();
                    for (k = 0; k < own.length; k++) own[k].duplicate(cut, ElementPlacement.PLACEATEND);
                    for (k = 0; k < ext.length; k++) ext[k].duplicate(cut, ElementPlacement.PLACEATEND);
                    st_styleCut(cut, cutColor);
                } else warn.push((i + 1) + ': ไม่พบเส้นตัดที่วาดเอง → ใช้สี่เหลี่ยมมุมมน');
            } else {
                for (k = own.length - 1; k >= 0; k--) { try { own[k].remove(); } catch (er) {} }
                if (o.cutType === 'contour') {
                    try { cut = st_contourCut(doc, art, U(o.offsetMM), stage, cutColor); }
                    catch (ec) { warn.push((i + 1) + ': ทำไดคัทตามรูปไม่ได้ (' + ec.message + ')'); cut = null; }
                }
            }
            if (!cut) cut = st_shapeCut(doc, art.visibleBounds, (o.cutType === 'own' || o.cutType === 'contour') ? { cutType: 'rect', offsetMM: o.offsetMM, radiusMM: Math.max(o.radiusMM, 2) } : o, stage, cutColor);
            var die = null;
            if (o.die) {
                step = 'เส้นไดคัทลายที่ ' + (i + 1);
                try { die = st_dieCut(doc, art, cut, o, stage, dieColor); }
                catch (ed) { warn.push((i + 1) + ': ไดคัทตามรูปไม่ได้ → สี่เหลี่ยมมุมมน'); die = st_shapeCut(doc, cut.geometricBounds, { cutType: 'rect', offsetMM: o.die.offMM, radiusMM: Math.max(o.die.radMM, 2) }, stage, dieColor); }
            }
            if (o.credit) {
                step = 'เครดิตลายที่ ' + (i + 1);
                try { var cr = st_makeCredit(doc, o.credit, stage); st_putCredit(cr, (die || cut).geometricBounds, o.credit); cr.move(PV, ElementPlacement.PLACEATEND); }
                catch (ecr) { warn.push('เครดิต: ' + ecr.message); }
            }
            var cb = (die || cut).geometricBounds;
            sizes.push(st_mmOf(cb[2] - cb[0]) + '×' + st_mmOf(cb[1] - cb[3]));
            if (die) die.move(PV, ElementPlacement.PLACEATBEGINNING);
            if (die && o.die && o.die.only) cut.remove(); else cut.move(PV, ElementPlacement.PLACEATBEGINNING);
            try { art.remove(); } catch (ea) {}
        }
        stage.remove(); stage = null;
        st_noPrint(PV);
        try { PV.zOrder(ZOrderMethod.BRINGTOFRONT); } catch (ez) {}
        doc.selection = null;
        for (i = 0; i < raw.length; i++) { try { raw[i].selected = true; } catch (es) {} }
        return '{"ok":true,"msg":' + st_q('สร้างตัวอย่างเส้นตัด ' + sel.length + ' ลาย · ขนาดตัด ' + sizes.join(', ') + ' มม.') + ',"warn":[' +
            (function () { var w = []; for (var x = 0; x < warn.length; x++) w.push(st_q(warn[x])); return w.join(','); })() + ']}';
    } catch (e) {
        try { if (stage) stage.remove(); } catch (e1) {}
        return st_err('ขั้น "' + step + '": ' + e.message + (e.line ? ' (บรรทัด ' + e.line + ')' : ''));
    }
}
