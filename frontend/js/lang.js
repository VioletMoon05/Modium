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
