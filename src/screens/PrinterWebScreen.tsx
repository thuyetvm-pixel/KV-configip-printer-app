import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Button } from '../components/Button';
import { colors, mono, spacing } from '../theme';

type Props = {
  url: string | null;
  onClose: () => void;
};

/** Embedded browser for the printer's web admin (plain HTTP is allowed via usesCleartextTraffic). */
export function PrinterWebScreen({ url, onClose }: Props) {
  const insets = useSafeAreaInsets();
  // WebView<P = undefined> resolves its props to `never` with recent TypeScript; pass an empty P.
  const webRef = useRef<WebView<object>>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  if (!url) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.bar}>
          <Pressable onPress={onClose} hitSlop={10}>
            <Text style={styles.action}>Đóng</Text>
          </Pressable>
          <Text style={styles.url} numberOfLines={1}>
            {url}
          </Text>
          <Pressable
            onPress={() => {
              setError(null);
              webRef.current?.reload();
            }}
            hitSlop={10}
          >
            <Text style={styles.action}>Tải lại</Text>
          </Pressable>
        </View>

        {error ? (
          <View style={styles.error}>
            <Text style={styles.errorTitle}>Không mở được trang cấu hình</Text>
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.errorText}>
              Nếu máy in đang khác dải IP, hãy đặt IP tĩnh cho điện thoại theo HƯỚNG DẪN ĐỔI IP (bước 2) rồi thử lại. Một số
              máy in chỉ mở HTTPS với chứng chỉ tự ký – hãy thử trình duyệt ngoài.
            </Text>
            <Button title="Mở bằng trình duyệt ngoài" variant="outline" onPress={() => Linking.openURL(url)} />
          </View>
        ) : (
          <WebView<object>
            ref={webRef}
            source={{ uri: url }}
            style={{ flex: 1 }}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={(e) => setError(`${e.nativeEvent.description} (mã ${e.nativeEvent.code})`)}
            onHttpError={(e) => setError(`HTTP ${e.nativeEvent.statusCode}`)}
            mixedContentMode="always"
            setSupportMultipleWindows={false}
            originWhitelist={['*']}
          />
        )}
        {loading && !error ? <ActivityIndicator style={styles.spinner} size="large" color={colors.primary} /> : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  action: { color: colors.primary, fontWeight: '700' },
  url: { flex: 1, color: colors.textMuted, fontSize: 13, ...mono },
  spinner: { position: 'absolute', top: '50%', alignSelf: 'center' },
  error: { padding: spacing.xl, gap: spacing.md },
  errorTitle: { fontSize: 17, fontWeight: '800', color: colors.red },
  errorText: { color: colors.text, fontSize: 14, lineHeight: 20 },
});
