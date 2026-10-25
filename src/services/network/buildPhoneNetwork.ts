import type { PermissionState, PhoneNetwork } from '../../types';
import { isValidIPv4, isValidPrefix, maskToPrefix, prefixToMask } from '../../utils/ipv4';

/** Raw inputs, kept free of React Native so the merge logic is unit-testable. */
export type NetworkSources = {
  native: {
    sdkInt: number;
    wifiEnabled: boolean | null;
    hasWifiNetwork: boolean;
    ipAddress: string | null;
    prefixLength: number | null;
    gateway: string | null;
    dhcpServer: string | null;
  } | null;
  netInfo: {
    type: string;
    isConnected: boolean | null;
    isWifiEnabled?: boolean;
    ssid?: string | null;
    ipAddress?: string | null;
    subnet?: string | null;
  };
  sdkInt: number | null;
  locationPermission: PermissionState;
};

function cleanSsid(ssid: string | null | undefined): string | null {
  if (!ssid || ssid === '<unknown ssid>' || ssid === '0x') return null;
  return ssid.replace(/^"|"$/g, '');
}

/** Merges native LinkProperties and NetInfo; every missing field gets a human explanation. */
export function buildPhoneNetwork(src: NetworkSources, now = Date.now()): PhoneNetwork {
  const issues: string[] = [];
  const { native, netInfo } = src;

  const wifiEnabled = native?.wifiEnabled ?? netInfo.isWifiEnabled ?? null;
  const onWifi = native ? native.hasWifiNetwork : netInfo.type === 'wifi';

  if (!native) issues.push('Thiếu module native NetworkTools: không đọc được gateway, không quét TCP/SNMP được. Hãy cài bản build APK của app.');
  if (wifiEnabled === false) issues.push('Wi-Fi đang tắt. Bật Wi-Fi và kết nối mạng của cửa hàng.');
  else if (!onWifi) issues.push('Điện thoại chưa kết nối Wi-Fi. Kết nối Wi-Fi cùng mạng với máy in.');

  let ipAddress = isValidIPv4(native?.ipAddress) ? native!.ipAddress : null;
  if (!ipAddress && onWifi && isValidIPv4(netInfo.ipAddress)) ipAddress = netInfo.ipAddress!;

  let prefixLength = isValidPrefix(native?.prefixLength) ? native!.prefixLength : null;
  if (prefixLength == null && netInfo.subnet) prefixLength = maskToPrefix(netInfo.subnet);

  if (onWifi && !ipAddress) issues.push('Chưa có IPv4 trên Wi-Fi (đang nhận DHCP?). Thử tắt/bật Wi-Fi.');
  if (ipAddress && prefixLength == null) issues.push('Không đọc được subnet mask – không thể so sánh subnet.');

  const gateway = isValidIPv4(native?.gateway) ? native!.gateway : null;
  if (onWifi && ipAddress && !gateway) issues.push('Không đọc được gateway (mạng có thể không có router mặc định).');

  const ssid = onWifi ? cleanSsid(netInfo.ssid) : null;
  if (onWifi && !ssid) {
    issues.push(
      src.locationPermission === 'granted'
        ? 'Không đọc được tên Wi-Fi: hãy bật Vị trí (GPS) trong cài đặt nhanh.'
        : 'Không đọc được tên Wi-Fi: cần cấp quyền Vị trí và bật GPS.',
    );
  }

  return {
    sdkInt: native?.sdkInt ?? src.sdkInt,
    wifiEnabled,
    onWifi,
    ssid,
    ipAddress,
    prefixLength,
    subnetMask: prefixLength != null ? prefixToMask(prefixLength) : null,
    gateway,
    dhcpServer: isValidIPv4(native?.dhcpServer) ? native!.dhcpServer : null,
    locationPermission: src.locationPermission,
    nativeModuleAvailable: !!native,
    issues,
    readAt: now,
  };
}

export type ScanBlocker = { code: 'native-missing' | 'wifi-off' | 'not-on-wifi' | 'no-ip' | 'no-prefix'; message: string };

/** Decides whether a scan can start. Missing SSID or location permission never blocks scanning. */
export function scanPreflight(net: PhoneNetwork | null): { canScan: boolean; blockers: ScanBlocker[]; warnings: string[] } {
  const blockers: ScanBlocker[] = [];
  const warnings: string[] = [];
  if (!net) return { canScan: false, blockers: [{ code: 'no-ip', message: 'Chưa đọc được thông tin mạng.' }], warnings };

  if (!net.nativeModuleAvailable) {
    blockers.push({ code: 'native-missing', message: 'Ứng dụng thiếu module mạng native – cần cài bản APK đầy đủ.' });
  }
  if (net.wifiEnabled === false) blockers.push({ code: 'wifi-off', message: 'Wi-Fi đang tắt.' });
  else if (!net.onWifi) blockers.push({ code: 'not-on-wifi', message: 'Điện thoại chưa kết nối Wi-Fi.' });
  else if (!net.ipAddress) blockers.push({ code: 'no-ip', message: 'Điện thoại chưa có IPv4 trên Wi-Fi.' });
  else if (net.prefixLength == null) blockers.push({ code: 'no-prefix', message: 'Không đọc được subnet mask.' });

  if (net.locationPermission !== 'granted' && net.locationPermission !== 'not-needed') {
    warnings.push('Chưa có quyền Vị trí: vẫn quét được nhưng không hiện tên Wi-Fi.');
  }
  return { canScan: blockers.length === 0, blockers, warnings };
}

/** True when the phone moved to another network/IP since `before` (e.g. Wi-Fi switched mid-scan). */
export function networkChanged(before: PhoneNetwork, after: PhoneNetwork): boolean {
  return (
    before.onWifi !== after.onWifi ||
    before.ipAddress !== after.ipAddress ||
    before.prefixLength !== after.prefixLength
  );
}
