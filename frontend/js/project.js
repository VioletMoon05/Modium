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
