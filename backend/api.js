/* Modium – BACKEND: dữ liệu & xử lý tài khoản. KHÔNG có mã giao diện. Frontend chỉ gọi qua window.API (cuối file).
   Khi có máy chủ thật: viết lại các hàm trong file này thành fetch() tới API, giữ nguyên tên hàm của window.API.
   LƯU Ý: đây vẫn là bản demo chạy hoàn toàn trên trình duyệt. localStorage không thể bảo vệ tài khoản
   trước người có quyền DevTools/XSS; backend thật vẫn bắt buộc cho production. */
(function () {
  var UK = 'mdm_users', SK = 'mdm_session', AK = 'mdm_login_attempts';
  var PBKDF2_ITERATIONS = 310000, LEGACY_ITERATIONS = 150000, SESSION_TTL = 7 * 86400000;
  var fails = 0, lockUntil = 0;

  /* ---------- tiện ích ---------- */
  function rd(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
  function wr(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function rm(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function own(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function b64(buf) { var a = new Uint8Array(buf), s = ''; for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
  function unb64(s) { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  function randomB64(n) { return b64(window.crypto.getRandomValues(new Uint8Array(n))); }
  function secure() { return !!(window.crypto && window.crypto.subtle && window.crypto.getRandomValues && window.TextEncoder); }

  async function hashPw(pw, saltB64, iterations) {
    var key = await window.crypto.subtle.importKey('raw', new window.TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
    var bits = await window.crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unb64(saltB64), iterations: iterations || LEGACY_ITERATIONS, hash: 'SHA-256' }, key, 256);
    return b64(bits);
  }
  function same(a, b) { /* so sánh thời gian không đổi */
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    var r = 0; for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  }

  function handle(v) { return String(v == null ? '' : v).trim().replace(/^@+/, ''); }
  function handleKey(v) { return handle(v).toLowerCase(); }
  function text(v) {
    var s = String(v == null ? '' : v);
    return s.normalize ? s.normalize('NFC').trim() : s.trim();
  }
  function chars(s) { return Array.from ? Array.from(s).length : s.length; }
  function goodDisplayName(s) { return chars(s) >= 1 && chars(s) <= 40 && !/[\u0000-\u001f\u007f<>]/.test(s); }
  function goodText(s, max) { return chars(s) <= max && !/[\u0000-\u001f\u007f]/.test(s); }
  function goodEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) && s.length <= 120; }
  function goodPassword(s) { return typeof s === 'string' && s.length >= 12 && s.length <= 128 && !/[\u0000-\u001f\u007f]/.test(s); }
  function reservedHandle(k) { return k === '__proto__' || k === 'prototype' || k === 'constructor'; }
  function imageValue(s, max) { return typeof s === 'string' && s.length <= max && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(s) ? s : ''; }

  /* Tệp dự án nằm trong IndexedDB dưới dạng Blob, không chuyển thành base64/localStorage.
     IndexedDB ghi/đọc bất đồng bộ để không chặn luồng giao diện. Đây vẫn chỉ là dữ liệu trên thiết bị hiện tại. */
  var FILE_DB = 'mdm_project_files', FILE_STORE = 'files', MAX_FILE_BYTES = 25 * 1024 * 1024, MAX_USER_FILE_BYTES = 100 * 1024 * 1024;
  var fileDbPromise = null;
  function fileDb() {
    if (!window.indexedDB) return Promise.reject(new Error('Trình duyệt không hỗ trợ lưu tệp an toàn (IndexedDB).'));
    if (!fileDbPromise) fileDbPromise = new Promise(function (resolve, reject) {
      var req;
      try { req = window.indexedDB.open(FILE_DB, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () { if (!req.result.objectStoreNames.contains(FILE_STORE)) req.result.createObjectStore(FILE_STORE, { keyPath: 'id' }); };
      req.onsuccess = function () { req.result.onversionchange = function () { req.result.close(); fileDbPromise = null; }; resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Không mở được kho tệp.')); };
      req.onblocked = function () { reject(new Error('Kho tệp đang được mở ở thẻ khác. Hãy tải lại trang rồi thử lại.')); };
    });
    return fileDbPromise;
  }
  function cleanFileName(value) {
    var name = String(value == null ? '' : value).replace(/^.*[\\/]/, '')
      .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim().replace(/^\.+/, '').slice(0, 120);
    return name || 'download';
  }
  function downloadUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return '';
    try {
      var u = new URL(value.trim());
      return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname && !u.username && !u.password ? u.href : '';
    } catch (e) { return ''; }
  }
  function projectFileId() {
    if (!window.crypto || !window.crypto.getRandomValues) throw new Error('Trình duyệt không hỗ trợ tạo mã tệp an toàn.');
    return randomB64(18);
  }
  function saveProjectFile(file, owner, slug, id, name) {
    return fileDb().then(function (db) { return new Promise(function (resolve, reject) {
      var tx, failed = null;
      try {
        tx = db.transaction(FILE_STORE, 'readwrite');
        var store = tx.objectStore(FILE_STORE), cursor = store.openCursor(), size = +file.size;
        cursor.onsuccess = function () {
          var c = cursor.result;
          if (c) {
            if (c.value && c.value.owner === owner) size += Math.max(0, +c.value.size || 0);
            c.continue(); return;
          }
          if (size > MAX_USER_FILE_BYTES) { failed = new Error('Bạn đã vượt giới hạn tổng 100 MB tệp trong bản demo.'); tx.abort(); return; }
          store.put({ id: id, owner: owner, slug: slug, name: name, size: +file.size, blob: file, created: Date.now() });
        };
        tx.oncomplete = function () { resolve(id); };
        tx.onerror = tx.onabort = function () { reject(failed || tx.error || new Error('Không thể lưu tệp. Hãy kiểm tra dung lượng trống của trình duyệt.')); };
      } catch (e) { reject(e); }
    }); });
  }
  function readProjectFile(id) {
    return fileDb().then(function (db) { return new Promise(function (resolve, reject) {
      var tx;
      try {
        tx = db.transaction(FILE_STORE, 'readonly');
        var req = tx.objectStore(FILE_STORE).get(id);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error || new Error('Không đọc được tệp.')); };
      } catch (e) { reject(e); }
    }); });
  }
  function removeProjectFile(id) {
    return fileDb().then(function (db) { return new Promise(function (resolve, reject) {
      var tx;
      try { tx = db.transaction(FILE_STORE, 'readwrite'); tx.objectStore(FILE_STORE).delete(id); tx.oncomplete = resolve; tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Không xóa được tệp tạm.')); }; }
      catch (e) { reject(e); }
    }); });
  }
  function removeFilesForOwner(owner) {
    return fileDb().then(function (db) { return new Promise(function (resolve, reject) {
      var tx;
      try {
        tx = db.transaction(FILE_STORE, 'readwrite');
        var cursor = tx.objectStore(FILE_STORE).openCursor();
        cursor.onsuccess = function () { var c = cursor.result; if (!c) return; if (c.value && c.value.owner === owner) c.delete(); c.continue(); };
        tx.oncomplete = resolve; tx.onerror = tx.onabort = function () { reject(tx.error || new Error('Không dọn được tệp.')); };
      } catch (e) { reject(e); }
    }); });
  }

  /* ---------- dữ liệu tài khoản ---------- */
  function users() { var u = rd(UK, {}); return u && typeof u === 'object' && !Array.isArray(u) ? u : {}; }
  function put(o, k, v) { Object.defineProperty(o, k, { value: v, enumerable: true, configurable: true, writable: true }); }
  function find(id) {
    var raw = String(id == null ? '' : id).trim(), key = handleKey(raw), email = raw.toLowerCase();
    var all = users();
    if (own(all, key)) return all[key];
    for (var k in all) if (own(all, k) && all[k] && String(all[k].email || '').toLowerCase() === email) return all[k];
    return null;
  }
  function sessionKey() {
    var s = rd(SK, null), n = null, all = users();
    if (typeof s === 'string') {
      n = handleKey(s);
      if (own(all, n) && window.crypto && window.crypto.getRandomValues) setSession(n); /* nâng cấp session cũ */
    } else if (s && typeof s === 'object') {
      if (!s.key || !s.token || !s.expires || s.expires < Date.now()) { rm(SK); return null; }
      n = handleKey(s.key);
    }
    if (!n || !own(all, n)) { if (n) rm(SK); return null; }
    return n;
  }
  function setSession(n) {
    return !!n && wr(SK, { key: n, token: randomB64(24), created: Date.now(), expires: Date.now() + SESSION_TTL });
  }
  function user() {
    var n = sessionKey(), all = users();
    return n && own(all, n) ? all[n] : null;
  }

  /* Giới hạn thử đăng nhập được lưu lại giữa các lần tải trang (vẫn chỉ là biện pháp demo). */
  function attemptId(id) { return 'k:' + String(id == null ? '' : id).trim().toLowerCase().slice(0, 160); }
  function attemptData() { var a = rd(AK, {}); return a && typeof a === 'object' && !Array.isArray(a) ? a : {}; }
  function isAttemptLocked(id) {
    var a = attemptData(), k = attemptId(id), x = a[k];
    if (!x) return false;
    if (x.until && x.until > Date.now()) return true;
    delete a[k]; wr(AK, a); return false;
  }
  function failedAttempt(id) {
    var a = attemptData(), k = attemptId(id), x = a[k] || { count: 0, until: 0 };
    x.count = (+x.count || 0) + 1;
    if (x.count >= 5) { x.count = 0; x.until = Date.now() + 30000; }
    put(a, k, x); wr(AK, a);
    if (++fails >= 5) { lockUntil = Date.now() + 30000; fails = 0; }
  }
  function clearAttempts(id) { var a = attemptData(); delete a[attemptId(id)]; wr(AK, a); }

  function signUp(f) {
    f = f || {};
    return signUpAsync(f);
  }

  async function signUpAsync(f) {
    var name = handle(f.username), email = String(f.email || '').trim().toLowerCase(), displayName = text(f.displayName), pw = f.password || '';
    if (!name || !email || !displayName || !pw || !f.confirm) return { err: 'Vui lòng nhập đầy đủ thông tin.' };
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(name) || reservedHandle(name.toLowerCase())) return { err: 'Tên @ phải dài 3–20 ký tự, chỉ gồm chữ, số, dấu _ và -.' };
    if (!goodDisplayName(displayName)) return { err: 'Tên hiển thị dài 1–40 ký tự và không chứa ký tự đặc biệt nguy hiểm.' };
    if (!goodEmail(email)) return { err: 'Email không hợp lệ.' };
    if (!goodPassword(pw)) return { err: 'Mật khẩu phải có 12–128 ký tự và không chứa ký tự điều khiển.' };
    if (pw !== f.confirm) return { err: 'Mật khẩu xác nhận không khớp.' };
    if (!secure()) return { err: 'Trình duyệt này không hỗ trợ mã hóa mật khẩu an toàn.' };
    var all = users(), key = name.toLowerCase();
    if (own(all, key)) return { err: 'Tên @ đã được sử dụng.' };
    for (var k in all) if (own(all, k) && String(all[k].email || '').toLowerCase() === email) return { err: 'Email đã được sử dụng.' };
    var salt = randomB64(16), hash = await hashPw(pw, salt, PBKDF2_ITERATIONS);
    put(all, key, { username: name, displayName: displayName, email: email, salt: salt, hash: hash, iterations: PBKDF2_ITERATIONS, created: Date.now(), news: !!f.news });
    if (!wr(UK, all) || !setSession(key)) { delete all[key]; wr(UK, all); rm(SK); return { err: 'Không thể lưu tài khoản. Hãy kiểm tra trình duyệt có đang chặn lưu trữ không.' }; }
    return { ok: true };
  }

  async function signIn(id, pw, code) {
    var login = String(id == null ? '' : id).trim(), aid = attemptId(login);
    if (!login || !pw) return { err: 'Vui lòng nhập đầy đủ thông tin.' };
    if (Date.now() < lockUntil || isAttemptLocked(login)) return { err: 'Bạn đã thử quá nhiều lần. Hãy thử lại sau 30 giây.' };
    if (!secure()) return { err: 'Trình duyệt này không hỗ trợ mã hóa mật khẩu an toàn.' };
    var u = find(login);
    /* luôn băm một lần dù tài khoản không tồn tại, để thời gian phản hồi không lộ thông tin */
    var salt = u && u.salt ? u.salt : randomB64(16), iterations = u && u.iterations >= 100000 ? u.iterations : LEGACY_ITERATIONS, h;
    try { h = await hashPw(pw, salt, iterations); } catch (e) { h = ''; }
    if (!u || !same(h, u.hash)) {
      failedAttempt(aid);
      return { err: 'Email/tên đăng nhập hoặc mật khẩu không đúng.' };
    }
    if (u.totp && !(await totpOk(u.totp, code))) { if (code) failedAttempt(aid); return { err: code ? 'Mã xác thực không đúng.' : 'Nhập mã xác thực 2 bước từ ứng dụng của bạn.', need2fa: true }; }
    fails = 0;
    clearAttempts(login);
    /* Nâng cấp hash cũ sau khi người dùng đăng nhập đúng, không làm mất tài khoản cũ. */
    if (iterations !== PBKDF2_ITERATIONS) {
      try {
        u.salt = randomB64(16); u.hash = await hashPw(pw, u.salt, PBKDF2_ITERATIONS); u.iterations = PBKDF2_ITERATIONS;
        var upgraded = users(), upgradedKey = handleKey(u.username);
        if (!own(upgraded, upgradedKey)) return { err: 'Không thể cập nhật bảo mật tài khoản.' };
        put(upgraded, upgradedKey, u);
        if (!wr(UK, upgraded)) return { err: 'Không thể cập nhật bảo mật tài khoản.' };
      } catch (e) { return { err: 'Không thể cập nhật bảo mật tài khoản.' }; }
    }
    if (!setSession(u.username.toLowerCase())) return { err: 'Không thể lưu phiên đăng nhập. Hãy kiểm tra trình duyệt có đang chặn lưu trữ không.' };
    return { ok: true };
  }

  function signOut() { rm(SK); }

  /* ================== QUẢN LÝ HỒ SƠ & BẢO MẬT ================== */
  function displayOf(u) { var d = text(u && u.displayName); return goodDisplayName(d) ? d : String(u && u.username || ''); }
  function bioOf(u) { var b = text(u && u.bio); return goodText(b, 160) ? b : ''; }
  function pub(u) { return u ? { username: u.username, handle: '@' + u.username, displayName: displayOf(u), email: String(u.email || ''), created: u.created, bio: bioOf(u), avatar: imageValue(u.avatar, 300000), totp: !!u.totp } : null; }
  function mutate(fn) {
    var all = users(), n = sessionKey(), u = n && own(all, n) ? all[n] : null;
    if (!u) return { err: 'Bạn chưa đăng nhập.' };
    try { var r = fn(all, u, n); if (r && r.err) return r; } catch (e) { return { err: 'Dữ liệu thay đổi không hợp lệ.' }; }
    return wr(UK, all) ? { ok: true } : { err: 'Không thể lưu thay đổi.' };
  }
  async function verify(pw) { var u = user(); if (!u || !pw || !secure()) return false; try { return same(await hashPw(pw, u.salt, u.iterations >= 100000 ? u.iterations : LEGACY_ITERATIONS), u.hash); } catch (e) { return false; } }
  var BAD = { err: 'Mật khẩu hiện tại không đúng.' };

  function updateProfile(f) {
    f = f || {};
    return mutate(function (all, u, n) {
      var name = f.username == null ? u.username : handle(f.username), key = name.toLowerCase(), dn = text(f.displayName == null ? displayOf(u) : f.displayName), av = f.avatar || '', bio = text(f.bio || '');
      if (!/^[A-Za-z0-9_-]{3,20}$/.test(name) || reservedHandle(key)) return { err: 'Tên @ không hợp lệ.' };
      if (key !== n) return { err: 'Tên @ không thể đổi sau khi tạo tài khoản để bảo vệ liên kết dự án.' };
      if (!goodDisplayName(dn)) return { err: 'Tên hiển thị dài 1–40 ký tự và không chứa ký tự đặc biệt nguy hiểm.' };
      if (!goodText(bio, 160)) return { err: 'Giới thiệu chỉ được dài tối đa 160 ký tự.' };
      if (av && (av.length > 300000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(av))) return { err: 'Ảnh đại diện không hợp lệ.' };
      u.displayName = dn; u.bio = bio; u.avatar = av;
    });
  }
  async function changeEmail(pw, email) {
    email = (email || '').trim().toLowerCase();
    if (!goodEmail(email)) return { err: 'Email không hợp lệ.' };
    if (!(await verify(pw))) return BAD;
    return mutate(function (all, u, n) { for (var k in all) if (own(all, k) && k !== n && String(all[k].email || '').toLowerCase() === email) return { err: 'Email đã được sử dụng.' }; u.email = email; });
  }
  async function changePassword(old, nw, cf) {
    if (!goodPassword(nw)) return { err: 'Mật khẩu mới phải có 12–128 ký tự và không chứa ký tự điều khiển.' };
    if (nw !== cf) return { err: 'Mật khẩu xác nhận không khớp.' };
    if (!(await verify(old))) return BAD;
    var salt = randomB64(16), hash = await hashPw(nw, salt, PBKDF2_ITERATIONS);
    return mutate(function (a, u) { u.salt = salt; u.hash = hash; u.iterations = PBKDF2_ITERATIONS; });
  }

  /* ---------- xác thực 2 bước (TOTP – RFC 6238) ---------- */
  var B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', pend = null;
  function toB32(a) { var s = '', bits = 0, v = 0; for (var i = 0; i < a.length; i++) { v = (v << 8) | a[i]; bits += 8; while (bits >= 5) { s += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } } return bits ? s + B32[(v << (5 - bits)) & 31] : s; }
  function fromB32(s) { var o = [], bits = 0, v = 0; for (var i = 0; i < s.length; i++) { v = (v << 5) | B32.indexOf(s[i]); bits += 5; if (bits >= 8) { o.push((v >>> (bits - 8)) & 255); bits -= 8; } } return new Uint8Array(o); }
  async function totp(sec, step) {
    var key = await window.crypto.subtle.importKey('raw', fromB32(sec), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']), m = new Uint8Array(8), n = step;
    for (var i = 7; i >= 0; i--) { m[i] = n & 255; n = Math.floor(n / 256); }
    var h = new Uint8Array(await window.crypto.subtle.sign('HMAC', key, m)), o = h[19] & 15;
    return ('00000' + ((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000)).slice(-6);
  }
  async function totpOk(sec, code) {
    code = String(code || '').replace(/\s/g, ''); if (!/^\d{6}$/.test(code)) return false;
    var s = Math.floor(Date.now() / 30000); for (var d = -1; d <= 1; d++) if (same(await totp(sec, s + d), code)) return true; return false;
  }
  function totpBegin() { var u = user(); if (!u || !secure()) return { err: 'Không thể tạo khóa 2FA trên trình duyệt này.' }; pend = toB32(window.crypto.getRandomValues(new Uint8Array(20))); return { secret: pend, uri: 'otpauth://totp/Modium:' + encodeURIComponent(u.username) + '?secret=' + pend + '&issuer=Modium' }; }
  async function totpEnable(code) { if (!pend || !(await totpOk(pend, code))) return { err: 'Mã không đúng. Hãy thử mã mới trong ứng dụng.' }; var s = pend; pend = null; return mutate(function (a, u) { u.totp = s; }); }
  async function totpDisable(pw) { if (!(await verify(pw))) return BAD; return mutate(function (a, u) { delete u.totp; }); }

  async function deleteAccount(pw) {
    if (!(await verify(pw))) return BAD;
    var n = sessionKey(), all = users(), oldProjects = projs(), remaining = oldProjects.filter(function (p) { return p.owner !== n; });
    if (!n || !own(all, n)) return { err: 'Bạn chưa đăng nhập.' };
    remaining.forEach(function (p) { if (Array.isArray(p.collab)) p.collab = p.collab.filter(function (c) { return c !== n; }); });
    if (!wr(PK, remaining)) return { err: 'Không thể xóa dữ liệu dự án của tài khoản.' };
    delete all[n];
    if (!wr(UK, all)) { wr(PK, oldProjects); return { err: 'Không thể xóa tài khoản.' }; }
    signOut(); removeFilesForOwner(n).catch(function () {}); return { ok: true };
  }
  function exportData() { var p = pub(user()); if (!p) return '{}'; p.created = new Date(p.created).toISOString(); return JSON.stringify(p, null, 2); }

  /* ================== DỰ ÁN (mod, modpack, gói tài nguyên, script, shader, công trình) ================== */
  var PK = 'mdm_projects', PTYPES = ['mods', 'modpacks', 'resourcepacks', 'plugins', 'shaders', 'structures'], PVIS = ['public', 'unlisted', 'private'],
    PRESOLUTIONS = ['8x', '16x', '32x', '48x', '64x', '128x', '256x', '512x'];
  function projs() { var p = rd(PK, []); return Array.isArray(p) ? p.filter(function (x) { return x && typeof x === 'object' && !Array.isArray(x); }) : []; }
  function me() { var n = sessionKey(), all = users(); return n && own(all, n) ? n : null; }
  function pubProfile(k) { var all = users(), key = handleKey(k), u = own(all, key) ? all[key] : null; return u ? { username: u.username, handle: '@' + u.username, displayName: displayOf(u), bio: bioOf(u), avatar: imageValue(u.avatar, 300000), created: u.created } : null; }
  function mine(p, n) { var c = Array.isArray(p.collab) ? p.collab : []; return !!n && (p.owner === n || c.indexOf(n) > -1); }
  function projectDownload(d) {
    if (!d || typeof d !== 'object') return null;
    if (d.mode === 'url') { var url = downloadUrl(d.url); return url ? { mode: 'url', url: url } : null; }
    if (d.mode === 'upload' && typeof d.fileId === 'string' && /^[A-Za-z0-9+/]{24}$/.test(d.fileId)) {
      var size = +d.fileSize, name = cleanFileName(d.fileName);
      return size > 0 && size <= MAX_FILE_BYTES ? { mode: 'upload', fileId: d.fileId, fileName: name, fileSize: size } : null;
    }
    return null;
  }
  function canViewProject(p, n) {
    return !!p && PVIS.indexOf(p.vis) > -1 && !!pubProfile(p.owner) && (p.vis !== 'private' || mine(p, n));
  }
  function projectBySlug(slug, n) {
    var wanted = String(slug || '').trim().toLowerCase(), l = projs();
    for (var i = 0; i < l.length; i++) if (String(l[i].slug || '').toLowerCase() === wanted && canViewProject(l[i], n)) return l[i];
    return null;
  }
  function bumpProjectDownloads(p) {
    var l = projs();
    for (var i = 0; i < l.length; i++) if (l[i].slug === p.slug && l[i].owner === p.owner) {
      l[i].downloads = Math.min(1000000000, Math.max(0, +l[i].downloads || 0) + 1); wr(PK, l); return;
    }
  }
  function view(p) {
    var col = Array.isArray(p.collab) ? p.collab : [], cats = Array.isArray(p.cats) ? p.cats : [];
    return { slug: /^[a-z0-9-]{3,40}$/.test(p.slug) ? p.slug : '', name: goodText(text(p.name), 40) ? text(p.name) : '', type: PTYPES.indexOf(p.type) > -1 ? p.type : 'mods', vis: PVIS.indexOf(p.vis) > -1 ? p.vis : 'private', owner: pubProfile(p.owner), collab: col.map(pubProfile).filter(Boolean), cats: cats.filter(function (c) { return typeof c === 'string' && /^[a-z]{2,20}$/.test(c); }),
      resolution: p.type === 'resourcepacks' && PRESOLUTIONS.indexOf(p.resolution) > -1 ? p.resolution : '', icon: imageValue(p.icon, 150000), banner: imageValue(p.banner, 350000), summary: goodText(text(p.summary), 200) ? text(p.summary) : '', download: projectDownload(p.download), created: +p.created || 0, updated: +p.updated || 0, downloads: Math.max(0, +p.downloads || 0), follows: Math.max(0, +p.follows || 0) };
  }
  /* danh sách công khai cho trang duyệt (định dạng của browse.js) */
  function projects(type) {
    return projs().filter(function (p) { return p.vis === 'public' && p.type === type && pubProfile(p.owner); }).map(function (p) {
      var o = pubProfile(p.owner);
      return { slug: p.slug, name: p.name, author: o.displayName, authorHandle: o.username, desc: p.summary, downloads: +p.downloads || 0, follows: +p.follows || 0, updated: new Date(+p.updated || Date.now()).toISOString(), categories: Array.isArray(p.cats) ? p.cats : [], resolution: p.type === 'resourcepacks' && PRESOLUTIONS.indexOf(p.resolution) > -1 ? p.resolution : '', icon: imageValue(p.icon, 150000), banner: imageValue(p.banner, 350000) };
    });
  }
  function getProject(slug) { var p = projectBySlug(slug, me()); return p ? view(p) : null; }
  async function downloadProject(slug) {
    var n = me(), p = projectBySlug(slug, n), d = p && projectDownload(p.download);
    if (!p) return { err: 'Dự án không tồn tại hoặc bạn không có quyền truy cập.' };
    if (!d) return { err: 'Dự án này chưa có tệp hoặc đường dẫn tải xuống hợp lệ.' };
    if (d.mode === 'url') {
      bumpProjectDownloads(p);
      return d;
    }
    var record;
    try { record = await readProjectFile(d.fileId); } catch (e) { return { err: 'Không thể đọc tệp trong trình duyệt. Hãy thử lại.' }; }
    if (!record || record.owner !== p.owner || record.slug !== p.slug || +record.size !== d.fileSize || !record.blob) return { err: 'Không tìm thấy tệp trên thiết bị này. Trong bản demo, tệp upload chưa được đồng bộ lên máy chủ.' };
    bumpProjectDownloads(p);
    return { mode: 'upload', fileName: cleanFileName(record.name || d.fileName), blob: new Blob([record.blob], { type: 'application/octet-stream' }) };
  }
  function userProjects(name) {
    var k = handleKey(name), n = me();
    return projs().filter(function (p) { return (p.owner === k || (Array.isArray(p.collab) && p.collab.indexOf(k) > -1)) && (p.vis === 'public' || mine(p, n)); }).map(view);
  }
  function searchUsers(q) {
    q = String(q || '').replace(/^@/, '').toLowerCase(); var n = me(), all = users(), out = [];
    if (!n || !q) return out;
    for (var k in all) if (own(all, k) && k !== n && k.indexOf(q) === 0 && out.length < 6) out.push({ username: all[k].username, handle: '@' + all[k].username, displayName: displayOf(all[k]), avatar: imageValue(all[k].avatar, 300000) });
    return out;
  }
  async function createProject(f) {
    f = f || {};
    var n = me(); if (!n) return { err: 'Bạn chưa đăng nhập.' };
    var name = String(f.name || '').trim(), slug = String(f.slug || '').trim().toLowerCase(), sum = String(f.summary || '').trim(), list = projs();
    if (list.length >= 100) return { err: 'Tài khoản đã đạt giới hạn 100 dự án trong bản demo.' };
    if (PVIS.indexOf(f.vis) < 0) return { err: 'Hãy chọn chế độ hiển thị.' };
    if (name.length < 3 || name.length > 40 || !goodText(name, 40)) return { err: 'Tên dự án phải dài 3–40 ký tự hợp lệ.' };
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) return { err: 'URL chỉ gồm chữ thường, số, dấu - (3–40 ký tự).' };
    if (list.some(function (p) { return String(p.slug || '').toLowerCase() === slug; })) return { err: 'URL này đã được dùng, hãy đổi tên khác.' };
    if (PTYPES.indexOf(f.type) < 0) return { err: 'Hãy chọn loại dự án.' };
    if (f.type === 'resourcepacks' && PRESOLUTIONS.indexOf(f.resolution) < 0) return { err: 'Hãy chọn độ phân giải của gói tài nguyên.' };
    if (!sum || sum.length > 200 || !goodText(sum, 200)) return { err: 'Hãy nhập mô tả ngắn hợp lệ (tối đa 200 ký tự).' };
    var dl = null, fileId = null;
    if (f.downloadMode === 'url') {
      var url = downloadUrl(f.url);
      if (!url) return { err: 'Hãy nhập URL HTTP/HTTPS hợp lệ (không dùng javascript:, data: hoặc thông tin đăng nhập trong URL).' };
      dl = { mode: 'url', url: url };
    } else if (f.downloadMode === 'upload') {
      var file = f.file;
      if (!(typeof Blob !== 'undefined' && file instanceof Blob) || typeof file.name !== 'string') return { err: 'Hãy chọn tệp cần tải lên.' };
      if (file.size < 1 || file.size > MAX_FILE_BYTES) return { err: 'Tệp phải có dung lượng từ 1 byte đến 25 MB.' };
      var fileName = cleanFileName(file.name);
      if (fileName === 'download') return { err: 'Tên tệp không hợp lệ.' };
      try {
        fileId = projectFileId();
        await saveProjectFile(file, n, slug, fileId, fileName);
      } catch (e) { return { err: e && e.message ? e.message : 'Không thể lưu tệp trong trình duyệt.' }; }
      dl = { mode: 'upload', fileId: fileId, fileName: fileName, fileSize: file.size };
    } else return { err: 'Hãy chọn tải tệp lên hoặc nhập URL tải xuống.' };
    var cats = (Array.isArray(f.cats) ? f.cats : []).filter(function (c) { return typeof c === 'string' && /^[a-z]{2,20}$/.test(c); }).slice(0, 8), col = [], all = users();
    (Array.isArray(f.collab) ? f.collab : []).forEach(function (c) { var k = handleKey(c); if (k !== n && own(all, k) && col.indexOf(k) < 0) col.push(k); });
    var t = Date.now();
    list.push({ slug: slug, name: name, type: f.type, vis: f.vis, resolution: f.type === 'resourcepacks' ? f.resolution : '', owner: n, collab: col.slice(0, 10), cats: cats, icon: imageValue(f.icon, 150000),
      banner: (f.type === 'modpacks' || f.type === 'resourcepacks') ? imageValue(f.banner, 350000) : '', summary: sum, download: dl, created: t, updated: t, downloads: 0, follows: 0 });
    if (wr(PK, list)) return { ok: true, slug: slug };
    if (fileId) removeProjectFile(fileId).catch(function () {});
    return { err: 'Không thể lưu project. Bộ nhớ trình duyệt có thể đã đầy; hãy dùng ảnh nhỏ hơn hoặc tệp nhẹ hơn.' };
  }

  /* Giao diện công khai của backend – frontend CHỈ được gọi qua đây */
  window.API = { user: function () { return pub(user()); }, signUp: signUp, signIn: signIn, signOut: signOut, updateProfile: updateProfile, changeEmail: changeEmail,
    changePassword: changePassword, totpBegin: totpBegin, totpEnable: totpEnable, totpDisable: totpDisable, deleteAccount: deleteAccount, exportData: exportData,
    profileOf: pubProfile, projects: projects, getProject: getProject, downloadProject: downloadProject, userProjects: userProjects, searchUsers: searchUsers, createProject: createProject };
})();
