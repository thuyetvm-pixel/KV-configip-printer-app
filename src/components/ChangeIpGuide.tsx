import type { ReactNode } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { suggestIps } from '../services/ip-management/suggestIp';
import { colors, font, mono, radius, spacing } from '../theme';
import type { SubnetStatus, TargetNetwork } from '../types';
import { isLinkLocal, prefixToMask } from '../utils/ipv4';
import { Button } from './Button';

type Props = {
  printerIp: string;
  newIp: string;
  target: TargetNetwork;
  subnetStatus: SubnetStatus;
  adminUrl: string | null;
  adminUnavailableReason: string | null;
  verifying: boolean;
  verifyResult: string | null;
  onOpenAdmin: (url: string) => void;
  onRecheckReachability: () => void;
  onVerifyNewIp: () => void;
};

export function openWifiSettings() {
  if (Platform.OS === 'android') Linking.sendIntent('android.settings.WIFI_SETTINGS').catch(() => Linking.openSettings());
  else Linking.openSettings();
}

/**
 * Temporary static IP for the phone inside the printer's (unknown-mask) subnet, so the web admin
 * becomes reachable. The printer's mask cannot be read from here: /24 is an explicit assumption
 * (/16 for 169.254.x.x), shown as such.
 */
function tempPhoneIp(printerIp: string) {
  const prefix = isLinkLocal(printerIp) ? 16 : 24;
  const [first] = suggestIps(
    { target: { ipAddress: printerIp, prefixLength: prefix, gateway: null, ssid: null }, knownInUse: [{ ip: printerIp, reason: '' }] },
    { count: 1 },
  ).suggestions;
  return first ? { ip: first.ip, prefix, mask: prefixToMask(prefix) } : null;
}

export function ChangeIpGuide(p: Props) {
  const different = p.subnetStatus === 'different';
  const temp = different ? tempPhoneIp(p.printerIp) : null;
  const mask = prefixToMask(p.target.prefixLength);

  return (
    <View style={styles.wrap}>
      <Step n={1} title="Xác nhận IP đích và subnet">
        <Mono text={`IP mới: ${p.newIp}\nSubnet mask: ${mask} (/${p.target.prefixLength})\nGateway: ${p.target.gateway ?? 'Không xác định'}`} />
      </Step>

      <Step n={2} title="Tạm đặt IP tĩnh cho điện thoại (nếu cần)">
        {different && temp ? (
          <>
            <Text style={styles.body}>
              Máy in đang ở subnet khác ({p.printerIp}). Ứng dụng không thể tự đổi IP điện thoại (Android không cho phép), hãy làm thủ công:
            </Text>
            <Text style={styles.body}>Cài đặt → Wi-Fi → chạm biểu tượng ⚙ của mạng đang dùng → Sửa / Nâng cao → Cài đặt IP: Tĩnh.</Text>
            <Mono text={`IP: ${temp.ip}\nĐộ dài tiền tố: ${temp.prefix} (mask ${temp.mask})\nGateway: để trống`} />
            <Text style={styles.warn}>
              Giả định máy in dùng mask /{temp.prefix} – nếu trang cấu hình in từ máy in ghi mask khác, đặt theo mask đó. Trong thời gian này
              điện thoại sẽ không có Internet qua Wi-Fi.
            </Text>
            <Button title="MỞ CÀI ĐẶT WI-FI" variant="outline" onPress={openWifiSettings} />
          </>
        ) : (
          <Text style={styles.body}>Máy in cùng subnet với điện thoại – không cần đổi IP điện thoại.</Text>
        )}
      </Step>

      <Step n={3} title="Mở giao diện quản trị máy in">
        <Button
          title="MỞ TRANG QUẢN TRỊ"
          disabled={!p.adminUrl}
          onPress={() => p.adminUrl && p.onOpenAdmin(p.adminUrl)}
        />
        {!p.adminUrl && p.adminUnavailableReason ? <Text style={styles.warn}>{p.adminUnavailableReason}</Text> : null}
        <Button title="KIỂM TRA LẠI KẾT NỐI TỚI MÁY IN" variant="outline" onPress={p.onRecheckReachability} />
        <Text style={styles.body}>Không có web? Dùng bảng điều khiển trên máy in hoặc phần mềm của hãng (BRAdmin, HP Easy Start, EpsonNet Config…).</Text>
      </Step>

      <Step n={4} title="Đổi địa chỉ IP máy in">
        <Text style={styles.body}>
          Thường ở mục Network / Mạng → TCP/IP → IPv4. Chọn cấu hình Thủ công / Static, nhập:
        </Text>
        <Mono text={`IP: ${p.newIp}\nSubnet mask: ${mask}\nGateway: ${p.target.gateway ?? '(để trống)'}`} />
        <Text style={styles.body}>Lưu lại. Máy in có thể khởi động lại; trang web sẽ mất kết nối – đó là bình thường.</Text>
      </Step>

      <Step n={5} title="Khôi phục cài đặt mạng điện thoại">
        <Text style={styles.body}>Cài đặt → Wi-Fi → mạng đang dùng → Cài đặt IP: DHCP. Chờ điện thoại nhận lại IP của mạng cửa hàng.</Text>
        <Button title="MỞ CÀI ĐẶT WI-FI" variant="outline" onPress={openWifiSettings} />
      </Step>

      <Step n={6} title="Quét lại và xác minh IP mới">
        <Button title={`XÁC MINH MÁY IN TẠI ${p.newIp}`} onPress={p.onVerifyNewIp} loading={p.verifying} />
        {p.verifyResult ? <Text style={styles.result}>{p.verifyResult}</Text> : null}
      </Step>
    </View>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepHeader}>
        <Text style={styles.stepNo}>{n}</Text>
        <Text style={styles.stepTitle}>{title}</Text>
      </View>
      <View style={styles.stepBody}>{children}</View>
    </View>
  );
}

function Mono({ text }: { text: string }) {
  return (
    <Text style={styles.mono} selectable>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  step: { gap: spacing.sm },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepNo: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary,
    color: colors.onPrimary,
    textAlign: 'center',
    lineHeight: 30,
    fontWeight: '900',
    overflow: 'hidden',
  },
  stepTitle: { flex: 1, fontSize: font.body, fontWeight: '800', color: colors.text },
  stepBody: { gap: spacing.sm, paddingLeft: 38 },
  body: { fontSize: font.small, color: colors.text, lineHeight: 20 },
  warn: { fontSize: font.small, color: colors.yellow, lineHeight: 20 },
  mono: {
    backgroundColor: colors.neutralBg,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontSize: font.body,
    color: colors.text,
    lineHeight: 24,
    ...mono,
  },
  result: { fontSize: font.small, fontWeight: '700', color: colors.text },
});
