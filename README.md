# Printer Scanner

Ứng dụng Android cho kỹ thuật viên hiện trường: quét mạng tìm máy in, nhận diện máy in **lệch subnet**,
đề xuất IP mới, **kiểm tra trùng IP** và hỗ trợ đổi IP máy in (hướng dẫn thủ công hoặc SNMP SET đã xác minh).

```
MỞ APP → QUÉT MẠNG → NHẬN DIỆN MÁY IN → CHỌN MÁY IN → GỢI Ý IP MỚI → KIỂM TRA TRÙNG IP → HỖ TRỢ ĐỔI IP
```

Bảo mật, chứng chỉ ký APK và cách quản lý khóa: xem [SECURITY.md](SECURITY.md).

## 1. Kiến trúc và lý do chọn

| Lựa chọn | Lý do |
| --- | --- |
| **Expo SDK 58 / React Native 0.88, TypeScript, Development Build (CNG)** | Có sẵn hệ thống config plugin để sinh `android/` + quyền từ `app.json`; dễ viết module native Kotlin trong dự án. Không chạy trên Expo Go. |
| **Module native riêng `modules/network-tools` (Kotlin, Expo Modules API)** | Android không có API JS cho: gateway/prefix, MulticastLock, TCP connect probe, UDP request/response, đọc ARP. Viết riêng thay vì dùng `react-native-udp` (đã ngừng bảo trì, RN 0.88 chỉ còn New Architecture). |
| `react-native-zeroconf` (NsdManager) | mDNS/Bonjour, còn được duy trì, hỗ trợ TXT record. |
| `@react-native-community/netinfo` | Tên Wi-Fi (SSID), trạng thái Wi-Fi. |
| `react-native-webview` | Mở trang quản trị máy in trong app. |
| Jest (`jest-expo`) | Unit test toàn bộ logic thuần (IPv4, subnet, gợi ý IP, trùng IP, phân loại thiết bị, BER/SNMP). |

```
App.tsx                         Trạng thái phiên: mạng điện thoại, mạng đích, danh sách thiết bị, điều hướng
modules/network-tools/          Module native Kotlin + API JS
src/
  types/                        Kiểu dữ liệu dùng chung
  utils/ipv4.ts                 IPv4, prefix/mask, network/broadcast, dải host (/0–/32, kể cả /31, /32)
  services/
    network/                    Đọc mạng điện thoại, quyền runtime, phân loại subnet, kiểm tra trước khi quét
    discovery/                  mDNS, quét TCP subnet, SNMP broadcast, nhập IP tay, gộp bằng chứng + mức tin cậy
    printer/                    SNMP (BER, GET/SET), kiểm tra kết nối, URL quản trị, cấu hình tự động
    ip-management/              Validate IP, thuật toán gợi ý IP, quyết định trùng IP, chạy kiểm tra trên mạng
  components/                   NetworkCard, DeviceCard, IpInput, ConflictStatus, ChangeIpGuide, AutoConfigPanel…
  screens/                      HomeScreen, PrinterDetailScreen, PrinterWebScreen
  **/__tests__/                 Unit test (dữ liệu giả CHỈ nằm trong src/__tests__/fixtures.ts)
```

App không có chế độ demo và không bao giờ hiển thị thiết bị giả: danh sách chỉ chứa thiết bị có bằng chứng
từ giao thức mạng, hoặc IP kỹ thuật viên tự nhập (gắn nhãn **Chưa xác minh** cho tới khi có phản hồi).

## 2. Những gì app làm được (Android không root)

### Thông tin mạng điện thoại
IPv4 + prefix + gateway + máy chủ DHCP (LinkProperties/DhcpInfo qua module native), SSID (NetInfo, cần quyền Vị trí),
trạng thái Wi-Fi, phiên bản Android, trạng thái quyền. Trường nào không đọc được hiển thị **“Không xác định”** kèm
hướng dẫn – không bao giờ dùng giá trị mặc định giả, không giả định /24.

### Khám phá thiết bị – mỗi kết quả ghi rõ phương pháp và mức tin cậy

| Phương pháp | Tìm được gì | Giới hạn thật |
| --- | --- | --- |
| **mDNS/NSD** (`_ipp`, `_ipps`, `_printer`, `_pdl-datastream`, `_http`) | Máy in **cả khi khác subnet**, miễn cùng L2/VLAN (multicast 224.0.0.251 không cần định tuyến). Tên dịch vụ, hostname, cổng, TXT (model `ty`/`usb_MDL`, hãng `usb_MFG`, `adminurl`). | Không qua router/VLAN. Máy in tắt Bonjour sẽ không thấy. `_http` một mình **không** được coi là máy in. |
| **Quét TCP subnet** (9100, 631, 515, 80, 443; timeout 700 ms; 96 kết nối song song; dừng được) | Mọi host trả lời (mở hoặc từ chối kết nối) trong subnet thật của điện thoại. Subnet > /22 chỉ quét /24 quanh IP điện thoại (có thông báo). | Chỉ trong subnet của điện thoại. Không ping (ping thất bại không chứng minh IP trống). |
| **SNMP GET broadcast** (UDP 161, community `public`, chỉ đọc) | sysDescr, sysName, model, MAC (`ifPhysAddress`), serial (Printer-MIB). | Máy in khác subnet phải tự định tuyến được câu trả lời về điện thoại – thường im lặng. |
| **IP nhập tay** (từ trang cấu hình in ra) | Thử TCP + SNMP tới IP đó. | Khác subnet và không có router → thường “Chưa xác minh”. |
| **ARP** (`/proc/net/arp`) | MAC của thiết bị đã thấy. | **Chỉ Android 9 trở xuống.** Android 10+ chặn. |

Mức tin cậy: **Máy in (đã xác nhận)** (dịch vụ in mDNS / Printer-MIB) · **Có thể là máy in** (cổng 9100/631/515, mô tả giống máy in) ·
**Thiết bị mạng** · **Chưa xác minh** (chỉ có IP nhập tay). MAC/model/hãng không lấy được hiển thị “Chưa xác định”; hãng đoán từ OUI
luôn ghi “(đoán theo MAC, chưa chắc chắn)”.

**Không làm được trên Android không root**: quét ARP/Layer 2 tổng quát, gửi frame Ethernet/raw socket, đọc bảng ARP từ Android 10,
tự đổi IP tĩnh của điện thoại. App không giả lập các chức năng này. Không gửi UDP broadcast tới cổng 9100 (9100 là TCP, không có cơ chế dò).

### Phân loại subnet
`CÙNG SUBNET` (xanh) · `KHÁC SUBNET` (đỏ, kèm nút nổi bật **GỢI Ý IP MỚI**) · `CHƯA XÁC ĐỊNH` (vàng, thiếu IP/prefix) ·
`CHƯA KIỂM TRA` (xám, chưa đọc được mạng). App ghi chú: cùng subnet chưa chắc kết nối được; khác subnet vẫn có thể kết nối nếu có định tuyến.

### Gợi ý IP mới (`services/ip-management/suggestIp.ts`)
Lấy subnet thật của **mạng đích** (mạng điện thoại khi đang DHCP, được giữ cố định kể cả khi điện thoại tạm đặt IP tĩnh sang dải khác).
Thứ tự thử: `.200 … .210, .220, .230, .240, .250, .150, .100` trong khối /24 chứa IP điện thoại (khi prefix ≤ 24), rồi các host từ cuối subnet
đi xuống. Mỗi ứng viên phải qua validation: thuộc subnet, không phải network/broadcast, không trùng IP điện thoại, gateway, máy chủ DHCP,
không trùng IP đã thấy khi quét; tránh dải DHCP nếu kỹ thuật viên nhập; chỉ dùng IP trong dải DHCP khi không còn lựa chọn khác (ghi rõ).
Ví dụ: điện thoại `192.168.1.50/24`, gateway `192.168.1.1` → gợi ý `192.168.1.200` (nếu .200 đã có thiết bị → `.201`).

### Kiểm tra trùng IP – bắt buộc trước khi xác nhận
Nhập đầy đủ IPv4 hoặc chỉ sửa số cuối `192.168.1.[201]` (khi prefix ≥ 24). Mỗi lần sửa: validation chạy lại ngay, kết quả dò cũ bị huỷ,
tự dò lại sau 0,7 giây. Phép dò: TCP tới 11 cổng phổ biến (timeout 4,5 s), SNMP GET, bảng ARP (Android ≤ 9).

| Trạng thái | Khi nào | Nút XÁC NHẬN ĐỔI IP |
| --- | --- | --- |
| **IP NÀY ĐANG ĐƯỢC SỬ DỤNG** (đỏ) | Trùng IP điện thoại/gateway/DHCP server/IP đã thấy, hoặc có thiết bị trả lời TCP (mở/từ chối), SNMP, ARP | Khoá |
| **CHƯA PHÁT HIỆN TRÙNG IP** (xanh) | Kernel báo không ai trả lời ARP (EHOSTUNREACH) | Mở sau khi tick “Tôi đã hiểu…” – kèm cảnh báo không tuyệt đối |
| **CHƯA THỂ XÁC MINH IP** (vàng) | Mọi cổng timeout (có thể có thiết bị chặn gói), lỗi dò, thiếu module, điện thoại không ở mạng đích | Khoá; có KIỂM TRA LẠI / DÙNG IP GỢI Ý KHÁC |
| IP KHÔNG HỢP LỆ | Sai định dạng, ngoài subnet, network/broadcast, địa chỉ dành riêng | Khoá |

### Đổi IP máy in
- **Hướng dẫn thủ công (6 bước)**: xác nhận IP đích → tạm đặt IP tĩnh cho điện thoại trong dải máy in (nút mở Cài đặt Wi-Fi; mask /24 là
  giả định được ghi rõ) → MỞ TRANG QUẢN TRỊ (chỉ bật khi máy in thực sự kết nối được, nếu không thì giải thích lý do) → đổi IP → trả điện
  thoại về DHCP → xác minh IP mới.
- **THỬ CẤU HÌNH TỰ ĐỘNG (SNMP SET)**: chỉ hiện khi máy in đang kết nối được **và** đã trả lời SNMP. Kỹ thuật viên nhập community ghi
  (ô mật khẩu, không lưu, không ghi log, không mặc định `public`) và OID của hãng. Trước khi đổi, app **xác minh**: đọc OID IP phải đúng
  bằng IP hiện tại của máy in, rồi ghi lại chính giá trị cũ để chứng minh có quyền ghi. Chỉ khi đạt mới mở nút đổi, có hộp xác nhận
  IP cũ/IP mới/mask/gateway/cảnh báo mất kết nối; sau đó dò lại IP mới tới 60 giây và báo đúng kết quả.

## 3. Quyền Android

| Quyền | Loại | Dùng cho |
| --- | --- | --- |
| `INTERNET`, `ACCESS_NETWORK_STATE`, `ACCESS_WIFI_STATE`, `CHANGE_WIFI_MULTICAST_STATE` | Khai báo (cấp khi cài) | Socket, đọc mạng, MulticastLock cho mDNS |
| `ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION` | **Xin lúc chạy** | Chỉ để đọc SSID (Android 8.1+). Từ chối vẫn quét được; app hướng dẫn mở Cài đặt nếu bị chặn vĩnh viễn |
| `ACCESS_LOCAL_NETWORK` | Khai báo; xin lúc chạy chỉ trên Android 17+ (API 37) | Android 17 yêu cầu cho truy cập LAN khi app target API 37 (hiện target 36) |
| `NEARBY_WIFI_DEVICES` | **Không dùng** | Chỉ cần cho quét điểm phát Wi-Fi/Wi-Fi Direct, không cần cho socket LAN hay SSID |

`usesCleartextTraffic=true` (expo-build-properties) để WebView mở `http://<IP máy in>`. Các quyền thừa từ template (bộ nhớ, ghi âm,
overlay) bị loại qua `blockedPermissions`.

## 4. Chạy thử & build

### Yêu cầu
Node.js 20+, **JDK 17**, Android SDK: `platforms;android-37.0`, `build-tools;37.0.0`, `ndk;27.1.12297006`, **`cmake;3.31.6`**.
Cài Android Studio là đủ, hoặc cmdline-tools như máy build hiện tại (`D:\android-toolchain`).

> **Windows:** CMake 3.22.1 mặc định đi kèm ninja 1.10, sẽ lỗi `Filename longer than 260 characters` khi biên dịch C++ codegen.
> Config plugin `plugins/withCmakeVersion.js` ép Gradle dùng CMake 3.31.6 (ninja 1.12, hỗ trợ đường dẫn dài). Windows cần bật
> `LongPathsEnabled` (máy build hiện tại đã bật).

```bash
npm install
```

```bash
npm test
```

```bash
npm run typecheck
```

### Build APK (Windows, PowerShell)
```powershell
$env:JAVA_HOME = "D:\android-toolchain\jdk-17.0.20.1+1"
$env:ANDROID_HOME = "D:\android-toolchain\sdk"
npx expo prebuild -p android --clean
Set-Content android\local.properties "sdk.dir=D:/android-toolchain/sdk"
cd android
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
.\gradlew.bat assembleDebug -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
```
(`sdk.dir` phải dùng dấu `/`. Bỏ `-PreactNativeArchitectures` để build thêm x86/x86_64 cho emulator.)

| APK | Đường dẫn | Dùng khi |
| --- | --- | --- |
| Release (~37 MB) | `android/app/build/outputs/apk/release/app-release.apk` | **Cài cho kỹ thuật viên**: chạy độc lập (JS đã đóng gói Hermes). Ký bằng khóa riêng khi có biến môi trường `ANDROID_KEYSTORE_*` (xem SECURITY.md), nếu không thì khóa debug (chỉ để thử). |
| Debug (~75 MB) | `android/app/build/outputs/apk/debug/app-debug.apk` | Phát triển: cần Metro (`npx expo start --dev-client`) + `adb reverse tcp:8081 tcp:8081`. |

Bản build gần nhất được chép vào `apk/` (đã gitignore).

### Cài lên điện thoại thật
```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```
Hoặc chép file APK sang điện thoại và mở (bật “Cài ứng dụng không rõ nguồn gốc”).

### Kịch bản kiểm tra tại hiện trường
1. Router cấp `192.168.1.x`; đặt tĩnh một máy in `10.0.0.100/24` cắm cùng switch.
2. Mở app, cấp quyền Vị trí → thẻ mạng hiện SSID, `IP điện thoại`, `Gateway`.
3. **BẮT ĐẦU QUÉT MẠNG** → máy in `10.0.0.100` hiện viền đỏ “KHÁC SUBNET” (qua mDNS nếu máy in bật Bonjour).
4. **GỢI Ý IP MỚI** → app gợi ý `192.168.1.200`, tự kiểm tra trùng → tick xác nhận → **XÁC NHẬN ĐỔI IP**.
5. **HƯỚNG DẪN ĐỔI IP** → làm theo 6 bước, bước 6 xác minh máy in trả lời ở IP mới.

## 5. Trạng thái kiểm thử

- `npm test`: 82 unit test (IPv4/prefix/network/broadcast, cùng/khác subnet, gợi ý IP, 8 nhóm trường hợp trùng IP bắt buộc,
  trạng thái quét lỗi/thiếu quyền/đổi mạng, phân loại thiết bị, BER/SNMP, kết nối/URL quản trị).
- `tsc --noEmit` sạch.
- APK release + debug build thành công trên Windows (Gradle, JDK 17, AGP, CMake 3.31.6).
- Chưa kiểm thử trên điện thoại/máy in thật (môi trường build không có thiết bị). Cần chạy kịch bản ở mục 4 trước khi phát hành.

## 6. Việc có thể làm tiếp
- Bảng OID SNMP đã kiểm chứng theo hãng/dòng máy để không phải nhập tay.
- Giao thức dò riêng của từng hãng (ví dụ máy in hoá đơn nhiệt không có mDNS/SNMP).
- Phát hành lên Google Play (dùng khóa hiện tại làm upload key, bật Play App Signing).
