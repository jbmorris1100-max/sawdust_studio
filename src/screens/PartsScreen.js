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
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { supabase } from '../lib/supabase';

// SQL migration for new columns (run once in Supabase SQL editor):
// ALTER TABLE part_scans ADD COLUMN IF NOT EXISTS status text;
// ALTER TABLE part_scans ADD COLUMN IF NOT EXISTS next_dept text;
// ALTER TABLE part_scans ADD COLUMN IF NOT EXISTS notes text;
// ALTER TABLE part_scans ADD COLUMN IF NOT EXISTS job_id text;

const DEPARTMENTS = ['Production', 'Assembly', 'Finishing', 'Craftsman'];

const QC_STATUSES = [
  'In Progress',
  'QC Check',
  'Passed QC',
  'Failed QC — Rework',
  'Moving to Next Stage',
];

const STATUS_COLORS = {
  'In Progress':          '#f59e0b',
  'QC Check':             '#3b82f6',
  'Passed QC':            '#22c55e',
  'Failed QC — Rework':   '#ef4444',
  'Moving to Next Stage': '#a78bfa',
};

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
  green:        '#22c55e',
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

// ── QC Modal ──────────────────────────────────────────────────
function QCModal({ visible, partNum, dept, jobId, onJobIdChange, onClose, onSubmit, saving }) {
  const [status,   setStatus]   = useState('In Progress');
  const [nextDept, setNextDept] = useState('');
  const [notes,    setNotes]    = useState('');

  useEffect(() => {
    if (visible) {
      setStatus('In Progress');
      setNextDept('');
      setNotes('');
    }
  }, [visible]);

  const otherDepts = DEPARTMENTS.filter((d) => d !== dept);

  const handleSubmit = () => onSubmit({ status, nextDept: nextDept || null, notes: notes.trim() || null });
  const handleApprove = () => onSubmit({ status: 'approved_incoming', nextDept: null, notes: notes.trim() || null });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.qcOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.qcBox}>
          <View style={styles.qcHeader}>
            <View>
              <Text style={styles.qcTitle}>QC Update</Text>
              <Text style={styles.qcSubtitle}>{partNum}</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color={C.muted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Current stage */}
            <View style={styles.qcStageRow}>
              <Ionicons name="location-outline" size={14} color={C.muted} />
              <Text style={styles.qcStageText}>Current stage: <Text style={{ color: C.accent }}>{dept}</Text></Text>
            </View>

            {/* Job # */}
            <Text style={styles.qcFieldLabel}>Job # (optional)</Text>
            <TextInput
              style={styles.qcInput}
              placeholder="e.g. J-1042"
              placeholderTextColor={C.muted}
              value={jobId}
              onChangeText={onJobIdChange}
            />

            {/* Status selector */}
            <Text style={styles.qcFieldLabel}>Status</Text>
            <View style={styles.qcChipRow}>
              {QC_STATUSES.map((s) => {
                const active = status === s;
                const col = STATUS_COLORS[s] ?? C.muted;
                return (
                  <TouchableOpacity
                    key={s}
                    style={[styles.qcChip, active && { backgroundColor: col + '22', borderColor: col }]}
                    onPress={() => setStatus(s)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.qcChipText, active && { color: col }]}>{s}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Next stage picker */}
            <Text style={styles.qcFieldLabel}>Send to next stage (optional)</Text>
            <View style={styles.qcChipRow}>
              {otherDepts.map((d) => {
                const active = nextDept === d;
                return (
                  <TouchableOpacity
                    key={d}
                    style={[styles.qcChip, active && { backgroundColor: C.accent + '22', borderColor: C.accent }]}
                    onPress={() => setNextDept(active ? '' : d)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.qcChipText, active && { color: C.accent }]}>{d}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Notes */}
            <Text style={styles.qcFieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.qcInput, { minHeight: 72, textAlignVertical: 'top', paddingTop: 10 }]}
              placeholder="Any issues, defects, or comments…"
              placeholderTextColor={C.muted}
              value={notes}
              onChangeText={setNotes}
              multiline
            />

            {/* Approve incoming button */}
            <TouchableOpacity
              style={[styles.approveBtn, saving && { opacity: 0.5 }]}
              onPress={handleApprove}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator size="small" color="#000" />
                : <>
                    <Ionicons name="checkmark-done-outline" size={18} color="#000" style={{ marginRight: 6 }} />
                    <Text style={styles.approveBtnText}>Approve Incoming Part</Text>
                  </>
              }
            </TouchableOpacity>

            {/* Submit with status */}
            <TouchableOpacity
              style={[styles.submitBtn, saving && { opacity: 0.5 }]}
              onPress={handleSubmit}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator size="small" color="#000" />
                : <Text style={styles.submitBtnText}>Log Part — {status}</Text>
              }
            </TouchableOpacity>

            <View style={{ height: 20 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

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
  const [qcVisible,   setQcVisible]   = useState(false);

  const cooldownRef = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  useEffect(() => { fetchRecent(); }, []);

  const fetchRecent = async () => {
    if (!dept) return;
    const { data } = await supabase
      .from('part_scans')
      .select('*')
      .eq('dept', dept)
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
    setQcVisible(true);
    setTimeout(() => { cooldownRef.current = false; }, 3000);
  };

  const handleRescan = () => {
    setScannedPart('');
    setManualPart('');
    setJobId('');
    setScanning(true);
    setQcVisible(false);
  };

  const showToast = (success, message) => {
    setToast({ visible: true, success, message });
    setTimeout(() => setToast((t) => ({ ...t, visible: false })), 2500);
  };

  const handleOpenQC = () => {
    const partNum = manualEntry ? manualPart : scannedPart;
    if (!partNum.trim() || !dept) return;
    setQcVisible(true);
  };

  const handleQcSubmit = async ({ status, nextDept, notes }) => {
    const partNum = (manualEntry ? manualPart : scannedPart).trim();
    if (!partNum || !dept) return;
    setSaving(true);

    const { data, error } = await supabase
      .from('part_scans')
      .insert({
        part_num:   partNum,
        dept,
        job_id:     jobId.trim() || null,
        scanned_by: userName ?? 'Unknown',
        status,
        next_dept:  nextDept || null,
        notes:      notes || null,
      })
      .select()
      .single();

    setSaving(false);

    if (error) {
      showToast(false, 'Failed to log scan. Try again.');
    } else {
      const label = status === 'approved_incoming' ? 'Approved' : 'Part logged';
      showToast(true, `${label}: ${partNum}`);
      setRecentScans((prev) => [data, ...prev].slice(0, 5));
      setJobId('');
      setManualPart('');
      setScannedPart('');
      setScanning(true);
      setQcVisible(false);
    }
  };

  const partNum = manualEntry ? manualPart : scannedPart;
  const canOpenQC = partNum.trim().length > 0 && dept.length > 0 && !saving;

  const statusColor = (s) => {
    if (s === 'Passed QC' || s === 'approved_incoming') return C.success;
    if (s === 'Failed QC — Rework') return C.error;
    return C.accent;
  };

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
            {userName ? <Text style={styles.headerSub}>{userName} · {dept}</Text> : null}
          </View>

          {/* Camera / Manual toggle */}
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeBtn, !manualEntry && styles.modeBtnActive]}
              onPress={() => { setManualEntry(false); setScanning(true); setQcVisible(false); }}
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
              onPress={() => { setManualEntry(true); setScanning(false); setQcVisible(false); }}
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
                    <TouchableOpacity
                      style={[styles.openQcBtn, { marginTop: 10 }]}
                      onPress={() => setQcVisible(true)}
                    >
                      <Ionicons name="clipboard-outline" size={15} color={C.accent} style={{ marginRight: 6 }} />
                      <Text style={styles.openQcBtnText}>Open QC Form</Text>
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
          <Text style={[styles.sectionLabel, { marginTop: manualEntry ? 4 : 16 }]}>Job # (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. J-1042"
            placeholderTextColor={C.muted}
            value={jobId}
            onChangeText={setJobId}
          />

          {/* Log Part → opens QC form */}
          {manualEntry && (
            <TouchableOpacity
              style={[styles.logBtn, !canOpenQC && styles.logBtnDisabled]}
              onPress={handleOpenQC}
              disabled={!canOpenQC}
              activeOpacity={0.85}
            >
              <Ionicons name="clipboard-outline" size={20} color="#000" style={{ marginRight: 6 }} />
              <Text style={styles.logBtnText}>Log Part with QC</Text>
            </TouchableOpacity>
          )}

          {/* Recent scans */}
          {recentScans.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Recent Scans</Text>
              {recentScans.map((scan) => {
                const sc = statusColor(scan.status);
                return (
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
                      {scan.status ? (
                        <Text style={[styles.recentStatus, { color: sc }]}>{scan.status}</Text>
                      ) : null}
                    </View>
                    <Text style={styles.recentTime}>
                      {new Date(scan.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                );
              })}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <QCModal
        visible={qcVisible}
        partNum={partNum || scannedPart}
        dept={dept}
        jobId={jobId}
        onJobIdChange={setJobId}
        onClose={() => { setQcVisible(false); if (!manualEntry && !scannedPart) setScanning(true); }}
        onSubmit={handleQcSubmit}
        saving={saving}
      />

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
  openQcBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: C.accent + '18',
    borderWidth: 1.5,
    borderColor: C.accent + '60',
  },
  openQcBtnText: { color: C.accent, fontSize: 14, fontWeight: '600' },

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
  recentPart:   { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 2 },
  recentMeta:   { fontSize: 12, color: C.muted },
  recentStatus: { fontSize: 11, fontWeight: '700', marginTop: 2 },
  recentTime:   { fontSize: 12, color: C.muted },

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

  // QC Modal
  qcOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'flex-end',
  },
  qcBox: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
    maxHeight: '92%',
  },
  qcHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  qcTitle:    { fontSize: 18, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  qcSubtitle: { fontSize: 13, color: C.accent, fontWeight: '700', marginTop: 3 },
  qcStageRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    marginBottom: 14, backgroundColor: C.input,
    borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12,
  },
  qcStageText: { fontSize: 13, color: C.muted },
  qcFieldLabel: {
    fontSize: 10, fontWeight: '700', color: C.muted,
    letterSpacing: 0.9, textTransform: 'uppercase',
    marginBottom: 8, marginTop: 14,
  },
  qcInput: {
    backgroundColor: C.input,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.border,
    color: C.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 4,
  },
  qcChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  qcChip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, backgroundColor: C.input,
    borderWidth: 1.5, borderColor: C.border,
  },
  qcChipText: { fontSize: 12, fontWeight: '600', color: C.muted },

  approveBtn: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    backgroundColor: C.success, borderRadius: 14,
    paddingVertical: 15, marginTop: 18,
  },
  approveBtnText: { color: '#000', fontSize: 15, fontWeight: '700' },

  submitBtn: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    backgroundColor: C.accent, borderRadius: 14,
    paddingVertical: 15, marginTop: 10,
  },
  submitBtnText: { color: '#000', fontSize: 15, fontWeight: '700' },
});
