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
