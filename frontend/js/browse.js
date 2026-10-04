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
