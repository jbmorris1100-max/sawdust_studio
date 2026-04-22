import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Vibration,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { supabase } from '../lib/supabase';

// ── Design tokens ─────────────────────────────────────────────
const C = {
  bg:           '#0d0d0d',
  surface:      '#141414',
  input:        '#1a1a1a',
  border:       '#2a2a2a',
  text:         '#e5e5e5',
  muted:        '#555555',
  accent:       '#f59e0b',
  accentDark:   '#d97706',
  success:      '#22c55e',
  successBg:    '#0a1f10',
  successBorder:'#14532d',
  error:        '#ef4444',
  errorBg:      '#1f0a0a',
  errorBorder:  '#450a0a',
};

// ── Toast ─────────────────────────────────────────────────────
const Toast = ({ visible, success, message }) => {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.delay(1800),
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          opacity,
          backgroundColor: success ? C.successBg  : C.errorBg,
          borderColor:     success ? C.successBorder : C.errorBorder,
        },
      ]}
      pointerEvents="none"
    >
      <Ionicons
        name={success ? 'checkmark-circle' : 'alert-circle'}
        size={16}
        color={success ? C.success : C.error}
        style={{ marginRight: 6 }}
      />
      <Text style={[styles.toastText, { color: success ? C.success : C.error }]}>
        {message}
      </Text>
    </Animated.View>
  );
};

// ── Scanner overlay with amber corner brackets ────────────────
const ScannerOverlay = () => (
  <View style={StyleSheet.absoluteFill} pointerEvents="none">
    <View style={styles.overlayTop} />
    <View style={styles.overlayMiddleRow}>
      <View style={styles.overlaySide} />
      <View style={styles.viewfinder}>
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />
      </View>
      <View style={styles.overlaySide} />
    </View>
    <View style={styles.overlayBottom}>
      <Text style={styles.scanHint}>Align barcode within the frame</Text>
    </View>
  </View>
);

// ── Main Screen ───────────────────────────────────────────────
export default function PartsScreen({ route }) {
  const { userName, userDept } = route.params ?? {};

  const [permission, requestPermission] = useCameraPermissions();
  const dept = userDept ?? '';
  const [scanning,    setScanning]    = useState(true);
  const [scannedPart, setScannedPart] = useState('');
  const [manualEntry, setManualEntry] = useState(false);
  const [manualPart,  setManualPart]  = useState('');
  const [jobId,       setJobId]       = useState('');
  const [saving,      setSaving]      = useState(false);
  const [toast,       setToast]       = useState({ visible: false, success: true, message: '' });
  const [recentScans, setRecentScans] = useState([]);

  const cooldownRef = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  useEffect(() => { fetchRecent(); }, []);

  const fetchRecent = async () => {
    const { data } = await supabase
      .from('part_scans')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);
    if (data) setRecentScans(data);
  };

  const handleBarCodeScanned = ({ data }) => {
    if (cooldownRef.current || !scanning) return;
    cooldownRef.current = true;
    Vibration.vibrate(80);
    setScannedPart(data);
    setScanning(false);
    setTimeout(() => { cooldownRef.current = false; }, 3000);
  };

  const handleRescan = () => {
    setScannedPart('');
    setManualPart('');
    setScanning(true);
  };

  const showToast = (success, message) => {
    setToast({ visible: true, success, message });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 2500);
  };

  const handleSubmit = async () => {
    const partNum = (manualEntry ? manualPart : scannedPart).trim();
    if (!partNum || !dept) return;
    setSaving(true);

    const { data, error } = await supabase
      .from('part_scans')
      .insert({ part_num: partNum, dept, job_id: jobId.trim() || null, scanned_by: userName ?? 'Unknown' })
      .select()
      .single();

    setSaving(false);

    if (error) {
      showToast(false, 'Failed to log scan. Try again.');
    } else {
      showToast(true, `Part ${partNum} logged`);
      setRecentScans((prev) => [data, ...prev].slice(0, 5));
      setJobId('');
      setManualPart('');
      setScannedPart('');
      setScanning(true);
    }
  };

  const partNum = manualEntry ? manualPart : scannedPart;
  const canLog  = partNum.trim().length > 0 && dept.length > 0 && !saving;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Scan Part</Text>
            {userName ? <Text style={styles.headerSub}>{userName}</Text> : null}
          </View>

          {/* Camera / Manual toggle */}
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeBtn, !manualEntry && styles.modeBtnActive]}
              onPress={() => { setManualEntry(false); setScanning(true); }}
            >
              <Ionicons
                name="camera-outline"
                size={16}
                color={!manualEntry ? '#000' : C.muted}
                style={{ marginRight: 5 }}
              />
              <Text style={[styles.modeBtnText, !manualEntry && styles.modeBtnTextActive]}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, manualEntry && styles.modeBtnActive]}
              onPress={() => { setManualEntry(true); setScanning(false); }}
            >
              <Ionicons
                name="create-outline"
                size={16}
                color={manualEntry ? '#000' : C.muted}
                style={{ marginRight: 5 }}
              />
              <Text style={[styles.modeBtnText, manualEntry && styles.modeBtnTextActive]}>Manual Entry</Text>
            </TouchableOpacity>
          </View>

          {/* Camera mode */}
          {!manualEntry && (
            <View style={styles.cameraSection}>
              {!permission?.granted && (
                <View style={styles.cameraPlaceholder}>
                  {!permission || permission.canAskAgain ? (
                    <>
                      <ActivityIndicator size="large" color={C.accent} />
                      <Text style={styles.cameraMsg}>Requesting camera access…</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="camera-off-outline" size={40} color={C.border} />
                      <Text style={styles.cameraMsg}>Camera permission denied.</Text>
                      <TouchableOpacity
                        style={styles.fallbackBtn}
                        onPress={() => setManualEntry(true)}
                      >
                        <Text style={styles.fallbackBtnText}>Use Manual Entry</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              )}

              {permission?.granted && (
                scanning ? (
                  <View style={styles.scannerWrap}>
                    <CameraView
                      style={StyleSheet.absoluteFill}
                      facing="back"
                      barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'ean8', 'upc_a', 'upc_e', 'pdf417', 'aztec', 'datamatrix'] }}
                      onBarcodeScanned={handleBarCodeScanned}
                    />
                    <ScannerOverlay />
                  </View>
                ) : (
                  <View style={styles.scannedWrap}>
                    <View style={styles.scannedIconWrap}>
                      <Ionicons name="checkmark-circle" size={36} color={C.success} />
                    </View>
                    <Text style={styles.scannedLabel}>Scanned</Text>
                    <Text style={styles.scannedValue}>{scannedPart}</Text>
                    <TouchableOpacity style={styles.rescanBtn} onPress={handleRescan}>
                      <Ionicons name="refresh-outline" size={15} color={C.muted} style={{ marginRight: 4 }} />
                      <Text style={styles.rescanBtnText}>Scan Again</Text>
                    </TouchableOpacity>
                  </View>
                )
              )}
            </View>
          )}

          {/* Manual entry mode */}
          {manualEntry && (
            <View style={styles.manualSection}>
              <Text style={styles.sectionLabel}>Part Number</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter part number…"
                placeholderTextColor={C.muted}
                value={manualPart}
                onChangeText={setManualPart}
                autoCapitalize="characters"
                autoFocus
              />
            </View>
          )}

          {/* Job # */}
          <Text style={[styles.sectionLabel, { marginTop: 16 }]}>Job # (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. J-1042"
            placeholderTextColor={C.muted}
            value={jobId}
            onChangeText={setJobId}
          />

          {/* Submit */}
          <TouchableOpacity
            style={[styles.logBtn, !canLog && styles.logBtnDisabled]}
            onPress={handleSubmit}
            disabled={!canLog}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator size="small" color="#000" />
              : <>
                  <Ionicons name="checkmark" size={20} color="#000" style={{ marginRight: 6 }} />
                  <Text style={styles.logBtnText}>Log Part</Text>
                </>
            }
          </TouchableOpacity>

          {/* Recent scans */}
          {recentScans.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Recent Scans</Text>
              {recentScans.map((scan) => (
                <View key={scan.id} style={styles.recentRow}>
                  <View style={styles.recentIconWrap}>
                    <Ionicons name="barcode-outline" size={18} color={C.muted} />
                  </View>
                  <View style={styles.recentLeft}>
                    <Text style={styles.recentPart}>{scan.part_num}</Text>
                    <Text style={styles.recentMeta}>
                      {scan.dept}
                      {scan.job_id ? ` · Job #${scan.job_id}` : ''}
                      {' · '}{scan.scanned_by}
                    </Text>
                  </View>
                  <Text style={styles.recentTime}>
                    {new Date(scan.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Toast visible={toast.visible} success={toast.success} message={toast.message} />
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────
const VIEWFINDER_SIZE = 230;
const CORNER_SIZE     = 22;
const CORNER_WIDTH    = 3;

const styles = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: C.bg },
  flex:          { flex: 1 },
  scrollContent: { paddingHorizontal: 18, paddingBottom: 40 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    marginBottom: 20,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  headerSub:   { fontSize: 13, color: C.muted },

  // Section label
  sectionLabel: {
    fontSize: 11,
    color: C.muted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginBottom: 10,
  },

  // Mode toggle
  modeRow: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 3,
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: C.border,
    gap: 3,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 9,
  },
  modeBtnActive:     { backgroundColor: C.accent },
  modeBtnText:       { fontSize: 14, fontWeight: '600', color: C.muted },
  modeBtnTextActive: { color: '#000' },

  // Camera
  cameraSection: { marginBottom: 20 },
  cameraPlaceholder: {
    height: VIEWFINDER_SIZE + 60,
    backgroundColor: C.surface,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: C.border,
    gap: 14,
  },
  cameraMsg: { color: C.muted, fontSize: 14 },
  scannerWrap: {
    height: VIEWFINDER_SIZE + 80,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },

  // Overlay
  overlayTop:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  overlayMiddleRow: { flexDirection: 'row', height: VIEWFINDER_SIZE },
  overlaySide:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  overlayBottom: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    paddingTop: 14,
  },
  scanHint: { color: 'rgba(255,255,255,0.55)', fontSize: 13, fontWeight: '500' },

  // Viewfinder
  viewfinder: { width: VIEWFINDER_SIZE, height: VIEWFINDER_SIZE, position: 'relative' },
  corner:     { position: 'absolute', width: CORNER_SIZE, height: CORNER_SIZE, borderColor: C.accent },
  cornerTL: { top: 0, left: 0,     borderTopWidth: CORNER_WIDTH,    borderLeftWidth: CORNER_WIDTH,  borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0,    borderTopWidth: CORNER_WIDTH,    borderRightWidth: CORNER_WIDTH, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0,  borderBottomWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH,  borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH, borderBottomRightRadius: 4 },

  // Scanned result
  scannedWrap: {
    height: VIEWFINDER_SIZE + 80,
    backgroundColor: C.surface,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: C.border,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  scannedIconWrap: { marginBottom: 4 },
  scannedLabel: { fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, fontWeight: '700' },
  scannedValue: { fontSize: 26, fontWeight: '800', color: C.text, letterSpacing: 1 },
  rescanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: C.input,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  rescanBtnText: { color: C.muted, fontSize: 14, fontWeight: '600' },

  // Fallback
  fallbackBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: C.accent,
    backgroundColor: '#1a1200',
  },
  fallbackBtnText: { color: C.accent, fontSize: 14, fontWeight: '700' },

  // Manual
  manualSection: { marginBottom: 4 },
  input: {
    backgroundColor: C.input,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.border,
    color: C.text,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 18,
  },

  // Log button
  logBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: C.accent,
    borderRadius: 14,
    paddingVertical: 17,
    marginBottom: 28,
    shadowColor: C.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  logBtnDisabled: { opacity: 0.4, shadowOpacity: 0 },
  logBtnText: { color: '#000', fontSize: 17, fontWeight: '700' },

  // Recent scans
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    gap: 10,
  },
  recentIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: C.input,
    borderWidth: 1,
    borderColor: C.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  recentLeft: { flex: 1 },
  recentPart: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 2 },
  recentMeta: { fontSize: 12, color: C.muted },
  recentTime: { fontSize: 12, color: C.muted },

  // Toast
  toast: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 24,
    borderWidth: 1,
    maxWidth: '80%',
  },
  toastText: { fontSize: 14, fontWeight: '700' },
});
