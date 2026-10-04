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
  var PK = 'mdm_projects', PTYPES = ['mods', 'modpacks', 'resourcepacks', 'plugins', 'shaders', 'structures'], PVIS = ['public', 'unlisted', 'private'];
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
      icon: imageValue(p.icon, 150000), banner: imageValue(p.banner, 350000), summary: goodText(text(p.summary), 200) ? text(p.summary) : '', download: projectDownload(p.download), created: +p.created || 0, updated: +p.updated || 0, downloads: Math.max(0, +p.downloads || 0), follows: Math.max(0, +p.follows || 0) };
  }
  /* danh sách công khai cho trang duyệt (định dạng của browse.js) */
  function projects(type) {
    return projs().filter(function (p) { return p.vis === 'public' && p.type === type && pubProfile(p.owner); }).map(function (p) {
      var o = pubProfile(p.owner);
      return { slug: p.slug, name: p.name, author: o.displayName, authorHandle: o.username, desc: p.summary, downloads: +p.downloads || 0, follows: +p.follows || 0, updated: new Date(+p.updated || Date.now()).toISOString(), categories: Array.isArray(p.cats) ? p.cats : [], icon: imageValue(p.icon, 150000), banner: imageValue(p.banner, 350000) };
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
    list.push({ slug: slug, name: name, type: f.type, vis: f.vis, owner: n, collab: col.slice(0, 10), cats: cats, icon: imageValue(f.icon, 150000),
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
    'ĐÂY KHÔNG PHẢI WEB CHÍNH THỨ CỦA NHÀ PHÁT TRIỂN MINI WAN, ĐÂY LÀ MỘT DỰ ÁN TÔI MUỐN CÔNG KHAI MỘT SỐ THỨ VỚI MỌI NGƯỜI VÀ CHẮC CHẮN LÀ NÓ LEGIT': 'THIS IS NOT THE OFFICIAL WEBSITE OF THE MINI WAN DEVELOPERS. IT IS A PROJECT I WANT TO SHARE PUBLICLY WITH EVERYONE, AND IT IS DEFINITELY LEGIT'
  };

  /* Đăng ký ngôn ngữ: mã -> bảng dịch. 'vi' là bản gốc nên không cần bảng. */
  var DICT = { en: EN };
  var ATTRS = ['aria-label', 'placeholder', 'alt'];
  var current = 'vi';

  function table(code) {
    if (code === 'vi') return null;
    return DICT[code] || DICT[code.split('-')[0]] || EN; /* chưa có bản dịch -> tiếng Anh */
  }

  function tr(src, tbl) {
    var k = src.trim();
    if (!k || !tbl || !tbl[k]) return src;
    return src.replace(k, tbl[k]);
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
        : field('f-i', 'Email hoặc tên @', 'text', 'username', '', 'mail', false, 120) + field('f-p', 'Mật khẩu', 'password', 'current-password', '', 'key', false, 128)) +
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
    if (fp) fp.onclick = function () { fe.textContent = L.t('Khôi phục mật khẩu cần máy chủ gửi email nên chưa khả dụng trong bản demo này.'); };
    f.onsubmit = async function (e) {
      e.preventDefault(); fe.textContent = ''; fs.disabled = true;
      var r;
      try {
        r = up ? await signUp({ displayName: $('#f-d').value, username: $('#f-u').value, email: $('#f-e').value, password: $('#f-p').value, confirm: $('#f-c').value, news: $('#f-n').checked })
               : await signIn($('#f-i').value, $('#f-p').value, ($('#f-t') || {}).value);
      } catch (x) { r = { err: 'Trình duyệt này không hỗ trợ mã hóa mật khẩu an toàn.' }; }
      fs.disabled = false;
      if (r.need2fa && !$('#f-t')) { fe.insertAdjacentHTML('beforebegin', field('f-t', 'Mã xác thực 2 bước', 'text', 'one-time-code', '', 'key', true)); $('#f-t').focus(); }
      if (r.err) { fe.textContent = L.t(r.err); return; }
      var n = A.next || '#/'; A.next = null; go(n);
    };
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

  window.A = { user: user, avatar: avatar, fmt: fmtDate, ic: ic, header: header, auth: authPage, dash: dash, esc: esc, next: null, go: go };
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
    $('#ps').onclick = function () {
      var r = API.updateProfile({ username: v('pu'), displayName: v('pd'), bio: v('pb'), avatar: av });
      say($('#pm'), r.err || 'Đã lưu thay đổi.', !r.err); if (!r.err) A.header();
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
      sec('se', 'Email', 'Hiện tại: <b>' + esc(u.email) + '</b>', 'Đổi email', inp('e-n', 'Email mới', 'email', 'email') + inp('e-p', 'Mật khẩu hiện tại', 'password', 'current-password') + '<button class="btn p act">Lưu email</button>') +
       sec('sp', 'Mật khẩu', 'Đổi mật khẩu đăng nhập của bạn.', 'Đổi mật khẩu', inp('m-o', 'Mật khẩu hiện tại', 'password', 'current-password') + inp('m-n', 'Mật khẩu mới (≥ 12 ký tự)', 'password', 'new-password') + inp('m-c', 'Xác nhận mật khẩu mới', 'password', 'new-password') + '<button class="btn p act">Đổi mật khẩu</button>') +
      sec('s2', 'Xác thực hai bước (2FA)', u.totp ? '<span class="st2 on">Đang bật</span> Cần mã từ ứng dụng khi đăng nhập.' : '<span class="st2">Đang tắt</span> Thêm một lớp bảo vệ khi đăng nhập.', u.totp ? 'Tắt 2FA' : 'Thiết lập',
        u.totp ? inp('t-p', 'Mật khẩu hiện tại', 'password', 'current-password') + '<button class="btn d act">Tắt 2FA</button>'
               : '<button class="btn" id="t-g">Tạo khóa bí mật</button><div id="t-b"></div>') +
      sec('sx', 'Xuất dữ liệu', 'Tải về bản sao dữ liệu tài khoản của bạn (JSON).', 'Xuất', '<button class="btn p" id="xp">' + ic(D.dl) + 'Tải xuống</button>') +
       sec('sd', 'Xóa tài khoản', 'Hành động này không thể hoàn tác.', 'Xóa', inp('d-c', 'Nhập tên @ "@' + esc(u.username) + '" để xác nhận', 'text', 'off') + inp('d-p', 'Mật khẩu hiện tại', 'password', 'current-password') + '<button class="btn d act">' + ic(D.trash) + 'Xóa tài khoản vĩnh viễn</button>', true);
    var again = function (r, msg) { if (!r.err) security(el, API.user(), msg); return r; };
    run('se', async function () { return again(await API.changeEmail(v('e-p'), v('e-n')), 'Đã đổi email.'); });
    run('sp', async function () { return again(await API.changePassword(v('m-o'), v('m-n'), v('m-c')), 'Đã đổi mật khẩu.'); });
    if (u.totp) run('s2', async function () { return again(await API.totpDisable(v('t-p')), 'Đã tắt xác thực hai bước.'); });
    else $('#t-g').onclick = function () {
       var s = API.totpBegin();
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
      var r = await API.deleteAccount(v('d-p')); if (!r.err) A.go('#/'); return r;
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
    if (d < 1) return vi ? 'Hôm nay' : 'Today';
    if (d < 7) return vi ? d + ' ngày trước' : d + (d === 1 ? ' day ago' : ' days ago');
    if (d < 14) return vi ? 'Tuần trước' : 'Last week';
    if (d < 30) { n = Math.floor(d / 7); return vi ? n + ' tuần trước' : n + ' weeks ago'; }
    if (d < 60) return vi ? 'Tháng trước' : 'Last month';
    if (d < 365) { n = Math.floor(d / 30); return vi ? n + ' tháng trước' : n + ' months ago'; }
    n = Math.floor(d / 365); return vi ? n + ' năm trước' : n + (n === 1 ? ' year ago' : ' years ago');
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
  function ago(t) { var d = Math.floor((Date.now() - t) / 864e5); return d < 1 ? 'Hôm nay' : d < 30 ? d + ' ngày trước' : d < 365 ? Math.floor(d / 30) + ' tháng trước' : Math.floor(d / 365) + ' năm trước'; }
  var CN = null;
  function cn(c) { if (!CN) { CN = {}; TY.forEach(function (t) { BR.cats(t[0]).forEach(function (x) { CN[x[0]] = x[1]; }); }); } return CN[c] || c; }
  function thumb(p, cls) {
    return p.icon ? '<img class="pic ' + cls + '" src="' + esc(p.icon) + '" alt="">' : '<div class="pic ' + cls + '" style="background:linear-gradient(135deg,hsl(' + hue(p.name) + ' 68% 52%),hsl(' + ((hue(p.name) + 40) % 360) + ' 66% 36%))" aria-hidden="true">' + esc(p.name.charAt(0).toUpperCase()) + '</div>';
  }
  function tags(p, all) { return '<span class="tag">' + TN[p.type] + '</span>' + p.cats.slice(0, all ? 20 : 3).map(function (c) { return '<span class="tag">' + esc(cn(c)) + '</span>'; }).join(''); }
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
  function profile(name) {
    var wanted = String(name || '').replace(/^@+/, ''), me = API.user(), self = !!me && (!wanted || wanted.toLowerCase() === me.username.toLowerCase()), u = self ? me : API.profileOf(wanted);
    if (!u) { app.innerHTML = '<div class="card empty"><h3>Không tìm thấy người dùng</h3><a class="btn p" href="#/">Về trang chủ</a></div>'; return; }
    var list = API.userProjects(u.username), dls = list.reduce(function (a, p) { return a + p.downloads; }, 0), tab = 'all';
    app.innerHTML = '<header class="uh">' + A.avatar(u, true) + '<div class="uhi"><h1>' + esc(u.displayName || u.username) + '</h1><p class="handle">@' + esc(u.username) + '</p><p>' + (u.bio ? esc(u.bio) : 'Người dùng Modium.') + '</p>' +
      '<div class="pst"><span>' + ic(I.box) + list.length + ' dự án</span><i></i><span>' + ic(I.dl) + num(dls) + ' lượt tải</span><i></i><span>' + ic(I.cal) + 'Tham gia ' + esc(A.fmt(u.created)) + '</span></div></div>' +
      (self ? '<a class="btn" href="#/settings/profile">' + ic(I.edit) + 'Chỉnh sửa</a>' : '') + '</header><div id="pl"></div>';
    function draw() {
      var types = TY.filter(function (t) { return list.some(function (p) { return p.type === t[0]; }); }), el = $('#pl');
      if (!list.length) { el.innerHTML = empty(self); return; }
      el.innerHTML = '<nav class="ptabs">' + [['all', 'Tất cả']].concat(types).map(function (t) { return '<button data-t="' + t[0] + '" class="' + (tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</nav>' +
        '<div class="rl rows">' + list.filter(function (p) { return tab === 'all' || p.type === tab; }).map(card).join('') + '</div>';
      el.querySelectorAll('[data-t]').forEach(function (b) { b.onclick = function () { tab = b.dataset.t; draw(); }; });
    }
    draw();
  }

  function dash() {
    var u = API.user(), l = API.userProjects(u.username);
    app.innerHTML = '<div class="hi" style="margin-top:20px">Chào mừng trở lại, <b>' + esc(u.displayName || u.username) + '</b> <span class="handle">@' + esc(u.username) + '</span></div><h1 style="font-size:2.2rem;margin:6px 0 16px">Bảng điều khiển</h1>' +
      '<div class="qa"><div><b>' + l.length + '</b><small>Dự án</small></div><div><b>' + num(l.reduce(function (a, p) { return a + p.downloads; }, 0)) + '</b><small>Lượt tải</small></div><div><b>0</b><small>Người theo dõi</small></div></div>' +
      '<p><a class="btn p" href="#/new">' + ic(I.plus) + 'Tạo dự án</a></p>' + (l.length ? '<div class="rl rows" style="margin-bottom:60px">' + l.map(card).join('') + '</div>' : '');
  }

  /* ---------- trang dự án ---------- */
  function project(slug) {
    var p = API.getProject(slug);
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
    $('#pt').onclick = function (e) { var b = e.target.closest('[data-t]'); if (!b) return; this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); body(b.dataset.t); };
     $('#dlb').onclick = async function () {
       var btn = this, msg = $('#dm');
       if (btn.disabled) return;
       btn.disabled = true; msg.className = 'fm'; msg.textContent = 'Đang chuẩn bị tải xuống…';
       try {
         var file = await API.downloadProject(slug);
         if (file.err) { msg.className = 'fm bad'; msg.textContent = file.err; return; }
         if (file.mode === 'url') { window.location.assign(file.url); return; }
         var objectUrl = URL.createObjectURL(file.blob), a = document.createElement('a');
         a.href = objectUrl; a.download = file.fileName; a.rel = 'noopener'; a.style.display = 'none';
         document.body.appendChild(a); a.click(); a.remove();
         window.setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 60000);
         msg.className = 'fm ok'; msg.textContent = 'Đã bắt đầu tải ' + file.fileName + '.';
       } catch (e) { msg.className = 'fm bad'; msg.textContent = 'Không thể tải tệp. Hãy thử lại.'; }
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
    var me = API.user(), st = { vis: 'public', type: '', cats: [], collab: [], icon: '', banner: '', downloadMode: 'upload', file: null, url: '' }, edited = false;
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
      fld('Tệp tải xuống', seg('mdo', [['upload', 'Tải tệp lên'], ['url', 'Dùng URL']]) + '<div id="mdpanel"></div><small>File tải lên tối đa 25 MB. Bản demo lưu tệp trên thiết bị hiện tại; để mọi người tải được, cần máy chủ/object storage.</small>') +
      '<div id="mcat"></div><div id="mimg"></div>' +
      fld('Mô tả ngắn', '<textarea id="mm" maxlength="200" rows="3" placeholder="Dự án này thêm..."></textarea><small>Một hai câu mô tả dự án của bạn.</small>') +
      '</div><div class="mf"><div class="fm" id="me" role="alert"></div><button class="btn" id="mcx" type="button">Hủy</button><button class="btn p" id="mok" type="button">Tạo dự án</button></div></div>';
    document.body.appendChild(m);
    var g = function (s) { return m.querySelector(s); };
    function close(to) { m.remove(); if (to) location.hash = to; }
    function mark(id, v) { g('#' + id).querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); b.setAttribute('aria-pressed', b.dataset.v === v); }); }
    function chips() {
      g('#mc').innerHTML = st.collab.map(function (c) { return '<span class="chp">@' + esc(c) + '<button type="button" data-r="' + esc(c) + '" aria-label="Xóa ' + esc(c) + '">' + ic(I.x) + '</button></span>'; }).join('');
    }
    function extras() {
      var cats = st.type ? BR.cats(st.type) : [], ban = st.type === 'modpacks' || st.type === 'resourcepacks';
      g('#mcat').innerHTML = st.type ? fld('Chủ đề (chọn nhiều)', '<div class="seg" id="mk">' + cats.map(function (c) { return '<button type="button" data-v="' + c[0] + '" class="' + (st.cats.indexOf(c[0]) > -1 ? 'on' : '') + '">' + c[1] + '</button>'; }).join('') + '</div>') : '';
       g('#mimg').innerHTML = '<div class="imgs"><div><b>Ảnh đại diện</b><div class="ip sq">' + (st.icon ? '<img src="' + esc(st.icon) + '" alt="">' : ic(I.box)) + '</div><button class="btn" type="button" data-f="icon">Chọn ảnh</button></div>' +
          (ban ? '<div><b>Ảnh bìa (thumbnail)</b><div class="ip wd">' + (st.banner ? '<img src="' + esc(st.banner) + '" alt="">' : ic(I.box)) + '</div><button class="btn" type="button" data-f="banner">Chọn ảnh</button></div>' : '') + '<input type="file" id="mf" accept="image/png,image/jpeg,image/webp" hidden></div>';
    }
    function fileSize(n) { return n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / (1024 * 1024)).toFixed(1) + ' MB'; }
    function renderDownload() {
      mark('mdo', st.downloadMode);
      if (st.downloadMode === 'url') {
        g('#mdpanel').innerHTML = '<input id="mdurl" type="url" maxlength="2048" placeholder="https://example.com/file.zip" autocomplete="url"><small>Chỉ chấp nhận liên kết HTTP/HTTPS. Khi bấm Tải xuống, trình duyệt sẽ mở liên kết này.</small>';
        g('#mdurl').value = st.url; g('#mdurl').oninput = function () { st.url = this.value; };
        return;
      }
      g('#mdpanel').innerHTML = '<div class="dropbox" id="mdrop"><b>Kéo thả tệp vào đây</b><span>ZIP, TXT, LUA hoặc định dạng tài nguyên khác</span><span id="mfn"></span></div><div class="drop-actions"><button class="btn" id="mchoose" type="button">Chọn tệp</button><button class="btn" id="mremove" type="button"' + (st.file ? '' : ' disabled') + '>Bỏ tệp</button><input type="file" id="mfile" hidden></div>';
      var drop = g('#mdrop'), input = g('#mfile');
      g('#mfn').textContent = st.file ? st.file.name + ' · ' + fileSize(st.file.size) : 'Chưa chọn tệp';
      g('#mchoose').onclick = function () { input.click(); };
      g('#mremove').onclick = function () { st.file = null; renderDownload(); };
      function choose(file) {
        if (!file) return;
        if (file.size < 1 || file.size > 25 * 1024 * 1024) { st.file = null; g('#mfn').textContent = 'Tệp phải từ 1 byte đến 25 MB.'; g('#mremove').disabled = true; g('#me').textContent = 'Tệp vượt quá giới hạn dung lượng.'; return; }
        st.file = file; g('#mfn').textContent = file.name + ' · ' + fileSize(file.size); g('#mremove').disabled = false; g('#me').textContent = '';
      }
      input.onchange = function () { choose(this.files && this.files[0]); this.value = ''; };
      drop.ondragover = function (e) { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = function () { drop.classList.remove('over'); };
      drop.ondrop = function (e) { e.preventDefault(); drop.classList.remove('over'); choose(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); };
    }
    var fk = '';
    g('#mv').onclick = function (e) { var b = e.target.closest('[data-v]'); if (b) { st.vis = b.dataset.v; mark('mv', st.vis); g('#mvh').textContent = VS.filter(function (x) { return x[0] === st.vis; })[0][2]; } };
    g('#mdo').onclick = function (e) { var b = e.target.closest('[data-v]'); if (b) { if (g('#mdurl')) st.url = g('#mdurl').value; st.downloadMode = b.dataset.v; renderDownload(); } };
    g('#mt').onclick = function (e) { var b = e.target.closest('[data-v]'); if (b) { st.type = b.dataset.v; st.cats = []; if (st.type !== 'modpacks' && st.type !== 'resourcepacks') st.banner = ''; mark('mt', st.type); extras(); } };
    g('#mcat').onclick = function (e) { var b = e.target.closest('[data-v]'); if (!b) return; var i = st.cats.indexOf(b.dataset.v); if (i > -1) st.cats.splice(i, 1); else st.cats.push(b.dataset.v); b.classList.toggle('on'); };
    g('#mimg').onclick = function (e) { var b = e.target.closest('[data-f]'); if (b) { fk = b.dataset.f; g('#mf').click(); } };
    g('#mimg').onchange = function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      pickImg(f, fk === 'icon' ? 256 : 960, fk === 'icon' ? 256 : 320, function (d) { if (!d) { g('#me').textContent = 'Tệp không phải ảnh hợp lệ.'; return; } st[fk] = d; extras(); });
    };
    g('#mn').oninput = function () { if (!edited) g('#ms').value = slugify(this.value); };
    g('#ms').oninput = function () { edited = true; };
    g('#mq').oninput = function () {
      var r = API.searchUsers(this.value);
       g('#msg').innerHTML = r.filter(function (x) { return st.collab.indexOf(x.username) < 0; }).map(function (x) { return '<button type="button" data-u="' + esc(x.username) + '">' + A.avatar(x) + '<span><b>' + esc(x.displayName || x.username) + '</b><small>@' + esc(x.username) + '</small></span></button>'; }).join('') || (this.value.replace('@', '') ? '<small>Không tìm thấy người dùng.</small>' : '');
    };
    g('#msg').onclick = function (e) { var b = e.target.closest('[data-u]'); if (b && st.collab.length < 10) { st.collab.push(b.dataset.u); chips(); this.innerHTML = ''; g('#mq').value = ''; } };
    g('#mc').onclick = function (e) { var b = e.target.closest('[data-r]'); if (b) { st.collab.splice(st.collab.indexOf(b.dataset.r), 1); chips(); } };
    g('#mx').onclick = g('#mcx').onclick = function () { close('#/dashboard'); };
    m.onclick = function (e) { if (e.target === m) close('#/dashboard'); };
    m.onkeydown = function (e) { if (e.key === 'Escape') close('#/dashboard'); };
    g('#mok').onclick = async function () {
      var submit = this;
      if (submit.disabled) return;
      submit.disabled = true; submit.textContent = 'Đang tạo…';
      try {
        var r = await API.createProject({ vis: st.vis, name: g('#mn').value, slug: g('#ms').value, type: st.type, cats: st.cats, collab: st.collab, icon: st.icon, banner: st.banner, summary: g('#mm').value,
          downloadMode: st.downloadMode, file: st.file, url: g('#mdurl') ? g('#mdurl').value : st.url });
        if (r.err) { g('#me').textContent = r.err; return; }
        close('#/project/' + r.slug);
      } catch (e) { g('#me').textContent = 'Không thể tạo dự án. Hãy thử lại.'; }
      finally { if (submit.isConnected) { submit.disabled = false; submit.textContent = 'Tạo dự án'; } }
    };
    mark('mv', 'public'); g('#mvh').textContent = VS[0][2]; extras(); renderDownload(); g('#mn').focus();
  }

  A.profile = profile; A.dash = dash; A.project = project; A.newProject = newProject;
})();
;
var $=function(s){return document.querySelector(s)},app=$('#app'),S={theme:'system',sync:false,lang:'vi',lay:{mods:'rows',plugins:'rows',datapacks:'rows',shaders:'rows',resourcepacks:'grid',modpacks:'rows'}},timer,P=null;
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
var LG=[['vi','','Tiếng Việt','Vietnamese','100'],['en','','English (United States)','','100'],['de-CH','','Deutsch (Schweiz)','German (Switzerland)','75'],['de','','Deutsch (Deutschland)','German (Germany)','75'],['es-419','','Español (Latinoamérica)','Spanish (Latin America)','75'],['es','','Español (España)','Spanish (Spain)','74'],['fr','','Français','French','74'],['hu','','Magyar (Magyarország)','Hungarian','74'],['it','','Italiano (Italia)','Italian (Italy)','74'],['nl','','Nederlands','Dutch','74'],['pl','','Polski','Polish','74']];
var PJ=[['Lumen Lights','Ánh sáng 3D cho các khối phát sáng','#2fc6df'],['Cubic Storage','Hệ thống kho đồ theo tủ hồ sơ','#7a63d6'],['Deepwood','Rừng sâu với sinh vật mới','#3f9a5c'],['Skyline Shader','Shader bầu trời chân thực','#d6803f']];
 function home(){var l=S.lay.mods,u=A.user();app.innerHTML='<section class="hero">'+(u?'<div class="hi">Chào mừng trở lại, <b>'+A.esc(u.displayName||u.username)+'</b> <span class="handle">@'+A.esc(u.username)+'</span></div>':'')+'<img alt="Logo Modium" src="'+$('.brand img').src+'"><h1>Nơi dành cho<span class="rot"><ul id="w"><li>mod</li><li>gói tài nguyên</li><li>gói dữ liệu</li><li>shader</li><li>modpack</li><li>plugin</li><li>máy chủ</li><li>mod</li></ul></span>MiniWorld</h1><p>Khám phá, chơi và chia sẻ nội dung MiniWorld trên nền tảng được xây dựng cho cộng đồng.</p><div class="cta"><a class="btn p" href="#/mods">Khám phá các tài nguyên</a>'+(u?'<a class="btn" href="#/dashboard">Đến bảng điều khiển</a>':'<a class="btn" href="#/signup">Đăng ký</a>')+'</div></section>'+(u?'<h2>Truy cập nhanh</h2><div class="qa"><a href="#/user"><b>Hồ sơ</b><small>Xem thông tin tài khoản của bạn</small></a><a href="#/dashboard"><b>Bảng điều khiển</b><small>Theo dõi hoạt động của bạn</small></a><a href="#/settings"><b>Cài đặt</b><small>Tùy chỉnh giao diện và ngôn ngữ</small></a></div>':'')+'<h2>Dự án nổi bật</h2><div class="plist '+(l==='grid'?'grid':'')+'">'+PJ.map(function(p){return'<div class="pc"><div class="pi" style="background:'+p[2]+'">'+p[0][0]+'</div><div><b>'+p[0]+'</b><small>'+p[1]+'</small></div></div>'}).join('')+'</div>';
var u=$('#w'),n=7,i=0;clearInterval(timer);L.apply(app);if(!matchMedia('(prefers-reduced-motion:reduce)').matches)timer=setInterval(function(){if(!u.isConnected)return clearInterval(timer);i++;u.style.transition='transform .6s cubic-bezier(.7,0,.2,1)';u.style.transform='translateY(-'+i*u.children[0].offsetHeight+'px)';if(i===n)setTimeout(function(){u.style.transition='none';u.style.transform='none';i=0},650)},2200)}
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
if(window.PAGE){BR.page(window.PAGE);$('#ddb').classList.add('on');L.apply(document.body);return}
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
addEventListener('hashchange',route);matchMedia('(prefers-color-scheme:light)').onchange=theme;L.set(S.lang);route();
