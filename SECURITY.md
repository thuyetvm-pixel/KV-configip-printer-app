# Bảo mật – Printer Scanner

## 1. Có cần mua chứng chỉ (certificate) không?

**Không cần mua.** App Android chỉ bắt buộc một thứ: **chứng chỉ ký ứng dụng (signing certificate)** do chính bạn tự tạo
(miễn phí). Android dùng chữ ký này để đảm bảo mỗi bản cập nhật đến từ đúng người phát hành.

| Loại | Có cần? | Ghi chú |
| --- | --- | --- |
| Chứng chỉ ký APK (keystore) | **Bắt buộc** | Đã tạo: RSA 4096, hạn 10000 ngày, `CN=Printer Scanner, OU=Field Tech, O=KV, C=VN`. SHA-256: `72:8E:EB:87:F9:51:9C:FD:C7:3E:61:A1:98:47:07:80:E4:6B:4D:6A:04:60:6C:CC:C8:DE:82:52:D7:E3:D1:BD` |
| Chứng chỉ SSL/TLS (HTTPS) | Không | App không có máy chủ, không gọi Internet. Chỉ nói chuyện với máy in trong mạng LAN. |
| Chứng chỉ code-signing mua từ CA | Không | Android không dùng loại này. |
| Google Play | Chỉ khi phát hành lên Play | Khóa trên dùng làm *upload key*; bật Play App Signing khi tạo app trên Play Console. |

**Khóa ký đang ở đâu**
- Bản gốc: `D:\KV-keystore\printer-scanner-release.jks` + `KEYSTORE-INFO.txt` (mật khẩu) – **ngoài** thư mục code, không bao giờ lên GitHub.
- Bản cho máy build: GitHub Secrets của kho (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`).
- **Hãy sao lưu thư mục `D:\KV-keystore`** (USB, ổ đám mây cá nhân, trình quản lý mật khẩu). Mất khóa = không thể phát hành bản
  cập nhật cài đè lên app đã cài; kỹ thuật viên sẽ phải gỡ app rồi cài lại.
- Nếu nghi lộ khóa: tạo khóa mới, cập nhật 4 secret, phát hành lại và yêu cầu gỡ – cài lại app.

**Kiểm tra một APK có đúng do bạn phát hành:** mỗi lần build trên GitHub, artifact có kèm `apk-signature.txt` (chứng chỉ ký)
và `apk-sha256.txt` (mã băm file). Chứng chỉ phải là `CN=Printer Scanner…` với SHA-256 như trên. File có đuôi `-TESTKEY` là bản
ký bằng khóa debug công khai – chỉ để thử, không phát cho kỹ thuật viên.

> Các APK build trước ngày bổ sung khóa riêng được ký bằng khóa debug. Điện thoại đã cài bản đó phải **gỡ app** trước khi cài
> bản mới (Android từ chối cập nhật khi chữ ký khác nhau).

## 2. Các biện pháp đã áp dụng trong app

| Hạng mục | Biện pháp |
| --- | --- |
| Ký ứng dụng | Release ký bằng khóa riêng (APK Signature Scheme v2); CI kiểm tra chữ ký, báo lỗi nếu lỡ ký bằng khóa debug. |
| Cập nhật | `versionCode` tăng theo mỗi lần build (1000 + số lần chạy) để bản mới cài đè được bản cũ. |
| Quyền | Chỉ xin quyền cần thiết (README mục 3). Vị trí chỉ để đọc tên Wi-Fi, từ chối vẫn dùng được. Loại bỏ quyền thừa (bộ nhớ, ghi âm, overlay). |
| Sao lưu dữ liệu | `allowBackup=false`: dữ liệu app không bị sao lưu lên đám mây / chuyển sang máy khác. App cũng không lưu dữ liệu nhạy cảm nào. |
| Thông tin đăng nhập SNMP | Community nhập ở ô mật khẩu, chỉ giữ trong bộ nhớ khi màn hình mở, không lưu, không ghi log, không mặc định `public` cho lệnh ghi. |
| Thay đổi cấu hình máy in | Không có lệnh ghi nào khi chưa xác minh (đọc OID, ghi thử giá trị cũ) và chưa có xác nhận của kỹ thuật viên. |
| Trình duyệt nhúng (WebView) | Chỉ mở trang của chính IP máy in; chặn mọi host khác và `file:`, `intent:`, `javascript:`, `data:`. Chế độ ẩn danh: không lưu cookie, cache, dữ liệu form; không cho mở cửa sổ mới, không truy cập file; không trộn nội dung HTTP vào trang HTTPS. |
| HTTP không mã hoá | Bật `usesCleartextTraffic` vì trang quản trị máy in là `http://<IP>`; Android không cho giới hạn theo dải IP nên phạm vi được khoá ở WebView như trên. App không kết nối Internet. |
| Chứng chỉ HTTPS tự ký của máy in | **Không** bỏ qua kiểm tra chứng chỉ trong app. Trang HTTPS tự ký được mở bằng trình duyệt ngoài để người dùng tự quyết định. |
| Mã nguồn release | Bật R8 (thu gọn/làm rối mã Java/Kotlin), JS biên dịch Hermes bytecode, không bật debug. |

## 3. Chuỗi cung ứng & CI

- GitHub Actions chạy với quyền tối thiểu (`contents: read`), không lưu token git sau checkout.
- Keystore chỉ được giải mã vào thư mục tạm của máy build và bị xoá cuối job; secret không có trên PR từ fork.
- `npm ci` theo `package-lock.json` (phiên bản cố định); `npm audit` chạy mỗi lần build.
- Dependabot: thư viện npm **chỉ** nhận PR vá lỗ hổng bảo mật (Dependabot alerts + security updates đã bật); GitHub Actions
  nhận 1 PR gộp mỗi tháng. Không gộp PR khi build APK của PR đó chưa có dấu ✓.
- `npm audit` hiện báo 5 lỗi mức *high* trong `@expo/cli` (node-forge, zod). Đây là công cụ build chạy trên máy tính, **không
  nằm trong APK**; bản sửa sẽ đến khi nâng Expo SDK.
- `.gitignore` chặn đưa lên kho: keystore (`*.jks`, `*.keystore`), `.env`, `local.properties`, APK/AAB.

## 4. Báo lỗi bảo mật

Không mở issue công khai cho lỗi bảo mật. Liên hệ trực tiếp chủ kho `thuyetvm-pixel` qua GitHub.
