import { Linking, PermissionsAndroid, Platform, type Permission } from 'react-native';
import type { PermissionState } from '../../types';

/**
 * Runtime permissions this app asks for. Everything else in the manifest is an install-time
 * ("normal") permission: INTERNET, ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE, CHANGE_WIFI_MULTICAST_STATE.
 *
 * - ACCESS_FINE_LOCATION: Android 8.1+ hides the Wi-Fi SSID without it (and without location services on).
 *   Scanning itself works without it.
 * - ACCESS_LOCAL_NETWORK: only enforced for apps targeting Android 17 (API 37); requested on such devices.
 * - NEARBY_WIFI_DEVICES is not used: it covers Wi-Fi scanning / Wi-Fi Direct, not LAN sockets or the SSID.
 */
const LOCAL_NETWORK = 'android.permission.ACCESS_LOCAL_NETWORK' as Permission;

function toState(result: string | undefined): PermissionState {
  if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
  if (result === PermissionsAndroid.RESULTS.DENIED) return 'denied';
  return 'unknown';
}

export async function getLocationPermission(): Promise<PermissionState> {
  if (Platform.OS !== 'android') return 'not-needed';
  const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  return granted ? 'granted' : 'denied';
}

export async function requestLocationPermission(): Promise<PermissionState> {
  if (Platform.OS !== 'android') return 'not-needed';
  // Android 12+ requires FINE and COARSE to be requested together.
  const result = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
  ]);
  return toState(result[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION]);
}

export async function requestLocalNetworkPermission(): Promise<PermissionState> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 37) return 'not-needed';
  try {
    return toState(await PermissionsAndroid.request(LOCAL_NETWORK));
  } catch {
    return 'unknown';
  }
}

export function openAppSettings(): Promise<void> {
  return Linking.openSettings();
}
