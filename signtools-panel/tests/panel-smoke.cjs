#!/usr/bin/env node
'use strict';

/*
 * Offline SignTools 1.13.48 panel smoke/regression test.
 *
 * This intentionally loads the unpacked release's real pack.js and sticker.js
 * into a Node vm. The browser/CEP/Illustrator surfaces below are deterministic
 * mocks only; no network, browser, Illustrator, Graphtec, or ExtendScript host
 * is involved.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DEFAULT_VERSION = '1.13.48';

function fail(message, error) {
  const detail = error && error.stack ? `\n${error.stack}` : '';
  console.error(`FAIL: ${message}${detail}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
  }
}

function assertMatch(value, pattern, message) {
  if (!pattern.test(value)) throw new Error(message);
}

function attrsFromSource(source) {
  const attrs = {};
  const re = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = re.exec(source))) {
    attrs[match[1]] = match[2] !== undefined ? match[2] :
      match[3] !== undefined ? match[3] :
        match[4] !== undefined ? match[4] : '';
  }
  return attrs;
}

function dataKey(name) {
  return name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

class MockNode {
  constructor() {
    this.parentNode = null;
    this.childNodes = [];
    this.listeners = Object.create(null);
    this._textContent = null;
  }

  appendChild(node) {
    if (!node) return node;
    if (node.parentNode) {
      const old = node.parentNode.childNodes.indexOf(node);
      if (old >= 0) node.parentNode.childNodes.splice(old, 1);
    }
    node.parentNode = this;
    this.childNodes.push(node);
    this._textContent = null;
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index >= 0) {
      this.childNodes.splice(index, 1);
      node.parentNode = null;
    }
    return node;
  }

  addEventListener(type, listener) {
    (this.listeners[type] || (this.listeners[type] = [])).push(listener);
  }

  dispatchEvent(event) {
    const e = event || { type: '' };
    if (!e.target) e.target = this;
    const listeners = this.listeners[e.type] || [];
    listeners.slice().forEach((listener) => listener.call(this, e));
    const handler = this[`on${e.type}`];
    if (typeof handler === 'function') handler.call(this, e);
    return true;
  }

  get textContent() {
    if (this._textContent !== null) return this._textContent;
    return this.childNodes.map((node) => node.textContent || '').join('');
  }

  set textContent(value) {
    this.childNodes = [];
    this._textContent = String(value == null ? '' : value);
  }
}

class MockTextNode extends MockNode {
  constructor(text) {
    super();
    this.nodeType = 3;
    this._textContent = String(text);
  }
}

function classSet(element) {
  return new Set(String(element._className || '').split(/\s+/).filter(Boolean));
}

function updateClassName(element, values) {
  element._className = Array.from(values).join(' ');
}

class MockClassList {
  constructor(element) {
    this.element = element;
  }

  contains(name) {
    return classSet(this.element).has(name);
  }

  add(...names) {
    const values = classSet(this.element);
    names.forEach((name) => values.add(name));
    updateClassName(this.element, values);
  }

  remove(...names) {
    const values = classSet(this.element);
    names.forEach((name) => values.delete(name));
    updateClassName(this.element, values);
  }

  toggle(name, force) {
    const values = classSet(this.element);
    const shouldHave = force === undefined ? !values.has(name) : !!force;
    if (shouldHave) values.add(name); else values.delete(name);
    updateClassName(this.element, values);
    return shouldHave;
  }
}

class MockCanvasContext {
  constructor() {
    this.fillStyle = '';
    this.strokeStyle = '';
    this.lineWidth = 1;
    this.font = '';
  }

  setLineDash() {}
  fillRect() {}
  strokeRect() {}
  beginPath() {}
  ellipse() {}
  moveTo() {}
  arcTo() {}
  closePath() {}
  fill() {}
  stroke() {}
  fillText() {}
}

class MockElement extends MockNode {
  constructor(tagName, attrs = {}) {
    super();
    this.nodeType = 1;
    this.tagName = tagName.toLowerCase();
    this.attributes = Object.create(null);
    this.style = {};
    this.dataset = {};
    this._className = '';
    this.classList = new MockClassList(this);
    this._value = undefined;
    this.type = attrs.type || '';
    this.disabled = Object.prototype.hasOwnProperty.call(attrs, 'disabled');
    this.checked = Object.prototype.hasOwnProperty.call(attrs, 'checked');
    this.min = attrs.min || '';
    this.max = attrs.max || '';
    this.step = attrs.step || '';
    this.title = attrs.title || '';

    Object.keys(attrs).forEach((name) => this.setAttribute(name, attrs[name]));

    if (this.tagName === 'input' || this.tagName === 'textarea') {
      if (Object.prototype.hasOwnProperty.call(attrs, 'value')) this._value = attrs.value;
    }
    if (this.tagName === 'canvas') {
      this.width = Number(attrs.width || 300);
      this.height = Number(attrs.height || 150);
      this._canvasContext = new MockCanvasContext();
    }
  }

  setAttribute(name, value) {
    const text = String(value);
    this.attributes[name] = text;
    if (name === 'id') this.id = text;
    if (name === 'class') this._className = text;
    if (name === 'type') this.type = text;
    if (name === 'value') this._value = text;
    if (name === 'checked') this.checked = true;
    if (name === 'disabled') this.disabled = true;
    if (name === 'data-name' || name.indexOf('data-') === 0) this.dataset[dataKey(name)] = text;
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this._className = String(value || '');
  }

  get value() {
    if (this.tagName === 'select') {
      if (this._value !== undefined) return this._value;
      const options = this.childNodes.filter((child) => child && child.tagName === 'option');
      const selected = options.find((option) => option.selected) || options[0];
      return selected ? selected.value : '';
    }
    if (this.tagName === 'textarea' && this._value === undefined) return this.textContent;
    return this._value === undefined ? '' : this._value;
  }

  set value(value) {
    this._value = String(value == null ? '' : value);
  }

  get selected() {
    return !!this._selected;
  }

  set selected(value) {
    this._selected = !!value;
  }

  get innerHTML() {
    return this.childNodes.map((node) => node.textContent || '').join('');
  }

  set innerHTML(value) {
    this.childNodes = [];
    this._textContent = null;
    parseMarkupInto(this, String(value || ''));
  }

  getContext(kind) {
    if (this.tagName !== 'canvas' || kind !== '2d') return null;
    return this._canvasContext;
  }

  querySelector(selector) {
    return querySelectorAllFrom(this, selector)[0] || null;
  }

  querySelectorAll(selector) {
    return querySelectorAllFrom(this, selector);
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  setSelectionRange() {}
}

function allElements(node, includeSelf) {
  const out = [];
  function visit(current, include) {
    if (current && current.nodeType === 1 && include) out.push(current);
    (current && current.childNodes || []).forEach((child) => visit(child, true));
  }
  visit(node, !!includeSelf);
  return out;
}

function parseSimpleSelector(selector) {
  const attrs = [];
  const withoutAttrs = selector.replace(/\[([^=\]]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/g,
    (_, name, quoted1, quoted2, bare) => {
      attrs.push({ name, value: quoted1 !== undefined ? quoted1 : quoted2 !== undefined ? quoted2 : bare });
      return '';
    });
  const ids = [];
  const classes = [];
  const withoutClasses = withoutAttrs.replace(/#([\w-]+)/g, (_, value) => { ids.push(value); return ''; })
    .replace(/\.([\w-]+)/g, (_, value) => { classes.push(value); return ''; });
  const tag = withoutClasses && withoutClasses !== '*' ? withoutClasses.toLowerCase() : null;
  return { tag, ids, classes, attrs };
}

function matchesSimple(element, selector) {
  if (!element || element.nodeType !== 1) return false;
  const parsed = parseSimpleSelector(selector);
  if (parsed.tag && element.tagName !== parsed.tag) return false;
  if (parsed.ids.some((id) => element.id !== id)) return false;
  const values = classSet(element);
  if (parsed.classes.some((name) => !values.has(name))) return false;
  for (const attr of parsed.attrs) {
    if (!Object.prototype.hasOwnProperty.call(element.attributes, attr.name)) return false;
    if (attr.value !== undefined && element.attributes[attr.name] !== String(attr.value).trim()) return false;
  }
  return true;
}

function matchesDescendantSelector(element, parts) {
  let current = element;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (i === parts.length - 1) {
      if (!matchesSimple(current, parts[i])) return false;
      current = current.parentNode;
      continue;
    }
    while (current && !matchesSimple(current, parts[i])) current = current.parentNode;
    if (!current) return false;
    current = current.parentNode;
  }
  return true;
}

function querySelectorAllFrom(node, selector) {
  const parts = String(selector).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  return allElements(node, node.nodeType === 1).filter((element) => matchesDescendantSelector(element, parts));
}

function parseMarkupInto(parent, html) {
  const stack = [parent];
  const tokenRe = /<!--[\s\S]*?-->|<[^>]*>|[^<]+/g;
  let match;
  while ((match = tokenRe.exec(html))) {
    const token = match[0];
    if (token.startsWith('<!--')) continue;
    if (token.startsWith('</')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (!token.startsWith('<')) {
      if (token) stack[stack.length - 1].appendChild(new MockTextNode(token));
      continue;
    }
    const opening = token.match(/^<\s*([a-zA-Z][\w:-]*)([\s\S]*?)>$/);
    if (!opening) continue;
    const tagName = opening[1].toLowerCase();
    const rawAttrs = opening[2].replace(/\/\s*$/, '');
    const attrs = attrsFromSource(rawAttrs);
    const element = new MockElement(tagName, attrs);
    element.ownerDocument = parent.ownerDocument || (parent.nodeType === 9 ? parent : null);
    stack[stack.length - 1].appendChild(element);
    const voidTag = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i.test(tagName);
    if (!voidTag && !/\/\s*>$/.test(token)) stack.push(element);
  }
}

class MockDocument extends MockNode {
  constructor(html) {
    super();
    this.nodeType = 9;
    this.ownerDocument = this;
    this.activeElement = null;
    parseMarkupInto(this, html);
    allElements(this, false).forEach((element) => { element.ownerDocument = this; });
  }

  getElementById(id) {
    return allElements(this, false).find((element) => element.id === id) || null;
  }

  querySelector(selector) {
    return querySelectorAllFrom(this, selector)[0] || null;
  }

  querySelectorAll(selector) {
    return querySelectorAllFrom(this, selector);
  }

  createElement(tagName) {
    const element = new MockElement(tagName);
    element.ownerDocument = this;
    return element;
  }

  createTextNode(text) {
    return new MockTextNode(text);
  }
}

function setDefaultMode(document, mode) {
  const buttons = document.querySelectorAll('.seg[data-name="stkMode"] button');
  buttons.forEach((button) => button.classList.toggle('on', button.dataset.v === mode));
  const active = buttons.find((button) => button.dataset.v === mode);
  if (active) active.dispatchEvent(new MockEvent('click'));
}

class MockEvent {
  constructor(type) {
    this.type = type;
    this.target = null;
  }
}

function buildHost(readPayload) {
  const calls = [];
  let placeResponse = { ok: true, msg: 'mock placed', warn: [] };
  let currentRead = readPayload;
  const bridge = {
    calls,
    setReadPayload(payload) { currentRead = payload; },
    setPlaceResponse(payload) { placeResponse = payload; },
    evalScript(source, callback) {
      const open = source.indexOf('(');
      const fn = open < 0 ? source : source.slice(0, open);
      const rawArg = open < 0 ? '' : source.slice(open + 1, -1);
      const arg = rawArg ? JSON.parse(rawArg) : undefined;
      calls.push({ fn, arg });
      let response;
      if (fn === 'st_stkRead') response = currentRead;
      else if (fn === 'st_stkPlace') response = placeResponse;
      else if (fn === 'st_lastCrash') response = { none: true };
      else response = { ok: true, msg: 'mock ' + fn, warn: [] };
      callback(JSON.stringify(response));
    },
  };
  return bridge;
}

function createSandbox(indexHtml, packSource, stickerSource, host) {
  const document = new MockDocument(indexHtml);
  const sandboxSetTimeout = (callback, delay) => {
    // Avoid keeping the CLI alive for the panel's 2.5s crash-check timer.
    return delay >= 1000 ? 0 : global.setTimeout(callback, delay);
  };
  const window = {
    document,
    __adobe_cep__: host,
    ST_core: { report() {} },
    setTimeout: sandboxSetTimeout,
    clearTimeout: global.clearTimeout,
    Event: MockEvent,
  };
  window.window = window;
  const sandbox = vm.createContext(window);
  vm.runInContext(packSource, sandbox, { filename: 'release/SignTools/js/pack.js' });
  assert(typeof window.STPack === 'object' && typeof window.STPack.pack === 'function', 'actual pack.js did not expose STPack.pack');
  vm.runInContext(stickerSource, sandbox, { filename: 'release/SignTools/js/sticker.js' });
  assert(window.__stk && typeof window.__stk.setItems === 'function', 'actual sticker.js did not initialize window.__stk');
  return { document, window, sandbox };
}

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickAndWait(element, ms = 5) {
  assert(element && typeof element.dispatchEvent === 'function', 'cannot click missing mock element');
  element.dispatchEvent(new MockEvent('click'));
  await wait(ms);
}

function placeCalls(host) {
  return host.calls.filter((call) => call.fn === 'st_stkPlace');
}

function checkPlaceArgs(call, expectedCount, label) {
  assert(call, `${label}: st_stkPlace call missing`);
  const args = call.arg;
  assert(args && typeof args === 'object', `${label}: st_stkPlace did not receive one object argument`);
  assertEqual(args.count, expectedCount, `${label}: host args.count mismatch`);
  assert(Array.isArray(args.sheets) && args.sheets.length > 0, `${label}: host args.sheets is empty`);
  assert(args.sheets.some((sheet) => Array.isArray(sheet) && sheet.length > 0), `${label}: every host sheet is empty`);
  assert(args.marks && args.marks.insetMM > 0 && args.marks.lenMM > 0, `${label}: marks were not forwarded`);
  assert(args.die && args.die.shape === 'rect' && args.die.offMM > 0, `${label}: die settings were not forwarded`);
  return args;
}

async function run() {
  const input = process.argv[2];
  if (!input || input === '-h' || input === '--help') {
    console.error('Usage: node signtools-panel/tests/panel-smoke.cjs <unpacked-release-root> [expected-version]');
    console.error('       <root>/SignTools/index.html and <root>/SignTools/js/{pack,sticker}.js are required.');
    process.exitCode = input ? 0 : 2;
    return;
  }

  assert(process.argv.length <= 4, 'too many arguments');
  const expectedVersion = process.argv[3] || DEFAULT_VERSION;
  assertMatch(expectedVersion, /^\d+\.\d+\.\d+$/, 'expected-version must be X.Y.Z');
  const releaseRoot = path.resolve(input);
  const signTools = path.join(releaseRoot, 'SignTools');
  const indexPath = path.join(signTools, 'index.html');
  const packPath = path.join(signTools, 'js', 'pack.js');
  const stickerPath = path.join(signTools, 'js', 'sticker.js');
  const manifestPath = path.join(signTools, 'CSXS', 'manifest.xml');
  [indexPath, packPath, stickerPath, manifestPath].forEach((file) => assert(fs.existsSync(file), `missing release file: ${file}`));

  const manifest = fs.readFileSync(manifestPath, 'utf8');
  const version = (manifest.match(/ExtensionBundleVersion="([^"]+)"/) || [])[1];
  assertEqual(version, expectedVersion, `release version guard failed for ${manifestPath}`);
  const extensionVersion = (manifest.match(/<Extension\s+Id="[^"]+"\s+Version="([^"]+)"/) || [])[1];
  assertEqual(extensionVersion, expectedVersion, 'panel extension version guard failed');

  const indexHtml = fs.readFileSync(indexPath, 'utf8');
  const packSource = fs.readFileSync(packPath, 'utf8');
  const stickerSource = fs.readFileSync(stickerPath, 'utf8');
  const readPayloads = [
    {
      sf: 1,
      items: [{ i: 0, name: 'fill design', vb: [0, 85.0393700787, 85.0393700787, 0], cut: null, raster: false, ownCuts: 0 }],
    },
    {
      sf: 1,
      items: [
        { i: 0, name: 'multi red', vb: [0, 85.0393700787, 85.0393700787, 0], cut: null, raster: false, ownCuts: 0 },
        { i: 1, name: 'multi blue', vb: [0, 85.0393700787, 85.0393700787, 0], cut: null, raster: false, ownCuts: 0 },
      ],
    },
  ];
  const host = buildHost(readPayloads[0]);
  const sim = createSandbox(indexHtml, packSource, stickerSource, host);
  const { document } = sim;

  // These assertions prove that defaults came from the shipped source HTML.
  assertEqual(document.getElementById('stkSheet').value, '210x297', 'source HTML A4 default was not loaded');
  assert(document.getElementById('stkCm5').checked, 'source HTML CM5 default was not loaded');
  assert(document.getElementById('stkRot').checked, 'source HTML rotation default was not loaded');
  assert(document.getElementById('stkSym').checked, 'source HTML Symbol default was not loaded');

  const readButton = document.getElementById('stkRead');
  const goButton = document.getElementById('stkGo');
  const cm5 = document.getElementById('stkCm5');
  const marks = document.getElementById('stkMarks');
  const die = document.getElementById('stkDie');
  cm5.checked = false;
  marks.checked = true;
  die.checked = true;

  // Fill mode: exercise the real stkRead -> real pack.js -> real stkGo path.
  setDefaultMode(document, 'fill');
  host.setReadPayload(readPayloads[0]);
  await clickAndWait(readButton);
  const fillResult = sim.window.__stk.result();
  assert(fillResult && fillResult.placed > 0, 'fill mode did not produce placed stickers');
  assert(!goButton.disabled, 'fill mode did not enable stkGo');
  host.setPlaceResponse({ ok: true, msg: 'mock fill placed', warn: [] });
  await clickAndWait(goButton);
  const fillPlace = placeCalls(host)[0];
  checkPlaceArgs(fillPlace, 1, 'fill');

  // Multi mode: read two designs, reduce quantities through the generated UI
  // inputs, then make host return the exact selection-mismatch error. The UI
  // must restore stkGo and surface that host error instead of staying disabled.
  setDefaultMode(document, 'multi');
  host.setReadPayload(readPayloads[1]);
  await clickAndWait(readButton);
  const quantityInputs = document.querySelectorAll('#stkList input');
  assertEqual(quantityInputs.length, 2, 'multi mode did not render both quantity inputs');
  quantityInputs.forEach((input) => {
    input.value = '2';
    input.dispatchEvent(new MockEvent('input'));
  });
  await wait(150);
  const multiResult = sim.window.__stk.result();
  assert(multiResult && multiResult.placed > 0, 'multi mode did not produce placed stickers');
  const designIds = new Set(multiResult.sheets.flat().map((item) => item.d));
  assert(designIds.has(0) && designIds.has(1), 'multi mode did not place both design IDs');

  const mismatch = 'รายการที่เลือกเปลี่ยนไป — กด "อ่านสติ๊กเกอร์" ใหม่อีกครั้ง';
  host.setPlaceResponse({ error: mismatch });
  await clickAndWait(goButton);
  const allPlaceCalls = placeCalls(host);
  const multiPlace = allPlaceCalls[allPlaceCalls.length - 1];
  checkPlaceArgs(multiPlace, 2, 'multi');
  await wait(5);
  assert(!goButton.disabled, 'stkGo did not recover after host selection-mismatch error');
  assert(goButton.textContent.includes('สร้างแผ่นงาน'), 'stkGo label did not recover after host error');
  assert(document.getElementById('stkWarn').textContent.includes(mismatch), 'selection-mismatch error was not displayed');

  const readCalls = host.calls.filter((call) => call.fn === 'st_stkRead');
  assertEqual(readCalls.length, 2, 'expected one real stkRead bridge call per mode');
  assertEqual(allPlaceCalls.length, 2, 'expected one real stkGo/st_stkPlace bridge call per mode');

  console.log(`PASS SignTools ${expectedVersion} offline panel smoke`);
  console.log(`  fill: stkRead -> ${fillResult.placed} placed -> stkGo/st_stkPlace count=1, sheets=${fillPlace.arg.sheets.length}, marks=yes, die=yes`);
  console.log(`  multi: stkRead -> ${multiResult.placed} placed across ${multiResult.sheets.length} sheet(s) -> stkGo/st_stkPlace count=2, mismatch UI recovery=yes`);
  console.log('  scope: actual pack.js/sticker.js in Node vm; DOM/Canvas/CEP are mocks only');
}

run().catch((error) => fail('offline panel smoke regression', error));
