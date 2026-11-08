/* Cross-platform SignTools path mapping. Pure ES5 runtime. */
(function (root, factory) {
  var api = factory();
  if (root) root.STPathMap = api;
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
}(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
  var WIN_BAD = /[:*?"<>|]/;

  function bad(message) {
    throw new Error('พาธไม่ถูกต้อง: ' + message);
  }

  function text(value) {
    if (typeof value !== 'string') {
      bad('ต้องเป็นข้อความ');
    }
    if (CONTROL.test(value)) {
      bad('ห้ามมีอักขระควบคุมหรือนัล');
    }
    return value;
  }

  function nfc(value) {
    if (String.prototype.normalize) {
      try { return value.normalize('NFC'); } catch (ignore) {}
    }
    return value;
  }

  function samePart(a, b, kind) {
    a = nfc(a);
    b = nfc(b);
    return kind === 'windows' ? a.toLowerCase() === b.toLowerCase() : a === b;
  }

  function splitWindows(value) {
    var raw = value.split(/[\\/]+/);
    var out = [];
    var i;
    for (i = 0; i < raw.length; i += 1) {
      if (raw[i] === '' || raw[i] === '.') { continue; }
      if (raw[i] === '..') { bad('ห้ามใช้ส่วน ..'); }
      out.push(raw[i]);
    }
    return out;
  }

  function splitPosix(value) {
    var raw = value.split('/');
    var out = [];
    var i;
    for (i = 0; i < raw.length; i += 1) {
      if (raw[i] === '' || raw[i] === '.') { continue; }
      if (raw[i] === '..') { bad('ห้ามใช้ส่วน ..'); }
      out.push(raw[i]);
    }
    return out;
  }

  function invalidWindowsParts(parts) {
    var i;
    for (i = 0; i < parts.length; i += 1) {
      if (WIN_BAD.test(parts[i])) { bad('ชื่อ Windows มีอักขระต้องห้าม'); }
    }
  }

  function windowsResult(parts, drive) {
    var path;
    if (drive) {
      invalidWindowsParts(parts);
      path = drive + '\\' + parts.join('\\');
      return { path: path, kind: 'windows', root: drive + '\\' };
    }
    if (parts.length < 2) { bad('UNC ต้องมี server และ share'); }
    invalidWindowsParts(parts);
    path = '\\\\' + parts.join('\\');
    return {
      path: path,
      kind: 'windows',
      root: '\\\\' + parts[0] + '\\' + parts[1]
    };
  }

  function normalizeWindows(value) {
    var drive = value.match(/^([A-Za-z]):[\\/]/);
    var body;
    var parts;
    if (drive) {
      body = value.slice(3);
      parts = splitWindows(body);
      return windowsResult(parts, drive[1] + ':');
    }
    if (/^[\\/]{2}/.test(value)) {
      body = value.replace(/^[\\/]+/, '');
      parts = splitWindows(body);
      return windowsResult(parts, null);
    }
    bad('พาธ Windows ต้องเป็น drive หรือ UNC แบบ absolute');
  }

  function posixResult(parts) {
    var path = '/' + parts.join('/');
    var root = null;
    if (parts.length >= 2 && parts[0] === 'Volumes') {
      root = '/Volumes/' + parts[1];
    }
    return { path: path, kind: 'posix', root: root };
  }

  function normalizePosix(value) {
    if (value.charAt(0) !== '/') {
      bad('พาธต้องเป็น absolute');
    }
    return posixResult(splitPosix(value));
  }

  function decodeUrlPart(value) {
    var decoded;
    try {
      decoded = decodeURIComponent(value);
    } catch (ignore) {
      bad('file URL มี percent encoding ไม่ถูกต้อง');
    }
    if (/[\\/]/.test(decoded) || CONTROL.test(decoded)) {
      bad('file URL ห้าม encode slash, backslash หรืออักขระควบคุม');
    }
    if (decoded === '..') { bad('file URL ห้ามใช้ส่วน ..'); }
    return decoded;
  }

  function decodeUrlParts(value) {
    var raw = value.split('/');
    var out = [];
    var i;
    for (i = 0; i < raw.length; i += 1) {
      if (raw[i] === '') { continue; }
      var part = decodeUrlPart(raw[i]);
      if (part !== '.') { out.push(part); }
    }
    return out;
  }

  function normalizeFileUrl(value) {
    var rest = value.slice(7);
    var slash = rest.indexOf('/');
    var authority = slash < 0 ? rest : rest.slice(0, slash);
    var pathname = slash < 0 ? '' : rest.slice(slash);
    var host;
    var parts;
    var first;

    if (/[?#]/.test(rest) || /\\/.test(rest) || authority.indexOf(':') >= 0) {
      bad('file URL ไม่รองรับ query, fragment, backslash หรือ port');
    }
    host = decodeUrlPart(authority);
    if (host === '.' || host === '?') { bad('file URL ไม่รองรับ device host'); }
    if (host.toLowerCase() === 'localhost' || host === '') {
      if (pathname === '') { bad('file URL ไม่มีพาธ'); }
      parts = decodeUrlParts(pathname);
      first = parts.length ? parts[0] : '';
      if (/^[A-Za-z]:$/.test(first) && pathname.charAt(0) === '/') {
        return windowsResult(parts.slice(1), first);
      }
      return posixResult(parts);
    }
    if (pathname.charAt(0) !== '/') { bad('file URL UNC ไม่มี share'); }
    parts = decodeUrlParts(pathname);
    if (!parts.length) { bad('file URL UNC ไม่มี share'); }
    parts.unshift(host);
    return windowsResult(parts, null);
  }

  function isDevice(value) {
    return /^(?:[\\/]{2}[?.][\\/]|[\\/][?][?][\\/])/.test(value);
  }

  function normalize(value) {
    var result;
    value = text(value);
    if (/^file:\/\//i.test(value)) {
      return normalizeFileUrl(value);
    }
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && !/^[A-Za-z]:[\\/]/.test(value)) {
      bad('ไม่รองรับ URL ชนิดนี้');
    }
    if (isDevice(value)) {
      bad('ไม่รองรับ device path');
    }
    if (/^[A-Za-z]:/.test(value)) {
      return normalizeWindows(value);
    }
    if (/^[\\/]{2}/.test(value)) {
      result = value.replace(/^[\\/]+/, '').split(/[\\/]+/);
      if (result.length >= 2 && result[0] !== '' && result[1] !== '') {
        return normalizeWindows(value);
      }
    }
    if (value.charAt(0) === '/') {
      return normalizePosix(value);
    }
    bad('ไม่รองรับพาธ relative');
  }

  function pathParts(value, kind) {
    var raw = value.split(kind === 'windows' ? '\\' : '/');
    var out = [];
    var i;
    for (i = 0; i < raw.length; i += 1) {
      if (raw[i] !== '') { out.push(raw[i]); }
    }
    return out;
  }

  function isUnder(value, root, kind) {
    var valueParts = pathParts(value, kind);
    var rootParts = pathParts(root, kind);
    var i;
    if (rootParts.length > valueParts.length) { return false; }
    for (i = 0; i < rootParts.length; i += 1) {
      if (!samePart(valueParts[i], rootParts[i], kind)) { return false; }
    }
    return true;
  }

  function joinMapped(target, kind, suffix) {
    var separator = kind === 'windows' ? '\\' : '/';
    if (!suffix.length) { return target; }
    if (target.charAt(target.length - 1) === separator) {
      return target + suffix.join(separator);
    }
    return target + separator + suffix.join(separator);
  }

  function mapKey(value, kind) {
    value = nfc(value);
    return kind === 'windows' ? value.toLowerCase() : value;
  }

  function hasWindowsBadTail(value) {
    var parts = pathParts(value, 'windows');
    var i;
    var start = /^[A-Za-z]:$/.test(parts[0] || '') ? 1 : 0;
    for (i = start; i < parts.length; i += 1) {
      if (WIN_BAD.test(parts[i])) { return true; }
    }
    return false;
  }

  function validateMaps(rules) {
    var out = [];
    var seen = {};
    var i;
    var rule;
    var win;
    var mac;
    var key;
    if (!Array.isArray(rules)) { bad('maps ต้องเป็น array'); }
    for (i = 0; i < rules.length; i += 1) {
      rule = rules[i];
      if (!rule || typeof rule !== 'object') { bad('map ต้องเป็น object'); }
      win = normalize(rule.windows);
      mac = normalize(rule.mac);
      if (win.kind !== 'windows' || !win.root) {
        bad('windows map ต้องเป็น UNC หรือ drive แบบ absolute');
      }
      if (mac.kind !== 'posix') {
        bad('mac map ต้องเป็นพาธ POSIX แบบ absolute');
      }
      key = mapKey(win.path, 'windows') + '\u0000' + mapKey(mac.path, 'posix');
      if (seen[key]) { continue; }
      seen[key] = true;
      // Keep explicitly configured alternatives; IO must inspect all and never
      // choose the first when more than one file exists or a target is unknown.
      out.push({ windows: win.path, mac: mac.path });
    }
    if (out.length > 20) { bad('maps ต้องไม่เกิน 20 คู่'); }
    return out;
  }

  function candidates(value, rules, platform) {
    var original = normalize(value);
    var maps = validateMaps(rules == null ? [] : rules);
    var compatible;
    var sourceKind;
    var sourceName;
    var targetKind;
    var targetName;
    var best = -1;
    var matches = [];
    var i;
    var source;
    var target;
    var sourceParts;
    var valueParts;
    var suffix;
    var mappedPath;
    var key;
    var seen = {};

    if (platform !== 'win32' && platform !== 'darwin' && platform !== 'linux') {
      bad('platform ต้องเป็น win32, darwin หรือ linux');
    }
    compatible = (original.kind === 'windows' && platform === 'win32') ||
      (original.kind === 'posix' && (platform === 'darwin' || platform === 'linux'));
    if (!compatible) {
      sourceKind = original.kind === 'windows' ? 'windows' : 'posix';
      sourceName = sourceKind === 'windows' ? 'windows' : 'mac';
      targetKind = sourceKind === 'windows' ? 'posix' : 'windows';
      targetName = targetKind === 'windows' ? 'windows' : 'mac';
      for (i = 0; i < maps.length; i += 1) {
        source = maps[i][sourceName];
        if (!isUnder(original.path, source, sourceKind)) { continue; }
        sourceParts = pathParts(source, sourceKind);
        if (sourceParts.length > best) {
          best = sourceParts.length;
          matches = [];
        }
        if (sourceParts.length === best) {
          matches.push(maps[i]);
        }
      }
      valueParts = pathParts(original.path, original.kind);
      for (i = 0; i < matches.length; i += 1) {
        source = matches[i][sourceName];
        target = matches[i][targetName];
        suffix = valueParts.slice(pathParts(source, sourceKind).length);
        if (targetKind === 'windows' && /\\/.test(original.path)) { continue; }
        mappedPath = joinMapped(target, targetKind, suffix);
        if (targetKind === 'windows' && hasWindowsBadTail(mappedPath)) { continue; }
        key = mapKey(mappedPath, targetKind);
        if (seen[key]) { continue; }
        seen[key] = true;
        mappedPath = normalize(mappedPath).path;
        mappedPath = { path: mappedPath, root: target, from: source, mode: 'mapped' };
        matches[i] = mappedPath;
      }
      /* Remove skipped entries without mutating the validated map array. */
      var mapped = [];
      for (i = 0; i < matches.length; i += 1) {
        if (matches[i] && matches[i].mode === 'mapped') { mapped.push(matches[i]); }
      }
      return {
        original: { path: original.path, compatible: compatible },
        mapped: mapped,
        needsMapping: !mapped.length
      };
    }
    return {
      original: { path: original.path, compatible: compatible },
      mapped: [],
      needsMapping: false
    };
  }

  function sameRelative(a, b) {
    var i;
    if (a.length !== b.length) { return false; }
    for (i = 0; i < a.length; i += 1) {
      if (nfc(a[i]) !== nfc(b[i])) { return false; }
    }
    return true;
  }

  function equivalent(a, b, rules) {
    var left = normalize(a);
    var right = normalize(b);
    var maps = validateMaps(rules == null ? [] : rules);
    var i;
    var leftParts;
    var rightParts;
    var sourceParts;
    var suffix;
    if (left.kind === right.kind) {
      if (left.kind === 'windows') {
        return mapKey(left.path, 'windows') === mapKey(right.path, 'windows');
      }
      return nfc(left.path) === nfc(right.path);
    }
    if (left.kind === 'windows') {
      for (i = 0; i < maps.length; i += 1) {
        if (!isUnder(left.path, maps[i].windows, 'windows') || !isUnder(right.path, maps[i].mac, 'posix')) { continue; }
        leftParts = pathParts(left.path, 'windows');
        rightParts = pathParts(right.path, 'posix');
        sourceParts = pathParts(maps[i].windows, 'windows');
        suffix = leftParts.slice(sourceParts.length);
        if (sameRelative(suffix, rightParts.slice(pathParts(maps[i].mac, 'posix').length))) { return true; }
      }
    } else {
      for (i = 0; i < maps.length; i += 1) {
        if (!isUnder(right.path, maps[i].windows, 'windows') || !isUnder(left.path, maps[i].mac, 'posix')) { continue; }
        leftParts = pathParts(left.path, 'posix');
        rightParts = pathParts(right.path, 'windows');
        sourceParts = pathParts(maps[i].mac, 'posix');
        suffix = rightParts.slice(pathParts(maps[i].windows, 'windows').length);
        if (sameRelative(suffix, leftParts.slice(sourceParts.length))) { return true; }
      }
    }
    return false;
  }

  return {
    normalize: normalize,
    validateMaps: validateMaps,
    rootOf: function (value) { return normalize(value).root; },
    candidates: candidates,
    equivalent: equivalent
  };
}));
