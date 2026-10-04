# Modium
- `backend/` – dữ liệu + xử lý tài khoản (api.js, data.js). Frontend chỉ gọi qua `window.API`.
- `frontend/` – giao diện: `css/`, `js/` (shell = menu/footer chung, auth-ui, account, browse, main, lang).
- `index.html`, `resourcepacks.html`, `modpacks.html` – 3 trang riêng.
- `dist/` – bản đã gộp sẵn để deploy. Khi có Node/npm, chạy `npm install` → `npm run build` sau mỗi lần sửa để tạo lại bản nén/làm rối chuẩn. Trong môi trường sửa lần này không có Node/npm, nên `dist/assets/a.js` đã được gộp để chạy nhưng chưa làm rối; hãy chạy lệnh build trên trước khi deploy production.

## Tệp tải xuống của project
- Khi tạo project, chọn **Tải tệp lên** để kéo-thả/chọn một tệp, hoặc chọn **Dùng URL** để nhập liên kết HTTP/HTTPS. URL dùng giao thức khác hoặc chứa thông tin đăng nhập sẽ bị từ chối.
- Tệp được ghi bất đồng bộ vào IndexedDB dạng Blob (không đổi sang base64 hay `localStorage`), giới hạn 25 MB/tệp và 100 MB/tài khoản trong bản demo. Tệp chỉ được tạo object URL khi người dùng bấm tải xuống.
- **Giới hạn hiện tại:** đây là ứng dụng tĩnh; tệp và dữ liệu project nằm trên thiết bị/trình duyệt đang dùng, không được tải lên máy chủ. Vì vậy người dùng khác hoặc thiết bị khác không thể lấy tệp đó. Muốn public thật cần API có xác thực và phân quyền phía server cùng database/object storage.

## Tài khoản
- `Tên @` là handle duy nhất, không phân biệt hoa thường và được lưu không có ký tự `@` ở đầu.
- `Tên hiển thị` không cần duy nhất; đây là tên được hiển thị ở hồ sơ và dự án.
- Handle không đổi sau khi tạo để không làm sai liên kết chủ sở hữu/cộng tác viên của dự án.
- Mật khẩu mới dùng PBKDF2-SHA-256 với salt riêng và 310.000 vòng; hash cũ được nâng cấp sau lần đăng nhập đúng.

## Giới hạn bảo mật quan trọng
Đây là bản demo tĩnh: tài khoản, session và dự án vẫn nằm trong `localStorage`. Người có quyền DevTools hoặc mã JavaScript độc hại trên cùng origin có thể đọc/sửa chúng, vì vậy không được dùng bản này để lưu tài khoản thật, thanh toán hoặc dữ liệu nhạy cảm.

Khi đưa lên production cần thay `backend/api.js` bằng API server thật: hash mật khẩu bằng Argon2id/bcrypt ở server, session cookie `HttpOnly; Secure; SameSite`, kiểm tra quyền sở hữu ở mọi endpoint, CSRF protection, rate limit theo IP/tài khoản, xác minh email và lưu dự án trong database/object storage.
