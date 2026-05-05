import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  SafeAreaView, StatusBar, KeyboardAvoidingView, Platform, Vibration,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { supabase } from '../lib/supabase';
import {
  lookupPartByNumber, extractWorkOrderContext,
  getEmployeeId, getLaborItemId, logTimeEntry,
  markPartScanned, applyWorkOrderTag, getWorkOrdersByProjectNumber,
} from '../lib/innergy';
import { setSyncStatus } from '../lib/syncQueue';

const CURRENT_TASK_KEY = '@sawdust_current_task';
const JOB_NUM_RE       = /^P-\d{2}-\d{4}$/i;

const C = {
  bg:            '#0d0d0d',
  surface:       '#141414',
  input:         '#1a1a1a',
  border:        '#2a2a2a',
  text:          '#e5e5e5',
  muted:         '#555555',
  accent:        '#f59e0b',
  success:       '#22c55e',
  successBg:     '#0a1f10',
  successBorder: '#14532d',
};

const VIEWFINDER = 240;
const C_SIZE     = 24;
const C_WIDTH    = 3;

const ScannerOverlay = () => (
  <View style={StyleSheet.absoluteFill} pointerEvents="none">
    <View style={s.overlayTop} />
    <View style={s.overlayRow}>
      <View style={s.overlaySide} />
      <View style={s.viewfinder}>
        <View style={[s.corner, s.cornerTL]} />
        <View style={[s.corner, s.cornerTR]} />
        <View style={[s.corner, s.cornerBL]} />
        <View style={[s.corner, s.cornerBR]} />
      </View>
      <View style={s.overlaySide} />
    </View>
    <View style={s.overlayBottom}>
      <Text style={s.scanHint}>Align code within frame</Text>
    </View>
  </View>
);

const ConfirmCard = ({ data }) => (
  <View style={s.confirmCard}>
    <Text style={s.confirmCheck}>✅ LOGGED IN</Text>
    <Text style={s.confirmJob}>{data.jobName || data.workOrderName || data.raw}</Text>
    {data.workOrderName && data.jobName
      ? <Text style={s.confirmWO}>{data.workOrderName}</Text>
      : null}
    {data.dept ? <Text style={s.confirmDept}>{data.dept}</Text> : null}
    <Text style={s.confirmTime}>
      {new Date(data.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    </Text>
  </View>
);

export default function PartsScreen({ route }) {
  const [userName, setUserName] = useState(route.params?.userName ?? '');
  const [userDept, setUserDept] = useState(route.params?.userDept ?? '');

  const [permission, requestPermission] = useCameraPermissions();
  const [scanning,   setScanning]   = useState(true);
  const [processing, setProcessing] = useState(false);
  const [confirmed,  setConfirmed]  = useState(null);
  const [jobInput,   setJobInput]   = useState('');
  const [syncOk,     setSyncOk]     = useState(true);

  const cooldown     = useRef(false);
  const confirmTimer = useRef(null);

  useEffect(() => {
    AsyncStorage.multiGet(['@sawdust_user_name', '@sawdust_user_dept']).then(pairs => {
      const n = pairs[0][1]; const d = pairs[1][1];
      if (n && !userName) setUserName(n);
      if (d && !userDept) setUserDept(d);
    });
  }, []);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) requestPermission();
  }, [permission]);

  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
  }, []);

  const showConfirmation = (data) => {
    setConfirmed(data);
    confirmTimer.current = setTimeout(() => {
      setConfirmed(null);
      setScanning(true);
    }, 3000);
  };

  const processPartScan = async (value) => {
    if (processing) return;
    setProcessing(true);
    Vibration.vibrate(80);
    const now = new Date().toISOString();

    try {
      // 1 – Identify the part / work order
      let ctx = null;
      if (JOB_NUM_RE.test(value.trim())) {
        const wos = await getWorkOrdersByProjectNumber(value.trim());
        const wo  = wos?.[0];
        if (wo) {
          ctx = {
            workOrderId:   wo.Id ?? wo.WorkOrderId,
            workOrderName: wo.Name ?? wo.WorkOrderName ?? wo.WoNumber ?? '',
            jobName:       wo.ProjectName ?? wo.JobName ?? '',
            dept:          wo.Dept ?? wo.DeptName ?? '',
            itemId:        null,
          };
        }
      } else {
        const item = await lookupPartByNumber(value.trim());
        ctx = extractWorkOrderContext(item);
      }

      let innergyOk = true;

      if (ctx?.workOrderId) {
        // 2 – Resolve IDs (cached after first call)
        const [empId, laborId] = await Promise.all([
          userName ? getEmployeeId(userName) : Promise.resolve(null),
          userDept ? getLaborItemId(userDept) : Promise.resolve(null),
        ]);

        // 3 – Close previous time entry
        const raw = await AsyncStorage.getItem(CURRENT_TASK_KEY);
        if (raw) {
          const prev  = JSON.parse(raw);
          const eId   = empId ?? prev.employeeId;
          if (eId && prev.workOrderId && prev.startedAt) {
            const r = await logTimeEntry({
              employeeId:  eId,
              workOrderId: prev.workOrderId,
              laborItemId: prev.laborItemId ?? laborId,
              startTime:   prev.startedAt,
              endTime:     now,
            });
            if (!r) innergyOk = false;
          }
        }

        // 4 – Persist new current task
        await AsyncStorage.setItem(CURRENT_TASK_KEY, JSON.stringify({
          workOrderId:   ctx.workOrderId,
          workOrderName: ctx.workOrderName,
          jobName:       ctx.jobName,
          dept:          ctx.dept || userDept,
          startedAt:     now,
          employeeId:    empId ?? null,
          laborItemId:   laborId ?? null,
          employeeName:  userName,
        }));

        // 5 – Mark scanned + tag (best-effort)
        const [markRes, tagRes] = await Promise.all([
          markPartScanned(ctx.workOrderId, ctx.itemId),
          applyWorkOrderTag(ctx.workOrderId, 'App: In Production'),
        ]);
        if (!markRes || !tagRes) innergyOk = false;
      } else {
        innergyOk = false;
      }

      // 6 – Always save to Supabase
      await supabase.from('part_scans').insert({
        part_num:   value.trim(),
        dept:       userDept || '',
        job_id:     ctx?.jobName  || null,
        scanned_by: userName      || 'Unknown',
        status:     'In Production',
        notes:      ctx?.workOrderName || null,
      }).catch(() => {});

      await setSyncStatus(innergyOk);
      setSyncOk(innergyOk);

      showConfirmation({
        raw:           value,
        jobName:       ctx?.jobName       || '',
        workOrderName: ctx?.workOrderName || '',
        dept:          ctx?.dept          || userDept || '',
        time:          now,
      });
    } catch (_) {
      await setSyncStatus(false);
      setSyncOk(false);
      showConfirmation({ raw: value, jobName: '', workOrderName: '', dept: userDept || '', time: now });
    } finally {
      setProcessing(false);
    }
  };

  const handleBarCodeScanned = ({ data }) => {
    if (cooldown.current || !scanning || processing) return;
    cooldown.current = true;
    setScanning(false);
    processPartScan(data);
    setTimeout(() => { cooldown.current = false; }, 4000);
  };

  const handleJobSubmit = () => {
    const val = jobInput.trim();
    if (!val || processing) return;
    setJobInput('');
    processPartScan(val);
  };

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <View style={s.header}>
        <Text style={s.headerTitle}>Scan Part</Text>
        <View style={s.headerRight}>
          {userName ? <Text style={s.headerSub}>{userName}</Text> : null}
          <View style={[s.syncDot, syncOk ? s.syncGreen : s.syncRed]} />
        </View>
      </View>

      {confirmed ? (
        <View style={s.confirmOverlay}>
          <ConfirmCard data={confirmed} />
          <Text style={s.confirmDismiss}>Dismissing in 3 seconds…</Text>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={s.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={24}
        >
          {/* Camera viewfinder */}
          <View style={s.cameraWrap}>
            {!permission?.granted ? (
              <View style={s.noCam}>
                <Ionicons name="camera-off-outline" size={36} color={C.border} />
                <Text style={s.noCamText}>
                  {permission?.canAskAgain ? 'Requesting camera…' : 'Camera unavailable'}
                </Text>
              </View>
            ) : scanning && !processing ? (
              <>
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  barcodeScannerSettings={{
                    barcodeTypes: ['qr','code128','code39','ean13','ean8','upc_a','pdf417','datamatrix'],
                  }}
                  onBarcodeScanned={handleBarCodeScanned}
                />
                <ScannerOverlay />
              </>
            ) : (
              <View style={s.processingWrap}>
                {processing ? (
                  <>
                    <Ionicons name="sync-outline" size={32} color={C.accent} />
                    <Text style={s.processingText}>Logging…</Text>
                  </>
                ) : (
                  <TouchableOpacity style={s.rescanBtn} onPress={() => setScanning(true)}>
                    <Ionicons name="scan-outline" size={22} color={C.accent} style={{ marginRight: 8 }} />
                    <Text style={s.rescanBtnText}>Scan Again</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {/* Manual job number fallback */}
          <View style={s.fallback}>
            <Text style={s.fallbackLabel}>Or enter job number</Text>
            <View style={s.fallbackRow}>
              <TextInput
                style={s.fallbackInput}
                placeholder="P-26-1001"
                placeholderTextColor={C.muted}
                value={jobInput}
                onChangeText={setJobInput}
                autoCapitalize="characters"
                returnKeyType="go"
                onSubmitEditing={handleJobSubmit}
              />
              <TouchableOpacity
                style={[s.fallbackBtn, (!jobInput.trim() || processing) && s.fallbackBtnOff]}
                onPress={handleJobSubmit}
                disabled={!jobInput.trim() || processing}
              >
                <Ionicons name="arrow-forward" size={20} color="#000" />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerSub:   { fontSize: 13, color: C.muted },
  syncDot:     { width: 8, height: 8, borderRadius: 4 },
  syncGreen:   { backgroundColor: C.success },
  syncRed:     { backgroundColor: '#ef4444' },

  cameraWrap: {
    flex: 1,
    marginHorizontal: 18,
    marginTop: 16,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  noCam: {
    flex: 1, backgroundColor: C.surface,
    justifyContent: 'center', alignItems: 'center', gap: 12,
  },
  noCamText: { color: C.muted, fontSize: 14 },

  processingWrap: {
    flex: 1, backgroundColor: C.surface,
    justifyContent: 'center', alignItems: 'center', gap: 10,
  },
  processingText: { color: C.accent, fontSize: 15, fontWeight: '700' },
  rescanBtn: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 24, paddingVertical: 14,
    borderRadius: 20, backgroundColor: C.input,
    borderWidth: 1.5, borderColor: C.border,
  },
  rescanBtnText: { color: C.accent, fontSize: 15, fontWeight: '700' },

  // Scanner overlay
  overlayTop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  overlayRow:  { flexDirection: 'row', height: VIEWFINDER },
  overlaySide: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  overlayBottom: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', paddingTop: 14,
  },
  scanHint:    { color: 'rgba(255,255,255,0.5)', fontSize: 13 },
  viewfinder:  { width: VIEWFINDER, height: VIEWFINDER, position: 'relative' },
  corner:      { position: 'absolute', width: C_SIZE, height: C_SIZE, borderColor: C.accent },
  cornerTL: { top: 0, left: 0,      borderTopWidth: C_WIDTH,    borderLeftWidth: C_WIDTH,  borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0,     borderTopWidth: C_WIDTH,    borderRightWidth: C_WIDTH, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0,   borderBottomWidth: C_WIDTH, borderLeftWidth: C_WIDTH,  borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0,  borderBottomWidth: C_WIDTH, borderRightWidth: C_WIDTH, borderBottomRightRadius: 4 },

  // Fallback
  fallback: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 20 },
  fallbackLabel: {
    fontSize: 11, color: C.muted, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.9, marginBottom: 10,
  },
  fallbackRow:   { flexDirection: 'row', gap: 10, alignItems: 'center' },
  fallbackInput: {
    flex: 1, backgroundColor: C.input, borderRadius: 12,
    borderWidth: 1.5, borderColor: C.border, color: C.text,
    fontSize: 16, paddingHorizontal: 14, paddingVertical: 13,
  },
  fallbackBtn:    { width: 48, height: 48, borderRadius: 12, backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center' },
  fallbackBtnOff: { opacity: 0.4 },

  // Confirmation
  confirmOverlay: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: C.bg, gap: 16,
  },
  confirmCard: {
    backgroundColor: C.successBg, borderWidth: 2, borderColor: C.successBorder,
    borderRadius: 20, paddingVertical: 32, paddingHorizontal: 40,
    alignItems: 'center', gap: 6, minWidth: 260,
  },
  confirmCheck:   { fontSize: 22, fontWeight: '800', color: C.success, marginBottom: 4 },
  confirmJob:     { fontSize: 18, fontWeight: '800', color: C.text, textAlign: 'center' },
  confirmWO:      { fontSize: 14, color: C.muted, textAlign: 'center' },
  confirmDept:    { fontSize: 13, color: C.accent, fontWeight: '600' },
  confirmTime:    { fontSize: 13, color: C.muted, marginTop: 4 },
  confirmDismiss: { fontSize: 12, color: C.muted },
});
