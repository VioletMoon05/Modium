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
;
/* Modium – dữ liệu tài nguyên cho trang duyệt.
   Hiện CHƯA có ai đăng gì nên mọi danh sách đều trống; trang sẽ hiện trạng thái "Chưa có tài nguyên nào".
   Khi có máy chủ / API, đổ dữ liệu vào đây (hoặc gán window.DATA.items từ API trước khi trang chạy).

   Mỗi tài nguyên là một đối tượng:
   {
     name: 'Tên', author: 'tên_tác_giả',
     desc: 'Mô tả' | { vi: 'Mô tả', en: 'Description' },
     downloads: 0, follows: 0, updated: '2026-10-01',        // ngày cập nhật (ISO)
     categories: ['decoration'],                              // mã danh mục (xem CATS / RP_CATS trong browse.js)
     env: 'client' | 'server' | 'both' | 'either',            // môi trường (mods, modpack, plugin…)
     license: 'os' | 'cr',                                    // os = mã nguồn mở
     resolution: '16x',                                       // chỉ gói tài nguyên: 8x, 16x, 32x, 48x, 64x, 128x, 256x, 512x
     dependencies: ['Tên dự án khác'],                        // tuỳ chọn
     icon: 'https://…/icon.png', banner: 'https://…/bia.png'  // tuỳ chọn; không có thì tự vẽ ô màu
   }
*/
window.DATA = {
  items: { mods: [], resourcepacks: [], datapacks: [], shaders: [], modpacks: [], plugins: [], servers: [] }
};
;
/* Browser-visible Supabase project configuration. The anon/publishable key is public;
   never put a service-role key or database password in this file. */
window.MODIUM_SUPABASE = {
  url: '',
  anonKey: '',
  required: false
};
;
/* Supabase-backed shared API. If no public project config is present, keep the local demo API. */
(function () {
  var cfg = window.MODIUM_SUPABASE || {};
  var configured = !!(cfg.url || cfg.anonKey);
  function failStartup(message) {
    window.API.init = function () { return Promise.reject(new Error(message)); };
  }
  if (!configured) {
    if (cfg.required) { window.API.remote = true; failStartup('Supabase configuration is required for this deployment'); }
    return;
  }
  window.API.remote = true;
  if (!cfg.url || !cfg.anonKey) { failStartup('Incomplete Supabase configuration'); return; }
  try {
    var projectUrl = new URL(cfg.url);
    if ((projectUrl.protocol !== 'https:' && !(projectUrl.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(projectUrl.hostname))) || projectUrl.username || projectUrl.password) {
      failStartup('Supabase URL must use HTTPS and contain no credentials'); return;
    }
  } catch (e) { failStartup('Invalid Supabase URL'); return; }
  if (/^sb_secret_/i.test(cfg.anonKey)) { failStartup('A secret key must never be used in the browser'); return; }
  try {
    var token = cfg.anonKey.split('.')[1], payload;
    if (token) {
      payload = token.replace(/-/g, '+').replace(/_/g, '/');
      while (payload.length % 4) payload += '=';
    }
    if (payload && JSON.parse(atob(payload)).role === 'service_role') {
      failStartup('A service-role key must never be used in the browser'); return;
    }
  } catch (e) {}
  if (!window.supabase || !window.supabase.createClient) { failStartup('Supabase JavaScript library failed to load'); return; }

  var client;
  try {
    client = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
    });
  } catch (e) { failStartup('Invalid Supabase configuration'); return; }

  var passwordRecovery = new URLSearchParams(window.location.search).get('flow') === 'reset-password';
  client.auth.onAuthStateChange(function (event) {
    if (event === 'PASSWORD_RECOVERY') passwordRecovery = true;
  });
  var cache = { authUser: null, profiles: [], profilesById: {}, profilesByName: {}, projects: [], collaborators: [], ownerProjectCount: 0, pendingFactor: null, totp: false };
  var TYPES = ['mods', 'modpacks', 'resourcepacks', 'plugins', 'shaders', 'structures'];
  var VIS = ['public', 'unlisted', 'private'];
  var RES = ['8x', '16x', '32x', '48x', '64x', '128x', '256x', '512x'];
  var MAX_FILE = 25 * 1024 * 1024;
  var LIST_COLUMNS = 'id,slug,name,type,visibility,owner_id,categories,resolution,summary,downloads,follows,created_at,updated_at';

  function cleanName(value) {
    return String(value == null ? '' : value).replace(/^.*[\\/]/, '')
      .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim().replace(/^\.+/, '').slice(0, 120) || 'download';
  }
  function safeUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return '';
    try {
      var u = new URL(value.trim());
      return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname && !u.username && !u.password ? u.href : '';
    } catch (e) { return ''; }
  }
  function errorText(err, fallback) {
    var msg = String(err && err.message || '');
    if (/already registered|already exists|duplicate key/i.test(msg)) return 'Tên @ hoặc email đã được sử dụng.';
    if (/invalid login credentials|invalid.*credentials|wrong password/i.test(msg)) return 'Email/tên đăng nhập hoặc mật khẩu không đúng.';
    if (/password/i.test(msg) && /length|characters|weak/i.test(msg)) return 'Mật khẩu phải có 12–128 ký tự và không chứa ký tự điều khiển.';
    if (/email/i.test(msg) && /invalid/i.test(msg)) return 'Email không hợp lệ.';
    return fallback || 'Không thể hoàn tất yêu cầu. Hãy thử lại.';
  }
  function profileShape(row) {
    if (!row) return null;
    return { id: row.id, username: row.username, handle: '@' + row.username, displayName: row.display_name || row.username,
      bio: row.bio || '', avatar: row.avatar || '', created: Date.parse(row.created_at) || Date.now() };
  }
  function currentUser() {
    var u = cache.authUser, p = u && cache.profilesById[u.id];
    if (!u || !p) return null;
    var out = profileShape(p); out.email = u.email || ''; out.totp = !!cache.totp; return out;
  }
  function projectShape(row) {
    var owner = profileShape(cache.profilesById[row.owner_id]);
    var collaborators = cache.collaborators.filter(function (c) { return c.project_id === row.id; }).map(function (c) { return profileShape(cache.profilesById[c.user_id]); }).filter(Boolean);
    var download = row.download_mode === 'url' ? { mode: 'url', url: row.download_url || '' }
      : row.download_mode === 'upload' ? { mode: 'upload', fileName: row.file_name || 'download', fileSize: +row.file_size || 0 } : null;
    return { id: row.id, slug: row.slug, name: row.name, type: row.type, vis: row.visibility, owner: owner || { id: row.owner_id, username: 'unknown', displayName: 'Modium user', bio: '', avatar: '', created: Date.now() },
      collab: collaborators, cats: Array.isArray(row.categories) ? row.categories : [], resolution: row.resolution || '', icon: row.icon || '', banner: row.banner || '', summary: row.summary || '',
      download: download, created: Date.parse(row.created_at) || Date.now(), updated: Date.parse(row.updated_at) || Date.now(), downloads: +row.downloads || 0, follows: +row.follows || 0,
      _filePath: row.file_path || '', _ownerId: row.owner_id };
  }
  function cacheProfiles(rows) {
    (rows || []).forEach(function (p) {
      var merged = Object.assign({}, cache.profilesById[p.id] || {}, p);
      if (!Object.prototype.hasOwnProperty.call(p, 'avatar')) merged.avatar = (cache.profilesById[p.id] || {}).avatar || '';
      cache.profilesById[merged.id] = merged;
      cache.profilesByName[merged.username.toLowerCase()] = merged;
    });
    cache.profiles = Object.keys(cache.profilesById).map(function (id) { return cache.profilesById[id]; });
  }
  async function loadProfiles(ids, includeAvatar) {
    ids = ids.filter(function (id, i) { return id && ids.indexOf(id) === i; });
    if (!ids.length) return;
    var columns = 'id,username,display_name,bio,created_at' + (includeAvatar ? ',avatar' : '');
    for (var offset = 0; offset < ids.length; offset += 100) {
      var result = await client.from('profiles').select(columns).in('id', ids.slice(offset, offset + 100)).limit(100);
      if (result.error) throw result.error;
      cacheProfiles(result.data);
    }
  }
  async function loadCache() {
    var uid = cache.authUser && cache.authUser.id;
    var requests = [client.from('projects').select(LIST_COLUMNS).eq('visibility', 'public').order('created_at', { ascending: false }).limit(500)];
    if (uid) {
      requests.push(client.from('profiles').select('id,username,display_name,bio,avatar,created_at').eq('id', uid).maybeSingle());
      requests.push(client.from('projects').select('id', { count: 'exact', head: true }).eq('owner_id', uid));
    }
    var results = await Promise.all(requests);
    for (var i = 0; i < results.length; i++) if (results[i].error) throw results[i].error;
    cache.projects = results[0].data || []; cache.collaborators = [];
    cache.profiles = []; cache.profilesById = {}; cache.profilesByName = {};
    cache.ownerProjectCount = uid ? results[2].count || 0 : 0;
    if (uid && results[1].data) cacheProfiles([results[1].data]);
    await loadProfiles(cache.projects.map(function (p) { return p.owner_id; }), false);
    var user = cache.authUser;
    cache.totp = false;
    if (user) {
      try {
        var factors = await client.auth.mfa.listFactors();
        cache.totp = !!(factors.data && factors.data.totp && factors.data.totp.some(function (f) { return f.status === 'verified'; }));
      } catch (e) {}
    }
  }
  async function init() {
    var result = await client.auth.getSession();
    if (result.error) throw result.error;
    cache.authUser = result.data.session ? result.data.session.user : null;
    if (cache.authUser && !passwordRecovery) {
      var level = await client.auth.mfa.getAuthenticatorAssuranceLevel();
      if (!level.error && level.data.nextLevel === 'aal2' && level.data.currentLevel !== 'aal2') {
        await client.auth.signOut();
        cache.authUser = null;
      }
    }
    await loadCache();
    client.auth.onAuthStateChange(function (event, session) {
      cache.authUser = session ? session.user : null;
      if (event === 'SIGNED_OUT') { cache.totp = false; cache.projects = []; cache.collaborators = []; cache.profiles = []; cache.profilesById = {}; cache.profilesByName = {}; cache.ownerProjectCount = 0; }
      if (window.A && window.A.header) window.A.header();
    });
    return { ok: true };
  }
  function visibleProfile(row) { return profileShape(row); }
  async function profileOf(name) {
    var key = String(name || '').replace(/^@+/, '').toLowerCase();
    var row = cache.profilesByName[key];
    if (!row) {
      var result = await client.from('profiles').select('id,username,display_name,bio,avatar,created_at').eq('username', key).maybeSingle();
      if (result.error) throw result.error;
      row = result.data;
      if (row) cacheProfiles([row]);
    }
    return visibleProfile(row);
  }
  function publicProjects(type) {
    return cache.projects.filter(function (p) { return p.visibility === 'public' && p.type === type; }).map(function (row) {
      var p = projectShape(row);
      return { slug: p.slug, name: p.name, author: p.owner.displayName, authorHandle: p.owner.username, desc: p.summary, downloads: p.downloads,
        follows: p.follows, updated: new Date(p.updated).toISOString(), categories: p.cats, resolution: p.resolution, icon: '', banner: '' };
    });
  }
  async function getProject(slug) {
    var wanted = String(slug || '').trim().toLowerCase();
    if (!/^[a-z0-9-]{3,40}$/.test(wanted)) return null;
    var result = await client.rpc('get_project_by_slug', { project_slug: wanted });
    if (result.error) throw result.error;
    var row = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!row) return null;
    await loadProfiles([row.owner_id], true);
    var related = await client.from('project_collaborators').select('project_id,user_id').eq('project_id', row.id).limit(10);
    if (!related.error) {
      cache.collaborators = cache.collaborators.filter(function (c) { return c.project_id !== row.id; }).concat(related.data || []);
      await loadProfiles((related.data || []).map(function (c) { return c.user_id; }), true);
    }
    var index = cache.projects.findIndex(function (p) { return p.id === row.id; });
    if (index < 0) cache.projects.push(row); else cache.projects[index] = row;
    return projectShape(row);
  }
  async function userProjects(name) {
    var key = String(name || '').replace(/^@+/, '').toLowerCase(), profile = cache.profilesByName[key];
    if (!profile) {
      var found = await client.from('profiles').select('id,username,display_name,bio,created_at').eq('username', key).maybeSingle();
      if (found.error) throw found.error;
      profile = found.data; if (profile) cacheProfiles([profile]);
    }
    if (!profile) return [];
    var result = await Promise.all([
      client.from('projects').select(LIST_COLUMNS).eq('owner_id', profile.id).order('created_at', { ascending: false }).limit(100),
      client.from('project_collaborators').select('project_id').eq('user_id', profile.id).limit(200)
    ]);
    if (result[0].error) throw result[0].error;
    var rows = result[0].data || [], ids = (result[1].data || []).map(function (x) { return x.project_id; });
    if (ids.length) {
      for (var offset = 0; offset < ids.length; offset += 100) {
        var shared = await client.from('projects').select(LIST_COLUMNS).in('id', ids.slice(offset, offset + 100)).limit(100);
        if (shared.error) throw shared.error;
        rows = rows.concat(shared.data || []);
      }
    }
    var unique = [];
    rows.forEach(function (p) { if (!unique.some(function (x) { return x.id === p.id; })) unique.push(p); });
    await loadProfiles(unique.map(function (p) { return p.owner_id; }), false);
    return unique.map(projectShape);
  }
  async function searchUsers(query) {
    var q = String(query || '').replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_-]/g, ''), me = cache.authUser && cache.authUser.id;
    if (!q) return [];
    var result = await client.from('profiles').select('id,username,display_name,created_at').ilike('username', q + '%').limit(7);
    if (result.error) throw result.error;
    cacheProfiles(result.data);
    return (result.data || []).filter(function (p) { return p.id !== me; }).slice(0, 6).map(function (p) {
      var u = profileShape(p); return { username: u.username, handle: u.handle, displayName: u.displayName, avatar: u.avatar };
    });
  }
  function validateProject(f) {
    if (!cache.authUser) return 'Bạn chưa đăng nhập.';
    if (cache.ownerProjectCount >= 100) return 'Tài khoản đã đạt giới hạn 100 dự án.';
    if (VIS.indexOf(f.vis) < 0) return 'Hãy chọn chế độ hiển thị.';
    if (typeof f.name !== 'string' || f.name.trim().length < 3 || f.name.trim().length > 40) return 'Tên dự án phải dài 3–40 ký tự hợp lệ.';
    if (!/^[a-z0-9-]{3,40}$/.test(String(f.slug || '').trim().toLowerCase())) return 'URL chỉ gồm chữ thường, số, dấu - (3–40 ký tự).';
    if (!TYPES.includes(f.type)) return 'Hãy chọn loại dự án.';
    if (f.type === 'resourcepacks' && RES.indexOf(f.resolution) < 0) return 'Hãy chọn độ phân giải của gói tài nguyên.';
    if (typeof f.summary !== 'string' || !f.summary.trim() || f.summary.trim().length > 200) return 'Hãy nhập mô tả ngắn hợp lệ (tối đa 200 ký tự).';
    if (f.downloadMode === 'url' && !safeUrl(f.url)) return 'Hãy nhập URL HTTP/HTTPS hợp lệ (không dùng javascript:, data: hoặc thông tin đăng nhập trong URL).';
    if (f.downloadMode === 'upload' && (!(f.file instanceof Blob) || !f.file.name || f.file.size < 1 || f.file.size > MAX_FILE)) return 'Tệp phải có dung lượng từ 1 byte đến 25 MB.';
    if (f.downloadMode !== 'url' && f.downloadMode !== 'upload') return 'Hãy chọn tải tệp lên hoặc nhập URL tải xuống.';
    if (cache.projects.some(function (p) { return p.slug.toLowerCase() === String(f.slug).toLowerCase(); })) return 'URL này đã được dùng, hãy đổi tên khác.';
    return '';
  }
  async function createProject(f) {
    f = f || {};
    var invalid = validateProject(f); if (invalid) return { err: invalid };
    var user = currentUser(), slug = String(f.slug).trim().toLowerCase(), file = f.downloadMode === 'upload' ? f.file : null;
    var fileName = file ? cleanName(file.name) : '', filePath = file ? user.id + '/' + crypto.randomUUID() + '/' + fileName : null;
    var row = { slug: slug, name: f.name.trim(), type: f.type, visibility: f.vis, resolution: f.type === 'resourcepacks' ? f.resolution : null,
      owner_id: user.id, categories: (Array.isArray(f.cats) ? f.cats : []).filter(function (c) { return typeof c === 'string' && /^[a-z]{2,20}$/.test(c); }).slice(0, 8),
      icon: f.icon || '', banner: f.type === 'modpacks' || f.type === 'resourcepacks' ? f.banner || '' : '', summary: f.summary.trim(),
      download_mode: f.downloadMode, download_url: f.downloadMode === 'url' ? safeUrl(f.url) : null, file_path: filePath, file_name: fileName || null, file_size: file ? file.size : null };
    var inserted = await client.from('projects').insert(row).select('*').single();
    if (inserted.error) return { err: errorText(inserted.error, 'Không thể lưu project. Hãy thử lại.') };
    var uploaded = false;
    if (file) {
      var upload = await client.storage.from('project-files').upload(filePath, file, { upsert: false, cacheControl: '3600', contentType: 'application/octet-stream' });
      if (upload.error) { await client.from('projects').delete().eq('id', inserted.data.id); return { err: 'Không thể tải file lên máy chủ. Kiểm tra quota/dung lượng rồi thử lại.' }; }
      uploaded = true;
    }
    var names = Array.isArray(f.collab) ? f.collab : [], ids = names.map(function (x) { var p = cache.profilesByName[String(x).toLowerCase()]; return p && p.id; }).filter(function (id, i, all) { return id && id !== user.id && all.indexOf(id) === i; });
    if (ids.length) {
      var links = await client.from('project_collaborators').insert(ids.map(function (id) { return { project_id: inserted.data.id, user_id: id }; }));
      if (links.error) {
        if (uploaded) await client.storage.from('project-files').remove([filePath]);
        await client.from('projects').delete().eq('id', inserted.data.id);
        return { err: errorText(links.error, 'Không thể thêm cộng tác viên.') };
      }
    }
    try { await loadCache(); } catch (e) {}
    return { ok: true, slug: slug };
  }
  async function downloadProject(slug) {
    var row = cache.projects.find(function (p) { return p.slug.toLowerCase() === String(slug || '').toLowerCase(); });
    if (!row) return { err: 'Dự án không tồn tại hoặc bạn không có quyền truy cập.' };
    if (row.download_mode === 'url') {
      var url = safeUrl(row.download_url); if (!url) return { err: 'Dự án này chưa có tệp hoặc đường dẫn tải xuống hợp lệ.' };
      client.rpc('increment_project_downloads', { project_slug: row.slug }).then(function () { loadCache().catch(function () {}); });
      return { mode: 'url', url: url };
    }
    if (!row.file_path) return { err: 'Dự án này chưa có tệp hoặc đường dẫn tải xuống hợp lệ.' };
    var signed = await client.storage.from('project-files').createSignedUrl(row.file_path, 120, { download: cleanName(row.file_name) });
    if (signed.error) return { err: errorText(signed.error, 'Không thể đọc tệp trên máy chủ. Hãy thử lại.') };
    client.rpc('increment_project_downloads', { project_slug: row.slug }).then(function () { loadCache().catch(function () {}); });
    return { mode: 'url', url: signed.data.signedUrl };
  }
  async function signUp(f) {
    f = f || {};
    var username = String(f.username || '').trim().replace(/^@+/, ''), email = String(f.email || '').trim().toLowerCase(), display = String(f.displayName || '').trim(), password = f.password || '';
    if (!/^[A-Za-z0-9_-]{3,20}$/.test(username)) return { err: 'Tên @ phải dài 3–20 ký tự, chỉ gồm chữ, số, dấu _ và -.' };
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { err: 'Email không hợp lệ.' };
    if (!display || display.length > 40 || /[\u0000-\u001f\u007f<>]/.test(display)) return { err: 'Tên hiển thị dài 1–40 ký tự và không chứa ký tự đặc biệt nguy hiểm.' };
    if (password.length < 12 || password.length > 128) return { err: 'Mật khẩu phải có 12–128 ký tự và không chứa ký tự điều khiển.' };
    if (password !== f.confirm) return { err: 'Mật khẩu xác nhận không khớp.' };
    var result = await client.auth.signUp({ email: email, password: password, options: { data: { username: username.toLowerCase(), display_name: display } } });
    if (result.error) return { err: errorText(result.error) };
    cache.authUser = result.data.session ? result.data.user : null;
    if (result.data.session) { try { await loadCache(); } catch (e) {} return { ok: true }; }
    return { ok: true, confirmationRequired: true };
  }
  async function verifyTotp(factorId, code) {
    var challenge = await client.auth.mfa.challenge({ factorId: factorId });
    if (challenge.error) return challenge;
    return client.auth.mfa.verify({ factorId: factorId, challengeId: challenge.data.id, code: String(code || '').replace(/\s/g, '') });
  }
  async function signIn(id, password, code) {
    var email = String(id || '').trim().toLowerCase();
    if (!email || !password) return { err: 'Vui lòng nhập đầy đủ thông tin.' };
    if (email.indexOf('@') < 1 || email.indexOf('.') < 1) return { err: 'Đăng nhập trên website cần dùng email của tài khoản.' };
    var result = await client.auth.signInWithPassword({ email: email, password: password });
    if (result.error) return { err: errorText(result.error) };
    cache.authUser = result.data.user;
    var assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error) { await client.auth.signOut({ scope: 'local' }); cache.authUser = null; return { err: 'Không thể xác minh trạng thái xác thực của tài khoản.' }; }
    if (assurance.data.nextLevel === 'aal2' && assurance.data.currentLevel !== 'aal2') {
      var factors = await client.auth.mfa.listFactors(), factor = factors.data && factors.data.totp && factors.data.totp.filter(function (x) { return x.status === 'verified'; })[0];
      if (!factor || factors.error) { await client.auth.signOut({ scope: 'local' }); cache.authUser = null; return { err: 'Không thể xác minh cấu hình 2FA của tài khoản.' }; }
      if (!code) {
        await client.auth.signOut({ scope: 'local' }); cache.authUser = null;
        cache.pendingFactor = factor.id;
        return { need2fa: true };
      }
      var verification = await verifyTotp(factor.id, code);
      if (verification.error) { await client.auth.signOut({ scope: 'local' }); cache.authUser = null; return { err: 'Mã xác thực không đúng.' }; }
    }
    try { await loadCache(); } catch (e) { return { err: 'Đăng nhập thành công nhưng chưa tải được hồ sơ; hãy thử tải lại trang.' }; }
    return { ok: true };
  }
  async function signOut() { await client.auth.signOut(); cache.authUser = null; cache.totp = false; cache.projects = []; cache.collaborators = []; }
  async function updateProfile(f) {
    var u = currentUser(); if (!u) return { err: 'Bạn chưa đăng nhập.' };
    var name = String(f.displayName || '').trim(), bio = String(f.bio || '').trim();
    if (!name || name.length > 40 || /[\u0000-\u001f\u007f<>]/.test(name)) return { err: 'Tên hiển thị dài 1–40 ký tự và không chứa ký tự đặc biệt nguy hiểm.' };
    if (bio.length > 160) return { err: 'Giới thiệu chỉ được dài tối đa 160 ký tự.' };
    if (f.avatar && (f.avatar.length > 300000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(f.avatar))) return { err: 'Ảnh đại diện không hợp lệ.' };
    var result = await client.from('profiles').update({ display_name: name, bio: bio, avatar: f.avatar || '' }).eq('id', u.id);
    if (result.error) return { err: errorText(result.error, 'Không thể lưu thay đổi.') };
    await loadCache(); return { ok: true };
  }
  async function reauthenticate(password, code) {
    var u = currentUser(); if (!u || !password) return false;
    var result = await client.auth.signInWithPassword({ email: u.email, password: password });
    if (result.error) return false;
    cache.authUser = result.data.user;
    var assurance = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assurance.error || assurance.data.nextLevel !== 'aal2' || assurance.data.currentLevel === 'aal2') return !assurance.error;
    var factors = await client.auth.mfa.listFactors(), factor = factors.data && factors.data.totp && factors.data.totp.filter(function (x) { return x.status === 'verified'; })[0];
    if (!factor || !code) return false;
    var verified = await verifyTotp(factor.id, code);
    return !verified.error;
  }
  async function changeEmail(password, email, code) {
    email = String(email || '').trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { err: 'Email không hợp lệ.' };
    if (!(await reauthenticate(password, code))) return { err: 'Hãy xác minh mật khẩu và mã 2FA hiện tại.' };
    var result = await client.auth.updateUser({ email: email }); return result.error ? { err: errorText(result.error) } : { ok: true, confirmationRequired: true };
  }
  async function changePassword(oldPassword, nextPassword, confirm, code) {
    if (typeof nextPassword !== 'string' || nextPassword.length < 12 || nextPassword.length > 128) return { err: 'Mật khẩu mới phải có 12–128 ký tự và không chứa ký tự điều khiển.' };
    if (nextPassword !== confirm) return { err: 'Mật khẩu xác nhận không khớp.' };
    if (!(await reauthenticate(oldPassword, code))) return { err: 'Hãy xác minh mật khẩu và mã 2FA hiện tại.' };
    var result = await client.auth.updateUser({ password: nextPassword }); return result.error ? { err: errorText(result.error) } : { ok: true };
  }
  async function totpBegin() {
    var result = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Modium' });
    if (result.error) return { err: errorText(result.error, 'Không thể tạo khóa 2FA trên trình duyệt này.') };
    cache.pendingFactor = result.data.id;
    return { secret: result.data.totp.secret, uri: result.data.totp.uri };
  }
  async function totpEnable(code) {
    if (!cache.pendingFactor) return { err: 'Hãy tạo khóa 2FA trước.' };
    var result = await verifyTotp(cache.pendingFactor, code);
    if (result.error) return { err: 'Mã không đúng. Hãy thử mã mới trong ứng dụng.' };
    cache.pendingFactor = null; await loadCache(); return { ok: true };
  }
  async function totpDisable(password, code) {
    if (!(await reauthenticate(password, code))) return { err: 'Hãy xác minh mật khẩu và mã 2FA hiện tại.' };
    var factors = await client.auth.mfa.listFactors(), list = factors.data && factors.data.totp || [], verified = list.filter(function (x) { return x.status === 'verified'; });
    for (var i = 0; i < verified.length; i++) { var r = await client.auth.mfa.unenroll({ factorId: verified[i].id }); if (r.error) return { err: errorText(r.error) }; }
    await loadCache(); return { ok: true };
  }
  async function deleteAccount(password, code) {
    if (!(await reauthenticate(password, code))) return { err: 'Hãy xác minh mật khẩu và mã 2FA hiện tại.' };
    var u = currentUser(), paths = [];
    async function listPage(prefix) {
      var found = [], pageSize = 1000;
      for (var offset = 0; offset < 100000; offset += pageSize) {
        var result = await client.storage.from('project-files').list(prefix, { limit: pageSize, offset: offset });
        if (result.error) throw result.error;
        found = found.concat(result.data || []);
        if (!result.data || result.data.length < pageSize) break;
      }
      return found;
    }
    try {
      var folders = await listPage(u.id);
      for (var f = 0; f < folders.length; f++) {
        var folder = folders[f];
        if (folder.id || folder.metadata) paths.push(u.id + '/' + folder.name);
        else {
          var files = await listPage(u.id + '/' + folder.name);
          files.forEach(function (file) { if (file.id || file.metadata) paths.push(u.id + '/' + folder.name + '/' + file.name); });
        }
      }
    } catch (e) { return { err: 'Không thể kiểm tra các tệp cần xóa. Hãy thử lại.' }; }
    for (var i = 0; i < paths.length; i += 100) {
      var removed = await client.storage.from('project-files').remove(paths.slice(i, i + 100));
      if (removed.error) return { err: 'Không thể xóa các tệp của tài khoản. Hãy thử lại.' };
    }
    var result = await client.rpc('delete_my_account');
    if (result.error) return { err: errorText(result.error, 'Không thể xóa tài khoản.') };
    await signOut(); return { ok: true };
  }
  async function resetPassword(email) {
    email = String(email || '').trim(); if (!email) return { err: 'Nhập email tài khoản để gửi liên kết khôi phục.' };
    var result = await client.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname + '?flow=reset-password' });
    return result.error ? { err: errorText(result.error, 'Không thể gửi email khôi phục.') } : { ok: true };
  }
  async function updateRecoveredPassword(password, confirm, code) {
    var user = currentUser();
    if (!passwordRecovery || !user) return { err: 'Liên kết khôi phục không hợp lệ hoặc đã hết hạn.' };
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) return { err: 'Mật khẩu mới phải có 12–128 ký tự và không chứa ký tự điều khiển.' };
    if (password !== confirm) return { err: 'Mật khẩu xác nhận không khớp.' };
    if (user.totp) {
      var factors = await client.auth.mfa.listFactors(), factor = factors.data && factors.data.totp && factors.data.totp.filter(function (x) { return x.status === 'verified'; })[0];
      if (factors.error || !factor || !code) return { err: 'Hãy nhập mã 2FA hiện tại.' };
      var verified = await verifyTotp(factor.id, code);
      if (verified.error) return { err: 'Mã xác thực không đúng.' };
    }
    var result = await client.auth.updateUser({ password: password });
    if (result.error) return { err: errorText(result.error, 'Không thể cập nhật mật khẩu. Hãy thử lại.') };
    passwordRecovery = false;
    await client.auth.signOut({ scope: 'local' });
    cache.authUser = null;
    return { ok: true };
  }
  function exportData() { var u = currentUser(); return u ? JSON.stringify(u, null, 2) : '{}'; }

  window.API = { remote: true, init: init, user: currentUser, signUp: signUp, signIn: signIn, signOut: signOut, updateProfile: updateProfile,
    changeEmail: changeEmail, changePassword: changePassword, totpBegin: totpBegin, totpEnable: totpEnable, totpDisable: totpDisable,
    deleteAccount: deleteAccount, resetPassword: resetPassword, updateRecoveredPassword: updateRecoveredPassword, isPasswordRecovery: function () { return passwordRecovery && !!currentUser(); }, exportData: exportData, profileOf: profileOf, projects: publicProjects,
    getProject: getProject, downloadProject: downloadProject, userProjects: userProjects, searchUsers: searchUsers, createProject: createProject };
})();
;
/* Modium – tệp xử lý ngôn ngữ.
   - Nội dung gốc của trang là tiếng Việt (vi). Mỗi mục trong EN là "câu tiếng Việt" -> "bản tiếng Anh".
   - Ngôn ngữ chưa có bản dịch sẽ hiển thị bằng tiếng Anh (đúng như cảnh báo trong phần Cài đặt).
   - Muốn thêm ngôn ngữ mới: tạo thêm một bảng như EN rồi đăng ký vào DICT bên dưới. */
(function () {
  var EN = {
    /* Thanh điều hướng */
    'Khám phá nội dung': 'Discover content', 'Công trình': 'Structures', 'Tài Liệu API': 'API Docs',
    'Tạo Map Đám Mây': 'Create Cloud Map', 'Tạo máy chủ': 'Create a server', 'Tải App': 'Get the app',
    'Đăng nhập': 'Log in', 'Cài đặt': 'Settings',
    /* Trang chủ */
    'Nơi dành cho': 'The place for', 'mod': 'mods', 'gói tài nguyên': 'resource packs', 'gói dữ liệu': 'data packs',
    'shader': 'shaders', 'modpack': 'modpacks', 'plugin': 'plugins', 'máy chủ': 'servers',
    'Khám phá, chơi và chia sẻ nội dung MiniWorld trên nền tảng được xây dựng cho cộng đồng.': 'Discover, play and share MiniWorld content on a platform built for the community.',
    'Khám phá các tài nguyên': 'Explore resources', 'Đăng ký': 'Sign up', 'Dự án nổi bật': 'Featured projects',
    'Ánh sáng 3D cho các khối phát sáng': '3D lighting for glowing blocks',
    'Hệ thống kho đồ theo tủ hồ sơ': 'Filing-cabinet style storage system',
    'Rừng sâu với sinh vật mới': 'Deep forest with new creatures',
    'Shader bầu trời chân thực': 'Realistic sky shader',
    'Logo Modium': 'Modium logo',
    /* Cài đặt */
    'HIỂN THỊ': 'DISPLAY', 'Giao diện': 'Appearance', 'Ngôn ngữ': 'Language',
    'Chọn chủ đề màu ưa thích của bạn.': 'Choose your preferred color theme.',
    'Đồng bộ với hệ thống': 'Sync with system', 'Sáng': 'Light', 'Tối': 'Dark',
    'Đồng bộ chủ đề trên các thiết bị': 'Sync theme across devices',
    'Dùng chủ đề này ở mọi nơi bạn đăng nhập. Tắt để giữ chủ đề riêng trên thiết bị này.': 'Use this theme everywhere you are signed in. Turn off to keep a separate theme on this device.',
    'Đồng bộ chủ đề': 'Sync theme',
    'Bố cục danh sách dự án': 'Project list layout',
    'Chọn bố cục cho từng trang hiển thị danh sách dự án.': 'Choose a layout for each page that shows a project list.',
    'Trang Mods': 'Mods page', 'Trang Plugin': 'Plugins page', 'Trang Gói dữ liệu': 'Data packs page',
    'Trang Shader': 'Shaders page', 'Trang Gói tài nguyên': 'Resource packs page', 'Trang Modpack': 'Modpacks page',
    'Hàng': 'Rows', 'Lưới': 'Grid',
    'Đổi ngôn ngữ có thể khiến một số nội dung hiển thị bằng tiếng Anh nếu chưa có bản dịch.': 'Changing the language may cause some content to appear in English if it has not been translated yet.',
    'Chọn ngôn ngữ ưa thích cho trang web.': 'Choose your preferred language for the website.',
    'Tìm ngôn ngữ...': 'Search languages...', 'Tìm ngôn ngữ': 'Search languages',
    'Ngôn ngữ tiêu chuẩn': 'Standard languages',
    /* Đăng nhập / đăng ký */
    'Đăng nhập vào Modium': 'Sign in to Modium', 'Email hoặc tên đăng nhập': 'Email or username', 'Email hoặc tên @': 'Email or @handle', 'Mật khẩu': 'Password',
    'Tiếp tục với Email': 'Continue with Email', 'Chưa có tài khoản?': 'Don\'t have an account?',
    'Đã có tài khoản?': 'Already have an account?', 'Tạo tài khoản Modium': 'Create a Modium account',
    'Tên đăng nhập': 'Username', 'Tên hiển thị': 'Display name', 'Tên @ (duy nhất)': 'Unique @handle', 'Tên @': '@handle', 'Xác nhận mật khẩu': 'Confirm password', 'Ít nhất 8 ký tự': 'At least 8 characters', 'Ít nhất 12 ký tự': 'At least 12 characters',
    'Tên này có thể trùng với người khác.': 'This name may be shared by other users.', 'Ví dụ: @minh_nguyen — chỉ gồm chữ, số, dấu _ và -.': 'Example: @minh_nguyen — letters, numbers, _ and - only.',
    'Chỉ gồm chữ, số, dấu _ và -': 'Letters, numbers, _ and - only',
    'Giữ cho tôi cập nhật những điều thú vị Modium đang làm qua email': 'Keep me updated on the cool things Modium is working on via email',
    'Hoàn tất đăng ký': 'Complete sign up',
    'Vui lòng nhập đầy đủ thông tin.': 'Please fill in all fields.',
    'Email/tên đăng nhập hoặc mật khẩu không đúng.': 'Incorrect email/username or password.',
    'Tên đăng nhập phải dài 3–20 ký tự, chỉ gồm chữ, số, dấu _ và -.': 'Username must be 3–20 characters and contain only letters, numbers, _ and -.', 'Tên @ phải dài 3–20 ký tự, chỉ gồm chữ, số, dấu _ và -.': '@handle must be 3–20 characters and contain only letters, numbers, _ and -.', 'Tên @ đã được sử dụng.': 'That @handle is already taken.',
    'Email không hợp lệ.': 'Invalid email address.',
    'Mật khẩu phải có ít nhất 8 ký tự.': 'Password must be at least 8 characters.', 'Mật khẩu phải có 12–128 ký tự và không chứa ký tự điều khiển.': 'Password must be 12–128 characters and contain no control characters.', 'Tên hiển thị dài 1–40 ký tự và không chứa ký tự đặc biệt nguy hiểm.': 'Display name must be 1–40 characters and contain no unsafe characters.',
    'Mật khẩu xác nhận không khớp.': 'Passwords do not match.',
    'Tên đăng nhập đã được sử dụng.': 'That username is already taken.',
    'Email đã được sử dụng.': 'That email is already in use.',
    'Trình duyệt này không hỗ trợ mã hóa mật khẩu an toàn.': 'This browser does not support secure password hashing.',
    'Không thể lưu tài khoản. Hãy kiểm tra trình duyệt có đang chặn lưu trữ không.': 'Could not save the account. Check whether your browser is blocking storage.',
    'Bạn đã thử quá nhiều lần. Hãy thử lại sau 30 giây.': 'Too many attempts. Please try again in 30 seconds.',
    'Đăng nhập bằng dịch vụ bên ngoài cần máy chủ nên chưa khả dụng trong bản demo này.': 'Signing in with an external service needs a server, so it is not available in this demo yet.',
    'Khôi phục mật khẩu cần máy chủ gửi email nên chưa khả dụng trong bản demo này.': 'Password recovery needs a server to send email, so it is not available in this demo yet.',
    'Tiếp tục với passkey': 'Continue with passkey', 'Quên mật khẩu': 'Forgot password',
    /* Menu tài khoản */
    'Menu tài khoản': 'Account menu', 'Đăng bài': 'Publish', 'Hồ sơ': 'Profile', 'Nâng cấp lên Modium+': 'Upgrade to Modium+',
    'Máy chủ của tôi': 'My servers', 'Thông báo': 'Notifications', 'Báo cáo đang xử lý': 'Active reports',
    'Bộ sưu tập': 'Collections', 'Dự án': 'Projects', 'Tổ chức': 'Organizations', 'Phân tích': 'Analytics',
    'Doanh thu': 'Revenue', 'Chuyển tài khoản': 'Switch account', 'Đăng xuất': 'Sign out',
    /* Trang chủ sau khi đăng nhập, hồ sơ, bảng điều khiển */
    'Chào mừng trở lại,': 'Welcome back,', 'Đến bảng điều khiển': 'Go to dashboard', 'Truy cập nhanh': 'Quick access',
    'Xem thông tin tài khoản của bạn': 'View your account details', 'Theo dõi hoạt động của bạn': 'Track your activity',
    'Tùy chỉnh giao diện và ngôn ngữ': 'Customize appearance and language',
    'Bảng điều khiển': 'Dashboard', 'Tham gia': 'Joined', 'Lượt tải': 'Downloads', 'Người theo dõi': 'Followers',
    'Bạn chưa có dự án nào': 'You have no projects yet',
    'Tính năng đăng dự án chưa khả dụng trong bản demo này.': 'Publishing projects is not available in this demo yet.',
    /* Trang duyệt tài nguyên */
    'Mods': 'Mods', 'Gói tài nguyên': 'Resource Packs', 'Gói dữ liệu': 'Data Packs', 'Shader': 'Shaders', 'Modpack': 'Modpacks', 'Plugin': 'Plugins', 'Máy chủ': 'Servers',
    'Loại tài nguyên': 'Resource type', 'Bộ lọc': 'Filters',
    'Tìm kiếm dự án...': 'Search projects...', 'Tìm kiếm dự án': 'Search projects',
    'Phiên bản trò chơi': 'Game version', 'Tìm kiếm...': 'Search...', 'Tìm phiên bản': 'Search versions', 'Hiện tất cả phiên bản': 'Show all versions',
    'Bộ nạp': 'Loader', 'Hiện thêm': 'Show more', 'Thu gọn': 'Show less', 'Danh mục': 'Category', 'Môi trường': 'Environment',
    'Phía máy khách': 'Client-side', 'Phía máy chủ': 'Server-side', 'Máy khách và máy chủ': 'Client and server', 'Máy khách hoặc máy chủ': 'Client or server',
    'Giấy phép': 'License', 'Mã nguồn mở': 'Open source', 'Phụ thuộc vào': 'Depends on', 'Tìm một dự án...': 'Search for a project...', 'Tìm dự án phụ thuộc': 'Search dependency project',
    'Loại trừ nâng cao': 'Advanced exclusions', 'Ẩn các danh mục sau': 'Hide these categories',
    'Sắp xếp theo:': 'Sort by:', 'Mức liên quan': 'Relevance', 'Lượt tải nhiều nhất': 'Most downloads', 'Được theo dõi nhiều nhất': 'Most followed', 'Cập nhật gần đây': 'Recently updated',
    'Hiển thị:': 'View:', 'Đổi bố cục': 'Change layout', 'Trang trước': 'Previous page', 'Trang sau': 'Next page', 'kết quả': 'results', 'bởi': 'by',
    'Không tìm thấy dự án phù hợp': 'No matching projects found', 'Hãy thử bỏ bớt bộ lọc.': 'Try removing some filters.', 'Xóa bộ lọc': 'Clear filters',
    'Dữ liệu minh họa: các dự án trên trang này là mẫu tự tạo.': 'Demo data: the projects on this page are made-up samples.',
    'Phiêu lưu': 'Adventure', 'Bị nguyền': 'Cursed', 'Trang trí': 'Decoration', 'Kinh tế': 'Economy', 'Trang bị': 'Equipment', 'Thức ăn': 'Food',
    'Cơ chế game': 'Game mechanics', 'Thư viện': 'Library', 'Phép thuật': 'Magic', 'Quản lý': 'Management', 'Sinh vật': 'Mobs', 'Tối ưu hóa': 'Optimization',
    'Xã hội': 'Social', 'Kho chứa': 'Storage', 'Công nghệ': 'Technology', 'Vận chuyển': 'Transportation', 'Tiện ích': 'Utility', 'Tạo thế giới': 'World generation',
    'Độ phân giải': 'Resolution', '8x trở xuống': '8x or lower', '512x trở lên': '512x or higher',
    'Âm thanh': 'Audio', 'Khối': 'Blocks', 'Chiến đấu': 'Combat', 'Phông chữ': 'Fonts', 'Giao diện (GUI)': 'GUI', 'Vật phẩm': 'Items', 'Bản địa hóa': 'Locale', 'Mô hình': 'Models',
    'Loại trừ': 'Exclude',
    'Chưa có tài nguyên nào': 'No resources yet', 'Hãy là người đầu tiên chia sẻ sáng tạo của bạn với cộng đồng.': 'Be the first to share your creation with the community.', 'Đăng tài nguyên': 'Publish a resource',
    /* Thanh xác nhận thay đổi */
    'Bạn có những thay đổi chưa được lưu': 'You have unsaved changes', 'Đặt lại': 'Reset', 'Lưu': 'Save',
    /* Chân trang */
    'Modium là': 'Modium is', 'mã nguồn mở được làm bởi Vazkii': 'open source, made by Vazkii',
    'Giới thiệu': 'About', 'Tin tức': 'News', 'Nhật ký thay đổi': 'Changelog', 'Trạng thái': 'Status',
    'Tuyển dụng': 'Careers', 'Chương trình phần thưởng': 'Rewards program',
    'Sản phẩm': 'Products', 'Ứng dụng Modium': 'Modium app',
    'Tài nguyên': 'Resources', 'Trung tâm trợ giúp': 'Help center', 'Dịch thuật': 'Translations',
    'Báo cáo sự cố': 'Report an issue', 'Tài liệu API': 'API docs',
    'Pháp lý': 'Legal', 'Quy tắc về nội dung': 'Content rules', 'Điều khoản sử dụng': 'Terms of use',
    'Chính sách quyền riêng tư': 'Privacy policy', 'Thông báo bảo mật': 'Security notice',
    'Chính sách bản quyền và DMCA': 'Copyright and DMCA policy',
    'ĐÂY KHÔNG PHẢI WEB CHÍNH THỨ CỦA NHÀ PHÁT TRIỂN MINI WAN, ĐÂY LÀ MỘT DỰ ÁN TÔI MUỐN CÔNG KHAI MỘT SỐ THỨ VỚI MỌI NGƯỜI VÀ CHẮC CHẮN LÀ NÓ LEGIT': 'THIS IS NOT THE OFFICIAL WEBSITE OF THE MINI WAN DEVELOPERS. IT IS A PROJECT I WANT TO SHARE PUBLICLY WITH EVERYONE, AND IT IS DEFINITELY LEGIT',
    "Ai cũng thấy và tìm được dự án.": "Everyone can see and find the project.",
    "Bạn chưa có dự án nào!": "You don't have any projects yet!",
    "Bạn chưa đăng nhập.": "You are not logged in yet.",
    "Bạn đã vượt giới hạn tổng 100 MB tệp trong bản demo.": "You have exceeded the 100 MB total file limit in the demo.",
    "Chi tiết": "Details",
    "Chưa chọn tệp": "File not selected",
    "Chưa có gì để hiển thị ở đây.": "There's nothing to show here yet.",
    "Chưa có phiên bản nào được đăng.": "No versions have been posted yet.",
    "Chưa có thay đổi nào.": "There are no changes yet.",
    "Chưa có ảnh nào trong thư viện.": "There are no photos in the gallery yet.",
    "Chế độ hiển thị": "Display mode",
    "Chỉ bạn và cộng tác viên xem được.": "Only you and your collaborators can see it.",
    "Chỉ người có liên kết mới xem được.": "Only people with the link can see it.",
    "Chủ sở hữu": "Owner",
    "Chủ đề (chọn nhiều)": "Topics (select multiple)",
    "Có lỗi xảy ra, trình duyệt có thể không hỗ trợ mã hóa an toàn.": "An error occurred, the browser may not support secure encryption.",
    "Công khai": "Public",
    "Cập nhật": "Updated",
    "Cộng tác viên": "Collaborator",
    "Cộng tác viên (không bắt buộc)": "Collaborator (not required)",
    "Dùng URL": "Use URLs",
    "Dữ liệu thay đổi không hợp lệ.": "Changed data is invalid.",
    "Dự án không tồn tại hoặc bạn không có quyền truy cập.": "The project doesn't exist or you don't have access.",
    "Dự án này chưa có tệp hoặc đường dẫn tải xuống hợp lệ.": "This project does not have a valid file or download link yet.",
    "Email mới": "New email",
    "Español (España)": "Español (España)",
    "Español (Latinoamérica)": "Español (Latinoamérica)",
    "Français": "Français",
    "Giới thiệu chỉ được dài tối đa 160 ký tự.": "Introductions can only be up to 160 characters long.",
    "Hành động này không thể hoàn tác.": "This action cannot be undone.",
    "Hãy chia sẻ mod, modpack hay gói tài nguyên đầu tiên của bạn.": "Please share your first mod, modpack or resource pack.",
    "Hãy chọn chế độ hiển thị.": "Please select display mode.",
    "Hãy chọn loại dự án.": "Please select the project type.",
    "Hãy chọn tải tệp lên hoặc nhập URL tải xuống.": "Choose to upload a file or enter a download URL.",
    "Hãy chọn tệp cần tải lên.": "Select the file to upload.",
    "Hãy chọn độ phân giải của gói tài nguyên.": "Please select the resource pack resolution.",
    "Hãy nhập URL HTTP/HTTPS hợp lệ (không dùng javascript:, data: hoặc thông tin đăng nhập trong URL).": "Please enter a valid HTTP/HTTPS URL (don't use javascript:, data: or login information in the URL).",
    "Hãy nhập mô tả ngắn hợp lệ (tối đa 200 ký tự).": "Please enter a valid short description (maximum 200 characters).",
    "Hãy nhập đúng tên @ để xác nhận.": "Please enter the correct @ name to confirm.",
    "Hôm nay": "Today",
    "hôm nay": "today",
    "Kho tệp đang được mở ở thẻ khác. Hãy tải lại trang rồi thử lại.": "The file store is open in another tab. Please reload the page and try again.",
    "Không công khai": "Not public",
    "Không dọn được tệp.": "Unable to clean file.",
    "Không mở được kho tệp.": "Unable to open file store.",
    "Không thể cập nhật bảo mật tài khoản.": "Unable to update account security.",
    "Không thể lưu phiên đăng nhập. Hãy kiểm tra trình duyệt có đang chặn lưu trữ không.": "Unable to save login session. Check if your browser is blocking storage.",
    "Không thể lưu thay đổi.": "Unable to save changes.",
    "Không thể lưu tệp trong trình duyệt.": "The file cannot be saved in the browser.",
    "Không thể lưu tệp. Hãy kiểm tra dung lượng trống của trình duyệt.": "File could not be saved. Check your browser's free space.",
    "Không thể tạo dự án. Hãy thử lại.": "Unable to create project. Please try again.",
    "Không thể tạo khóa 2FA trên trình duyệt này.": "2FA keys cannot be generated on this browser.",
    "Không thể tải tệp. Hãy thử lại.": "Could not load file. Please try again.",
    "Không thể xóa dữ liệu dự án của tài khoản.": "The account's project data cannot be deleted.",
    "Không thể xóa tài khoản.": "Account cannot be deleted.",
    "Không thể đọc tệp trong trình duyệt. Hãy thử lại.": "The file cannot be read in the browser. Please try again.",
    "Không tìm thấy tệp trên thiết bị này. Trong bản demo, tệp upload chưa được đồng bộ lên máy chủ.": "Files not found on this device. In the demo, the uploaded file has not been synchronized to the server.",
    "Không xóa được tệp tạm.": "Unable to delete temporary files.",
    "Không đọc được tệp.": "Unable to read file.",
    "Loại dự án": "Project type",
    "Magyar (Magyarország)": "Magyar (Magyarorszag)",
    "Mã 6 số hiện trong ứng dụng": "The 6-digit code appears in the application",
    "Mã không đúng. Hãy thử mã mới trong ứng dụng.": "Code is incorrect. Try the new code in the app.",
    "Mã xác thực 2 bước": "2-step authentication code",
    "Mã xác thực không đúng.": "Authentication code is incorrect.",
    "Mô tả": "Describe",
    "Mô tả ngắn": "Short description",
    "Mật khẩu hiện tại": "Current password",
    "Mật khẩu hiện tại không đúng.": "Current password is incorrect.",
    "Mật khẩu mới (≥ 12 ký tự)": "New password (≥ 12 characters)",
    "Mật khẩu mới phải có 12–128 ký tự và không chứa ký tự điều khiển.": "The new password must be 12–128 characters long and contain no control characters.",
    "Người dùng Modium.": "Modium users.",
    "Người dùng này chưa có dự án nào!": "This user doesn't have any projects yet!",
    "Người sáng tạo": "Creator",
    "Nhập mã xác thực 2 bước từ ứng dụng của bạn.": "Enter the 2-step authentication code from your app.",
    "Phiên bản": "Version",
    "Riêng tư": "Private",
    "Thiết lập": "Establish",
    "Thông tin": "Information",
    "Nền tảng": "Platform",
    "Loại": "Type",
    "Hiển thị": "Visibility",
    "Tải xuống": "Download",
    "Thẻ": "Card",
    "Tiếng Việt": "Vietnamese",
    "Trình duyệt không hỗ trợ lưu tệp an toàn (IndexedDB).": "The browser does not support secure file saving (IndexedDB).",
    "Trình duyệt không hỗ trợ tạo mã tệp an toàn.": "The browser does not support secure file encryption.",
    "Tài khoản và bảo mật": "Account and security",
    "Tài khoản đã đạt giới hạn 100 dự án trong bản demo.": "The account has reached its limit of 100 projects in the demo.",
    "Tên @ không hợp lệ.": "@Name is invalid.",
    "Tên @ không thể đổi sau khi tạo tài khoản để bảo vệ liên kết dự án.": "@name cannot be changed after account creation to protect project links.",
    "Tên dự án": "Project name",
    "Tên dự án phải dài 3–40 ký tự hợp lệ.": "The project name must be 3–40 valid characters long.",
    "Tên tệp không hợp lệ.": "Invalid file name.",
    "Tạo dự án": "Create project",
    "Tải tệp lên": "Upload files",
    "Tải về bản sao dữ liệu tài khoản của bạn (JSON).": "Download a copy of your account data (JSON).",
    "Tất cả": "All",
    "Tắt 2FA": "Turn off 2FA",
    "Tệp không phải ảnh hợp lệ.": "The file is not a valid image.",
    "Tệp phải có dung lượng từ 1 byte đến 25 MB.": "Files must be between 1 byte and 25 MB.",
    "Tệp phải từ 1 byte đến 25 MB.": "Files must be between 1 byte and 25 MB.",
    "Tệp tải xuống": "Download file",
    "Tệp vượt quá giới hạn dung lượng.": "File exceeds capacity limit.",
    "URL chỉ gồm chữ thường, số, dấu - (3–40 ký tự).": "URLs contain only lowercase letters, numbers, and - signs (3–40 characters).",
    "URL này đã được dùng, hãy đổi tên khác.": "This URL is already in use, please change the name.",
    "Xuất": "Export",
    "Xuất dữ liệu": "Export data",
    "Xác nhận mật khẩu mới": "Confirm new password",
    "Xác thực hai bước (2FA)": "Two-step authentication (2FA)",
    "Xóa": "Erase",
    "Xóa tài khoản": "Delete account",
    "lượt tải": "downloads",
    "ngày trước": "days ago",
    "người theo dõi": "followers",
    "năm trước": "last year",
    "tháng trước": "last month",
    "Đang chuẩn bị tải xuống…": "Preparing to download…",
    "Đang tạo…": "Creating…",
    "Đã bật xác thực hai bước.": "Two-step authentication enabled.",
    "Đã bắt đầu tải xuống.": "Download has started.",
    "Đã lưu thay đổi.": "Changes saved.",
    "Đã lưu.": "Saved.",
    "Đã tắt xác thực hai bước.": "Two-step authentication disabled.",
    "Đã đổi email.": "Email changed.",
    "Đã đổi mật khẩu.": "Password changed.",
    "Đăng": "Published",
    "Đổi email": "Change email",
    "Đổi mật khẩu": "Change password",
    "Đổi mật khẩu đăng nhập của bạn.": "Change your login password.",
    "Độ phân giải gói tài nguyên": "Resource pack resolution",
    "Ảnh đại diện không hợp lệ.": "Invalid profile picture.",
    "Đang kết nối đến Modium…": "Connecting to Modium…",
    "Không thể kết nối đến dịch vụ Modium.": "Could not connect to Modium services.",
    "Hãy kiểm tra cấu hình Supabase và thử lại.": "Check the Supabase configuration and try again.",
    "Thử lại": "Retry",
    "Nếu email tồn tại, liên kết đặt lại mật khẩu sẽ được gửi đến hộp thư.": "If the email exists, a password-reset link will be sent to its inbox.",
    "Kiểm tra email để xác nhận tài khoản trước khi đăng nhập.": "Check your email to confirm your account before signing in.",
    "Không thể lưu thay đổi. Hãy thử lại.": "Could not save changes. Please try again.",
    "Không thể tạo khóa xác thực hai bước.": "Could not create a two-factor authentication key.",
    "Tệp tải lên tối đa 25 MB và được lưu trong kho riêng của Modium.": "Uploads are limited to 25 MB and stored in Modium's private storage.",
    "Hãy xác minh mật khẩu và mã 2FA hiện tại.": "Verify your current password and 2FA code.",
    "Không thể tải file lên máy chủ. Kiểm tra quota/dung lượng rồi thử lại.": "Could not upload the file. Check your storage quota and try again.",
    "Tài khoản đã đạt giới hạn 100 dự án.": "This account has reached the 100-project limit.",
    "Nhập mã từ ứng dụng xác thực, rồi đăng nhập lại.": "Enter the code from your authenticator app, then sign in again.",
    "Đặt lại mật khẩu": "Reset password",
    "Nhập mật khẩu mới để hoàn tất khôi phục.": "Enter a new password to finish recovery.",
    "Liên kết khôi phục không hợp lệ hoặc đã hết hạn.": "This recovery link is invalid or has expired.",
    "Không thể cập nhật mật khẩu. Hãy thử lại.": "Could not update the password. Please try again.",
    "Lưu mật khẩu mới": "Save new password",
    "Mật khẩu đã được cập nhật.": "Your password has been updated.",
    "Mã 2FA hiện tại": "Current 2FA code",
    "Hãy nhập mã 2FA hiện tại.": "Enter your current 2FA code.",
    "Không thể xác minh trạng thái xác thực của tài khoản.": "Could not verify the account's authentication status.",
    "Không thể gửi email khôi phục.": "Could not send the recovery email."
  };

  /* Đăng ký ngôn ngữ: mã -> bảng dịch. 'vi' là bản gốc nên không cần bảng. */
  
  var ES_419 = {
    "Khám phá nội dung": "Descubre contenido",
    "Công trình": "Estructuras",
    "Tài Liệu API": "Documentos API",
    "Tạo Map Đám Mây": "Crear mapa de la nube",
    "Tạo máy chủ": "crear un servidor",
    "Tải App": "Obtén la aplicación",
    "Đăng nhập": "Acceso",
    "Cài đặt": "Ajustes",
    "Nơi dành cho": "El lugar para",
    "mod": "mods",
    "gói tài nguyên": "paquetes de recursos",
    "gói dữ liệu": "paquetes de datos",
    "shader": "shaders",
    "modpack": "modpacks",
    "plugin": "plugins",
    "máy chủ": "servidores",
    "Khám phá, chơi và chia sẻ nội dung MiniWorld trên nền tảng được xây dựng cho cộng đồng.": "Descubra, juegue y comparta contenido de MiniWorld en una plataforma creada para la comunidad.",
    "Khám phá các tài nguyên": "Explorar recursos",
    "Đăng ký": "Inscribirse",
    "Dự án nổi bật": "Proyectos destacados",
    "Ánh sáng 3D cho các khối phát sáng": "Iluminación 3D para bloques brillantes",
    "Hệ thống kho đồ theo tủ hồ sơ": "Sistema de almacenamiento estilo archivador",
    "Rừng sâu với sinh vật mới": "Bosque profundo con nuevas criaturas.",
    "Shader bầu trời chân thực": "Sombreador de cielo realista",
    "Logo Modium": "Logo de Modium",
    "HIỂN THỊ": "MOSTRAR",
    "Giao diện": "Apariencia",
    "Ngôn ngữ": "Idioma",
    "Chọn chủ đề màu ưa thích của bạn.": "Elija su tema de color preferido.",
    "Đồng bộ với hệ thống": "Sincronizar con el sistema",
    "Sáng": "Luz",
    "Tối": "Oscuro",
    "Đồng bộ chủ đề trên các thiết bị": "Sincronizar tema entre dispositivos",
    "Dùng chủ đề này ở mọi nơi bạn đăng nhập. Tắt để giữ chủ đề riêng trên thiết bị này.": "Utilice este tema en todos los lugares donde haya iniciado sesión. Desactívelo para mantener un tema separado en este dispositivo.",
    "Đồng bộ chủ đề": "Tema de sincronización",
    "Bố cục danh sách dự án": "Diseño de lista de proyectos",
    "Chọn bố cục cho từng trang hiển thị danh sách dự án.": "Elija un diseño para cada página que muestre una lista de proyectos.",
    "Trang Mods": "Página de modificaciones",
    "Trang Plugin": "Página de complementos",
    "Trang Gói dữ liệu": "Página de paquetes de datos",
    "Trang Shader": "Página de sombreadores",
    "Trang Gói tài nguyên": "Página de paquetes de recursos",
    "Trang Modpack": "Página de paquetes de modificaciones",
    "Hàng": "Filas",
    "Lưới": "Red",
    "Đổi ngôn ngữ có thể khiến một số nội dung hiển thị bằng tiếng Anh nếu chưa có bản dịch.": "Cambiar el idioma puede hacer que algún contenido aparezca en inglés si aún no ha sido traducido.",
    "Chọn ngôn ngữ ưa thích cho trang web.": "Elija su idioma preferido para el sitio web.",
    "Tìm ngôn ngữ...": "Buscar idiomas...",
    "Tìm ngôn ngữ": "Idiomas de búsqueda",
    "Ngôn ngữ tiêu chuẩn": "Idiomas estándar",
    "Đăng nhập vào Modium": "Iniciar sesión en Modium",
    "Email hoặc tên đăng nhập": "Correo electrónico o nombre de usuario",
    "Email hoặc tên @": "Correo electrónico o @handle",
    "Mật khẩu": "Contraseña",
    "Tiếp tục với Email": "Continuar con el correo electrónico",
    "Chưa có tài khoản?": "¿No tienes una cuenta?",
    "Đã có tài khoản?": "¿Ya tienes una cuenta?",
    "Tạo tài khoản Modium": "Crea una cuenta en Modium",
    "Tên đăng nhập": "Nombre de usuario",
    "Tên hiển thị": "Nombre para mostrar",
    "Tên @ (duy nhất)": "@handle único",
    "Tên @": "@manejar",
    "Xác nhận mật khẩu": "Confirmar Contraseña",
    "Ít nhất 8 ký tự": "Al menos 8 caracteres",
    "Ít nhất 12 ký tự": "Al menos 12 caracteres",
    "Tên này có thể trùng với người khác.": "Este nombre puede ser compartido por otros usuarios.",
    "Ví dụ: @minh_nguyen — chỉ gồm chữ, số, dấu _ và -.": "Ejemplo: @minh_nguyen: letras, números, _ y - únicamente.",
    "Chỉ gồm chữ, số, dấu _ và -": "Letras, números, _ y - únicamente",
    "Giữ cho tôi cập nhật những điều thú vị Modium đang làm qua email": "Mantenme informado sobre las cosas interesantes en las que Modium está trabajando por correo electrónico.",
    "Hoàn tất đăng ký": "Regístrate completo",
    "Vui lòng nhập đầy đủ thông tin.": "Por favor complete todos los campos.",
    "Email/tên đăng nhập hoặc mật khẩu không đúng.": "Correo electrónico/nombre de usuario o contraseña incorrectos.",
    "Tên đăng nhập phải dài 3–20 ký tự, chỉ gồm chữ, số, dấu _ và -.": "El nombre de usuario debe tener entre 3 y 20 caracteres y contener solo letras, números, _ y -.",
    "Tên @ phải dài 3–20 ký tự, chỉ gồm chữ, số, dấu _ và -.": "@handle debe tener entre 3 y 20 caracteres y contener solo letras, números, _ y -.",
    "Tên @ đã được sử dụng.": "Ese @handle ya está en uso.",
    "Email không hợp lệ.": "Dirección de correo electrónico no válida.",
    "Mật khẩu phải có ít nhất 8 ký tự.": "La contraseña debe tener al menos 8 caracteres.",
    "Mật khẩu phải có 12–128 ký tự và không chứa ký tự điều khiển.": "La contraseña debe tener entre 12 y 128 caracteres y no contener caracteres de control.",
    "Tên hiển thị dài 1–40 ký tự và không chứa ký tự đặc biệt nguy hiểm.": "El nombre para mostrar debe tener entre 1 y 40 caracteres y no contener caracteres no seguros.",
    "Mật khẩu xác nhận không khớp.": "Las contraseñas no coinciden.",
    "Tên đăng nhập đã được sử dụng.": "Ese nombre de usuario ya está en uso.",
    "Email đã được sử dụng.": "Ese correo electrónico ya está en uso.",
    "Trình duyệt này không hỗ trợ mã hóa mật khẩu an toàn.": "Este navegador no admite el hash seguro de contraseñas.",
    "Không thể lưu tài khoản. Hãy kiểm tra trình duyệt có đang chặn lưu trữ không.": "No se pudo guardar la cuenta. Compruebe si su navegador está bloqueando el almacenamiento.",
    "Bạn đã thử quá nhiều lần. Hãy thử lại sau 30 giây.": "Demasiados intentos. Inténtelo de nuevo en 30 segundos.",
    "Đăng nhập bằng dịch vụ bên ngoài cần máy chủ nên chưa khả dụng trong bản demo này.": "Iniciar sesión con un servicio externo necesita un servidor, por lo que aún no está disponible en esta demostración.",
    "Khôi phục mật khẩu cần máy chủ gửi email nên chưa khả dụng trong bản demo này.": "La recuperación de contraseña necesita un servidor para enviar correo electrónico, por lo que aún no está disponible en esta demostración.",
    "Tiếp tục với passkey": "Continuar con la clave de acceso",
    "Quên mật khẩu": "Has olvidado tu contraseña",
    "Menu tài khoản": "Menú de cuenta",
    "Đăng bài": "Publicar",
    "Hồ sơ": "Perfil",
    "Nâng cấp lên Modium+": "Actualízate a Modo+",
    "Máy chủ của tôi": "Mis servidores",
    "Thông báo": "Notificaciones",
    "Báo cáo đang xử lý": "Informes activos",
    "Bộ sưu tập": "Colecciones",
    "Dự án": "Proyectos",
    "Tổ chức": "Organizaciones",
    "Phân tích": "Analítica",
    "Doanh thu": "Ganancia",
    "Chuyển tài khoản": "Cambiar de cuenta",
    "Đăng xuất": "desconectar",
    "Chào mừng trở lại,": "Bienvenido de nuevo,",
    "Đến bảng điều khiển": "Ir al panel",
    "Truy cập nhanh": "Acceso rápido",
    "Xem thông tin tài khoản của bạn": "Ver los detalles de su cuenta",
    "Theo dõi hoạt động của bạn": "Sigue tu actividad",
    "Tùy chỉnh giao diện và ngôn ngữ": "Personaliza la apariencia y el idioma.",
    "Bảng điều khiển": "Panel",
    "Tham gia": "Unido",
    "Lượt tải": "Descargas",
    "Người theo dõi": "Seguidores",
    "Bạn chưa có dự án nào": "Aún no tienes proyectos",
    "Tính năng đăng dự án chưa khả dụng trong bản demo này.": "La publicación de proyectos aún no está disponible en esta demostración.",
    "Mods": "Modificaciones",
    "Gói tài nguyên": "Paquetes de recursos",
    "Gói dữ liệu": "Paquetes de datos",
    "Shader": "Sombreadores",
    "Modpack": "Paquetes de modificaciones",
    "Plugin": "Complementos",
    "Máy chủ": "Servidores",
    "Loại tài nguyên": "Tipo de recurso",
    "Bộ lọc": "Filtros",
    "Tìm kiếm dự án...": "Buscar proyectos...",
    "Tìm kiếm dự án": "Buscar proyectos",
    "Phiên bản trò chơi": "Versión del juego",
    "Tìm kiếm...": "Buscar...",
    "Tìm phiên bản": "Buscar versiones",
    "Hiện tất cả phiên bản": "Mostrar todas las versiones",
    "Bộ nạp": "Cargador",
    "Hiện thêm": "Mostrar más",
    "Thu gọn": "Mostrar menos",
    "Danh mục": "Categoría",
    "Môi trường": "Ambiente",
    "Phía máy khách": "Lado del cliente",
    "Phía máy chủ": "Del lado del servidor",
    "Máy khách và máy chủ": "Cliente y servidor",
    "Máy khách hoặc máy chủ": "Cliente o servidor",
    "Giấy phép": "Licencia",
    "Mã nguồn mở": "Código abierto",
    "Phụ thuộc vào": "Depende de",
    "Tìm một dự án...": "Busca un proyecto...",
    "Tìm dự án phụ thuộc": "Proyecto de dependencia de búsqueda",
    "Loại trừ nâng cao": "Exclusiones avanzadas",
    "Ẩn các danh mục sau": "Ocultar estas categorías",
    "Sắp xếp theo:": "Ordenar por:",
    "Mức liên quan": "Pertinencia",
    "Lượt tải nhiều nhất": "La mayoría de las descargas",
    "Được theo dõi nhiều nhất": "Los más seguidos",
    "Cập nhật gần đây": "Actualizado recientemente",
    "Hiển thị:": "Vista:",
    "Đổi bố cục": "Cambiar diseño",
    "Trang trước": "Pagina anterior",
    "Trang sau": "Página siguiente",
    "kết quả": "resultados",
    "bởi": "por",
    "Không tìm thấy dự án phù hợp": "No se encontraron proyectos coincidentes",
    "Hãy thử bỏ bớt bộ lọc.": "Intente eliminar algunos filtros.",
    "Xóa bộ lọc": "Limpiar filtros",
    "Dữ liệu minh họa: các dự án trên trang này là mẫu tự tạo.": "Datos de demostración: los proyectos de esta página son muestras inventadas.",
    "Phiêu lưu": "Aventura",
    "Bị nguyền": "Maldito",
    "Trang trí": "Decoración",
    "Kinh tế": "Economía",
    "Trang bị": "Equipo",
    "Thức ăn": "Alimento",
    "Cơ chế game": "Mecánica de juego",
    "Thư viện": "Biblioteca",
    "Phép thuật": "Magia",
    "Quản lý": "Gestión",
    "Sinh vật": "turbas",
    "Tối ưu hóa": "Mejoramiento",
    "Xã hội": "Social",
    "Kho chứa": "Almacenamiento",
    "Công nghệ": "Tecnología",
    "Vận chuyển": "Transporte",
    "Tiện ích": "Utilidad",
    "Tạo thế giới": "generación mundial",
    "Độ phân giải": "Resolución",
    "8x trở xuống": "8x o menos",
    "512x trở lên": "512x o superior",
    "Âm thanh": "Audio",
    "Khối": "Bloques",
    "Chiến đấu": "Combatir",
    "Phông chữ": "Fuentes",
    "Giao diện (GUI)": "GUI",
    "Vật phẩm": "Elementos",
    "Bản địa hóa": "Lugar",
    "Mô hình": "Modelos",
    "Loại trừ": "Excluir",
    "Chưa có tài nguyên nào": "Aún no hay recursos",
    "Hãy là người đầu tiên chia sẻ sáng tạo của bạn với cộng đồng.": "Sé el primero en compartir tu creación con la comunidad.",
    "Đăng tài nguyên": "Publicar un recurso",
    "Bạn có những thay đổi chưa được lưu": "Tienes cambios sin guardar",
    "Đặt lại": "Reiniciar",
    "Lưu": "Ahorrar",
    "Modium là": "El modo es",
    "mã nguồn mở được làm bởi Vazkii": "código abierto, hecho por Vazkii",
    "Giới thiệu": "Acerca de",
    "Tin tức": "Noticias",
    "Nhật ký thay đổi": "Registro de cambios",
    "Trạng thái": "Estado",
    "Tuyển dụng": "Carreras",
    "Chương trình phần thưởng": "Programa de recompensas",
    "Sản phẩm": "Productos",
    "Ứng dụng Modium": "Aplicación moderada",
    "Tài nguyên": "Recursos",
    "Trung tâm trợ giúp": "Centro de ayuda",
    "Dịch thuật": "Traducciones",
    "Báo cáo sự cố": "Informar un problema",
    "Tài liệu API": "Documentos API",
    "Pháp lý": "Legal",
    "Quy tắc về nội dung": "Reglas de contenido",
    "Điều khoản sử dụng": "Condiciones de uso",
    "Chính sách quyền riêng tư": "Política de privacidad",
    "Thông báo bảo mật": "Aviso de seguridad",
    "Chính sách bản quyền và DMCA": "Política de derechos de autor y DMCA",
    "ĐÂY KHÔNG PHẢI WEB CHÍNH THỨ CỦA NHÀ PHÁT TRIỂN MINI WAN, ĐÂY LÀ MỘT DỰ ÁN TÔI MUỐN CÔNG KHAI MỘT SỐ THỨ VỚI MỌI NGƯỜI VÀ CHẮC CHẮN LÀ NÓ LEGIT": "ESTE NO ES EL SITIO WEB OFICIAL DE LOS DESARROLLADORES DE MINI WAN. ES UN PROYECTO QUE QUIERO COMPARTIR PÚBLICAMENTE CON TODOS, Y DEFINITIVAMENTE ES LEGÍTIMO",
    "Ai cũng thấy và tìm được dự án.": "Todos pueden ver y encontrar el proyecto.",
    "Bạn chưa có dự án nào!": "¡Aún no tienes ningún proyecto!",
    "Bạn chưa đăng nhập.": "Aún no has iniciado sesión.",
    "Bạn đã vượt giới hạn tổng 100 MB tệp trong bản demo.": "Ha excedido el límite total de archivos de 100 MB en la demostración.",
    "Chi tiết": "Detalles",
    "Chưa chọn tệp": "Archivo no seleccionado",
    "Chưa có gì để hiển thị ở đây.": "No hay nada que mostrar aquí todavía.",
    "Chưa có phiên bản nào được đăng.": "Aún no se han publicado versiones.",
    "Chưa có thay đổi nào.": "Aún no hay cambios.",
    "Chưa có ảnh nào trong thư viện.": "Aún no hay fotos en la galería.",
    "Chế độ hiển thị": "Modo de visualización",
    "Chỉ bạn và cộng tác viên xem được.": "Sólo tú y tus colaboradores podéis verlo.",
    "Chỉ người có liên kết mới xem được.": "Sólo las personas con el enlace podrán verlo.",
    "Chủ sở hữu": "Dueño",
    "Chủ đề (chọn nhiều)": "Temas (seleccione varios)",
    "Có lỗi xảy ra, trình duyệt có thể không hỗ trợ mã hóa an toàn.": "Se produjo un error; es posible que el navegador no admita el cifrado seguro.",
    "Công khai": "Público",
    "Cập nhật": "Actualizado",
    "Cộng tác viên": "Colaborador",
    "Cộng tác viên (không bắt buộc)": "Colaborador (no requerido)",
    "Dùng URL": "Usar URL",
    "Dữ liệu thay đổi không hợp lệ.": "Los datos modificados no son válidos.",
    "Dự án không tồn tại hoặc bạn không có quyền truy cập.": "El proyecto no existe o no tienes acceso.",
    "Dự án này chưa có tệp hoặc đường dẫn tải xuống hợp lệ.": "Este proyecto aún no tiene un archivo válido ni un enlace de descarga.",
    "Email mới": "Nuevo correo electrónico",
    "Español (España)": "Español (España)",
    "Español (Latinoamérica)": "Español (Latinoamérica)",
    "Français": "francés",
    "Giới thiệu chỉ được dài tối đa 160 ký tự.": "Las presentaciones solo pueden tener hasta 160 caracteres.",
    "Hành động này không thể hoàn tác.": "Esta acción no se puede deshacer.",
    "Hãy chia sẻ mod, modpack hay gói tài nguyên đầu tiên của bạn.": "Comparta su primer mod, modpack o paquete de recursos.",
    "Hãy chọn chế độ hiển thị.": "Seleccione el modo de visualización.",
    "Hãy chọn loại dự án.": "Por favor seleccione el tipo de proyecto.",
    "Hãy chọn tải tệp lên hoặc nhập URL tải xuống.": "Elija cargar un archivo o ingresar una URL de descarga.",
    "Hãy chọn tệp cần tải lên.": "Seleccione el archivo para cargar.",
    "Hãy chọn độ phân giải của gói tài nguyên.": "Seleccione la resolución del paquete de recursos.",
    "Hãy nhập URL HTTP/HTTPS hợp lệ (không dùng javascript:, data: hoặc thông tin đăng nhập trong URL).": "Ingrese una URL HTTP/HTTPS válida (no use javascript:, datos: ni información de inicio de sesión en la URL).",
    "Hãy nhập mô tả ngắn hợp lệ (tối đa 200 ký tự).": "Introduzca una descripción breve válida (máximo 200 caracteres).",
    "Hãy nhập đúng tên @ để xác nhận.": "Ingrese el @ nombre correcto para confirmar.",
    "Hôm nay": "Hoy",
    "hôm nay": "hoy",
    "Kho tệp đang được mở ở thẻ khác. Hãy tải lại trang rồi thử lại.": "El almacén de archivos está abierto en otra pestaña. Vuelva a cargar la página e inténtelo de nuevo.",
    "Không công khai": "No publico",
    "Không dọn được tệp.": "No se puede limpiar el archivo.",
    "Không mở được kho tệp.": "No se puede abrir el almacén de archivos.",
    "Không thể cập nhật bảo mật tài khoản.": "No se puede actualizar la seguridad de la cuenta.",
    "Không thể lưu phiên đăng nhập. Hãy kiểm tra trình duyệt có đang chặn lưu trữ không.": "No se puede guardar la sesión de inicio de sesión. Compruebe si su navegador está bloqueando el almacenamiento.",
    "Không thể lưu thay đổi.": "No se pueden guardar los cambios.",
    "Không thể lưu tệp trong trình duyệt.": "El archivo no se puede guardar en el navegador.",
    "Không thể lưu tệp. Hãy kiểm tra dung lượng trống của trình duyệt.": "No se pudo guardar el archivo. Comprueba el espacio libre de tu navegador.",
    "Không thể tạo dự án. Hãy thử lại.": "No se puede crear el proyecto. Por favor inténtalo de nuevo.",
    "Không thể tạo khóa 2FA trên trình duyệt này.": "Las claves 2FA no se pueden generar en este navegador.",
    "Không thể tải tệp. Hãy thử lại.": "No se pudo cargar el archivo. Por favor inténtalo de nuevo.",
    "Không thể xóa dữ liệu dự án của tài khoản.": "Los datos del proyecto de la cuenta no se pueden eliminar.",
    "Không thể xóa tài khoản.": "La cuenta no se puede eliminar.",
    "Không thể đọc tệp trong trình duyệt. Hãy thử lại.": "El archivo no se puede leer en el navegador. Por favor inténtalo de nuevo.",
    "Không tìm thấy tệp trên thiết bị này. Trong bản demo, tệp upload chưa được đồng bộ lên máy chủ.": "Archivos no encontrados en este dispositivo. En la demostración, el archivo cargado no se sincronizó con el servidor.",
    "Không xóa được tệp tạm.": "No se pueden eliminar archivos temporales.",
    "Không đọc được tệp.": "No se puede leer el archivo.",
    "Loại dự án": "Tipo de proyecto",
    "Magyar (Magyarország)": "magiar (Magyarorszag)",
    "Mã 6 số hiện trong ứng dụng": "El código de 6 dígitos aparece en la aplicación.",
    "Mã không đúng. Hãy thử mã mới trong ứng dụng.": "El código es incorrecto. Pruebe el nuevo código en la aplicación.",
    "Mã xác thực 2 bước": "código de autenticación de 2 pasos",
    "Mã xác thực không đúng.": "El código de autenticación es incorrecto.",
    "Mô tả": "Describir",
    "Mô tả ngắn": "Breve descripción",
    "Mật khẩu hiện tại": "Contraseña actual",
    "Mật khẩu hiện tại không đúng.": "La contraseña actual es incorrecta.",
    "Mật khẩu mới (≥ 12 ký tự)": "Nueva contraseña (≥ 12 caracteres)",
    "Mật khẩu mới phải có 12–128 ký tự và không chứa ký tự điều khiển.": "La nueva contraseña debe tener entre 12 y 128 caracteres y no contener caracteres de control.",
    "Người dùng Modium.": "Usuarios del modo.",
    "Người dùng này chưa có dự án nào!": "¡Este usuario aún no tiene ningún proyecto!",
    "Người sáng tạo": "Creador",
    "Nhập mã xác thực 2 bước từ ứng dụng của bạn.": "Ingrese el código de autenticación de 2 pasos desde su aplicación.",
    "Phiên bản": "Versión",
    "Riêng tư": "Privado",
    "Thiết lập": "Establecer",
    "Thông tin": "Información",
    "Nền tảng": "Plataforma",
    "Loại": "Tipo",
    "Hiển thị": "Visibilidad",
    "Tải xuống": "Descargar",
    "Thẻ": "Tarjeta",
    "Tiếng Việt": "vietnamita",
    "Trình duyệt không hỗ trợ lưu tệp an toàn (IndexedDB).": "El navegador no admite el guardado seguro de archivos (IndexedDB).",
    "Trình duyệt không hỗ trợ tạo mã tệp an toàn.": "El navegador no admite el cifrado seguro de archivos.",
    "Tài khoản và bảo mật": "Cuenta y seguridad",
    "Tài khoản đã đạt giới hạn 100 dự án trong bản demo.": "La cuenta ha alcanzado su límite de 100 proyectos en la demostración.",
    "Tên @ không hợp lệ.": "@Nombre no es válido.",
    "Tên @ không thể đổi sau khi tạo tài khoản để bảo vệ liên kết dự án.": "@name no se puede cambiar después de la creación de la cuenta para proteger los enlaces del proyecto.",
    "Tên dự án": "Nombre del proyecto",
    "Tên dự án phải dài 3–40 ký tự hợp lệ.": "El nombre del proyecto debe tener entre 3 y 40 caracteres válidos.",
    "Tên tệp không hợp lệ.": "Nombre de archivo no válido.",
    "Tạo dự án": "Crear proyecto",
    "Tải tệp lên": "Subir archivos",
    "Tải về bản sao dữ liệu tài khoản của bạn (JSON).": "Descargue una copia de los datos de su cuenta (JSON).",
    "Tất cả": "Todo",
    "Tắt 2FA": "Desactivar 2FA",
    "Tệp không phải ảnh hợp lệ.": "El archivo no es una imagen válida.",
    "Tệp phải có dung lượng từ 1 byte đến 25 MB.": "Los archivos deben tener entre 1 byte y 25 MB.",
    "Tệp phải từ 1 byte đến 25 MB.": "Los archivos deben tener entre 1 byte y 25 MB.",
    "Tệp tải xuống": "Descargar archivo",
    "Tệp vượt quá giới hạn dung lượng.": "El archivo excede el límite de capacidad.",
    "URL chỉ gồm chữ thường, số, dấu - (3–40 ký tự).": "Las URL contienen solo letras minúsculas, números y signos - (de 3 a 40 caracteres).",
    "URL này đã được dùng, hãy đổi tên khác.": "Esta URL ya está en uso, cambie el nombre.",
    "Xuất": "Exportar",
    "Xuất dữ liệu": "Exportar datos",
    "Xác nhận mật khẩu mới": "Confirmar nueva contraseña",
    "Xác thực hai bước (2FA)": "Autenticación de dos pasos (2FA)",
    "Xóa": "Borrar",
    "Xóa tài khoản": "Eliminar cuenta",
    "lượt tải": "descargas",
    "ngày trước": "hace dias",
    "người theo dõi": "seguidores",
    "năm trước": "el año pasado",
    "tháng trước": "mes pasado",
    "Đang chuẩn bị tải xuống…": "Preparándose para descargar…",
    "Đang tạo…": "Creando…",
    "Đã bật xác thực hai bước.": "Autenticación de dos pasos habilitada.",
    "Đã bắt đầu tải xuống.": "La descarga ha comenzado.",
    "Đã lưu thay đổi.": "Cambios guardados.",
    "Đã lưu.": "Guardado.",
    "Đã tắt xác thực hai bước.": "Autenticación en dos pasos deshabilitada.",
    "Đã đổi email.": "Correo electrónico cambiado.",
    "Đã đổi mật khẩu.": "Contraseña cambiada.",
    "Đăng": "Publicado",
    "Đổi email": "Cambiar correo electrónico",
    "Đổi mật khẩu": "Cambiar la contraseña",
    "Đổi mật khẩu đăng nhập của bạn.": "Cambie su contraseña de inicio de sesión.",
    "Độ phân giải gói tài nguyên": "Resolución del paquete de recursos",
    "Ảnh đại diện không hợp lệ.": "Imagen de perfil no válida.",
    "Đang kết nối đến Modium…": "Conectando con Modium…",
    "Không thể kết nối đến dịch vụ Modium.": "No se pudo conectar con los servicios de Modium.",
    "Hãy kiểm tra cấu hình Supabase và thử lại.": "Revisa la configuración de Supabase e inténtalo de nuevo.",
    "Thử lại": "Reintentar",
    "Nếu email tồn tại, liên kết đặt lại mật khẩu sẽ được gửi đến hộp thư.": "Si el correo existe, se enviará un enlace para restablecer la contraseña.",
    "Kiểm tra email để xác nhận tài khoản trước khi đăng nhập.": "Revisa tu correo para confirmar la cuenta antes de iniciar sesión.",
    "Không thể lưu thay đổi. Hãy thử lại.": "No se pudieron guardar los cambios. Inténtalo de nuevo.",
    "Không thể tạo khóa xác thực hai bước.": "No se pudo crear la clave de autenticación en dos pasos.",
    "Tệp tải lên tối đa 25 MB và được lưu trong kho riêng của Modium.": "Los archivos subidos tienen un límite de 25 MB y se guardan en el almacenamiento privado de Modium.",
    "Hãy xác minh mật khẩu và mã 2FA hiện tại.": "Verifica tu contraseña actual y el código 2FA.",
    "Không thể tải file lên máy chủ. Kiểm tra quota/dung lượng rồi thử lại.": "No se pudo subir el archivo. Revisa tu cuota de almacenamiento e inténtalo de nuevo.",
    "Tài khoản đã đạt giới hạn 100 dự án.": "Esta cuenta alcanzó el límite de 100 proyectos.",
    "Nhập mã từ ứng dụng xác thực, rồi đăng nhập lại.": "Ingresa el código de tu aplicación de autenticación y vuelve a iniciar sesión.",
    "Đặt lại mật khẩu": "Restablecer contraseña",
    "Nhập mật khẩu mới để hoàn tất khôi phục.": "Ingresa una contraseña nueva para completar la recuperación.",
    "Liên kết khôi phục không hợp lệ hoặc đã hết hạn.": "El enlace de recuperación no es válido o venció.",
    "Không thể cập nhật mật khẩu. Hãy thử lại.": "No se pudo actualizar la contraseña. Inténtalo de nuevo.",
    "Lưu mật khẩu mới": "Guardar contraseña nueva",
    "Mật khẩu đã được cập nhật.": "Se actualizó tu contraseña.",
    "Mã 2FA hiện tại": "Código 2FA actual",
    "Hãy nhập mã 2FA hiện tại.": "Ingresa tu código 2FA actual.",
    "Không thể xác minh trạng thái xác thực của tài khoản.": "No se pudo verificar el estado de autenticación de la cuenta.",
    "Không thể gửi email khôi phục.": "No se pudo enviar el correo de recuperación."
  };
  var ZH_CN = {
    "Khám phá nội dung": "发现内容",
    "Công trình": "结构",
    "Tài Liệu API": "API文档",
    "Tạo Map Đám Mây": "创建云地图",
    "Tạo máy chủ": "创建服务器",
    "Tải App": "获取应用程序",
    "Đăng nhập": "登录",
    "Cài đặt": "设置",
    "Nơi dành cho": "的地方",
    "mod": "模组",
    "gói tài nguyên": "资源包",
    "gói dữ liệu": "数据包",
    "shader": "光影",
    "modpack": "模组包",
    "plugin": "插件",
    "máy chủ": "服务器",
    "Khám phá, chơi và chia sẻ nội dung MiniWorld trên nền tảng được xây dựng cho cộng đồng.": "在为社区构建的平台上发现、播放和分享迷你世界内容。",
    "Khám phá các tài nguyên": "探索资源",
    "Đăng ký": "报名",
    "Dự án nổi bật": "特色项目",
    "Ánh sáng 3D cho các khối phát sáng": "发光块的 3D 照明",
    "Hệ thống kho đồ theo tủ hồ sơ": "文件柜式存储系统",
    "Rừng sâu với sinh vật mới": "森林深处有新生物",
    "Shader bầu trời chân thực": "逼真的天空着色器",
    "Logo Modium": "Modium 标志",
    "HIỂN THỊ": "展示",
    "Giao diện": "外貌",
    "Ngôn ngữ": "语言",
    "Chọn chủ đề màu ưa thích của bạn.": "选择您喜欢的颜色主题。",
    "Đồng bộ với hệ thống": "与系统同步",
    "Sáng": "光",
    "Tối": "黑暗的",
    "Đồng bộ chủ đề trên các thiết bị": "跨设备同步主题",
    "Dùng chủ đề này ở mọi nơi bạn đăng nhập. Tắt để giữ chủ đề riêng trên thiết bị này.": "在您登录的任何地方都使用此主题。关闭此主题可在此设备上保留单独的主题。",
    "Đồng bộ chủ đề": "同步主题",
    "Bố cục danh sách dự án": "项目清单布局",
    "Chọn bố cục cho từng trang hiển thị danh sách dự án.": "为显示项目列表的每个页面选择布局。",
    "Trang Mods": "模组页面",
    "Trang Plugin": "插件页面",
    "Trang Gói dữ liệu": "数据包页面",
    "Trang Shader": "着色器页面",
    "Trang Gói tài nguyên": "资源包页面",
    "Trang Modpack": "模组包页面",
    "Hàng": "行数",
    "Lưới": "网格",
    "Đổi ngôn ngữ có thể khiến một số nội dung hiển thị bằng tiếng Anh nếu chưa có bản dịch.": "更改语言可能会导致某些内容（如果尚未翻译）显示为英语。",
    "Chọn ngôn ngữ ưa thích cho trang web.": "选择您喜欢的网站语言。",
    "Tìm ngôn ngữ...": "搜索语言...",
    "Tìm ngôn ngữ": "搜索语言",
    "Ngôn ngữ tiêu chuẩn": "标准语言",
    "Đăng nhập vào Modium": "登录 Modium",
    "Email hoặc tên đăng nhập": "电子邮件或用户名",
    "Email hoặc tên @": "电子邮件或@handle",
    "Mật khẩu": "密码",
    "Tiếp tục với Email": "继续使用电子邮件",
    "Chưa có tài khoản?": "没有帐户？",
    "Đã có tài khoản?": "已经有帐户？",
    "Tạo tài khoản Modium": "创建一个 Modium 帐户",
    "Tên đăng nhập": "用户名",
    "Tên hiển thị": "显示名称",
    "Tên @ (duy nhất)": "独特的@handle",
    "Tên @": "@处理",
    "Xác nhận mật khẩu": "确认密码",
    "Ít nhất 8 ký tự": "至少 8 个字符",
    "Ít nhất 12 ký tự": "至少 12 个字符",
    "Tên này có thể trùng với người khác.": "该名称可能会被其他用户共享。",
    "Ví dụ: @minh_nguyen — chỉ gồm chữ, số, dấu _ và -.": "示例：@minh_nguyen — 仅限字母、数字、_ 和 -。",
    "Chỉ gồm chữ, số, dấu _ và -": "仅字母、数字、_ 和 -",
    "Giữ cho tôi cập nhật những điều thú vị Modium đang làm qua email": "通过电子邮件让我了解 Modium 正在开发的最新动态",
    "Hoàn tất đăng ký": "完成注册",
    "Vui lòng nhập đầy đủ thông tin.": "请填写所有字段。",
    "Email/tên đăng nhập hoặc mật khẩu không đúng.": "电子邮件/用户名或密码不正确。",
    "Tên đăng nhập phải dài 3–20 ký tự, chỉ gồm chữ, số, dấu _ và -.": "用户名必须为 3-20 个字符，并且仅包含字母、数字、_ 和 -。",
    "Tên @ phải dài 3–20 ký tự, chỉ gồm chữ, số, dấu _ và -.": "@handle 必须为 3-20 个字符，并且仅包含字母、数字、_ 和 -。",
    "Tên @ đã được sử dụng.": "该@handle 已被占用。",
    "Email không hợp lệ.": "电子邮件地址无效。",
    "Mật khẩu phải có ít nhất 8 ký tự.": "密码必须至少为 8 个字符。",
    "Mật khẩu phải có 12–128 ký tự và không chứa ký tự điều khiển.": "密码必须为 12-128 个字符，且不包含控制字符。",
    "Tên hiển thị dài 1–40 ký tự và không chứa ký tự đặc biệt nguy hiểm.": "显示名称必须为 1–40 个字符，并且不包含不安全字符。",
    "Mật khẩu xác nhận không khớp.": "密码不匹配。",
    "Tên đăng nhập đã được sử dụng.": "该用户名已被占用。",
    "Email đã được sử dụng.": "该电子邮件已被使用。",
    "Trình duyệt này không hỗ trợ mã hóa mật khẩu an toàn.": "此浏览器不支持安全密码散列。",
    "Không thể lưu tài khoản. Hãy kiểm tra trình duyệt có đang chặn lưu trữ không.": "无法保存帐户。检查您的浏览器是否阻止存储。",
    "Bạn đã thử quá nhiều lần. Hãy thử lại sau 30 giây.": "尝试次数太多。请在 30 秒后重试。",
    "Đăng nhập bằng dịch vụ bên ngoài cần máy chủ nên chưa khả dụng trong bản demo này.": "使用外部服务登录需要服务器，因此在本演示中尚不可用。",
    "Khôi phục mật khẩu cần máy chủ gửi email nên chưa khả dụng trong bản demo này.": "密码恢复需要服务器发送电子邮件，因此此演示中尚不可用。",
    "Tiếp tục với passkey": "使用密钥继续",
    "Quên mật khẩu": "忘记密码",
    "Menu tài khoản": "账户菜单",
    "Đăng bài": "发布",
    "Hồ sơ": "轮廓",
    "Nâng cấp lên Modium+": "升级到 Modium+",
    "Máy chủ của tôi": "我的服务器",
    "Thông báo": "通知",
    "Báo cáo đang xử lý": "活跃报告",
    "Bộ sưu tập": "收藏",
    "Dự án": "项目",
    "Tổ chức": "组织机构",
    "Phân tích": "分析",
    "Doanh thu": "收入",
    "Chuyển tài khoản": "切换账户",
    "Đăng xuất": "登出",
    "Chào mừng trở lại,": "欢迎回来，",
    "Đến bảng điều khiển": "转到仪表板",
    "Truy cập nhanh": "快速访问",
    "Xem thông tin tài khoản của bạn": "查看您的帐户详细信息",
    "Theo dõi hoạt động của bạn": "追踪您的活动",
    "Tùy chỉnh giao diện và ngôn ngữ": "自定义外观和语言",
    "Bảng điều khiển": "仪表板",
    "Tham gia": "已加入",
    "Lượt tải": "下载",
    "Người theo dõi": "追随者",
    "Bạn chưa có dự án nào": "您还没有项目",
    "Tính năng đăng dự án chưa khả dụng trong bản demo này.": "此演示中尚不支持发布项目。",
    "Mods": "模组",
    "Gói tài nguyên": "资源包",
    "Gói dữ liệu": "数据包",
    "Shader": "着色器",
    "Modpack": "模组包",
    "Plugin": "插件",
    "Máy chủ": "服务器",
    "Loại tài nguyên": "资源类型",
    "Bộ lọc": "过滤器",
    "Tìm kiếm dự án...": "搜索项目...",
    "Tìm kiếm dự án": "搜索项目",
    "Phiên bản trò chơi": "游戏版本",
    "Tìm kiếm...": "搜索...",
    "Tìm phiên bản": "搜索版本",
    "Hiện tất cả phiên bản": "显示所有版本",
    "Bộ nạp": "装载机",
    "Hiện thêm": "显示更多",
    "Thu gọn": "显示较少",
    "Danh mục": "类别",
    "Môi trường": "环境",
    "Phía máy khách": "客户端",
    "Phía máy chủ": "服务器端",
    "Máy khách và máy chủ": "客户端和服务器",
    "Máy khách hoặc máy chủ": "客户端或服务器",
    "Giấy phép": "执照",
    "Mã nguồn mở": "开源",
    "Phụ thuộc vào": "取决于",
    "Tìm một dự án...": "搜索项目...",
    "Tìm dự án phụ thuộc": "搜索依赖项目",
    "Loại trừ nâng cao": "高级排除",
    "Ẩn các danh mục sau": "隐藏这些类别",
    "Sắp xếp theo:": "排序方式：",
    "Mức liên quan": "关联",
    "Lượt tải nhiều nhất": "下载次数最多",
    "Được theo dõi nhiều nhất": "大多数关注",
    "Cập nhật gần đây": "最近更新",
    "Hiển thị:": "看法：",
    "Đổi bố cục": "更改布局",
    "Trang trước": "上一页",
    "Trang sau": "下一页",
    "kết quả": "结果",
    "bởi": "经过",
    "Không tìm thấy dự án phù hợp": "没有找到匹配的项目",
    "Hãy thử bỏ bớt bộ lọc.": "尝试删除一些过滤器。",
    "Xóa bộ lọc": "清除过滤器",
    "Dữ liệu minh họa: các dự án trên trang này là mẫu tự tạo.": "演示数据：此页面上的项目是虚构的示例。",
    "Phiêu lưu": "冒险",
    "Bị nguyền": "被诅咒的",
    "Trang trí": "装饰",
    "Kinh tế": "经济",
    "Trang bị": "设备",
    "Thức ăn": "食物",
    "Cơ chế game": "游戏机制",
    "Thư viện": "图书馆",
    "Phép thuật": "魔法",
    "Quản lý": "管理",
    "Sinh vật": "暴民",
    "Tối ưu hóa": "优化",
    "Xã hội": "社会的",
    "Kho chứa": "贮存",
    "Công nghệ": "技术",
    "Vận chuyển": "运输",
    "Tiện ích": "公用事业",
    "Tạo thế giới": "世界一代",
    "Độ phân giải": "分辨率",
    "8x trở xuống": "8 倍或更低",
    "512x trở lên": "512x 或更高",
    "Âm thanh": "声音的",
    "Khối": "积木",
    "Chiến đấu": "战斗",
    "Phông chữ": "字体",
    "Giao diện (GUI)": "图形用户界面",
    "Vật phẩm": "项目",
    "Bản địa hóa": "语言环境",
    "Mô hình": "型号",
    "Loại trừ": "排除",
    "Chưa có tài nguyên nào": "还没有资源",
    "Hãy là người đầu tiên chia sẻ sáng tạo của bạn với cộng đồng.": "成为第一个与社区分享您的创作的人。",
    "Đăng tài nguyên": "发布资源",
    "Bạn có những thay đổi chưa được lưu": "您有未保存的更改",
    "Đặt lại": "重置",
    "Lưu": "节省",
    "Modium là": "钠是",
    "mã nguồn mở được làm bởi Vazkii": "开源，由 Vazkii 制作",
    "Giới thiệu": "关于",
    "Tin tức": "消息",
    "Nhật ký thay đổi": "变更日志",
    "Trạng thái": "地位",
    "Tuyển dụng": "职业机会",
    "Chương trình phần thưởng": "奖励计划",
    "Sản phẩm": "产品",
    "Ứng dụng Modium": "中度应用程序",
    "Tài nguyên": "资源",
    "Trung tâm trợ giúp": "帮助中心",
    "Dịch thuật": "翻译",
    "Báo cáo sự cố": "报告问题",
    "Tài liệu API": "API文档",
    "Pháp lý": "合法的",
    "Quy tắc về nội dung": "内容规则",
    "Điều khoản sử dụng": "使用条款",
    "Chính sách quyền riêng tư": "隐私政策",
    "Thông báo bảo mật": "安全须知",
    "Chính sách bản quyền và DMCA": "版权和 DMCA 政策",
    "ĐÂY KHÔNG PHẢI WEB CHÍNH THỨ CỦA NHÀ PHÁT TRIỂN MINI WAN, ĐÂY LÀ MỘT DỰ ÁN TÔI MUỐN CÔNG KHAI MỘT SỐ THỨ VỚI MỌI NGƯỜI VÀ CHẮC CHẮN LÀ NÓ LEGIT": "这不是 MINI WAN 开发者的官方网站。这是一个我想与所有人公开分享的项目，而且它绝对是合法的",
    "Ai cũng thấy và tìm được dự án.": "每个人都可以看到并找到该项目。",
    "Bạn chưa có dự án nào!": "您还没有任何项目！",
    "Bạn chưa đăng nhập.": "您还没有登录。",
    "Bạn đã vượt giới hạn tổng 100 MB tệp trong bản demo.": "您已超出演示中 100 MB 的总文件限制。",
    "Chi tiết": "详细信息",
    "Chưa chọn tệp": "未选择文件",
    "Chưa có gì để hiển thị ở đây.": "这里还没有什么可显示的。",
    "Chưa có phiên bản nào được đăng.": "尚未发布任何版本。",
    "Chưa có thay đổi nào.": "目前还没有任何变化。",
    "Chưa có ảnh nào trong thư viện.": "图库中还没有照片。",
    "Chế độ hiển thị": "显示方式",
    "Chỉ bạn và cộng tác viên xem được.": "只有您和您的合作者可以看到它。",
    "Chỉ người có liên kết mới xem được.": "只有知道链接的人才能看到它。",
    "Chủ sở hữu": "所有者",
    "Chủ đề (chọn nhiều)": "主题（多选）",
    "Có lỗi xảy ra, trình duyệt có thể không hỗ trợ mã hóa an toàn.": "发生错误，浏览器可能不支持安全加密。",
    "Công khai": "民众",
    "Cập nhật": "更新",
    "Cộng tác viên": "合作者",
    "Cộng tác viên (không bắt buộc)": "合作者（非必需）",
    "Dùng URL": "使用网址",
    "Dữ liệu thay đổi không hợp lệ.": "更改后的数据无效。",
    "Dự án không tồn tại hoặc bạn không có quyền truy cập.": "该项目不存在或您无权访问。",
    "Dự án này chưa có tệp hoặc đường dẫn tải xuống hợp lệ.": "该项目还没有有效的文件或下载链接。",
    "Email mới": "新电子邮件",
    "Español (España)": "西班牙语（España）",
    "Español (Latinoamérica)": "西班牙语（拉丁美洲）",
    "Français": "法国人",
    "Giới thiệu chỉ được dài tối đa 160 ký tự.": "简介最多只能有 160 个字符。",
    "Hành động này không thể hoàn tác.": "此操作无法撤消。",
    "Hãy chia sẻ mod, modpack hay gói tài nguyên đầu tiên của bạn.": "请分享您的第一个模组、模组包或资源包。",
    "Hãy chọn chế độ hiển thị.": "请选择显示模式。",
    "Hãy chọn loại dự án.": "请选择项目类型。",
    "Hãy chọn tải tệp lên hoặc nhập URL tải xuống.": "选择上传文件或输入下载 URL。",
    "Hãy chọn tệp cần tải lên.": "选择要上传的文件。",
    "Hãy chọn độ phân giải của gói tài nguyên.": "请选择资源包分辨率。",
    "Hãy nhập URL HTTP/HTTPS hợp lệ (không dùng javascript:, data: hoặc thông tin đăng nhập trong URL).": "请输入有效的 HTTP/HTTPS URL（请勿在 URL 中使用 javascript:、data: 或登录信息）。",
    "Hãy nhập mô tả ngắn hợp lệ (tối đa 200 ký tự).": "请输入有效的简短描述（最多 200 个字符）。",
    "Hãy nhập đúng tên @ để xác nhận.": "请输入正确的@名称进行确认。",
    "Hôm nay": "今天",
    "hôm nay": "今天",
    "Kho tệp đang được mở ở thẻ khác. Hãy tải lại trang rồi thử lại.": "文件存储在另一个选项卡中打开。请重新加载页面并重试。",
    "Không công khai": "不公开",
    "Không dọn được tệp.": "无法清理文件。",
    "Không mở được kho tệp.": "无法打开文件存储。",
    "Không thể cập nhật bảo mật tài khoản.": "无法更新帐户安全性。",
    "Không thể lưu phiên đăng nhập. Hãy kiểm tra trình duyệt có đang chặn lưu trữ không.": "无法保存登录会话。检查您的浏览器是否阻止存储。",
    "Không thể lưu thay đổi.": "无法保存更改。",
    "Không thể lưu tệp trong trình duyệt.": "该文件无法保存在浏览器中。",
    "Không thể lưu tệp. Hãy kiểm tra dung lượng trống của trình duyệt.": "无法保存文件。检查浏览器的可用空间。",
    "Không thể tạo dự án. Hãy thử lại.": "无法创建项目。请再试一次。",
    "Không thể tạo khóa 2FA trên trình duyệt này.": "无法在此浏览器上生成 2FA 密钥。",
    "Không thể tải tệp. Hãy thử lại.": "无法加载文件。请再试一次。",
    "Không thể xóa dữ liệu dự án của tài khoản.": "该帐户的项目数据无法删除。",
    "Không thể xóa tài khoản.": "帐户无法删除。",
    "Không thể đọc tệp trong trình duyệt. Hãy thử lại.": "无法在浏览器中读取该文件。请再试一次。",
    "Không tìm thấy tệp trên thiết bị này. Trong bản demo, tệp upload chưa được đồng bộ lên máy chủ.": "在此设备上找不到文件。演示中，上传的文件尚未同步到服务器。",
    "Không xóa được tệp tạm.": "无法删除临时文件。",
    "Không đọc được tệp.": "无法读取文件。",
    "Loại dự án": "项目类型",
    "Magyar (Magyarország)": "马扎尔语 (Magyarorszag)",
    "Mã 6 số hiện trong ứng dụng": "6 位数字代码出现在应用程序中",
    "Mã không đúng. Hãy thử mã mới trong ứng dụng.": "代码不正确。在应用程序中尝试新代码。",
    "Mã xác thực 2 bước": "两步验证码",
    "Mã xác thực không đúng.": "验证码不正确。",
    "Mô tả": "描述",
    "Mô tả ngắn": "简短描述",
    "Mật khẩu hiện tại": "当前密码",
    "Mật khẩu hiện tại không đúng.": "当前密码不正确。",
    "Mật khẩu mới (≥ 12 ký tự)": "新密码（≥12个字符）",
    "Mật khẩu mới phải có 12–128 ký tự và không chứa ký tự điều khiển.": "新密码的长度必须为 12-128 个字符，并且不包含控制字符。",
    "Người dùng Modium.": "中等用户。",
    "Người dùng này chưa có dự án nào!": "该用户还没有任何项目！",
    "Người sáng tạo": "创作者",
    "Nhập mã xác thực 2 bước từ ứng dụng của bạn.": "输入应用程序中的两步验证码。",
    "Phiên bản": "版本",
    "Riêng tư": "私人的",
    "Thiết lập": "建立",
    "Thông tin": "信息",
    "Nền tảng": "平台",
    "Loại": "类型",
    "Hiển thị": "可见性",
    "Tải xuống": "下载",
    "Thẻ": "卡片",
    "Tiếng Việt": "越南语",
    "Trình duyệt không hỗ trợ lưu tệp an toàn (IndexedDB).": "浏览器不支持安全文件保存（IndexedDB）。",
    "Trình duyệt không hỗ trợ tạo mã tệp an toàn.": "浏览器不支持安全文件加密。",
    "Tài khoản và bảo mật": "账户与安全",
    "Tài khoản đã đạt giới hạn 100 dự án trong bản demo.": "该帐户已达到演示中 100 个项目的限制。",
    "Tên @ không hợp lệ.": "@名称无效。",
    "Tên @ không thể đổi sau khi tạo tài khoản để bảo vệ liên kết dự án.": "@name 在创建帐户后无法更改，以保护项目链接。",
    "Tên dự án": "项目名称",
    "Tên dự án phải dài 3–40 ký tự hợp lệ.": "项目名称的长度必须为 3-40 个有效字符。",
    "Tên tệp không hợp lệ.": "文件名无效。",
    "Tạo dự án": "创建项目",
    "Tải tệp lên": "上传文件",
    "Tải về bản sao dữ liệu tài khoản của bạn (JSON).": "下载您的帐户数据 (JSON) 的副本。",
    "Tất cả": "全部",
    "Tắt 2FA": "关闭 2FA",
    "Tệp không phải ảnh hợp lệ.": "该文件不是有效的图像。",
    "Tệp phải có dung lượng từ 1 byte đến 25 MB.": "文件大小必须介于 1 字节到 25 MB 之间。",
    "Tệp phải từ 1 byte đến 25 MB.": "文件大小必须介于 1 字节到 25 MB 之间。",
    "Tệp tải xuống": "下载文件",
    "Tệp vượt quá giới hạn dung lượng.": "文件超出容量限制。",
    "URL chỉ gồm chữ thường, số, dấu - (3–40 ký tự).": "URL 仅包含小写字母、数字和 - 符号（3–40 个字符）。",
    "URL này đã được dùng, hãy đổi tên khác.": "该网址已被使用，请更改名称。",
    "Xuất": "出口",
    "Xuất dữ liệu": "导出数据",
    "Xác nhận mật khẩu mới": "确认新密码",
    "Xác thực hai bước (2FA)": "两步身份验证 (2FA)",
    "Xóa": "擦除",
    "Xóa tài khoản": "删除帐户",
    "lượt tải": "下载",
    "ngày trước": "几天前",
    "người theo dõi": "追随者",
    "năm trước": "去年",
    "tháng trước": "上个月",
    "Đang chuẩn bị tải xuống…": "正在准备下载...",
    "Đang tạo…": "创造……",
    "Đã bật xác thực hai bước.": "启用两步验证。",
    "Đã bắt đầu tải xuống.": "下载已开始。",
    "Đã lưu thay đổi.": "更改已保存。",
    "Đã lưu.": "已保存。",
    "Đã tắt xác thực hai bước.": "两步验证已禁用。",
    "Đã đổi email.": "电子邮件已更改。",
    "Đã đổi mật khẩu.": "密码已更改。",
    "Đăng": "发布",
    "Đổi email": "更改电子邮件",
    "Đổi mật khẩu": "更改密码",
    "Đổi mật khẩu đăng nhập của bạn.": "更改您的登录密码。",
    "Độ phân giải gói tài nguyên": "资源包分辨率",
    "Ảnh đại diện không hợp lệ.": "个人资料图片无效。",
    "Đang kết nối đến Modium…": "正在连接 Modium…",
    "Không thể kết nối đến dịch vụ Modium.": "无法连接到 Modium 服务。",
    "Hãy kiểm tra cấu hình Supabase và thử lại.": "请检查 Supabase 配置并重试。",
    "Thử lại": "重试",
    "Nếu email tồn tại, liên kết đặt lại mật khẩu sẽ được gửi đến hộp thư.": "如果该邮箱存在，密码重置链接将发送至其收件箱。",
    "Kiểm tra email để xác nhận tài khoản trước khi đăng nhập.": "请先检查邮箱并确认账户，然后再登录。",
    "Không thể lưu thay đổi. Hãy thử lại.": "无法保存更改，请重试。",
    "Không thể tạo khóa xác thực hai bước.": "无法创建双重身份验证密钥。",
    "Tệp tải lên tối đa 25 MB và được lưu trong kho riêng của Modium.": "上传文件大小上限为 25 MB，并存储在 Modium 的私有存储中。",
    "Hãy xác minh mật khẩu và mã 2FA hiện tại.": "请验证当前密码和 2FA 验证码。",
    "Không thể tải file lên máy chủ. Kiểm tra quota/dung lượng rồi thử lại.": "无法上传文件。请检查存储配额后重试。",
    "Tài khoản đã đạt giới hạn 100 dự án.": "此账户已达到 100 个项目的上限。",
    "Nhập mã từ ứng dụng xác thực, rồi đăng nhập lại.": "请输入身份验证器应用中的验证码，然后重新登录。",
    "Đặt lại mật khẩu": "重置密码",
    "Nhập mật khẩu mới để hoàn tất khôi phục.": "请输入新密码以完成恢复。",
    "Liên kết khôi phục không hợp lệ hoặc đã hết hạn.": "恢复链接无效或已过期。",
    "Không thể cập nhật mật khẩu. Hãy thử lại.": "无法更新密码，请重试。",
    "Lưu mật khẩu mới": "保存新密码",
    "Mật khẩu đã được cập nhật.": "密码已更新。",
    "Mã 2FA hiện tại": "当前 2FA 验证码",
    "Hãy nhập mã 2FA hiện tại.": "请输入当前的 2FA 验证码。",
    "Không thể xác minh trạng thái xác thực của tài khoản.": "无法验证账户的身份验证状态。",
    "Không thể gửi email khôi phục.": "无法发送恢复邮件。"
  };
  var JA = {
    "Khám phá nội dung": "コンテンツを発見する",
    "Công trình": "構造物",
    "Tài Liệu API": "APIドキュメント",
    "Tạo Map Đám Mây": "クラウドマップの作成",
    "Tạo máy chủ": "サーバーを作成する",
    "Tải App": "アプリを入手",
    "Đăng nhập": "ログイン",
    "Cài đặt": "設定",
    "Nơi dành cho": "の場所",
    "mod": "Mod",
    "gói tài nguyên": "リソースパック",
    "gói dữ liệu": "データパック",
    "shader": "シェーダー",
    "modpack": "MODパック",
    "plugin": "プラグイン",
    "máy chủ": "サーバー",
    "Khám phá, chơi và chia sẻ nội dung MiniWorld trên nền tảng được xây dựng cho cộng đồng.": "コミュニティ向けに構築されたプラットフォームで MiniWorld コンテンツを発見、再生、共有します。",
    "Khám phá các tài nguyên": "リソースを探索する",
    "Đăng ký": "サインアップ",
    "Dự án nổi bật": "注目のプロジェクト",
    "Ánh sáng 3D cho các khối phát sáng": "光るブロックの 3D ライティング",
    "Hệ thống kho đồ theo tủ hồ sơ": "ファイリングキャビネットスタイルのストレージシステム",
    "Rừng sâu với sinh vật mới": "新しい生き物が生息する深い森",
    "Shader bầu trời chân thực": "リアルな空シェーダー",
    "Logo Modium": "Modium のロゴ",
    "HIỂN THỊ": "画面",
    "Giao diện": "外観",
    "Ngôn ngữ": "言語",
    "Chọn chủ đề màu ưa thích của bạn.": "好みのカラーテーマを選択してください。",
    "Đồng bộ với hệ thống": "システムと同期する",
    "Sáng": "ライト",
    "Tối": "暗い",
    "Đồng bộ chủ đề trên các thiết bị": "デバイス間でテーマを同期する",
    "Dùng chủ đề này ở mọi nơi bạn đăng nhập. Tắt để giữ chủ đề riêng trên thiết bị này.": "サインインしているすべての場所でこのテーマを使用します。このデバイス上で別のテーマを保持するには、オフにします。",
    "Đồng bộ chủ đề": "同期テーマ",
    "Bố cục danh sách dự án": "プロジェクトリストのレイアウト",
    "Chọn bố cục cho từng trang hiển thị danh sách dự án.": "プロジェクト リストを表示する各ページのレイアウトを選択します。",
    "Trang Mods": "改造ページ",
    "Trang Plugin": "プラグインページ",
    "Trang Gói dữ liệu": "データパックのページ",
    "Trang Shader": "シェーダーページ",
    "Trang Gói tài nguyên": "リソース パックのページ",
    "Trang Modpack": "Modpack ページ",
    "Hàng": "行",
    "Lưới": "グリッド",
    "Đổi ngôn ngữ có thể khiến một số nội dung hiển thị bằng tiếng Anh nếu chưa có bản dịch.": "言語を変更すると、一部のコンテンツがまだ翻訳されていない場合、英語で表示されることがあります。",
    "Chọn ngôn ngữ ưa thích cho trang web.": "Web サイトで使用する言語を選択します。",
    "Tìm ngôn ngữ...": "言語を検索...",
    "Tìm ngôn ngữ": "検索言語",
    "Ngôn ngữ tiêu chuẩn": "標準言語",
    "Đăng nhập vào Modium": "Modiumにサインインする",
    "Email hoặc tên đăng nhập": "メールアドレスまたはユーザー名",
    "Email hoặc tên @": "メールアドレスまたは@ハンドル",
    "Mật khẩu": "パスワード",
    "Tiếp tục với Email": "メールで続行",
    "Chưa có tài khoản?": "アカウントをお持ちでない場合は、",
    "Đã có tài khoản?": "すでにアカウントをお持ちですか?",
    "Tạo tài khoản Modium": "Modiumアカウントを作成する",
    "Tên đăng nhập": "ユーザー名",
    "Tên hiển thị": "表示名",
    "Tên @ (duy nhất)": "ユニークな@ハンドル",
    "Tên @": "@ハンドル",
    "Xác nhận mật khẩu": "パスワードを認証する",
    "Ít nhất 8 ký tự": "少なくとも 8 文字",
    "Ít nhất 12 ký tự": "少なくとも 12 文字",
    "Tên này có thể trùng với người khác.": "この名前は他のユーザーと共有される可能性があります。",
    "Ví dụ: @minh_nguyen — chỉ gồm chữ, số, dấu _ và -.": "例: @minh_nguyen — 文字、数字、_ および - のみ。",
    "Chỉ gồm chữ, số, dấu _ và -": "文字、数字、_ および - のみ",
    "Giữ cho tôi cập nhật những điều thú vị Modium đang làm qua email": "Modium が取り組んでいることの最新情報を電子メールで知らせてください",
    "Hoàn tất đăng ký": "サインアップを完了する",
    "Vui lòng nhập đầy đủ thông tin.": "すべてのフィールドに入力してください。",
    "Email/tên đăng nhập hoặc mật khẩu không đúng.": "メールアドレス/ユーザー名またはパスワードが間違っています。",
    "Tên đăng nhập phải dài 3–20 ký tự, chỉ gồm chữ, số, dấu _ và -.": "ユーザー名は 3 ～ 20 文字で、文字、数字、_、- のみを含む必要があります。",
    "Tên @ phải dài 3–20 ký tự, chỉ gồm chữ, số, dấu _ và -.": "@handle は 3 ～ 20 文字で、文字、数字、_、- のみを含む必要があります。",
    "Tên @ đã được sử dụng.": "その @handle はすでに取得されています。",
    "Email không hợp lệ.": "メールアドレスが無効です。",
    "Mật khẩu phải có ít nhất 8 ký tự.": "パスワードは 8 文字以上である必要があります。",
    "Mật khẩu phải có 12–128 ký tự và không chứa ký tự điều khiển.": "パスワードは 12 ～ 128 文字にする必要があり、制御文字を含めることはできません。",
    "Tên hiển thị dài 1–40 ký tự và không chứa ký tự đặc biệt nguy hiểm.": "表示名は 1 ～ 40 文字にする必要があり、安全でない文字を含めることはできません。",
    "Mật khẩu xác nhận không khớp.": "パスワードが一致しません。",
    "Tên đăng nhập đã được sử dụng.": "そのユーザー名はすでに使用されています。",
    "Email đã được sử dụng.": "そのメールはすでに使用されています。",
    "Trình duyệt này không hỗ trợ mã hóa mật khẩu an toàn.": "このブラウザは安全なパスワード ハッシュをサポートしていません。",
    "Không thể lưu tài khoản. Hãy kiểm tra trình duyệt có đang chặn lưu trữ không.": "アカウントを保存できませんでした。ブラウザがストレージをブロックしていないか確認してください。",
    "Bạn đã thử quá nhiều lần. Hãy thử lại sau 30 giây.": "試行回数が多すぎます。 30 秒後にもう一度お試しください。",
    "Đăng nhập bằng dịch vụ bên ngoài cần máy chủ nên chưa khả dụng trong bản demo này.": "外部サービスを使用したサインインにはサーバーが必要なため、このデモではまだ使用できません。",
    "Khôi phục mật khẩu cần máy chủ gửi email nên chưa khả dụng trong bản demo này.": "パスワード回復には電子メールを送信するサーバーが必要なため、このデモではまだ利用できません。",
    "Tiếp tục với passkey": "パスキーを使用して続行する",
    "Quên mật khẩu": "パスワードをお忘れですか",
    "Menu tài khoản": "アカウントメニュー",
    "Đăng bài": "公開",
    "Hồ sơ": "プロフィール",
    "Nâng cấp lên Modium+": "Modium+ にアップグレードする",
    "Máy chủ của tôi": "私のサーバー",
    "Thông báo": "通知",
    "Báo cáo đang xử lý": "アクティブなレポート",
    "Bộ sưu tập": "コレクション",
    "Dự án": "プロジェクト",
    "Tổ chức": "組織",
    "Phân tích": "分析",
    "Doanh thu": "収益",
    "Chuyển tài khoản": "アカウントを切り替える",
    "Đăng xuất": "サインアウト",
    "Chào mừng trở lại,": "おかえり、",
    "Đến bảng điều khiển": "ダッシュボードに移動",
    "Truy cập nhanh": "クイックアクセス",
    "Xem thông tin tài khoản của bạn": "アカウントの詳細を表示する",
    "Theo dõi hoạt động của bạn": "アクティビティを追跡する",
    "Tùy chỉnh giao diện và ngôn ngữ": "外観と言語をカスタマイズする",
    "Bảng điều khiển": "ダッシュボード",
    "Tham gia": "参加しました",
    "Lượt tải": "ダウンロード",
    "Người theo dõi": "フォロワー",
    "Bạn chưa có dự án nào": "まだプロジェクトがありません",
    "Tính năng đăng dự án chưa khả dụng trong bản demo này.": "このデモではプロジェクトの公開はまだ利用できません。",
    "Mods": "改造",
    "Gói tài nguyên": "リソースパック",
    "Gói dữ liệu": "データパック",
    "Shader": "シェーダ",
    "Modpack": "モッドパック",
    "Plugin": "プラグイン",
    "Máy chủ": "サーバー",
    "Loại tài nguyên": "リソースの種類",
    "Bộ lọc": "フィルター",
    "Tìm kiếm dự án...": "プロジェクトを検索...",
    "Tìm kiếm dự án": "プロジェクトを検索する",
    "Phiên bản trò chơi": "ゲームバージョン",
    "Tìm kiếm...": "検索...",
    "Tìm phiên bản": "バージョンの検索",
    "Hiện tất cả phiên bản": "すべてのバージョンを表示",
    "Bộ nạp": "ローダ",
    "Hiện thêm": "もっと見る",
    "Thu gọn": "表示を少なくする",
    "Danh mục": "カテゴリ",
    "Môi trường": "環境",
    "Phía máy khách": "クライアント側",
    "Phía máy chủ": "サーバー側",
    "Máy khách và máy chủ": "クライアントとサーバー",
    "Máy khách hoặc máy chủ": "クライアントまたはサーバー",
    "Giấy phép": "ライセンス",
    "Mã nguồn mở": "オープンソース",
    "Phụ thuộc vào": "に応じて",
    "Tìm một dự án...": "プロジェクトを検索...",
    "Tìm dự án phụ thuộc": "依存関係プロジェクトの検索",
    "Loại trừ nâng cao": "高度な除外",
    "Ẩn các danh mục sau": "これらのカテゴリを非表示にする",
    "Sắp xếp theo:": "並べ替え：",
    "Mức liên quan": "関連性",
    "Lượt tải nhiều nhất": "ほとんどのダウンロード",
    "Được theo dõi nhiều nhất": "最もフォローされている",
    "Cập nhật gần đây": "最近更新された",
    "Hiển thị:": "ビュー：",
    "Đổi bố cục": "レイアウトの変更",
    "Trang trước": "前のページへ",
    "Trang sau": "次のページ",
    "kết quả": "結果",
    "bởi": "による",
    "Không tìm thấy dự án phù hợp": "一致するプロジェクトが見つかりませんでした",
    "Hãy thử bỏ bớt bộ lọc.": "いくつかのフィルターを削除してみてください。",
    "Xóa bộ lọc": "フィルターをクリアする",
    "Dữ liệu minh họa: các dự án trên trang này là mẫu tự tạo.": "デモ データ: このページのプロジェクトは作成されたサンプルです。",
    "Phiêu lưu": "アドベンチャー",
    "Bị nguyền": "呪われた",
    "Trang trí": "装飾",
    "Kinh tế": "経済",
    "Trang bị": "装置",
    "Thức ăn": "食べ物",
    "Cơ chế game": "ゲームの仕組み",
    "Thư viện": "図書館",
    "Phép thuật": "魔法",
    "Quản lý": "管理",
    "Sinh vật": "モブ",
    "Tối ưu hóa": "最適化",
    "Xã hội": "社交",
    "Kho chứa": "ストレージ",
    "Công nghệ": "テクノロジー",
    "Vận chuyển": "交通機関",
    "Tiện ích": "ユーティリティ",
    "Tạo thế giới": "世界世代",
    "Độ phân giải": "解像度",
    "8x trở xuống": "8倍以下",
    "512x trở lên": "512x以上",
    "Âm thanh": "オーディオ",
    "Khối": "ブロック",
    "Chiến đấu": "戦闘",
    "Phông chữ": "フォント",
    "Giao diện (GUI)": "GUI",
    "Vật phẩm": "アイテム",
    "Bản địa hóa": "ロケール",
    "Mô hình": "モデル",
    "Loại trừ": "除外する",
    "Chưa có tài nguyên nào": "まだリソースがありません",
    "Hãy là người đầu tiên chia sẻ sáng tạo của bạn với cộng đồng.": "あなたの作品をコミュニティと最初に共有してください。",
    "Đăng tài nguyên": "リソースを公開する",
    "Bạn có những thay đổi chưa được lưu": "未保存の変更があります",
    "Đặt lại": "リセット",
    "Lưu": "保存",
    "Modium là": "モディウムは",
    "mã nguồn mở được làm bởi Vazkii": "オープンソース、Vazkii 製",
    "Giới thiệu": "について",
    "Tin tức": "ニュース",
    "Nhật ký thay đổi": "変更履歴",
    "Trạng thái": "状態",
    "Tuyển dụng": "キャリア",
    "Chương trình phần thưởng": "特典プログラム",
    "Sản phẩm": "製品",
    "Ứng dụng Modium": "モディウムアプリ",
    "Tài nguyên": "リソース",
    "Trung tâm trợ giúp": "ヘルプセンター",
    "Dịch thuật": "翻訳",
    "Báo cáo sự cố": "問題を報告する",
    "Tài liệu API": "APIドキュメント",
    "Pháp lý": "法律上の",
    "Quy tắc về nội dung": "コンテンツルール",
    "Điều khoản sử dụng": "利用規約",
    "Chính sách quyền riêng tư": "プライバシーポリシー",
    "Thông báo bảo mật": "セキュリティに関する通知",
    "Chính sách bản quyền và DMCA": "著作権とDMCAポリシー",
    "ĐÂY KHÔNG PHẢI WEB CHÍNH THỨ CỦA NHÀ PHÁT TRIỂN MINI WAN, ĐÂY LÀ MỘT DỰ ÁN TÔI MUỐN CÔNG KHAI MỘT SỐ THỨ VỚI MỌI NGƯỜI VÀ CHẮC CHẮN LÀ NÓ LEGIT": "これは MINI WAN 開発者の公式 Web サイトではありません。これは私が皆さんと公に共有したいプロジェクトであり、間違いなく合法です",
    "Ai cũng thấy và tìm được dự án.": "誰もがプロジェクトを見て見つけることができます。",
    "Bạn chưa có dự án nào!": "まだプロジェクトがありません。",
    "Bạn chưa đăng nhập.": "まだログインしていません。",
    "Bạn đã vượt giới hạn tổng 100 MB tệp trong bản demo.": "デモで合計ファイル制限 100 MB を超えました。",
    "Chi tiết": "詳細",
    "Chưa chọn tệp": "ファイルが選択されていません",
    "Chưa có gì để hiển thị ở đây.": "ここにはまだ何も表示できません。",
    "Chưa có phiên bản nào được đăng.": "まだバージョンは投稿されていません。",
    "Chưa có thay đổi nào.": "まだ変更はありません。",
    "Chưa có ảnh nào trong thư viện.": "ギャラリーにはまだ写真がありません。",
    "Chế độ hiển thị": "表示モード",
    "Chỉ bạn và cộng tác viên xem được.": "あなたとあなたの共同編集者だけがそれを見ることができます。",
    "Chỉ người có liên kết mới xem được.": "リンクを知っている人だけが見ることができます。",
    "Chủ sở hữu": "所有者",
    "Chủ đề (chọn nhiều)": "トピック (複数選択)",
    "Có lỗi xảy ra, trình duyệt có thể không hỗ trợ mã hóa an toàn.": "エラーが発生しました。ブラウザは安全な暗号化をサポートしていない可能性があります。",
    "Công khai": "公共",
    "Cập nhật": "更新",
    "Cộng tác viên": "協力者",
    "Cộng tác viên (không bắt buộc)": "協力者（必須ではありません）",
    "Dùng URL": "URLを使用する",
    "Dữ liệu thay đổi không hợp lệ.": "変更されたデータは無効です。",
    "Dự án không tồn tại hoặc bạn không có quyền truy cập.": "プロジェクトが存在しないか、アクセス権がありません。",
    "Dự án này chưa có tệp hoặc đường dẫn tải xuống hợp lệ.": "このプロジェクトには有効なファイルまたはダウンロード リンクがまだありません。",
    "Email mới": "新しいメール",
    "Español (España)": "スペイン語 (エスパーニャ)",
    "Español (Latinoamérica)": "スペイン語 (ラテンアメリカ)",
    "Français": "フランセ",
    "Giới thiệu chỉ được dài tối đa 160 ký tự.": "紹介文の長さは最大 160 文字までです。",
    "Hành động này không thể hoàn tác.": "この操作は元に戻すことができません。",
    "Hãy chia sẻ mod, modpack hay gói tài nguyên đầu tiên của bạn.": "最初の MOD、MODPACK、またはリソース パックを共有してください。",
    "Hãy chọn chế độ hiển thị.": "表示モードを選択してください。",
    "Hãy chọn loại dự án.": "プロジェクトの種類を選択してください。",
    "Hãy chọn tải tệp lên hoặc nhập URL tải xuống.": "ファイルをアップロードするか、ダウンロード URL を入力するかを選択します。",
    "Hãy chọn tệp cần tải lên.": "アップロードするファイルを選択します。",
    "Hãy chọn độ phân giải của gói tài nguyên.": "リソース パックの解像度を選択してください。",
    "Hãy nhập URL HTTP/HTTPS hợp lệ (không dùng javascript:, data: hoặc thông tin đăng nhập trong URL).": "有効な HTTP/HTTPS URL を入力してください (URL には javascript:、data:、またはログイン情報を使用しないでください)。",
    "Hãy nhập mô tả ngắn hợp lệ (tối đa 200 ký tự).": "有効な短い説明を入力してください (最大 200 文字)。",
    "Hãy nhập đúng tên @ để xác nhận.": "確認のため正しい@名を入力してください。",
    "Hôm nay": "今日",
    "hôm nay": "今日",
    "Kho tệp đang được mở ở thẻ khác. Hãy tải lại trang rồi thử lại.": "ファイル ストアが別のタブで開かれています。ページをリロードして、もう一度お試しください。",
    "Không công khai": "非公開",
    "Không dọn được tệp.": "ファイルをクリーンアップできません。",
    "Không mở được kho tệp.": "ファイル ストアを開けません。",
    "Không thể cập nhật bảo mật tài khoản.": "アカウントのセキュリティを更新できません。",
    "Không thể lưu phiên đăng nhập. Hãy kiểm tra trình duyệt có đang chặn lưu trữ không.": "ログインセッションを保存できません。ブラウザがストレージをブロックしていないか確認してください。",
    "Không thể lưu thay đổi.": "変更を保存できません。",
    "Không thể lưu tệp trong trình duyệt.": "ファイルをブラウザに保存できません。",
    "Không thể lưu tệp. Hãy kiểm tra dung lượng trống của trình duyệt.": "ファイルを保存できませんでした。ブラウザの空き容量を確認してください。",
    "Không thể tạo dự án. Hãy thử lại.": "プロジェクトを作成できません。もう一度試してください。",
    "Không thể tạo khóa 2FA trên trình duyệt này.": "このブラウザでは 2FA キーを生成できません。",
    "Không thể tải tệp. Hãy thử lại.": "ファイルをロードできませんでした。もう一度試してください。",
    "Không thể xóa dữ liệu dự án của tài khoản.": "アカウントのプロジェクトデータは削除できません。",
    "Không thể xóa tài khoản.": "アカウントは削除できません。",
    "Không thể đọc tệp trong trình duyệt. Hãy thử lại.": "ファイルをブラウザで読み取ることができません。もう一度試してください。",
    "Không tìm thấy tệp trên thiết bị này. Trong bản demo, tệp upload chưa được đồng bộ lên máy chủ.": "このデバイス上にファイルが見つかりません。デモでは、アップロードされたファイルはサーバーに同期されていません。",
    "Không xóa được tệp tạm.": "一時ファイルを削除できません。",
    "Không đọc được tệp.": "ファイルを読み取れません。",
    "Loại dự án": "プロジェクトの種類",
    "Magyar (Magyarország)": "マジャル語 (マジャロルザグ)",
    "Mã 6 số hiện trong ứng dụng": "6桁のコードがアプリケーションに表示されます",
    "Mã không đúng. Hãy thử mã mới trong ứng dụng.": "コードが間違っています。アプリで新しいコードを試してください。",
    "Mã xác thực 2 bước": "2段階認証コード",
    "Mã xác thực không đúng.": "認証コードが間違っています。",
    "Mô tả": "説明する",
    "Mô tả ngắn": "簡単な説明",
    "Mật khẩu hiện tại": "現在のパスワード",
    "Mật khẩu hiện tại không đúng.": "現在のパスワードが間違っています。",
    "Mật khẩu mới (≥ 12 ký tự)": "新しいパスワード (12 文字以上)",
    "Mật khẩu mới phải có 12–128 ký tự và không chứa ký tự điều khiển.": "新しいパスワードの長さは 12 ～ 128 文字にする必要があり、制御文字を含めることはできません。",
    "Người dùng Modium.": "Modiumユーザー。",
    "Người dùng này chưa có dự án nào!": "このユーザーにはまだプロジェクトがありません。",
    "Người sáng tạo": "クリエイター",
    "Nhập mã xác thực 2 bước từ ứng dụng của bạn.": "アプリから2段階認証コードを入力します。",
    "Phiên bản": "バージョン",
    "Riêng tư": "プライベート",
    "Thiết lập": "確立する",
    "Thông tin": "情報",
    "Nền tảng": "プラットフォーム",
    "Loại": "種類",
    "Hiển thị": "公開範囲",
    "Tải xuống": "ダウンロード",
    "Thẻ": "カード",
    "Tiếng Việt": "ベトナム語",
    "Trình duyệt không hỗ trợ lưu tệp an toàn (IndexedDB).": "ブラウザは安全なファイル保存 (IndexedDB) をサポートしていません。",
    "Trình duyệt không hỗ trợ tạo mã tệp an toàn.": "ブラウザは安全なファイル暗号化をサポートしていません。",
    "Tài khoản và bảo mật": "アカウントとセキュリティ",
    "Tài khoản đã đạt giới hạn 100 dự án trong bản demo.": "アカウントはデモでプロジェクトの制限である 100 に達しました。",
    "Tên @ không hợp lệ.": "@Nameが無効です。",
    "Tên @ không thể đổi sau khi tạo tài khoản để bảo vệ liên kết dự án.": "プロジェクトのリンクを保護するために、アカウント作成後に @name を変更することはできません。",
    "Tên dự án": "プロジェクト名",
    "Tên dự án phải dài 3–40 ký tự hợp lệ.": "プロジェクト名は、有効な文字数が 3 ～ 40 文字である必要があります。",
    "Tên tệp không hợp lệ.": "ファイル名が無効です。",
    "Tạo dự án": "プロジェクトの作成",
    "Tải tệp lên": "ファイルをアップロードする",
    "Tải về bản sao dữ liệu tài khoản của bạn (JSON).": "アカウント データ (JSON) のコピーをダウンロードします。",
    "Tất cả": "全て",
    "Tắt 2FA": "2FA をオフにする",
    "Tệp không phải ảnh hợp lệ.": "ファイルは有効な画像ではありません。",
    "Tệp phải có dung lượng từ 1 byte đến 25 MB.": "ファイルは 1 バイトから 25 MB までである必要があります。",
    "Tệp phải từ 1 byte đến 25 MB.": "ファイルは 1 バイトから 25 MB までである必要があります。",
    "Tệp tải xuống": "ファイルをダウンロードする",
    "Tệp vượt quá giới hạn dung lượng.": "ファイルが容量制限を超えています。",
    "URL chỉ gồm chữ thường, số, dấu - (3–40 ký tự).": "URL には、小文字、数字、および - 記号 (3 ～ 40 文字) のみが含まれます。",
    "URL này đã được dùng, hãy đổi tên khác.": "この URL は既に使用されています。名前を変更してください。",
    "Xuất": "輸出",
    "Xuất dữ liệu": "データのエクスポート",
    "Xác nhận mật khẩu mới": "新しいパスワードを確認します",
    "Xác thực hai bước (2FA)": "二段階認証（2FA）",
    "Xóa": "消去",
    "Xóa tài khoản": "アカウントを削除する",
    "lượt tải": "ダウンロード",
    "ngày trước": "数日前",
    "người theo dõi": "フォロワー",
    "năm trước": "去年",
    "tháng trước": "先月",
    "Đang chuẩn bị tải xuống…": "ダウンロードの準備をしています…",
    "Đang tạo…": "作成…",
    "Đã bật xác thực hai bước.": "二段階認証が有効になりました。",
    "Đã bắt đầu tải xuống.": "ダウンロードが開始されました。",
    "Đã lưu thay đổi.": "変更が保存されました。",
    "Đã lưu.": "保存されました。",
    "Đã tắt xác thực hai bước.": "二段階認証が無効になっています。",
    "Đã đổi email.": "メールアドレスが変わりました。",
    "Đã đổi mật khẩu.": "パスワードが変更されました。",
    "Đăng": "公開",
    "Đổi email": "メールアドレスを変更する",
    "Đổi mật khẩu": "パスワードを変更する",
    "Đổi mật khẩu đăng nhập của bạn.": "ログインパスワードを変更します。",
    "Độ phân giải gói tài nguyên": "リソースパックの解像度",
    "Ảnh đại diện không hợp lệ.": "プロフィール写真が無効です。",
    "Đang kết nối đến Modium…": "Modium に接続しています…",
    "Không thể kết nối đến dịch vụ Modium.": "Modium サービスに接続できません。",
    "Hãy kiểm tra cấu hình Supabase và thử lại.": "Supabase の設定を確認して、もう一度お試しください。",
    "Thử lại": "再試行",
    "Nếu email tồn tại, liên kết đặt lại mật khẩu sẽ được gửi đến hộp thư.": "メールアドレスが登録されている場合、パスワードリセットリンクが受信トレイに送信されます。",
    "Kiểm tra email để xác nhận tài khoản trước khi đăng nhập.": "ログイン前にメールを確認してアカウントを認証してください。",
    "Không thể lưu thay đổi. Hãy thử lại.": "変更を保存できませんでした。もう一度お試しください。",
    "Không thể tạo khóa xác thực hai bước.": "二要素認証キーを作成できませんでした。",
    "Tệp tải lên tối đa 25 MB và được lưu trong kho riêng của Modium.": "アップロードは最大 25 MB で、Modium のプライベートストレージに保存されます。",
    "Hãy xác minh mật khẩu và mã 2FA hiện tại.": "現在のパスワードと 2FA コードを確認してください。",
    "Không thể tải file lên máy chủ. Kiểm tra quota/dung lượng rồi thử lại.": "ファイルをアップロードできませんでした。ストレージ容量を確認して再試行してください。",
    "Tài khoản đã đạt giới hạn 100 dự án.": "このアカウントはプロジェクト数の上限 100 件に達しました。",
    "Nhập mã từ ứng dụng xác thực, rồi đăng nhập lại.": "認証アプリのコードを入力して、もう一度ログインしてください。",
    "Đặt lại mật khẩu": "パスワードをリセット",
    "Nhập mật khẩu mới để hoàn tất khôi phục.": "新しいパスワードを入力して、復旧を完了してください。",
    "Liên kết khôi phục không hợp lệ hoặc đã hết hạn.": "復旧リンクが無効か、有効期限が切れています。",
    "Không thể cập nhật mật khẩu. Hãy thử lại.": "パスワードを更新できませんでした。もう一度お試しください。",
    "Lưu mật khẩu mới": "新しいパスワードを保存",
    "Mật khẩu đã được cập nhật.": "パスワードを更新しました。",
    "Mã 2FA hiện tại": "現在の 2FA コード",
    "Hãy nhập mã 2FA hiện tại.": "現在の 2FA コードを入力してください。",
    "Không thể xác minh trạng thái xác thực của tài khoản.": "アカウントの認証状態を確認できませんでした。",
    "Không thể gửi email khôi phục.": "復旧メールを送信できませんでした。"
  };
  var DICT = { en: EN, 'es-419': ES_419, 'zh-CN': ZH_CN, ja: JA };
  var PARTIAL_KEYS = Object.keys(EN).filter(function (k) { return k.length >= 3; }).sort(function (a, b) { return b.length - a.length; });
  var PARTIAL_RE = new RegExp(PARTIAL_KEYS.map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'), 'g');
  var ATTRS = ['aria-label', 'placeholder', 'alt'];
  var current = 'vi';

  function table(code) {
    if (code === 'vi') return null;
    return DICT[code] || DICT[code.split('-')[0]] || EN; /* chưa có bản dịch -> tiếng Anh */
  }

  function tr(src, tbl) {
    var k = src.trim();
    if (!k || !tbl) return src;
    var translation = tbl[k] || EN[k];
    if (translation) return src.replace(k, translation);
    return src.replace(PARTIAL_RE, function (match) { return tbl[match] || EN[match] || match; });
  }

  /* Áp dụng ngôn ngữ cho toàn bộ (hoặc một phần) trang. Có thể gọi lặp lại nhiều lần. */
  function apply(root) {
    root = root || document.body;
    var tbl = table(current);
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode && n.parentNode.nodeName;
        return p === 'SCRIPT' || p === 'STYLE' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = w.nextNode())) {
      if (n.__o === undefined) n.__o = n.nodeValue; /* nhớ bản tiếng Việt gốc */
      var v = tbl ? tr(n.__o, tbl) : n.__o;
      if (n.nodeValue !== v) n.nodeValue = v;
    }
    var els = root.querySelectorAll ? root.querySelectorAll('[aria-label],[placeholder],[alt]') : [];
    Array.prototype.forEach.call(els, function (el) {
      ATTRS.forEach(function (a) {
        if (!el.hasAttribute(a)) return;
        var key = 'data-o-' + a;
        if (!el.hasAttribute(key)) el.setAttribute(key, el.getAttribute(a)); /* nhớ bản gốc */
        var o = el.getAttribute(key);
        var nv = tbl ? tr(o, tbl) : o;
        if (el.getAttribute(a) !== nv) el.setAttribute(a, nv);
      });
    });
    document.documentElement.lang = current;
  }

  /* Đổi ngôn ngữ hiện hành rồi áp dụng ngay. */
  function set(code) {
    current = code || 'vi';
    apply(document.body);
  }

  /* Dịch một câu động (vd. thông báo lỗi) theo ngôn ngữ hiện hành. */
  function t(src) { return tr(src, table(current)); }

  window.L = { t: t, set: set, apply: apply, get: function () { return current; }, dict: DICT };
})();
;
/* Modium – FRONTEND: khung chung (đầu trang + chân trang) cho mọi trang HTML. Sửa menu/footer ở đây, không cần sửa từng file .html. */
(function () {
  var html = "<div class=\"bgp\">\n    </div>\n<header>\n    <a class=\"brand\" href=\"#/\">\n        <img alt=\"\" src=\"logo.png\">Modium\n    </a>\n\n<nav>\n    <div class=\"dd\" id=\"dd\">\n        <button class=\"nb\" id=\"ddb\" aria-haspopup=\"menu\" aria-expanded=\"false\">\n            <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n                <circle cx=\"12\" cy=\"12\" r=\"10\"/>\n                <path d=\"m16.24 7.76-1.8 5.41a2 2 0 0 1-1.27 1.27L7.76 16.24l1.8-5.41a2 2 0 0 1 1.27-1.27z\"/>\n            </svg>Khám phá nội dung<span class=\"chv\">\n                <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n                    <path d=\"m6 9 6 6 6-6\"/>\n                </svg>\n            </span>\n        </button>\n        <div class=\"menu\" role=\"menu\">\n            <!-- Mods -->\n            <a role=\"menuitem\" href=\"#/mods\">\n                <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n                    <path d=\"M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z\"/>\n                    <path d=\"M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7M14.5 17.5 4.5 15\"/>\n                </svg>Mods\n            </a>\n\n            <!-- Resource pack -->\n            <a role=\"menuitem\" href=\"resourcepacks.html\">\n                <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n                    <path d=\"M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z\"/>\n                    <path d=\"m3.3 7 8.7 5 8.7-5M12 22V12\"/>\n                </svg>Resouce pack\n            </a>\n\n            <!-- Mod -->\n                <a role=\"menuitem\" href=\"modpacks.html\">\n                    <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n                        <path d=\"M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z\"/>\n                        <path d=\"M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7M14.5 17.5 4.5 15\"/>\n                    </svg>Mod Pack\n                </a>\n\n                <!-- Script -->\n                    <a role=\"menuitem\" href=\"#/plugins\">\n                        <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n                            <path d=\"M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1\"/>\n                        </svg>Script\n                    </a>\n\n                        <!-- Shader -->\n                    <a role=\"menuitem\" href=\"#/shaders\">\n                        <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n                            <circle cx=\"6\" cy=\"15\" r=\"4\"/>\n                            <circle cx=\"18\" cy=\"15\" r=\"4\"/>\n                            <path d=\"M14 15a2 2 0 0 0-2-2 2 2 0 0 0-2 2M2.5 13 5 7c.7-1.3 1.4-2 3-2M21.5 13 19 7c-.7-1.3-1.5-2-3-2\"/>\n                        </svg>Shader\n                    </a>\n                    \n                    <!-- Structure -->\n                    <a role=\"menuitem\" href=\"#/structures\">\n                            <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n                                <path d=\"m7.5 4.27 9 5.15\"/>\n                                <path d=\"M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z\"/>\n                                <path d=\"m3.3 7 8.7 5 8.7-5M12 22V12\"/>\n                            </svg>Công trình\n                        </a>\n\n                        <!-- API Documentation -->\n                        <a role=\"menuitem\" href=\"#/\">\n                            <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n                            <path d=\"M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z\"/>\n                            </svg>Tài Liệu API\n                        </a>\n\n                        <a role=\"menuitem\" href=\"#/\">\n                            <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n                                <path d=\"M22 12H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11zM6 16h.01M10 16h.01\"/>\n                            </svg>Tạo Map Đám Mây\n                        </a>\n        </div>\n    </div>\n                            <a class=\"nb\" href=\"#/\">\n                                <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n                                    <rect width=\"20\" height=\"8\" x=\"2\" y=\"2\" rx=\"2\"/>\n                                    <rect width=\"20\" height=\"8\" x=\"2\" y=\"14\" rx=\"2\"/>\n                                    <path d=\"M6 6h.01M6 18h.01\"/>\n                                </svg>Tạo máy chủ</a>\n\n                            <a class=\"nb\" href=\"#/\">\n                                <svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n                                <path d=\"M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1m-4-4-4 4m0 0-4-4m4 4V4\"/>\n                                </svg>Tải App\n                            </a>\n</nav>\n<div class=\"hr\" id=\"hr\">\n    <a class=\"btn p\" href=\"#/\">Đăng nhập</a>\n    <a class=\"gear\" href=\"#/settings\" aria-label=\"Cài đặt\"><svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1\"/></svg></a></div></header>\n<main class=\"wrap\" id=\"app\">\n\n</main>\n<footer>\n    <div class=\"fg\">\n        <div>\n            <a class=\"brand\" href=\"#/\" style=\"margin:0\">\n                <img alt=\"\" src=\"logo.png\">Modium</a>\n<div class=\"soc\">\n    <a href=\"#/\" aria-label=\"Discord\">\n        <svg viewBox=\"0 0 24 24\">\n            <path d=\"M20.317 4.37a19.8 19.8 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.3 18.3 0 0 0-5.487 0 13 13 0 0 0-.617-1.25.08.08 0 0 0-.079-.037A19.7 19.7 0 0 0 3.677 4.37C.533 9.046-.32 13.58.099 18.057a19.9 19.9 0 0 0 5.993 3.03c.462-.63.874-1.295 1.226-1.994a13 13 0 0 1-1.872-.892 10 10 0 0 0 .372-.292c3.928 1.793 8.18 1.793 12.062 0 .12.098.246.198.373.292a12.3 12.3 0 0 1-1.873.892c.36.698.772 1.362 1.225 1.993a19.8 19.8 0 0 0 6.002-3.03c.5-5.177-.838-9.674-3.549-13.66M8.02 15.33c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418m7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418\"/>\n        </svg>\n    </a>\n<a href=\"#/\" aria-label=\"Bluesky\">\n    <svg viewBox=\"0 0 24 24\">\n        <path d=\"M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8\"/>\n</svg>\n</a>\n<a href=\"#/\" aria-label=\"X\">\n    <svg viewBox=\"0 0 24 24\">\n        <path d=\"M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z\"/>\n    </svg>\n</a>\n<a href=\"#/\" aria-label=\"YouTube\">\n    <svg viewBox=\"0 0 24 24\">\n        <path d=\"M23.498 6.186a3.02 3.02 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.02 3.02 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.02 3.02 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.02 3.02 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814M9.545 15.568V8.432L15.818 12z\"/>\n    </svg>\n</a>\n<a href=\"#/\" aria-label=\"Reddit\">\n    <svg viewBox=\"0 0 24 24\">\n        <path d=\"M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286A.72.72 0 0 0 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0m4.388 3.199a1.999 1.999 0 1 1-1.947 2.46 2.37 2.37 0 0 0-2.032 2.341c1.776.067 3.4.567 4.686 1.363a2.802 2.802 0 1 1 2.908 4.753c-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87a2.8 2.8 0 0 1 1.189-5.34c.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365a3.23 3.23 0 0 1 2.88-3.207 2 2 0 0 1 1.959-1.595m-8.085 8.376c-.784 0-1.459.78-1.506 1.797s.64 1.429 1.426 1.429 1.371-.369 1.418-1.385-.553-1.841-1.338-1.841m7.406 0c-.786 0-1.385.824-1.338 1.841s.634 1.385 1.418 1.385c.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797m-3.703 4.013c-.974 0-1.907.048-2.77.135a3.2 3.2 0 0 0 2.953 1.964 3.2 3.2 0 0 0 2.953-1.964 28 28 0 0 0-2.769-.135\"/>\n    </svg>\n</a>\n</div>\n\n    <p>Modium là <a href=\"#/\">mã nguồn mở được làm bởi Vazkii</a>.</p><p>© 2026 Modium</p>\n</div>\n<div>\n    <h4>Giới thiệu</h4>\n    <a href=\"#/\">Tin tức</a>\n    <a href=\"#/\">Nhật ký thay đổi</a>\n    <a href=\"#/\">Trạng thái</a>\n    <a href=\"#/\">Tuyển dụng</a>\n    <a href=\"#/\">Chương trình phần thưởng</a>\n</div>\n\n<div>\n    <h4>Sản phẩm</h4>\n    <a href=\"#/\">Modium+</a>\n    <a href=\"#/\">Ứng dụng Modium</a>\n    <a href=\"#/\">Modium Hosting</a>\n</div>\n\n<div>\n    <h4>Tài nguyên</h4>\n<a href=\"#/\">Trung tâm trợ giúp</a>\n<a href=\"#/\">Dịch thuật</a>\n<a href=\"#/\">Báo cáo sự cố</a>\n<a href=\"#/\">Tài liệu API</a>\n</div>\n\n<div>\n    <h4>Pháp lý</h4>\n    <a href=\"#/\">Quy tắc về nội dung</a>\n    <a href=\"#/\">Điều khoản sử dụng</a>\n    <a href=\"#/\">Chính sách quyền riêng tư</a>\n    <a href=\"#/\">Thông báo bảo mật</a>\n    <a href=\"#/\">Chính sách bản quyền và DMCA</a>\n</div>\n\n<div class=\"dis\">ĐÂY KHÔNG PHẢI WEB CHÍNH THỨC CỦA NHÀ PHÁT TRIỂN MINI WAN, ĐÂY LÀ MỘT DỰ ÁN TÔI MUỐN CÔNG KHAI MỘT SỐ THỨC VỚI MỌI NGƯỜI VÀ CHẮC CHẮN LÀ NÓ LEGIT</div>\n</footer>\n\n        ";
  if (window.PAGE) html = html.replace(/href="#\//g, 'href="index.html#/');
  document.body.insertAdjacentHTML('afterbegin', html);
})();
;
/* Modium – FRONTEND: giao diện đăng nhập / đăng ký, menu tài khoản. Dữ liệu & xử lý nằm ở backend/api.js (window.API). */
(function () {
  var user = API.user, signUp = API.signUp, signIn = API.signIn, signOut = API.signOut;
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function ic(d, cls) { return '<svg' + (cls ? ' class="' + cls + '"' : '') + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; }

  /* ---------- ảnh đại diện ---------- */
  function avatar(u, big) {
    var cl = 'av' + (big ? ' lg' : '');
    if (u.avatar) return '<img class="' + cl + '" src="' + esc(u.avatar) + '" alt="">';
    var h = 0, n = String(u.displayName || u.username || '?'); for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360;
    return '<span class="' + cl + '" style="background:hsl(' + h + ' 52% 38%)" aria-hidden="true">' + esc(n.charAt(0).toUpperCase()) + '</span>';
  }

  /* ---------- đầu trang ---------- */
  var OUT = null;
  var P = {
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    up: '<path d="m18 9-6-6-6 6"/><path d="M12 3v14"/><path d="M5 21h14"/>',
    srv: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    lib: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
    org: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
    chart: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
    usd: '<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    sw: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    plus: '<path d="M5 12h14M12 5v14"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    gear: '<circle cx="12" cy="12" r="3"/>',
    arr: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>'
  };
  function item(href, icon, label, cls) {
    return '<a role="menuitem" href="' + href + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + ic(P[icon]) + label + '</a>';
  }

  function header0() {
    var h = document.getElementById('hr'); if (!h) return;
    if (OUT === null) { OUT = h.innerHTML; var g = h.querySelector('.gear svg'); if (g) P.gear = g.innerHTML; }
    var u = user();
    if (!u) {
      h.innerHTML = OUT.replace(/(<a class="btn p" href=")[^"]*"/, '$1#/signin"');
      return;
    }
    h.innerHTML =
      '<a class="btn pub" href="#/new">' + ic(P.plus) + 'Đăng bài</a>' +
      '<div class="dd ud" id="ud"><button class="uav" id="udb" aria-haspopup="menu" aria-expanded="false" aria-label="Menu tài khoản">' +
      avatar(u) + '<span class="chv">' + ic(P.down) + '</span></button>' +
      '<div class="menu" role="menu">' +
      item('#/user', 'user', 'Hồ sơ') +
      item('#/', 'up', 'Nâng cấp lên Modium+', 'up') +
      item('#/', 'srv', 'Máy chủ của tôi') +
      item('#/settings', 'gear', 'Cài đặt') +
      '<hr class="mh">' +
      item('#/', 'bell', 'Thông báo') + item('#/', 'flag', 'Báo cáo đang xử lý') + item('#/', 'lib', 'Bộ sưu tập') +
      '<hr class="mh">' +
      item('#/dashboard', 'box', 'Dự án') + item('#/', 'org', 'Tổ chức') + item('#/', 'chart', 'Phân tích') + item('#/', 'usd', 'Doanh thu') +
      '<hr class="mh">' +
      '<a role="menuitem" href="#/signin" id="usw">' + ic(P.sw) + 'Chuyển tài khoản<span class="mr">' + ic(P.right) + '</span></a>' +
      '<button role="menuitem" class="so" id="uso">' + ic(P.out) + 'Đăng xuất</button>' +
      '</div></div>';
    var ud = document.getElementById('ud'), b = document.getElementById('udb');
    b.onclick = function (e) { e.stopPropagation(); var o = ud.classList.toggle('open'); b.setAttribute('aria-expanded', o); };
    ud.querySelector('.menu').onclick = function (e) { if (e.target.closest('a,button')) closeMenu(); };
    document.getElementById('uso').onclick = function () { signOut(); go('#/'); };
    document.getElementById('usw').onclick = function () { signOut(); };
  }
  function header() {
    header0();
    if (window.PAGE) document.querySelectorAll('#hr a[href^="#/"]').forEach(function (a) { a.setAttribute('href', 'index.html' + a.getAttribute('href')); });
  }
  function closeMenu() {
    var ud = document.getElementById('ud'); if (!ud) return;
    ud.classList.remove('open'); document.getElementById('udb').setAttribute('aria-expanded', 'false');
  }
  document.addEventListener('click', function (e) { var ud = document.getElementById('ud'); if (ud && !ud.contains(e.target)) closeMenu(); });
  addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { var b = document.getElementById('udb'); if (b && document.getElementById('ud').classList.contains('open')) { closeMenu(); b.focus(); } }
  });

  /* chuyển trang; nếu đang ở đúng địa chỉ đó thì vẽ lại */
  function go(h) { if (window.PAGE) { location.href = 'index.html' + h; return; } if (location.hash === h) route(); else location.hash = h; }

  /* ---------- trang đăng nhập / đăng ký ---------- */
  var SOCIAL = [['Discord', '#5865f2'], ['GitHub', '#6e7681'], ['Microsoft', '#2f7de1'], ['Google', '#d9453a'], ['Steam', '#2a475e'], ['GitLab', '#e24329']];
  P.mail = '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>';
  P.key = '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>';
  P.pk = '<circle cx="10" cy="7" r="4"/><path d="M10.3 15H7a4 4 0 0 0-4 4v2"/><circle cx="18" cy="18" r="3"/><path d="m21 21-1.9-1.9"/>';

  /* ô nhập có biểu tượng bên trái; showLabel=false thì chỉ hiện placeholder (nhãn vẫn có cho trình đọc màn hình) */
  function field(id, label, type, ac, hint, icon, showLabel, max) {
    return '<label class="fi" for="' + id + '">' + (showLabel ? '<span>' + label + '</span>' : '') +
      '<div class="iw">' + ic(P[icon]) + '<input id="' + id + '" name="' + id + '" type="' + type + '" autocomplete="' + ac + '" aria-label="' + label + '"' +
      (showLabel ? '' : ' placeholder="' + label + '"') + (max ? ' maxlength="' + max + '"' : '') + ' required></div>' +
      (hint ? '<small>' + hint + '</small>' : '') + '</label>';
  }
  function authPage(mode) {
    var up = mode === 'up';
    var social = up ? '' :
      '<div class="sg2">' + SOCIAL.map(function (x) {
        return '<button type="button" class="sob" data-ext>' + '<span class="bd" style="background:' + x[1] + '" aria-hidden="true">' + x[0].charAt(0) + '</span>' + x[0] + '</button>';
      }).join('') + '<button type="button" class="sob full" data-ext>' + ic(P.pk) + 'Tiếp tục với passkey</button></div><hr class="dv">';
    app.innerHTML = '<div class="card auth"><h2 class="at">' + (up ? 'Tạo tài khoản Modium' : 'Đăng nhập vào Modium') + '</h2>' + social +
      '<form id="af" novalidate>' +
      (up
        ? field('f-d', 'Tên hiển thị', 'text', 'name', 'Tên này có thể trùng với người khác.', 'user', true, 40) +
          field('f-u', 'Tên @ (duy nhất)', 'text', 'username', 'Ví dụ: @minh_nguyen — chỉ gồm chữ, số, dấu _ và -.', 'user', true, 20) + field('f-e', 'Email', 'email', 'email', '', 'mail', true, 120) +
          field('f-p', 'Mật khẩu', 'password', 'new-password', 'Ít nhất 12 ký tự', 'key', true, 128) + field('f-c', 'Xác nhận mật khẩu', 'password', 'new-password', '', 'key', true, 128) +
          '<label class="cb"><input type="checkbox" id="f-n"><span>Giữ cho tôi cập nhật những điều thú vị Modium đang làm qua email</span></label>'
        : field('f-i', API.remote ? 'Email' : 'Email hoặc tên @', 'text', API.remote ? 'email' : 'username', '', 'mail', false, 120) + field('f-p', 'Mật khẩu', 'password', 'current-password', '', 'key', false, 128)) +
      '<div class="fe" id="fe" role="alert" aria-live="polite"></div>' +
      '<button class="btn p wide" id="fs" type="submit">' + (up ? 'Hoàn tất đăng ký' : 'Tiếp tục với Email') + ic(P.arr) + '</button></form>' +
      '<div class="al">' + (up ? 'Đã có tài khoản? <a href="#/signin">Đăng nhập</a>'
        : '<button type="button" class="lk" data-fp>Quên mật khẩu</button><i class="sep" aria-hidden="true"></i><a href="#/signup">Đăng ký</a>') + '</div></div>';
    var f = $('#af'), fe = $('#fe'), fs = $('#fs');
    (up ? $('#f-u') : $('#f-i')).focus();
    /* các cách đăng nhập cần máy chủ: báo rõ thay vì giả vờ hoạt động */
    app.querySelectorAll('[data-ext]').forEach(function (x) {
      x.onclick = function () { fe.textContent = L.t('Đăng nhập bằng dịch vụ bên ngoài cần máy chủ nên chưa khả dụng trong bản demo này.'); };
    });
    var fp = app.querySelector('[data-fp]');
    if (fp) fp.onclick = async function () {
      if (!API.remote) { fe.textContent = L.t('Khôi phục mật khẩu cần máy chủ gửi email nên chưa khả dụng trong bản demo này.'); return; }
      fp.disabled = true;
      try {
        var reset = await API.resetPassword($('#f-i').value);
        fe.textContent = L.t(reset.err || 'Nếu email tồn tại, liên kết đặt lại mật khẩu sẽ được gửi đến hộp thư.');
      } catch (x) { fe.textContent = L.t('Không thể gửi email khôi phục. Hãy thử lại.'); }
      finally { fp.disabled = false; }
    };
    f.onsubmit = async function (e) {
      e.preventDefault(); fe.textContent = ''; fs.disabled = true;
      var r;
      try {
        r = up ? await signUp({ displayName: $('#f-d').value, username: $('#f-u').value, email: $('#f-e').value, password: $('#f-p').value, confirm: $('#f-c').value, news: $('#f-n').checked })
               : await signIn($('#f-i').value, $('#f-p').value, ($('#f-t') || {}).value);
      } catch (x) { r = { err: 'Trình duyệt này không hỗ trợ mã hóa mật khẩu an toàn.' }; }
      fs.disabled = false;
      if (r.need2fa) {
        if (!$('#f-t')) fe.insertAdjacentHTML('beforebegin', field('f-t', 'Mã xác thực 2 bước', 'text', 'one-time-code', '', 'key', true));
        fe.textContent = L.t('Nhập mã từ ứng dụng xác thực, rồi đăng nhập lại.');
        $('#f-t').focus(); L.apply(app); return;
      }
      if (r.err) { fe.textContent = L.t(r.err); return; }
      if (r.confirmationRequired) { fe.className = 'fe ok'; fe.textContent = L.t('Kiểm tra email để xác nhận tài khoản trước khi đăng nhập.'); return; }
      var n = A.next || '#/'; A.next = null; go(n);
    };
  }

  function resetPasswordPage() {
    if (!API.remote) {
      app.innerHTML = '<div class="card auth"><h2>' + L.t('Đặt lại mật khẩu') + '</h2><p>' + L.t('Khôi phục mật khẩu cần máy chủ gửi email nên chưa khả dụng trong bản demo này.') + '</p><a class="btn p" href="#/signin">' + L.t('Đăng nhập') + '</a></div>';
      L.apply(app); return;
    }
    var canReset = API.isPasswordRecovery && API.isPasswordRecovery(), user = canReset && API.user();
    app.innerHTML = '<div class="card auth"><h2>' + L.t('Đặt lại mật khẩu') + '</h2><p>' + L.t(canReset ? 'Nhập mật khẩu mới để hoàn tất khôi phục.' : 'Liên kết khôi phục không hợp lệ hoặc đã hết hạn.') + '</p>' +
      (canReset ? '<form id="rf"><label class="fl2"><b>' + L.t('Mật khẩu mới (≥ 12 ký tự)') + '</b><input id="rn" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label><label class="fl2"><b>' + L.t('Xác nhận mật khẩu mới') + '</b><input id="rc" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></label>' + (user.totp ? '<label class="fl2"><b>' + L.t('Mã 2FA hiện tại') + '</b><input id="r2" type="text" autocomplete="one-time-code" inputmode="numeric" required></label>' : '') + '<div id="re" class="fe" role="alert"></div><button class="btn p" type="submit">' + L.t('Lưu mật khẩu mới') + '</button></form>' : '') +
      '<p><a href="#/signin">' + L.t('Đăng nhập') + '</a></p></div>';
    var form = $('#rf');
    if (form) form.onsubmit = async function (e) {
      e.preventDefault(); var button = form.querySelector('button'), error = $('#re'); button.disabled = true;
      try {
        var result = await API.updateRecoveredPassword($('#rn').value, $('#rc').value, $('#r2') ? $('#r2').value : '');
        if (result.err) error.textContent = L.t(result.err);
        else { app.innerHTML = '<div class="card auth"><h2>' + L.t('Mật khẩu đã được cập nhật.') + '</h2><a class="btn p" href="#/signin">' + L.t('Đăng nhập') + '</a></div>'; L.apply(app); }
      } catch (x) { error.textContent = L.t('Không thể cập nhật mật khẩu. Hãy thử lại.'); }
      finally { if (button.isConnected) button.disabled = false; }
    };
    L.apply(app);
  }

  /* ---------- hồ sơ & bảng điều khiển ---------- */
  function fmtDate(t) {
    var l = L.get() === 'vi' ? 'vi-VN' : L.get();
    try { return new Date(t).toLocaleDateString(l); } catch (e) { return new Date(t).toLocaleDateString(); }
  }
  function dash() {
    var u = user();
    app.innerHTML = '<div class="hi" style="margin-top:20px">Chào mừng trở lại, <b>' + esc(u.displayName || u.username) + '</b> <span class="handle">@' + esc(u.username) + '</span></div><h1 style="font-size:2.2rem;margin:6px 0 16px">Bảng điều khiển</h1>' +
      '<div class="qa"><div><b>0</b><small>Dự án</small></div><div><b>0</b><small>Lượt tải</small></div><div><b>0</b><small>Người theo dõi</small></div></div>' +
      '<div class="card" style="margin-bottom:60px"><h3>Bạn chưa có dự án nào</h3><p style="margin:0">Tính năng đăng dự án chưa khả dụng trong bản demo này.</p></div>';
  }

  window.A = { user: user, avatar: avatar, fmt: fmtDate, ic: ic, header: header, auth: authPage, resetPasswordPage: resetPasswordPage, dash: dash, esc: esc, next: null, go: go };
})();
;
/* Modium – FRONTEND: trang hồ sơ (#/user) và các tab tài khoản trong Cài đặt (#/settings/profile, #/settings/security).
   Chỉ vẽ giao diện; mọi xử lý dữ liệu gọi qua window.API (backend/api.js). */
(function () {
  var esc = A.esc, ic = A.ic;
  var D = {
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
    dl: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    cal: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    edit: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
    up: '<path d="m18 9-6-6-6 6"/><path d="M12 3v14"/><path d="M5 21h14"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'
  };
  var TABS = [['profile', 'Hồ sơ'], ['security', 'Tài khoản và bảo mật']];
  function hue(n) { var h = 0; for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360; return h; }
  function say(el, t, ok) { el.textContent = L.t(t); el.className = 'fm ' + (ok ? 'ok' : 'bad'); }
  function v(id) { return $('#' + id).value; }

  /* ---------- thanh bên + điều phối tab ---------- */
  function sideAcc(tab) {
    if (!API.user()) return '';
    return '<div class="lb">TÀI KHOẢN</div>' + TABS.map(function (x) { return '<button data-t="' + x[0] + '" class="' + (tab === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('');
  }
  function acc(tab) {
    var el = $('#acc'), u = API.user(); if (!u) return;
    tab === 'security' ? security(el, u, '') : profileTab(el, u);
  }

  /* ---------- tab Hồ sơ ---------- */
  function profileTab(el, u) {
    var av = u.avatar;
    el.innerHTML = '<h2>Ảnh đại diện</h2><div class="avr"><span id="avp">' + A.avatar(u, true) + '</span><div><button class="btn" id="up">' + ic(D.up) + 'Tải ảnh lên</button><button class="btn" id="rm">' + ic(D.trash) + 'Xóa ảnh</button>' +
      '<input type="file" id="fl" accept="image/png,image/jpeg,image/webp" hidden></div></div>' +
      '<label class="fl2"><b>Tên hiển thị</b><input id="pd" maxlength="40" autocomplete="name" value="' + esc(u.displayName || u.username) + '"><small>Có thể trùng với người khác và dùng để nhận diện bạn.</small></label>' +
      '<label class="fl2"><b>Tên @</b><input id="pu" maxlength="20" autocomplete="username" value="' + esc(u.username) + '" readonly><small>Tên @ duy nhất, không thể đổi để bảo vệ liên kết dự án.</small></label>' +
      '<label class="fl2"><b>Giới thiệu</b><textarea id="pb" maxlength="160" rows="3">' + esc(u.bio) + '</textarea><small id="pc">' + u.bio.length + '/160</small></label>' +
      '<div class="fm" id="pm" role="status"></div><button class="btn p" id="ps">Lưu thay đổi</button> <a class="btn" href="#/user">Xem hồ sơ</a>';
    function prev() { $('#avp').innerHTML = A.avatar({ username: v('pu') || u.username, displayName: v('pd') || u.displayName || u.username, avatar: av }, true); }
    $('#up').onclick = function () { $('#fl').click(); };
    $('#rm').onclick = function () { av = ''; prev(); };
    $('#pd').oninput = prev;
    $('#pb').oninput = function () { $('#pc').textContent = this.value.length + '/160'; };
    $('#fl').onchange = function () {
      var f = this.files[0]; if (!f) return;
      var im = new Image(), url = URL.createObjectURL(f);
      im.onload = function () {
        var c = document.createElement('canvas'), s = Math.min(im.width, im.height);
        c.width = c.height = 256; c.getContext('2d').drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, 256, 256);
        av = c.toDataURL('image/jpeg', .88); URL.revokeObjectURL(url); prev();
      };
      im.onerror = function () { say($('#pm'), 'Tệp không phải ảnh hợp lệ.'); };
      im.src = url;
    };
    $('#ps').onclick = async function () {
      var button = this; button.disabled = true;
      try {
        var r = await API.updateProfile({ username: v('pu'), displayName: v('pd'), bio: v('pb'), avatar: av });
        say($('#pm'), r.err || 'Đã lưu thay đổi.', !r.err); if (!r.err) A.header();
      } catch (e) { say($('#pm'), 'Không thể lưu thay đổi. Hãy thử lại.'); }
      finally { button.disabled = false; }
    };
  }

  /* ---------- tab Tài khoản và bảo mật ---------- */
  function sec(id, title, desc, label, body, danger) {
    return '<details class="sec' + (danger ? ' dg' : '') + '" id="' + id + '"><summary><div><b>' + title + '</b><small>' + desc + '</small></div><span class="btn">' + label + '</span></summary><div class="sb">' + body + '<div class="fm" role="status"></div></div></details>';
  }
  function inp(id, label, type, ac) { return '<label class="fl2"><b>' + label + '</b><input id="' + id + '" type="' + type + '" autocomplete="' + ac + '"></label>'; }
  function run(id, fn) { /* gắn hành động cho nút .act trong khối id */
    var box = $('#' + id), m = box.querySelector('.fm'), b = box.querySelector('.act');
    b.onclick = async function () {
      b.disabled = true; var r;
      try { r = await fn(); } catch (e) { r = { err: 'Có lỗi xảy ra, trình duyệt có thể không hỗ trợ mã hóa an toàn.' }; }
      b.disabled = false; say(m, r.err || 'Đã lưu.', !r.err);
    };
  }
  function security(el, u, note) {
    el.innerHTML = '<h2>Tài khoản và bảo mật</h2>' + (note ? '<div class="fm ok">' + L.t(note) + '</div>' : '') +
       sec('se', 'Email', 'Hiện tại: <b>' + esc(u.email) + '</b>', 'Đổi email', inp('e-n', 'Email mới', 'email', 'email') + inp('e-p', 'Mật khẩu hiện tại', 'password', 'current-password') + (u.totp ? inp('e-t', 'Mã 2FA hiện tại', 'text', 'one-time-code') : '') + '<button class="btn p act">Lưu email</button>') +
        sec('sp', 'Mật khẩu', 'Đổi mật khẩu đăng nhập của bạn.', 'Đổi mật khẩu', inp('m-o', 'Mật khẩu hiện tại', 'password', 'current-password') + inp('m-n', 'Mật khẩu mới (≥ 12 ký tự)', 'password', 'new-password') + inp('m-c', 'Xác nhận mật khẩu mới', 'password', 'new-password') + (u.totp ? inp('m-t', 'Mã 2FA hiện tại', 'text', 'one-time-code') : '') + '<button class="btn p act">Đổi mật khẩu</button>') +
      sec('s2', 'Xác thực hai bước (2FA)', u.totp ? '<span class="st2 on">Đang bật</span> Cần mã từ ứng dụng khi đăng nhập.' : '<span class="st2">Đang tắt</span> Thêm một lớp bảo vệ khi đăng nhập.', u.totp ? 'Tắt 2FA' : 'Thiết lập',
         u.totp ? inp('t-p', 'Mật khẩu hiện tại', 'password', 'current-password') + inp('t-off-code', 'Mã 2FA hiện tại', 'text', 'one-time-code') + '<button class="btn d act">Tắt 2FA</button>'
               : '<button class="btn" id="t-g">Tạo khóa bí mật</button><div id="t-b"></div>') +
      sec('sx', 'Xuất dữ liệu', 'Tải về bản sao dữ liệu tài khoản của bạn (JSON).', 'Xuất', '<button class="btn p" id="xp">' + ic(D.dl) + 'Tải xuống</button>') +
        sec('sd', 'Xóa tài khoản', 'Hành động này không thể hoàn tác.', 'Xóa', inp('d-c', 'Nhập tên @ "@' + esc(u.username) + '" để xác nhận', 'text', 'off') + inp('d-p', 'Mật khẩu hiện tại', 'password', 'current-password') + (u.totp ? inp('d-t', 'Mã 2FA hiện tại', 'text', 'one-time-code') : '') + '<button class="btn d act">' + ic(D.trash) + 'Xóa tài khoản vĩnh viễn</button>', true);
    var again = function (r, msg) { if (!r.err) security(el, API.user(), msg); return r; };
     run('se', async function () { return again(await API.changeEmail(v('e-p'), v('e-n'), u.totp ? v('e-t') : ''), 'Đã đổi email.'); });
     run('sp', async function () { return again(await API.changePassword(v('m-o'), v('m-n'), v('m-c'), u.totp ? v('m-t') : ''), 'Đã đổi mật khẩu.'); });
     if (u.totp) run('s2', async function () { return again(await API.totpDisable(v('t-p'), v('t-off-code')), 'Đã tắt xác thực hai bước.'); });
     else $('#t-g').onclick = async function () {
        var s;
        try { s = await API.totpBegin(); } catch (e) { s = { err: 'Không thể tạo khóa xác thực hai bước.' }; }
       if (s.err) { say($('#s2 .fm'), s.err); return; }
       $('#t-b').innerHTML = '<p>Nhập khóa này vào ứng dụng xác thực (Google Authenticator, Authy, 2FAS…):</p><code class="sk">' + s.secret + '</code>' +
        '<p><small>Trên điện thoại có thể mở liên kết: <a href="' + esc(s.uri) + '">otpauth</a></small></p>' + inp('t-c', 'Mã 6 số hiện trong ứng dụng', 'text', 'one-time-code') + '<button class="btn p act">Bật 2FA</button>';
      run('s2', async function () { return again(await API.totpEnable(v('t-c')), 'Đã bật xác thực hai bước.'); });
    };
    $('#xp').onclick = function () {
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([API.exportData()], { type: 'application/json' }));
      a.download = 'modium-' + u.username + '.json'; a.click();
    };
    run('sd', async function () {
      if (v('d-c').trim().replace(/^@+/, '').toLowerCase() !== u.username.toLowerCase()) return { err: 'Hãy nhập đúng tên @ để xác nhận.' };
       var r = await API.deleteAccount(v('d-p'), u.totp ? v('d-t') : ''); if (!r.err) A.go('#/'); return r;
    });
  }

  A.sideAcc = sideAcc; A.acc = acc;
})();
;
/* Modium – trang duyệt tài nguyên (#/mods, #/resourcepacks, #/datapacks, #/shaders, #/modpacks, #/plugins, #/servers).
   Có: thanh tab, bộ lọc bên trái, tìm kiếm, sắp xếp, số mục mỗi trang, đổi bố cục hàng/lưới, phân trang.
   Gói tài nguyên có giao diện riêng: thẻ có ảnh bìa, lọc theo độ phân giải, danh mục có nút loại trừ. */
(function () {
  var TYPES = [['mods', 'Mods'], ['resourcepacks', 'Gói tài nguyên'], ['datapacks', 'Gói dữ liệu'], ['shaders', 'Shader'], ['modpacks', 'Modpack'], ['plugins', 'Script'], ['structures', 'Công trình'], ['servers', 'Máy chủ']];
  /* Mỗi loại tài nguyên hiện những nhóm bộ lọc nào */
  var CFG = {
    mods: 'cat env lic dep excl', modpacks: 'cat env lic', plugins: 'cat lic',
    resourcepacks: 'cat res lic', datapacks: 'cat lic', shaders: 'cat lic', structures: 'cat lic', servers: 'cat'
  };
  var CATS = [['adventure', 'Phiêu lưu'], ['cursed', 'Bị nguyền'], ['decoration', 'Trang trí'], ['economy', 'Kinh tế'], ['equipment', 'Trang bị'], ['food', 'Thức ăn'],
    ['mechanics', 'Cơ chế game'], ['library', 'Thư viện'], ['magic', 'Phép thuật'], ['management', 'Quản lý'], ['minigame', 'Minigame'], ['mobs', 'Sinh vật'],
    ['optimization', 'Tối ưu hóa'], ['social', 'Xã hội'], ['storage', 'Kho chứa'], ['technology', 'Công nghệ'], ['transport', 'Vận chuyển'], ['utility', 'Tiện ích'], ['worldgen', 'Tạo thế giới']];
  /* Danh mục riêng của gói tài nguyên */
  var RP_CATS = [['audio', 'Âm thanh'], ['blocks', 'Khối'], ['combat', 'Chiến đấu'], ['cursed', 'Bị nguyền'], ['decoration', 'Trang trí'], ['entities', 'Sinh vật'],
    ['environment', 'Môi trường'], ['equipment', 'Trang bị'], ['fonts', 'Phông chữ'], ['gui', 'Giao diện (GUI)'], ['items', 'Vật phẩm'], ['locale', 'Bản địa hóa'], ['models', 'Mô hình']];
  var CATN = {}; CATS.concat(RP_CATS).forEach(function (c) { CATN[c[0]] = c[1]; });
  var RES = [['8x', '8x trở xuống'], ['16x', '16x'], ['32x', '32x'], ['48x', '48x'], ['64x', '64x'], ['128x', '128x'], ['256x', '256x'], ['512x', '512x trở lên']];
  var ENV = [['client', 'Phía máy khách'], ['server', 'Phía máy chủ']];
  var ENVTAG = { client: 'Phía máy khách', server: 'Phía máy chủ', both: 'Máy khách và máy chủ', either: 'Máy khách hoặc máy chủ' };
  var SORTS = [['rel', 'Mức liên quan'], ['dl', 'Lượt tải nhiều nhất'], ['fl', 'Được theo dõi nhiều nhất'], ['up', 'Cập nhật gần đây']];
  var PER = [10, 20, 50];
  var B = null, CACHE = {};
  var esc = function (s) { return A.esc(s); };

  var I = {
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    chev: '<path d="m18 15-6-6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', check: '<path d="M20 6 9 17l-5-5"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    dl: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    clock: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    mon: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
    srv: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
    rows: '<rect width="18" height="7" x="3" y="3" rx="1"/><rect width="18" height="7" x="3" y="14" rx="1"/>',
    grid: '<rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/>',
    prev: '<path d="m15 18-6-6 6-6"/>', next: '<path d="m9 18 6-6-6-6"/>'
  };
  function ic(d, c) { return '<svg' + (c ? ' class="' + c + '"' : '') + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; }

  /* ---------- dữ liệu ---------- */
  function safeUrl(u) { return typeof u === 'string' && (/^(https?:\/\/[^\s"'<>]+|[\w./-]+)$/.test(u) || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+\/=]+$/.test(u)) ? u : ''; }
  function items(t) {
    var src = ((window.DATA && DATA.items && DATA.items[t]) || []).concat(window.API ? API.projects(t) : []);
    if (CACHE[t] && CACHE[t].src === src && CACHE[t].len === src.length) return CACHE[t].list; /* dữ liệu đổi thì tính lại */
    var list = src.map(function (r, i) {
      var name = String(r.name || ''), h = 0; for (var k = 0; k < name.length; k++) h = (h * 31 + name.charCodeAt(k)) % 360;
      var w = name.split(/\s+/), d = typeof r.desc === 'string' ? { vi: r.desc, en: r.desc } : (r.desc || {});
      var t0 = Date.parse(r.updated);
       return { id: i, slug: r.slug || '', n: name, a: String(r.author || ''), ah: String(r.authorHandle || ''), d: [d.vi || d.en || '', d.en || d.vi || ''], dl: +r.downloads || 0, fl: +r.follows || 0,
        u: isNaN(t0) ? 9999 : Math.max(0, Math.floor((Date.now() - t0) / 864e5)), c: r.categories || [], e: r.env || 'either', lic: r.license || '',
        res: r.resolution || '', dep: r.dependencies || [], icon: safeUrl(r.icon), banner: safeUrl(r.banner), hue: h,
        ini: ((w[0] || '').charAt(0) + (w[1] ? w[1].charAt(0) : (w[0] || '').charAt(1))).toUpperCase() };
    });
    CACHE[t] = { src: src, len: src.length, list: list };
    return list;
  }
  function fresh(t) {
    var col = {};
    if (window.innerWidth < 860) CFG[t].split(' ').forEach(function (k) { col[k] = true; });
    return { t: t, q: '', ct: [], ex: [], rs: [], en: [], os: false, dep: '', sort: 'rel', per: 20, pg: 1, col: col };
  }
  function has(a, v) { return a.indexOf(v) > -1; }
  function tog(a, v) { var i = a.indexOf(v); if (i > -1) a.splice(i, 1); else a.push(v); }
  function drop(a, v) { var i = a.indexOf(v); if (i > -1) a.splice(i, 1); }

  function match(p) {
    if (B.ct.length && !B.ct.every(function (c) { return has(p.c, c); })) return false;
    if (B.ex.length && p.c.some(function (c) { return has(B.ex, c); })) return false;
    if (B.rs.length && !has(B.rs, p.res)) return false;
    if (B.en.length && !B.en.every(function (e) { return has([e, 'both', 'either'], p.e); })) return false;
    if (B.os && p.lic !== 'os') return false;
    if (B.dep) { var d = B.dep.toLowerCase(); if (!p.dep.some(function (n) { return String(n).toLowerCase().indexOf(d) > -1; })) return false; }
    return true;
  }
  function score(p, q) {
    var n = p.n.toLowerCase();
    if (n.indexOf(q) === 0) return 4; if (n.indexOf(q) > -1) return 3;
    if (p.a.toLowerCase().indexOf(q) > -1) return 2;
    if ((p.d[0] + ' ' + p.d[1]).toLowerCase().indexOf(q) > -1) return 1;
    return 0;
  }
  function query() {
    var q = B.q.trim().toLowerCase(), sc = {};
    var l = items(B.t).filter(match);
    if (q) l = l.filter(function (p) { return (sc[p.id] = score(p, q)) > 0; });
    l.sort(function (a, b) {
      if (B.sort === 'dl') return b.dl - a.dl;
      if (B.sort === 'fl') return b.fl - a.fl;
      if (B.sort === 'up') return a.u - b.u || b.dl - a.dl;
      return (q ? sc[b.id] - sc[a.id] : 0) || b.dl - a.dl;
    });
    return l;
  }

  /* ---------- định dạng ---------- */
  function num(n) { return n < 10000 ? n.toLocaleString('en-US') : n < 1e6 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M'; }
  function ago(d) {
    var vi = L.get() === 'vi', n;
    if (vi) {
      if (d < 1) return 'Hôm nay';
      if (d < 7) return d + ' ngày trước';
      if (d < 14) return 'Tuần trước';
      if (d < 30) return Math.floor(d / 7) + ' tuần trước';
      if (d < 60) return 'Tháng trước';
      if (d < 365) return Math.floor(d / 30) + ' tháng trước';
      return Math.floor(d / 365) + ' năm trước';
    }
    try {
      var relative = new Intl.RelativeTimeFormat(L.get(), { numeric: 'auto' });
      if (d < 1) return relative.format(0, 'day');
      if (d < 7) return relative.format(-d, 'day');
      if (d < 30) return relative.format(-Math.floor(d / 7), 'week');
      if (d < 365) return relative.format(-Math.floor(d / 30), 'month');
      return relative.format(-Math.floor(d / 365), 'year');
    } catch (e) {
      if (d < 1) return 'Today';
      if (d < 30) return d + (d === 1 ? ' day ago' : ' days ago');
      if (d < 365) return Math.floor(d / 30) + ' months ago';
      n = Math.floor(d / 365); return n + (n === 1 ? ' year ago' : ' years ago');
    }
  }
  function catList(t) { return t === 'resourcepacks' ? RP_CATS : CATS; }
  function layout() { return (S.lay && S.lay[B.t]) || (B.t === 'resourcepacks' ? 'grid' : 'rows'); }

  /* ---------- khung trang ---------- */
  function tabHref(t) { return t === 'resourcepacks' || t === 'modpacks' ? t + '.html' : (window.PAGE ? 'index.html' : '') + '#/' + t; }
  function page(t) {
    if (!B || B.t !== t) B = fresh(t);
    app.innerHTML =
      '<nav class="tabs" aria-label="Loại tài nguyên">' + TYPES.map(function (x) {
        return '<a href="' + tabHref(x[0]) + '"' + (x[0] === t ? ' class="on" aria-current="page"' : '') + '>' + x[1] + '</a>';
      }).join('') + '</nav>' +
      '<div class="bg2"><aside id="bside" aria-label="Bộ lọc"></aside><div class="bmain">' +
      '<div class="srbar">' + ic(I.search) + '<input id="bq" type="search" placeholder="Tìm kiếm dự án..." aria-label="Tìm kiếm dự án" value="' + esc(B.q) + '" autocomplete="off"></div>' +
      '<div id="bres"></div></div></div>';
    side(); res(); wire();
    L.apply(app);
  }

  /* ---------- thanh bên ---------- */
  function sec(key, title, inner) {
    var c = !!B.col[key];
    return '<section class="card fs"><button class="fh" data-c="' + key + '" aria-expanded="' + !c + '">' + title + ic(c ? I.down : I.chev) + '</button>' +
      (c ? '' : '<div class="fb">' + inner + '</div>') + '</section>';
  }
  function opt(k, v, label, on) {
    return '<button class="fo' + (on ? ' on' : '') + '" data-k="' + k + '" data-v="' + esc(v) + '" aria-pressed="' + on + '"><span class="bx">' + ic(I.check) + '</span><span>' + label + '</span></button>';
  }
  /* danh mục của gói tài nguyên: bấm để chọn (✓), nút ⊘ bên cạnh để loại trừ */
  function optEx(v, label) {
    var inc = has(B.ct, v), exc = has(B.ex, v);
    return '<div class="fx' + (inc ? ' inc' : '') + (exc ? ' exc' : '') + '"><button class="fo" data-k="ct" data-v="' + v + '" aria-pressed="' + inc + '"><span class="ci">' + label + '</span>' + (inc ? ic(I.check, 'ck') : '') + '</button>' +
      '<button class="xb" data-k="ex" data-v="' + v + '" aria-pressed="' + exc + '" data-lab="' + esc(label) + '">' + ic(I.ban) + '</button></div>';
  }
  function side() {
    var cf = CFG[B.t].split(' '), h = '', rp = B.t === 'resourcepacks';
    if (has(cf, 'cat')) h += sec('cat', 'Danh mục', catList(B.t).map(function (c) { return rp ? optEx(c[0], c[1]) : opt('ct', c[0], c[1], has(B.ct, c[0])); }).join(''));
    if (has(cf, 'res')) h += sec('res', 'Độ phân giải', RES.map(function (r) { return opt('rs', r[0], r[1], has(B.rs, r[0])); }).join(''));
    if (has(cf, 'env')) h += sec('env', 'Môi trường', ENV.map(function (e) { return opt('en', e[0], e[1], has(B.en, e[0])); }).join(''));
    if (has(cf, 'lic')) h += sec('lic', 'Giấy phép', opt('os', 'os', 'Mã nguồn mở', B.os));
    if (has(cf, 'dep')) h += sec('dep', 'Phụ thuộc vào', '<div class="iw">' + ic(I.search) + '<input id="dq" class="vs" placeholder="Tìm một dự án..." aria-label="Tìm dự án phụ thuộc" value="' + esc(B.dep) + '" autocomplete="off"></div>');
    if (has(cf, 'excl')) h += sec('excl', 'Loại trừ nâng cao', '<p class="mt">Ẩn các danh mục sau</p>' + CATS.map(function (c) { return opt('ex', c[0], c[1], has(B.ex, c[0])); }).join(''));
    var s = $('#bside'); s.innerHTML = h;
    L.apply(s);
    /* nhãn đọc màn hình cho nút loại trừ: "Loại trừ <tên danh mục>" (đã dịch) */
    Array.prototype.forEach.call(s.querySelectorAll('.xb'), function (b) { var l = L.t(b.dataset.lab); b.setAttribute('aria-label', L.t('Loại trừ') + ' ' + l); b.title = L.t('Loại trừ') + ' ' + l; });
  }

  /* ---------- thẻ dự án ---------- */
  function tagsOf(p) {
    var tags = '', show = p.c.slice(0, 3);
    if (B.t === 'mods' || B.t === 'modpacks') tags += '<span class="tag">' + ic(p.e === 'client' ? I.mon : p.e === 'server' ? I.srv : I.globe) + ENVTAG[p.e] + '</span>';
    if (p.res) tags += '<span class="tag">' + esc(p.res) + '</span>';
    show.forEach(function (c) { tags += '<span class="tag">' + (CATN[c] || esc(c)) + '</span>'; });
    var more = p.c.length - show.length;
    if (more > 0) tags += '<span class="tag">+' + more + '</span>';
    return tags;
  }
  function icon(p, cls) {
    return p.icon ? '<img class="pic ' + cls + '" src="' + esc(p.icon) + '" alt="" loading="lazy">'
      : '<div class="pic ' + cls + '" style="background:linear-gradient(135deg,hsl(' + p.hue + ' 68% 52%),hsl(' + ((p.hue + 40) % 360) + ' 66% 36%))" aria-hidden="true">' + esc(p.ini) + '</div>';
  }
  function author(p) { return esc(p.a) + (p.ah ? ' <span class="handle">@' + esc(p.ah) + '</span>' : ''); }
  function desc(p) { return esc(p.d[L.get() === 'vi' ? 0 : 1]); }
  function nm(p) { return p.slug ? '<a href="' + (window.PAGE ? 'index.html' : '') + '#/project/' + esc(p.slug) + '">' + esc(p.n) + '</a>' : esc(p.n); }
  function card(p) {
    return '<article class="pj">' + icon(p, '') +
      '<div class="pb"><h3>' + esc(p.n) + ' <span class="by"><span>bởi</span> ' + author(p) + '</span></h3><p class="pd2">' + desc(p) + '</p><div class="tgs">' + tagsOf(p) + '</div></div>' +
      '<div class="st"><span>' + ic(I.dl) + num(p.dl) + '</span><span>' + ic(I.heart) + num(p.fl) + '</span><span class="up">' + ic(I.clock) + ago(p.u) + '</span></div></article>';
  }
  /* thẻ có ảnh bìa (gói tài nguyên, dạng lưới) */
  function cardBanner(p) {
    return '<article class="pj bnr"><div class="bn">' + (p.banner ? '<img src="' + esc(p.banner) + '" alt="" loading="lazy">'
      : '<div class="bnf" style="background:linear-gradient(135deg,hsl(' + p.hue + ' 60% 46%),hsl(' + ((p.hue + 50) % 360) + ' 60% 28%))" aria-hidden="true">' + esc(p.ini) + '</div>') + '</div>' +
       '<div class="bb"><div class="bh">' + icon(p, 'sm') + '<div class="pb"><h3>' + esc(p.n) + ' <span class="by"><span>bởi</span> ' + author(p) + '</span></h3><p class="pd2">' + desc(p) + '</p></div></div>' +
      '<div class="tgs">' + tagsOf(p) + '</div>' +
      '<div class="st row"><span>' + ic(I.dl) + num(p.dl) + '</span><span>' + ic(I.heart) + num(p.fl) + '</span><span class="up">' + ic(I.clock) + ago(p.u) + '</span></div></div></article>';
  }

  function pager(pages) {
    if (pages < 2) return '';
    var set = {}, out = [], p = B.pg;
    [1, 2, p - 1, p, p + 1, pages].forEach(function (n) { if (n >= 1 && n <= pages) set[n] = 1; });
    var ns = Object.keys(set).map(Number).sort(function (a, b) { return a - b; }), last = 0;
    ns.forEach(function (n) {
      if (n - last > 1) out.push('<span class="dots" aria-hidden="true">…</span>');
      out.push('<button class="pgb' + (n === p ? ' on' : '') + '" data-p="' + n + '"' + (n === p ? ' aria-current="page"' : '') + ' aria-label="' + n + '">' + n + '</button>'); last = n;
    });
    return '<div class="pgn"><button class="pgb ar" data-p="' + (p - 1) + '"' + (p === 1 ? ' disabled' : '') + ' aria-label="Trang trước">' + ic(I.prev) + '</button>' + out.join('') +
      '<button class="pgb ar" data-p="' + (p + 1) + '"' + (p === pages ? ' disabled' : '') + ' aria-label="Trang sau">' + ic(I.next) + '</button></div>';
  }
  function res() {
    var l = query(), pages = Math.max(1, Math.ceil(l.length / B.per)); if (B.pg > pages) B.pg = pages;
    var lay = layout(), banner = B.t === 'resourcepacks' && lay === 'grid', slice = l.slice((B.pg - 1) * B.per, B.pg * B.per), pg = pager(pages);
    var bar = '<div class="tb"><label class="sel"><span>Sắp xếp theo:</span><select id="bs">' + SORTS.map(function (s) { return '<option value="' + s[0] + '"' + (B.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select>' + ic(I.down) + '</label>' +
      '<label class="sel"><span>Hiển thị:</span><select id="bp">' + PER.map(function (n) { return '<option' + (B.per === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select>' + ic(I.down) + '</label>' +
      '<button class="lay-b" id="bl" aria-label="Đổi bố cục">' + ic(lay === 'rows' ? I.rows : I.grid) + '</button>' + '<div class="tbr">' + pg + '</div></div>';
    var body;
    if (slice.length) body = '<div class="rl ' + lay + (banner ? ' bn-on' : '') + '">' + slice.map(banner ? cardBanner : card).join('') + '</div>';
    else if (!items(B.t).length) body = '<div class="card empty"><h3>Chưa có tài nguyên nào</h3><p>Hãy là người đầu tiên chia sẻ sáng tạo của bạn với cộng đồng.</p><a class="btn p" href="' + (window.PAGE ? 'index.html' : '') + '#/new">Đăng tài nguyên</a></div>';
    else body = '<div class="card empty"><h3>Không tìm thấy dự án phù hợp</h3><p>Hãy thử bỏ bớt bộ lọc.</p><button class="btn p" data-clear>Xóa bộ lọc</button></div>';
    $('#bres').innerHTML = bar + '<p class="cnt"><b>' + l.length + '</b> <span>kết quả</span></p>' + body + (slice.length ? '<div class="tb bt">' + pg + '</div>' : '');
    L.apply($('#bres'));
  }

  /* ---------- sự kiện ---------- */
  function wire() {
    $('#bq').oninput = function () { B.q = this.value; B.pg = 1; res(); };
    var s = $('#bside');
    s.onclick = function (e) {
      var c = e.target.closest('[data-c]');
      if (c) { B.col[c.dataset.c] = !B.col[c.dataset.c]; side(); return; }
      var o = e.target.closest('[data-k]'); if (!o) return;
      var k = o.dataset.k, v = o.dataset.v;
      if (k === 'ct') { tog(B.ct, v); drop(B.ex, v); }          /* chọn danh mục thì bỏ loại trừ */
      else if (k === 'ex') { tog(B.ex, v); drop(B.ct, v); }     /* loại trừ thì bỏ chọn */
      else if (k === 'rs') tog(B.rs, v); else if (k === 'en') tog(B.en, v);
      else if (k === 'os') B.os = !B.os;
      B.pg = 1; side(); res();
    };
    s.oninput = function (e) { if (e.target.id === 'dq') { B.dep = e.target.value; B.pg = 1; res(); } };
    var r = $('#bres');
    r.onclick = function (e) {
      var p = e.target.closest('[data-p]');
      if (p && !p.disabled) { B.pg = +p.dataset.p; res(); $('.tabs').scrollIntoView({ block: 'start' }); return; }
      if (e.target.closest('#bl')) { S.lay = S.lay || {}; S.lay[B.t] = layout() === 'rows' ? 'grid' : 'rows'; save(); res(); $('#bl').focus(); return; }
      if (e.target.closest('[data-clear]')) { var t = B.t; B = fresh(t); page(t); }
    };
    r.onchange = function (e) {
      if (e.target.id === 'bs') B.sort = e.target.value;
      else if (e.target.id === 'bp') B.per = +e.target.value;
      else return;
      B.pg = 1; res(); var el = $('#' + e.target.id); if (el) el.focus();
    };
  }

  var RX = /^#\/(mods|resourcepacks|datapacks|shaders|modpacks|plugins|structures|servers)$/;
  window.BR = { cats: catList, page: page, type: function (h) { var m = RX.exec(h); return m ? m[1] : null; } };
})();
;
/* Modium – FRONTEND: hồ sơ công khai, bảng điều khiển, hộp thoại "Tạo dự án" và trang dự án. Dữ liệu lấy qua window.API. */
(function () {
  var esc = A.esc, ic = A.ic;
  var TY = [['mods', 'Mod'], ['modpacks', 'Modpack'], ['resourcepacks', 'Gói tài nguyên'], ['plugins', 'Script'], ['shaders', 'Shader'], ['structures', 'Công trình']];
  var VS = [['public', 'Công khai', 'Ai cũng thấy và tìm được dự án.'], ['unlisted', 'Không công khai', 'Chỉ người có liên kết mới xem được.'], ['private', 'Riêng tư', 'Chỉ bạn và cộng tác viên xem được.']];
  var PRES = ['8x', '16x', '32x', '48x', '64x', '128x', '256x', '512x'];
  var TN = {}, VN = {}; TY.forEach(function (t) { TN[t[0]] = t[1]; }); VS.forEach(function (t) { VN[t[0]] = t[1]; });
  var I = {
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
    dl: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    cal: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    edit: '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4Z"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    clock: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>', plus: '<path d="M5 12h14M12 5v14"/>'
  };
  function hue(n) { var h = 0; for (var i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360; return h; }
  function num(n) { return n < 1e4 ? n.toLocaleString('en-US') : n < 1e6 ? (n / 1e3).toFixed(1) + 'K' : (n / 1e6).toFixed(1) + 'M'; }
  function ago(t) {
    var d = Math.floor((Date.now() - t) / 864e5);
    if (L.get() === 'vi') return d < 1 ? 'Hôm nay' : d < 30 ? d + ' ngày trước' : d < 365 ? Math.floor(d / 30) + ' tháng trước' : Math.floor(d / 365) + ' năm trước';
    try {
      var relative = new Intl.RelativeTimeFormat(L.get(), { numeric: 'auto' });
      return d < 1 ? relative.format(0, 'day') : d < 30 ? relative.format(-d, 'day') : d < 365 ? relative.format(-Math.floor(d / 30), 'month') : relative.format(-Math.floor(d / 365), 'year');
    } catch (e) { return d < 1 ? 'today' : d < 30 ? d + ' days ago' : d < 365 ? Math.floor(d / 30) + ' months ago' : Math.floor(d / 365) + ' years ago'; }
  }
  var CN = null;
  function cn(c) { if (!CN) { CN = {}; TY.forEach(function (t) { BR.cats(t[0]).forEach(function (x) { CN[x[0]] = x[1]; }); }); } return CN[c] || c; }
  function thumb(p, cls) {
    return p.icon ? '<img class="pic ' + cls + '" src="' + esc(p.icon) + '" alt="">' : '<div class="pic ' + cls + '" style="background:linear-gradient(135deg,hsl(' + hue(p.name) + ' 68% 52%),hsl(' + ((hue(p.name) + 40) % 360) + ' 66% 36%))" aria-hidden="true">' + esc(p.name.charAt(0).toUpperCase()) + '</div>';
  }
   function tags(p, all) { return '<span class="tag">' + TN[p.type] + '</span>' + (p.resolution ? '<span class="tag">' + esc(p.resolution) + '</span>' : '') + p.cats.slice(0, all ? 20 : 3).map(function (c) { return '<span class="tag">' + esc(cn(c)) + '</span>'; }).join(''); }
  function stat(i, t) { return '<span>' + ic(I[i]) + t + '</span>'; }
  function card(p) {
    return '<article class="pj">' + thumb(p, '') + '<div class="pb"><h3><a href="#/project/' + esc(p.slug) + '">' + esc(p.name) + '</a>' + (p.vis !== 'public' ? ' <span class="tag">' + VN[p.vis] + '</span>' : '') + '</h3><p class="pd2">' + esc(p.summary) + '</p><div class="tgs">' + tags(p) + '</div></div>' +
      '<div class="st">' + stat('dl', num(p.downloads)) + stat('heart', num(p.follows)) + '<span class="up">' + ic(I.clock) + ago(p.updated) + '</span></div></article>';
  }
  function empty(self) {
    return '<div class="emp"><svg viewBox="0 0 120 100" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M60 6v14M36 12l8 10M84 12l-8 10"/><path d="M20 58 36 28h48l16 30v26a6 6 0 0 1-6 6H26a6 6 0 0 1-6-6z"/><path d="M20 58h26c0 8 6 14 14 14s14-6 14-14h26"/></svg>' +
      '<h3>' + (self ? 'Bạn chưa có dự án nào!' : 'Người dùng này chưa có dự án nào!') + '</h3><p>' + (self ? 'Hãy chia sẻ mod, modpack hay gói tài nguyên đầu tiên của bạn.' : 'Chưa có gì để hiển thị ở đây.') + '</p>' + (self ? '<a class="btn p" href="#/new">Tạo dự án</a>' : '') + '</div>';
  }

  /* ---------- hồ sơ (gọn, theo mẫu) ---------- */
  async function profile(name) {
    var routeAtStart = location.hash, wanted = String(name || '').replace(/^@+/, ''), me = API.user(), self = !!me && (!wanted || wanted.toLowerCase() === me.username.toLowerCase()), u;
    try { u = self ? me : await API.profileOf(wanted); } catch (e) { u = null; }
    if (location.hash !== routeAtStart) return;
    if (!u) { app.innerHTML = '<div class="card empty"><h3>Không tìm thấy người dùng</h3><a class="btn p" href="#/">Về trang chủ</a></div>'; return; }
    var list;
    try { list = await API.userProjects(u.username); } catch (e) { list = []; }
    if (location.hash !== routeAtStart) return;
    var dls = list.reduce(function (a, p) { return a + p.downloads; }, 0), tab = 'all';
    app.innerHTML = '<header class="uh">' + A.avatar(u, true) + '<div class="uhi"><h1>' + esc(u.displayName || u.username) + '</h1><p class="handle">@' + esc(u.username) + '</p><p>' + (u.bio ? esc(u.bio) : 'Người dùng Modium.') + '</p>' +
      '<div class="pst"><span>' + ic(I.box) + list.length + ' dự án</span><i></i><span>' + ic(I.dl) + num(dls) + ' lượt tải</span><i></i><span>' + ic(I.cal) + 'Tham gia ' + esc(A.fmt(u.created)) + '</span></div></div>' +
      (self ? '<a class="btn" href="#/settings/profile">' + ic(I.edit) + 'Chỉnh sửa</a>' : '') + '</header><div id="pl"></div>';
    function draw() {
      var types = TY.filter(function (t) { return list.some(function (p) { return p.type === t[0]; }); }), el = $('#pl');
      if (!list.length) { el.innerHTML = empty(self); return; }
      el.innerHTML = '<nav class="ptabs">' + [['all', 'Tất cả']].concat(types).map(function (t) { return '<button data-t="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</nav>' +
        '<div class="rl rows">' + list.filter(function (p) { return tab === 'all' || p.type === tab; }).map(card).join('') + '</div>';
      el.querySelectorAll('[data-t]').forEach(function (b) { b.onclick = function () { tab = b.dataset.t; draw(); L.apply(el); }; });
    }
    draw(); L.apply(app);
  }

  async function dash() {
    var routeAtStart = location.hash, u = API.user(), l;
    if (!u) return;
    try { l = await API.userProjects(u.username); } catch (e) { l = []; }
    if (location.hash !== routeAtStart) return;
    app.innerHTML = '<div class="hi" style="margin-top:20px">Chào mừng trở lại, <b>' + esc(u.displayName || u.username) + '</b> <span class="handle">@' + esc(u.username) + '</span></div><h1 style="font-size:2.2rem;margin:6px 0 16px">Bảng điều khiển</h1>' +
      '<div class="qa"><div><b>' + l.length + '</b><small>Dự án</small></div><div><b>' + num(l.reduce(function (a, p) { return a + p.downloads; }, 0)) + '</b><small>Lượt tải</small></div><div><b>0</b><small>Người theo dõi</small></div></div>' +
      '<p><a class="btn p" href="#/new">' + ic(I.plus) + 'Tạo dự án</a></p>' + (l.length ? '<div class="rl rows" style="margin-bottom:60px">' + l.map(card).join('') + '</div>' : '');
    L.apply(app);
  }

  /* ---------- trang dự án ---------- */
  async function project(slug) {
    var p = null;
    try { p = await API.getProject(slug); } catch (e) {}
    if (location.hash.indexOf('#/project/') !== 0 || decodeURIComponent(location.hash.slice(10)) !== slug) return;
    if (!p) { app.innerHTML = '<div class="card empty"><h3>Không tìm thấy dự án</h3><p>Dự án không tồn tại hoặc đang ở chế độ riêng tư.</p><a class="btn p" href="#/">Về trang chủ</a></div>'; return; }
    var people = [[p.owner, 'Chủ sở hữu']].concat(p.collab.map(function (c) { return [c, 'Cộng tác viên']; })), TABS = [['d', 'Mô tả'], ['g', 'Thư viện'], ['c', 'Nhật ký thay đổi'], ['v', 'Phiên bản']];
    function box(t, b) { return '<section class="card sbx"><h3>' + t + '</h3>' + b + '</section>'; }
    app.innerHTML = '<header class="uh">' + thumb(p, 'xl') + '<div class="uhi"><h1>' + esc(p.name) + '</h1><p>' + esc(p.summary) + '</p><div class="pst">' + stat('dl', num(p.downloads) + ' lượt tải') + '<i></i>' + stat('heart', num(p.follows) + ' người theo dõi') + '<i></i><div class="tgs">' + tags(p) + '</div></div></div>' +
      '<button class="btn p" id="dlb">' + ic(I.dl) + 'Tải xuống</button></header><div class="fm bad" id="dm"></div>' +
      '<div class="pgrid"><div><nav class="ptabs" id="pt">' + TABS.map(function (t, i) { return '<button data-t="' + t[0] + '" class="' + (i ? '' : 'on') + '">' + t[1] + '</button>'; }).join('') + '</nav><div class="card" id="pbody"></div></div><aside>' +
      box('Thông tin', '<p class="kv"><span>Nền tảng</span>Mini World</p><p class="kv"><span>Loại</span>' + TN[p.type] + '</p><p class="kv"><span>Hiển thị</span>' + VN[p.vis] + '</p>') +
      (p.cats.length ? box('Thẻ', '<div class="tgs">' + tags(p, 1) + '</div>') : '') +
      box('Người sáng tạo', people.map(function (x) { return '<a class="cr" href="#/user/' + encodeURIComponent(x[0].username) + '">' + A.avatar(x[0]) + '<span><b>' + esc(x[0].displayName || x[0].username) + '</b><small>@' + esc(x[0].username) + ' · ' + x[1] + '</small></span></a>'; }).join('')) +
      box('Chi tiết', '<p class="kv">' + ic(I.cal) + 'Đăng ' + ago(p.created).toLowerCase() + '</p><p class="kv">' + ic(I.clock) + 'Cập nhật ' + ago(p.updated).toLowerCase() + '</p>') + '</aside></div>';
    function body(t) {
      $('#pbody').innerHTML = t === 'd' ? (p.banner ? '<img class="bnr2" src="' + esc(p.banner) + '" alt="">' : '') + '<p>' + esc(p.summary) + '</p>'
        : '<p style="margin:0">' + (t === 'v' ? 'Chưa có phiên bản nào được đăng.' : t === 'c' ? 'Chưa có thay đổi nào.' : 'Chưa có ảnh nào trong thư viện.') + '</p>';
    }
    body('d');
    L.apply(app);
    $('#pt').onclick = function (e) { var b = e.target.closest('[data-t]'); if (!b) return; this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); body(b.dataset.t); L.apply($('#pbody')); };
     $('#dlb').onclick = async function () {
       var btn = this, msg = $('#dm');
       if (btn.disabled) return;
       btn.disabled = true; msg.className = 'fm'; msg.textContent = L.t('Đang chuẩn bị tải xuống…');
       try {
         var file = await API.downloadProject(slug);
         if (file.err) { msg.className = 'fm bad'; msg.textContent = L.t(file.err); return; }
         if (file.mode === 'url') { window.location.assign(file.url); return; }
         var objectUrl = URL.createObjectURL(file.blob), a = document.createElement('a');
         a.href = objectUrl; a.download = file.fileName; a.rel = 'noopener'; a.style.display = 'none';
         document.body.appendChild(a); a.click(); a.remove();
         window.setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 60000);
         msg.className = 'fm ok'; msg.textContent = L.t('Đã bắt đầu tải xuống.');
       } catch (e) { msg.className = 'fm bad'; msg.textContent = L.t('Không thể tải tệp. Hãy thử lại.'); }
       finally { btn.disabled = false; }
     };
  }

  /* ---------- ảnh: cắt vuông/tỉ lệ rồi nén ---------- */
  function pickImg(file, w, h, cb) {
    var im = new Image(), url = URL.createObjectURL(file);
    im.onload = function () {
      var c = document.createElement('canvas'), r = Math.min(im.width / w, im.height / h), sw = w * r, sh = h * r;
      c.width = w; c.height = h; c.getContext('2d').drawImage(im, (im.width - sw) / 2, (im.height - sh) / 2, sw, sh, 0, 0, w, h);
      URL.revokeObjectURL(url); cb(c.toDataURL('image/jpeg', .85));
    };
    im.onerror = function () { cb(''); };
    im.src = url;
  }
  function slugify(s) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }

  /* ---------- hộp thoại "Tạo dự án" ---------- */
  function newProject() {
    var me = API.user(), st = { vis: 'public', type: '', cats: [], collab: [], icon: '', banner: '', resolution: '', downloadMode: 'upload', file: null, url: '' }, edited = false;
    function fld(l, b) { return '<div class="fl2"><b>' + l + '</b>' + b + '</div>'; }
    function seg(id, arr) { return '<div class="seg" id="' + id + '" role="group">' + arr.map(function (x) { return '<button type="button" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>'; }
    var m = document.createElement('div'); m.id = 'mo'; m.className = 'mo'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Tạo dự án');
    m.innerHTML = '<div class="md"><div class="mh"><h2>Tạo dự án</h2><button class="x" id="mx" aria-label="Đóng">' + ic(I.x) + '</button></div><div class="mb">' +
      fld('Chế độ hiển thị', seg('mv', VS) + '<small id="mvh"></small>') +
      fld('Tên dự án', '<input id="mn" maxlength="40" placeholder="Nhập tên dự án..." autocomplete="off">') +
      fld('URL', '<div class="urlw"><span>modium/project/</span><input id="ms" maxlength="40" autocomplete="off"></div>') +
      fld('Loại dự án', seg('mt', TY)) +
      fld('Chủ sở hữu', '<input value="@' + esc(me.username) + '" disabled><small>Bạn là chủ sở hữu của dự án này.</small>') +
      fld('Cộng tác viên (không bắt buộc)', '<div class="chips" id="mc"></div><input id="mq" placeholder="Gõ @tên người dùng để tìm..." autocomplete="off"><div class="sug" id="msg"></div>') +
      fld('Tệp tải xuống', seg('mdo', [['upload', 'Tải tệp lên'], ['url', 'Dùng URL']]) + '<div id="mdpanel"></div><small>' + (API.remote ? 'Tệp tải lên tối đa 25 MB và được lưu trong kho riêng của Modium.' : 'File tải lên tối đa 25 MB. Bản demo lưu tệp trên thiết bị hiện tại; để mọi người tải được, cần máy chủ/object storage.') + '</small>') +
      '<div id="mcat"></div><div id="mimg"></div>' +
      fld('Mô tả ngắn', '<textarea id="mm" maxlength="200" rows="3" placeholder="Dự án này thêm..."></textarea><small>Một hai câu mô tả dự án của bạn.</small>') +
      '</div><div class="mf"><div class="fm" id="me" role="alert"></div><button class="btn" id="mcx" type="button">Hủy</button><button class="btn p" id="mok" type="button">Tạo dự án</button></div></div>';
    document.body.appendChild(m);
    L.apply(m);
    var g = function (s) { return m.querySelector(s); };
    function close(to) { m.remove(); if (to) location.hash = to; }
    function mark(id, v) { g('#' + id).querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); b.setAttribute('aria-pressed', b.dataset.v === v); }); }
    function chips() {
      g('#mc').innerHTML = st.collab.map(function (c) { return '<span class="chp">@' + esc(c) + '<button type="button" data-r="' + esc(c) + '" aria-label="Xóa ' + esc(c) + '">' + ic(I.x) + '</button></span>'; }).join('');
    }
    function extras() {
      var cats = st.type ? BR.cats(st.type) : [], ban = st.type === 'modpacks' || st.type === 'resourcepacks';
      var catField = st.type ? fld('Chủ đề (chọn nhiều)', '<div class="seg" id="mk">' + cats.map(function (c) { return '<button type="button" data-v="' + c[0] + '" class="' + (st.cats.indexOf(c[0]) > -1 ? 'on' : '') + '">' + c[1] + '</button>'; }).join('') + '</div>') : '';
      var resField = st.type === 'resourcepacks' ? fld('Độ phân giải gói tài nguyên', '<select id="mres" required aria-label="Độ phân giải gói tài nguyên"><option value="">Chọn độ phân giải...</option>' + PRES.map(function (r) { return '<option value="' + r + '">' + r + '</option>'; }).join('') + '</select><small>Chọn độ phân giải của texture trong pack.</small>') : '';
      g('#mcat').innerHTML = catField + resField;
      if (st.type === 'resourcepacks') g('#mres').value = st.resolution;
        g('#mimg').innerHTML = '<div class="imgs"><div><b>Ảnh đại diện</b><div class="ip sq">' + (st.icon ? '<img src="' + esc(st.icon) + '" alt="">' : ic(I.box)) + '</div><button class="btn" type="button" data-f="icon">Chọn ảnh</button></div>' +
           (ban ? '<div><b>Ảnh bìa (thumbnail)</b><div class="ip wd">' + (st.banner ? '<img src="' + esc(st.banner) + '" alt="">' : ic(I.box)) + '</div><button class="btn" type="button" data-f="banner">Chọn ảnh</button></div>' : '') + '<input type="file" id="mf" accept="image/png,image/jpeg,image/webp" hidden></div>';
      L.apply(g('#mcat')); L.apply(g('#mimg'));
    }
    function fileSize(n) { return n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / (1024 * 1024)).toFixed(1) + ' MB'; }
    function renderDownload() {
      mark('mdo', st.downloadMode);
      if (st.downloadMode === 'url') {
        g('#mdpanel').innerHTML = '<input id="mdurl" type="url" maxlength="2048" placeholder="https://example.com/file.zip" autocomplete="url"><small>Chỉ chấp nhận liên kết HTTP/HTTPS. Khi bấm Tải xuống, trình duyệt sẽ mở liên kết này.</small>';
        g('#mdurl').value = st.url; g('#mdurl').oninput = function () { st.url = this.value; }; L.apply(g('#mdpanel'));
        return;
      }
      g('#mdpanel').innerHTML = '<div class="dropbox" id="mdrop"><b>Kéo thả tệp vào đây</b><span>ZIP, TXT, LUA hoặc định dạng tài nguyên khác</span><span id="mfn"></span></div><div class="drop-actions"><button class="btn" id="mchoose" type="button">Chọn tệp</button><button class="btn" id="mremove" type="button"' + (st.file ? '' : ' disabled') + '>Bỏ tệp</button><input type="file" id="mfile" hidden></div>';
      var drop = g('#mdrop'), input = g('#mfile');
      g('#mfn').textContent = st.file ? st.file.name + ' · ' + fileSize(st.file.size) : 'Chưa chọn tệp';
      g('#mchoose').onclick = function () { input.click(); };
      g('#mremove').onclick = function () { st.file = null; renderDownload(); };
      function choose(file) {
        if (!file) return;
        if (file.size < 1 || file.size > 25 * 1024 * 1024) { st.file = null; g('#mfn').textContent = L.t('Tệp phải từ 1 byte đến 25 MB.'); g('#mremove').disabled = true; g('#me').textContent = L.t('Tệp vượt quá giới hạn dung lượng.'); return; }
        st.file = file; g('#mfn').textContent = file.name + ' · ' + fileSize(file.size); g('#mremove').disabled = false; g('#me').textContent = '';
      }
      input.onchange = function () { choose(this.files && this.files[0]); this.value = ''; };
      drop.ondragover = function (e) { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = function () { drop.classList.remove('over'); };
      drop.ondrop = function (e) { e.preventDefault(); drop.classList.remove('over'); choose(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); };
      L.apply(g('#mdpanel'));
    }
    var fk = '';
     g('#mv').onclick = function (e) { var b = e.target.closest('[data-v]'); if (b) { st.vis = b.dataset.v; mark('mv', st.vis); g('#mvh').textContent = L.t(VS.filter(function (x) { return x[0] === st.vis; })[0][2]); } };
    g('#mdo').onclick = function (e) { var b = e.target.closest('[data-v]'); if (b) { if (g('#mdurl')) st.url = g('#mdurl').value; st.downloadMode = b.dataset.v; renderDownload(); } };
     g('#mt').onclick = function (e) { var b = e.target.closest('[data-v]'); if (b) { st.type = b.dataset.v; st.cats = []; if (st.type !== 'modpacks' && st.type !== 'resourcepacks') st.banner = ''; if (st.type !== 'resourcepacks') st.resolution = ''; mark('mt', st.type); extras(); } };
     g('#mcat').onclick = function (e) { var b = e.target.closest('[data-v]'); if (!b) return; var i = st.cats.indexOf(b.dataset.v); if (i > -1) st.cats.splice(i, 1); else st.cats.push(b.dataset.v); b.classList.toggle('on'); };
     g('#mcat').onchange = function (e) { if (e.target.id === 'mres') st.resolution = e.target.value; };
    g('#mimg').onclick = function (e) { var b = e.target.closest('[data-f]'); if (b) { fk = b.dataset.f; g('#mf').click(); } };
    g('#mimg').onchange = function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      pickImg(f, fk === 'icon' ? 256 : 960, fk === 'icon' ? 256 : 320, function (d) { if (!d) { g('#me').textContent = 'Tệp không phải ảnh hợp lệ.'; return; } st[fk] = d; extras(); });
    };
    g('#mn').oninput = function () { if (!edited) g('#ms').value = slugify(this.value); };
    g('#ms').oninput = function () { edited = true; };
     var searchSeq = 0;
     g('#mq').oninput = async function () {
       var input = this, seq = ++searchSeq, r;
       try { r = await API.searchUsers(input.value); } catch (e) { r = []; }
       if (seq !== searchSeq || !input.isConnected) return;
       g('#msg').innerHTML = r.filter(function (x) { return st.collab.indexOf(x.username) < 0; }).map(function (x) { return '<button type="button" data-u="' + esc(x.username) + '">' + A.avatar(x) + '<span><b>' + esc(x.displayName || x.username) + '</b><small>@' + esc(x.username) + '</small></span></button>'; }).join('') || (this.value.replace('@', '') ? '<small>Không tìm thấy người dùng.</small>' : '');
       L.apply(g('#msg'));
     };
    g('#msg').onclick = function (e) { var b = e.target.closest('[data-u]'); if (b && st.collab.length < 10) { st.collab.push(b.dataset.u); chips(); this.innerHTML = ''; g('#mq').value = ''; } };
    g('#mc').onclick = function (e) { var b = e.target.closest('[data-r]'); if (b) { st.collab.splice(st.collab.indexOf(b.dataset.r), 1); chips(); } };
    g('#mx').onclick = g('#mcx').onclick = function () { close('#/dashboard'); };
    m.onclick = function (e) { if (e.target === m) close('#/dashboard'); };
    m.onkeydown = function (e) { if (e.key === 'Escape') close('#/dashboard'); };
    g('#mok').onclick = async function () {
      var submit = this;
      if (submit.disabled) return;
        submit.disabled = true; submit.textContent = L.t('Đang tạo…');
      try {
        var r = await API.createProject({ vis: st.vis, name: g('#mn').value, slug: g('#ms').value, type: st.type, resolution: st.resolution, cats: st.cats, collab: st.collab, icon: st.icon, banner: st.banner, summary: g('#mm').value,
          downloadMode: st.downloadMode, file: st.file, url: g('#mdurl') ? g('#mdurl').value : st.url });
        if (r.err) { g('#me').textContent = L.t(r.err); return; }
        close('#/project/' + r.slug);
      } catch (e) { g('#me').textContent = L.t('Không thể tạo dự án. Hãy thử lại.'); }
      finally { if (submit.isConnected) { submit.disabled = false; submit.textContent = L.t('Tạo dự án'); } }
    };
    mark('mv', 'public'); g('#mvh').textContent = L.t(VS[0][2]); extras(); renderDownload(); g('#mn').focus();
  }

  A.profile = profile; A.dash = dash; A.project = project; A.newProject = newProject;
})();
;
var $=function(s){return document.querySelector(s)},app=$('#app'),S={theme:'system',sync:false,lang:'vi',lay:{mods:'rows',plugins:'rows',datapacks:'rows',shaders:'rows',resourcepacks:'grid',modpacks:'rows'}},timer,P=null;window.PAGE=document.body.getAttribute('data-page')||window.PAGE;
try{var z=JSON.parse(localStorage.getItem('mdm'));if(z)S=Object.assign(S,z)}catch(e){}

function R(c){return c.map(function(x,i,a){var h=20/a.length;return'<rect y="'+i*h+'" width="30" height="'+h+'" fill="'+x+'"/>'}).join('')}
function V(c){return c.map(function(x,i){return'<rect x="'+i*10+'" width="10" height="20" fill="'+x+'"/>'}).join('')}
function F(c){var b='';
if(c==='vi')b='<rect width="30" height="20" fill="#da251d"/><path fill="#ff0" d="M15 4.5l1.76 5.4h5.68l-4.6 3.34 1.76 5.4L15 15.3l-4.6 3.34 1.76-5.4-4.6-3.34h5.68z"/>';
else if(c==='en'){b='<rect width="30" height="20" fill="#fff"/>';for(var i=0;i<13;i+=2)b+='<rect y="'+i*1.538+'" width="30" height="1.538" fill="#b22234"/>';b+='<rect width="12" height="10.77" fill="#3c3b6e"/>';for(var y=0;y<3;y++)for(var x=0;x<4;x++)b+='<circle cx="'+(1.8+x*2.8)+'" cy="'+(1.9+y*3.4)+'" r=".6" fill="#fff"/>'}
else if(c==='de-CH'||c==='ch')b='<rect width="30" height="20" fill="#d52b1e"/><path fill="#fff" d="M12.5 4h5v4h4v4h-4v4h-5v-4h-4V8h4z"/>';
else if(c==='de')b=R(['#000','#d00','#ffce00']);
else if(c==='es-419')b=V(['#006847','#fff','#ce1126'])+'<circle cx="15" cy="10" r="2.6" fill="#8a5a2b"/>';
else if(c==='es')b=R(['#c60b1e'])+'<rect y="5" width="30" height="10" fill="#ffc400"/>';
else if(c==='fr')b=V(['#0055a4','#fff','#ef4135']);
else if(c==='hu')b=R(['#cd2a3e','#fff','#436f4d']);
else if(c==='it')b=V(['#009246','#fff','#ce2b37']);
else if(c==='nl')b=R(['#ae1c28','#fff','#21468b']);
else if(c==='pl')b=R(['#fff','#dc143c']);
else if(c==='zh-CN')b='<rect width="30" height="20" fill="#de2910"/><path fill="#ffde00" d="m8 3 1.2 3.6H13L10 8.8l1.1 3.7L8 10.2l-3.1 2.3L6 8.8 3 6.6h3.8z"/>';
else if(c==='ja')b='<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="5" fill="#bc002d"/>';
return'<svg class="fl" viewBox="0 0 30 20" aria-hidden="true">'+b+'</svg>'}
function cur(){return P||S.lang}
function bar(){var e=$('#ub'),d=P&&P!==S.lang&&location.hash==='#/settings/language';
if(!d){if(e)e.remove();return}
if(!e){e=document.createElement('div');e.id='ub';e.setAttribute('role','alertdialog');e.setAttribute('aria-live','polite');
e.innerHTML='<span class="um">Bạn có những thay đổi chưa được lưu</span><button class="ur" id="urs"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>Đặt lại</button><button class="us btn p" id="usv"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>Lưu</button>';
document.body.appendChild(e);
$('#urs').onclick=function(){P=null;settings('language')};
$('#usv').onclick=function(){S.lang=P;P=null;save();L.set(S.lang);settings('language')}}
L.apply(e)}
function save(){try{localStorage.setItem('mdm',JSON.stringify(S))}catch(e){}}
function theme(){var t=S.theme==='system'?(matchMedia('(prefers-color-scheme:light)').matches?'light':'dark'):S.theme;document.documentElement.dataset.theme=t}
var TH=[['system','Đồng bộ với hệ thống','#16181c','#27292e','#42444a','#9aa'],['light','Sáng','#ebebeb','#fff','#ddd','#222'],['dark','Tối','#0d1419','#1a2630','#33485a','#9fb2c0'],['oled','OLED','#000','#101013','#25262b','#9fb2c0']];
var PR=[['Mods','mods'],['Plugin','plugins'],['Gói dữ liệu','datapacks'],['Shader','shaders'],['Gói tài nguyên','resourcepacks'],['Modpack','modpacks']];
var LG=[['vi','','Ti\u1ebfng Vi\u1ec7t','Vietnamese','100'],['en','','English (United States)','','100'],['es-419','','Espa\u00f1ol (Latinoam\u00e9rica)','Spanish (Latin America)','100'],['zh-CN','','\u7b80\u4f53\u4e2d\u6587','Simplified Chinese','100'],['ja','','\u65e5\u672c\u8a9e','Japanese','100']];
var PJ=[['Lumen Lights','Ánh sáng 3D cho các khối phát sáng','#2fc6df'],['Cubic Storage','Hệ thống kho đồ theo tủ hồ sơ','#7a63d6'],['Deepwood','Rừng sâu với sinh vật mới','#3f9a5c'],['Skyline Shader','Shader bầu trời chân thực','#d6803f']];
 function home(){var l=S.lay.mods,u=A.user();app.innerHTML='<section class="hero">'+(u?'<div class="hi">Chào mừng trở lại, <b>'+A.esc(u.displayName||u.username)+'</b> <span class="handle">@'+A.esc(u.username)+'</span></div>':'')+'<img alt="Logo Modium" src="'+$('.brand img').src+'"><h1>Nơi dành cho<span class="rot"><ul id="w"><li>mod</li><li>gói tài nguyên</li><li>gói dữ liệu</li><li>shader</li><li>modpack</li><li>plugin</li><li>máy chủ</li></ul></span>MiniWorld</h1><p>Khám phá, chơi và chia sẻ nội dung MiniWorld trên nền tảng được xây dựng cho cộng đồng.</p><div class="cta"><a class="btn p" href="#/mods">Khám phá các tài nguyên</a>'+(u?'<a class="btn" href="#/dashboard">Đến bảng điều khiển</a>':'<a class="btn" href="#/signup">Đăng ký</a>')+'</div></section>'+(u?'<h2>Truy cập nhanh</h2><div class="qa"><a href="#/user"><b>Hồ sơ</b><small>Xem thông tin tài khoản của bạn</small></a><a href="#/dashboard"><b>Bảng điều khiển</b><small>Theo dõi hoạt động của bạn</small></a><a href="#/settings"><b>Cài đặt</b><small>Tùy chỉnh giao diện và ngôn ngữ</small></a></div>':'')+'<h2>Dự án nổi bật</h2><div class="plist '+(l==='grid'?'grid':'')+'">'+PJ.map(function(p){return'<div class="pc"><div class="pi" style="background:'+p[2]+'">'+p[0][0]+'</div><div><b>'+p[0]+'</b><small>'+p[1]+'</small></div></div>'}).join('')+'</div>';
var u=$('#w'),n=6,i=0;clearInterval(timer);L.apply(app);if(!matchMedia('(prefers-reduced-motion:reduce)').matches)timer=setInterval(function(){if(!u.isConnected)return clearInterval(timer);i++;u.style.transition='transform .6s cubic-bezier(.7,0,.2,1)';u.style.transform='translateY(-'+i*u.children[0].offsetHeight+'px)';if(i===n)setTimeout(function(){u.style.transition='none';u.style.transform='none';i=0},650)},2200)}
function settings(tab){clearInterval(timer);var b;
var isAcc=['profile','security'].indexOf(tab)>-1&&A.user();
if(isAcc){b='<div id="acc"></div>'}else if(tab==='language'){b='<h2>Ngôn ngữ</h2><div class="warn">Đổi ngôn ngữ có thể khiến một số nội dung hiển thị bằng tiếng Anh nếu chưa có bản dịch.</div><p>Chọn ngôn ngữ ưa thích cho trang web.</p><input class="srch" id="q" type="search" placeholder="Tìm ngôn ngữ..." aria-label="Tìm ngôn ngữ"><h3>Ngôn ngữ tiêu chuẩn</h3><div id="ll"></div>';}
else{b='<h2>Giao diện</h2><p>Chọn chủ đề màu ưa thích của bạn.</p><div class="themes" role="radiogroup">'+TH.map(function(t){return'<button class="opt'+(S.theme===t[0]?' on':'')+'" role="radio" aria-checked="'+(S.theme===t[0])+'" data-th="'+t[0]+'"><div class="pv" style="background:'+t[2]+';--c2:'+t[3]+';--c3:'+t[4]+';--c4:'+t[5]+'"><i></i></div><div class="ol"><span class="rd"></span>'+t[1]+'</div></button>'}).join('')+'</div><div class="row"><div><h3>Đồng bộ chủ đề trên các thiết bị</h3><p style="margin:0">Dùng chủ đề này ở mọi nơi bạn đăng nhập. Tắt để giữ chủ đề riêng trên thiết bị này.</p></div><button class="tg" role="switch" aria-checked="'+S.sync+'" aria-label="Đồng bộ chủ đề" id="sy"></button></div><div class="row"><div><h2 style="font-size:1.3rem">Bố cục danh sách dự án</h2><p style="margin:0">Chọn bố cục cho từng trang hiển thị danh sách dự án.</p></div></div>'+PR.map(function(p){return'<h3>Trang '+p[0]+'</h3><div class="lay">'+['rows','grid'].map(function(k){return'<button class="opt'+(S.lay[p[1]]===k?' on':'')+'" role="radio" aria-checked="'+(S.lay[p[1]]===k)+'" data-pg="'+p[1]+'" data-k="'+k+'"><div class="pv">'+(k==='rows'?'<div class="rows"><i></i><i></i><i></i><i></i></div>':'<div class="gr"><i></i><i></i><i></i><i></i></div>')+'</div><div class="ol"><span class="rd"></span>'+(k==='rows'?'Hàng':'Lưới')+'</div></button>'}).join('')+'</div>'}).join('')}
app.innerHTML='<h1 style="font-size:2.2rem;margin:20px 0">Cài đặt</h1><div class="sg"><div class="card side"><div class="lb">HIỂN THỊ</div><button data-t="" class="'+(!isAcc&&tab!=='language'?'on':'')+'">Giao diện</button><button data-t="language" class="'+(tab==='language'?'on':'')+'">Ngôn ngữ</button>'+A.sideAcc(tab)+'</div><div class="card">'+b+'</div></div>';
app.querySelectorAll('.side button').forEach(function(x){x.onclick=function(){location.hash='#/settings'+(x.dataset.t?'/'+x.dataset.t:'')}});
if(tab==='language'){var q=$('#q');function r(){var v=q.value.toLowerCase();$('#ll').innerHTML=LG.filter(function(g){return(g[2]+g[3]).toLowerCase().indexOf(v)>-1}).map(function(g){return'<button class="lg'+(cur()===g[0]?' on':'')+'" data-l="'+g[0]+'">'+F(g[0])+''+g[2]+' <small>'+g[3]+'</small><em>'+g[4]+'%</em><span class="ck">'+(cur()===g[0]?'✓':'')+'</span></button>'}).join('');$('#ll').querySelectorAll('.lg').forEach(function(x){x.onclick=function(){P=x.dataset.l;r();bar()}})}q.oninput=r;r()}
else if(!isAcc){app.querySelectorAll('[data-th]').forEach(function(x){x.onclick=function(){S.theme=x.dataset.th;save();theme();settings()}});app.querySelectorAll('[data-pg]').forEach(function(x){x.onclick=function(){S.lay[x.dataset.pg]=x.dataset.k;save();settings()}});$('#sy').onclick=function(){S.sync=!S.sync;save();settings()}}
if(isAcc)A.acc(tab);bar();L.apply(app)}
function route(){var h=location.hash,u,mo=$('#mo');if(mo)mo.remove();P=null;clearInterval(timer);theme();A.header();u=A.user();
 if(h==='#/reset-password'||new URLSearchParams(location.search).get('flow')==='reset-password'){A.resetPasswordPage();return}
 if(window.PAGE){if(h.indexOf('#/project/')===0){$('#ddb').classList.add('on');A.project(decodeURIComponent(h.slice(10))).then(function(){L.apply(document.body)});return}if(h.indexOf('#/user/')===0){$('#ddb').classList.add('on');A.profile(decodeURIComponent(h.slice(7)));L.apply(document.body);return}BR.page(window.PAGE);$('#ddb').classList.add('on');L.apply(document.body);return}
if(h==='#/resourcepacks'||h==='#/modpacks'){location.replace(h.slice(2)+'.html');return}
  if(h==='#/signin'||h==='#/signup'){if(u){location.replace('#/');return}A.auth(h==='#/signup'?'up':'in')}
else if(h==='#/dashboard'||h==='#/user'){if(!u){A.next=h;location.replace('#/signin');return}h==='#/user'?A.profile():A.dash()}
else if(h==='#/new'){if(!u){A.next=h;location.replace('#/signin');return}A.dash();A.newProject()}
else if(h.indexOf('#/project/')===0)A.project(decodeURIComponent(h.slice(10)))
else if(h.indexOf('#/user/')===0)A.profile(decodeURIComponent(h.slice(7)))
else if(BR.type(h))BR.page(BR.type(h));
else if(h.indexOf('#/settings')===0)settings(h.split('/')[2]);else home();$('#ddb').classList.toggle('on',!!BR.type(h));bar();L.apply(document.body);scrollTo(0,0)}
var dd=$('#dd'),db=$('#ddb');db.onclick=function(e){e.stopPropagation();var o=dd.classList.toggle('open');db.setAttribute('aria-expanded',o)};
function cl(){dd.classList.remove('open');db.setAttribute('aria-expanded','false')}
document.addEventListener('click',cl);addEventListener('keydown',function(e){if(e.key==='Escape')cl()});addEventListener('hashchange',cl);
addEventListener('hashchange',route);matchMedia('(prefers-color-scheme:light)').onchange=theme;L.set(S.lang);
if(API.init){app.innerHTML='<div class="card empty"><h2>'+L.t('Đang kết nối đến Modium…')+'</h2></div>';API.init().then(route).catch(function(){app.innerHTML='<div class="card empty"><h2>'+L.t('Không thể kết nối đến dịch vụ Modium.')+'</h2><p>'+L.t('Hãy kiểm tra cấu hình Supabase và thử lại.')+'</p><button class="btn p" id="retry-api">'+L.t('Thử lại')+'</button></div>';var b=$('#retry-api');if(b)b.onclick=function(){location.reload()}})}else route();
