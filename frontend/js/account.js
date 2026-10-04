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
