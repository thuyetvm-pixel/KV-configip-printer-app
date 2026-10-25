import { useState, type ReactNode } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  applySnmpIpChange,
  isValidOid,
  preflightSnmpConfig,
  type ApplyResult,
  type PreflightResult,
} from '../services/printer/autoConfig';
import { colors, font, mono, radius, spacing, TOUCH } from '../theme';
import type { TargetNetwork } from '../types';
import { prefixToMask } from '../utils/ipv4';
import { Button } from './Button';

type Props = {
  printerIp: string;
  newIp: string;
  target: TargetNetwork;
  onApplied: (result: ApplyResult) => void;
};

/**
 * Automatic change over SNMP SET. The community is kept only in this component's state:
 * it is never logged, stored or shown again.
 */
export function AutoConfigPanel({ printerIp, newIp, target, onApplied }: Props) {
  const [community, setCommunity] = useState('');
  const [ipOid, setIpOid] = useState('');
  const [maskOid, setMaskOid] = useState('');
  const [gatewayOid, setGatewayOid] = useState('');
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);

  const mask = prefixToMask(target.prefixLength);
  const inputsValid =
    community.length > 0 &&
    isValidOid(ipOid) &&
    (!maskOid || isValidOid(maskOid)) &&
    (!gatewayOid || isValidOid(gatewayOid));

  const resetPreflight = () => {
    setPreflight(null);
    setResult(null);
  };

  const runPreflight = async () => {
    setChecking(true);
    setResult(null);
    try {
      setPreflight(
        await preflightSnmpConfig({
          printerIp,
          community,
          oids: { ip: ipOid, mask: maskOid || undefined, gateway: gatewayOid || undefined },
        }),
      );
    } catch (e) {
      setPreflight({ ok: false, step: 'read', message: (e as Error).message });
    } finally {
      setChecking(false);
    }
  };

  const apply = () => {
    if (!preflight?.ok) return;
    const verified = preflight.oids;
    const hasGateway = verified.some((v) => v.role === 'gateway');
    Alert.alert(
      'Xác nhận đổi IP máy in',
      `IP cũ: ${printerIp}\nIP mới: ${newIp}\n` +
        `${verified.some((v) => v.role === 'mask') ? `Subnet mask: ${mask}\n` : ''}` +
        `${hasGateway ? `Gateway: ${target.gateway ?? '(không đổi)'}\n` : ''}` +
        '\nSau lệnh này, máy in sẽ mất kết nối ở IP cũ. Nếu thông số sai, có thể phải reset cấu hình mạng trên máy in.',
      [
        { text: 'Huỷ', style: 'cancel' },
        {
          text: 'ĐỔI IP',
          style: 'destructive',
          onPress: async () => {
            setApplying(true);
            try {
              const r = await applySnmpIpChange({
                printerIp,
                community,
                verified,
                newValues: { ip: newIp, mask, gateway: target.gateway ?? undefined },
              });
              setResult(r);
              onApplied(r);
            } catch (e) {
              setResult({ ok: false, message: (e as Error).message });
            } finally {
              setApplying(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.body}>
        Không có OID chuẩn nào để ghi IP máy in: nhập OID từ MIB riêng của hãng/dòng máy. Ứng dụng sẽ kiểm tra trước, không thay đổi gì cho
        đến khi bạn xác nhận.
      </Text>
      <Field label="Community có quyền ghi (không dùng mặc định)">
        <TextInput
          value={community}
          onChangeText={(t) => {
            setCommunity(t);
            resetPreflight();
          }}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
      </Field>
      <Field label="OID địa chỉ IP *">
        <OidInput value={ipOid} onChange={(t) => (setIpOid(t), resetPreflight())} />
      </Field>
      <Field label="OID subnet mask (tuỳ chọn)">
        <OidInput value={maskOid} onChange={(t) => (setMaskOid(t), resetPreflight())} />
      </Field>
      <Field label="OID gateway (tuỳ chọn)">
        <OidInput value={gatewayOid} onChange={(t) => (setGatewayOid(t), resetPreflight())} />
      </Field>

      <Button title="KIỂM TRA KHẢ NĂNG CẤU HÌNH" variant="outline" onPress={runPreflight} loading={checking} disabled={!inputsValid} />

      {preflight && !preflight.ok ? (
        <Text style={[styles.result, { color: colors.red }]}>✗ Không thể cấu hình tự động: {preflight.message}</Text>
      ) : null}
      {preflight?.ok ? (
        <View style={styles.okBox}>
          <Text style={[styles.result, { color: colors.green }]}>✓ Đã xác minh:</Text>
          {preflight.oids.map((o) => (
            <Text key={o.oid} style={styles.mono}>
              {o.role}: {o.oid} = {o.currentValue} ({o.type === 'ip' ? 'IpAddress' : 'OctetString'}) – ghi thử thành công
            </Text>
          ))}
          <Button title="THỬ CẤU HÌNH TỰ ĐỘNG" variant="danger" onPress={apply} loading={applying} />
        </View>
      ) : null}

      {result ? (
        <Text style={[styles.result, { color: result.ok ? (result.verified ? colors.green : colors.yellow) : colors.red }]}>
          {result.ok ? (result.verified ? '✓ ' : '⚠ ') : '✗ '}
          {result.message}
        </Text>
      ) : null}
    </View>
  );
}

function OidInput({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  return (
    <TextInput
      value={value}
      onChangeText={(t) => onChange(t.replace(/[^0-9.]/g, ''))}
      placeholder="1.3.6.1.4.1.…"
      keyboardType="numbers-and-punctuation"
      autoCapitalize="none"
      style={[styles.input, mono]}
    />
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  body: { fontSize: font.small, color: colors.textMuted, lineHeight: 20 },
  label: { fontSize: font.tiny, fontWeight: '700', color: colors.textMuted },
  input: {
    minHeight: TOUCH,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    fontSize: font.body,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  okBox: { gap: spacing.sm },
  mono: { fontSize: font.tiny, color: colors.text, ...mono },
  result: { fontSize: font.small, fontWeight: '700', lineHeight: 20 },
});
