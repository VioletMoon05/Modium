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
