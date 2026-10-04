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
