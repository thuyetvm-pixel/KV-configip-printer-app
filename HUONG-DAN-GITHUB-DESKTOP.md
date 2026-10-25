# Hướng dẫn dùng GitHub Desktop cho dự án KV-configip-printer-app

Không cần gõ lệnh. Mọi thao tác đều là bấm chuột.

## A. Mở dự án trong GitHub Desktop (làm 1 lần)
1. Mở **GitHub Desktop**. Nếu chưa đăng nhập: **File → Options → Accounts → Sign in** bằng tài khoản `thuyetvm-pixel`.
2. Bấm **File → Add local repository…**
3. Bấm **Choose…**, chọn thư mục `D:\KV-configip-printer-app`, bấm **Add repository**.
4. Ở thanh trên cùng, mục **Current repository** sẽ hiện `KV-configip-printer-app`, **Current branch** là `main`.

## B. Đưa thay đổi lên GitHub (mỗi khi có code mới)
1. Nếu tab **Changes** (cột trái) có file thay đổi:
   - Ô **Summary** (góc dưới trái): gõ mô tả ngắn, ví dụ `Cập nhật giao diện`.
   - Bấm nút xanh **Commit to main**.
2. Bấm **Push origin** (thanh trên cùng).
3. Khi nút đổi thành **Fetch origin** là đã đẩy xong. GitHub sẽ tự build APK mới.

## C. Lấy bản mới nhất về máy
Bấm **Fetch origin**, nếu nút đổi thành **Pull origin** thì bấm tiếp.

## D. Tải file APK do GitHub build
1. Vào https://github.com/thuyetvm-pixel/KV-configip-printer-app → tab **Actions**.
2. Bấm vào lần chạy **Build APK** mới nhất có dấu ✓ xanh (mỗi lần build mất khoảng 15 phút).
3. Kéo xuống mục **Artifacts**, bấm **printer-scanner-apk-…** để tải về (file .zip).
4. Giải nén → được `printer-scanner-v….apk` (kèm 2 file kiểm tra chữ ký). Chép file `.apk` sang điện thoại Android và mở để cài
   (cho phép “Cài ứng dụng không rõ nguồn gốc” nếu điện thoại hỏi).

Muốn build lại mà không sửa code: tab **Actions → Build APK → Run workflow → Run workflow**.

## Khi gặp lỗi
- **Push bị từ chối / yêu cầu đăng nhập**: kiểm tra lại bước A.1.
- **Build APK có dấu ✗ đỏ**: bấm vào lần chạy đó, chụp màn hình phần chữ đỏ và gửi cho người hỗ trợ.
- APK được ký bằng khóa riêng của bạn (xem SECURITY.md). File có chữ `TESTKEY` là bản thử, không phát cho kỹ thuật viên.
- Nếu điện thoại báo “Ứng dụng chưa được cài đặt” khi cập nhật: gỡ app cũ (bản ký khóa thử nghiệm) rồi cài lại.
- **Sao lưu thư mục `D:\KV-keystore`** – mất khóa thì không phát hành được bản cập nhật.
