import React, { useState, useEffect, useRef, useContext } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  Modal, SafeAreaView, StatusBar, KeyboardAvoidingView,
  Platform, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { EndDayContext } from '../lib/EndDayContext';
import {
  getWorkOrdersByProjectNumber, getEmployeeId, getLaborItemId,
  logTimeEntry, applyWorkOrderTag,
} from '../lib/innergy';
import { setSyncStatus, getSyncStatus } from '../lib/syncQueue';

const C = {
  bg:      '#0d0d0d',
  surface: '#141414',
  input:   '#1a1a1a',
  border:  '#2a2a2a',
  text:    '#e5e5e5',
  muted:   '#555555',
  accent:  '#f59e0b',
  success: '#22c55e',
  danger:  '#ef4444',
  pink:    '#f9a8d4',
  pinkBg:  '#500724',
};

function padTime(n) { return String(n).padStart(2, '0'); }

function formatTimer(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${padTime(h)}:${padTime(m)}:${padTime(s)}`;
}

function formatLoggedTime(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function CraftsmanHomeScreen({ route }) {
  const [userName, setUserName] = useState(route.params?.userName ?? '');
  const [userDept, setUserDept] = useState(route.params?.userDept ?? 'Craftsman');

  const [lastQCTime,   setLastQCTime]   = useState(null);
  const [lastJobName,  setLastJobName]  = useState('');
  const [elapsed,      setElapsed]      = useState('00:00:00');
  const [qcVisible,    setQcVisible]    = useState(false);
  const [jobInput,     setJobInput]     = useState('');
  const [submitting,   setSubmitting]   = useState(false);
  const [confirmMsg,   setConfirmMsg]   = useState('');
  const [syncOk,       setSyncOk]       = useState(true);
  const [endDayMode,   setEndDayMode]   = useState(false);

  const endDay      = useContext(EndDayContext);
  const intervalRef = useRef(null);
  const confirmRef  = useRef(null);

  useEffect(() => {
    AsyncStorage.multiGet(['@sawdust_user_name', '@sawdust_user_dept', '@sawdust_shift_start'])
      .then(pairs => {
        const n = pairs[0][1]; const d = pairs[1][1]; let start = pairs[2][1];
        if (n && !userName) setUserName(n);
        if (d && !userDept) setUserDept(d);
        if (!start) {
          start = new Date().toISOString();
          AsyncStorage.setItem('@sawdust_shift_start', start);
        }
        setLastQCTime(start);
      });
    getSyncStatus().then(({ ok }) => setSyncOk(ok));
  }, []);

  // Elapsed timer
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!lastQCTime) return;
    const tick = () => setElapsed(formatTimer(Date.now() - new Date(lastQCTime).getTime()));
    tick();
    intervalRef.current = setInterval(tick, 1000);
    return () => clearInterval(intervalRef.current);
  }, [lastQCTime]);

  useEffect(() => () => {
    if (confirmRef.current) clearTimeout(confirmRef.current);
  }, []);

  const doLogTime = async (jobNum, startTime, endTime) => {
    const wos = await getWorkOrdersByProjectNumber(jobNum.trim());
    const wo  = wos?.[0];
    const jobName = wo ? (wo.ProjectName ?? wo.JobName ?? wo.Name ?? jobNum) : jobNum;
    let innergyOk = true;

    if (wo) {
      const woId = wo.Id ?? wo.WorkOrderId;
      const [empId, laborId] = await Promise.all([
        userName ? getEmployeeId(userName) : Promise.resolve(null),
        getLaborItemId('Craftsman'),
      ]);
      const result = await logTimeEntry({
        employeeId:  empId,
        workOrderId: woId,
        laborItemId: laborId,
        startTime,
        endTime,
      });
      if (!result) innergyOk = false;
      await applyWorkOrderTag(woId, 'App: In Production').catch(() => {});
    } else {
      innergyOk = false;
    }

    const ms = new Date(endTime).getTime() - new Date(startTime).getTime();
    await supabase.from('time_clock').insert({
      employee_name:  userName || 'Unknown',
      work_order_id:  (wo?.Id ?? wo?.WorkOrderId)?.toString() ?? jobNum,
      job_name:       jobName,
      clock_in:       startTime,
      clock_out:      endTime,
      minutes_logged: Math.round(ms / 60000),
      dept:           'Craftsman',
      sync_status:    innergyOk ? 'synced' : 'pending',
    }).catch(() => {});

    await setSyncStatus(innergyOk);
    setSyncOk(innergyOk);
    return { jobName, ms, innergyOk };
  };

  const handleQCSubmit = async () => {
    const val = jobInput.trim();
    if (!val || submitting) return;
    setSubmitting(true);
    try {
      const endTime   = new Date().toISOString();
      const startTime = lastQCTime ?? new Date().toISOString();
      const { jobName, ms } = await doLogTime(val, startTime, endTime);

      setLastJobName(jobName);
      setLastQCTime(endTime);
      await AsyncStorage.setItem('@sawdust_shift_start', endTime);

      const logged = formatLoggedTime(ms);
      setConfirmMsg(`✅ ${logged} logged to ${jobName}`);
      confirmRef.current = setTimeout(() => setConfirmMsg(''), 3000);

      setQcVisible(false);
      setJobInput('');

      if (endDayMode) {
        setTimeout(async () => {
          setEndDayMode(false);
          await endDay();
        }, 3000);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleEndDay = () => {
    if (lastQCTime) {
      Alert.alert(
        'End Your Day',
        'Log your current time before signing out?',
        [
          {
            text: 'No, just sign out',
            style: 'destructive',
            onPress: async () => {
              await AsyncStorage.multiRemove(['@sawdust_shift_start', '@sawdust_current_task']);
              await endDay();
            },
          },
          {
            text: 'Log Final Time',
            onPress: () => { setEndDayMode(true); setJobInput(''); setQcVisible(true); },
          },
        ]
      );
    } else {
      endDay();
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.appTitle}>Craftsman</Text>
          {userName ? <Text style={styles.userName}>{userName}</Text> : null}
        </View>
        <View style={[styles.syncDot, syncOk ? styles.syncGreen : styles.syncRed]} />
      </View>

      {/* Main body */}
      <View style={styles.body}>
        {/* Timer */}
        <View style={styles.timerCard}>
          <Text style={styles.timerLabel}>TIME ON CURRENT PIECE</Text>
          <Text style={styles.timerValue}>{elapsed}</Text>
          {lastJobName ? (
            <Text style={styles.lastJob}>Last: {lastJobName}</Text>
          ) : (
            <Text style={styles.lastJob}>Tap QC ✓ when piece is done</Text>
          )}
        </View>

        {/* Confirmation message */}
        {confirmMsg ? (
          <View style={styles.confirmBanner}>
            <Text style={styles.confirmBannerText}>{confirmMsg}</Text>
          </View>
        ) : null}

        {/* QC button */}
        <TouchableOpacity
          style={styles.qcBtn}
          onPress={() => { setEndDayMode(false); setJobInput(''); setQcVisible(true); }}
          activeOpacity={0.85}
        >
          <Ionicons name="checkmark-circle-outline" size={36} color="#000" style={{ marginRight: 12 }} />
          <Text style={styles.qcBtnText}>QC ✓</Text>
        </TouchableOpacity>
      </View>

      {/* End Day */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.endDayBtn} onPress={handleEndDay} activeOpacity={0.8}>
          <Text style={styles.endDayText}>End Day</Text>
        </TouchableOpacity>
      </View>

      {/* QC Modal */}
      <Modal visible={qcVisible} animationType="slide" transparent onRequestClose={() => { setQcVisible(false); setEndDayMode(false); }}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {endDayMode ? 'Log Final Time' : 'QC Complete'}
              </Text>
              <TouchableOpacity
                onPress={() => { setQcVisible(false); setEndDayMode(false); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color={C.muted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSub}>
              {endDayMode ? 'Log remaining time before signing out' : `${elapsed} on this piece`}
            </Text>

            <Text style={styles.fieldLabel}>JOB NUMBER</Text>
            <TextInput
              style={styles.input}
              placeholder="P-26-1001"
              placeholderTextColor={C.muted}
              value={jobInput}
              onChangeText={setJobInput}
              autoCapitalize="characters"
              autoFocus
              returnKeyType="go"
              onSubmitEditing={handleQCSubmit}
            />

            <TouchableOpacity
              style={[styles.submitBtn, (!jobInput.trim() || submitting) && styles.submitBtnOff]}
              onPress={handleQCSubmit}
              disabled={!jobInput.trim() || submitting}
            >
              {submitting
                ? <ActivityIndicator size="small" color="#000" />
                : <Text style={styles.submitBtnText}>
                    {endDayMode ? 'Log & Sign Out' : `Log ${elapsed}`}
                  </Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  appTitle: { fontSize: 22, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  userName: { fontSize: 13, color: C.muted, marginTop: 2 },
  syncDot:   { width: 8, height: 8, borderRadius: 4 },
  syncGreen: { backgroundColor: C.success },
  syncRed:   { backgroundColor: C.danger },

  body:   { flex: 1, paddingHorizontal: 20, justifyContent: 'center', gap: 24 },
  footer: { paddingHorizontal: 20, paddingBottom: 20, paddingTop: 8 },

  // Timer card
  timerCard: {
    backgroundColor: C.surface, borderRadius: 20, borderWidth: 1.5, borderColor: C.border,
    paddingVertical: 28, paddingHorizontal: 24, alignItems: 'center', gap: 8,
  },
  timerLabel: { fontSize: 10, fontWeight: '700', color: C.muted, letterSpacing: 0.9, textTransform: 'uppercase' },
  timerValue: { fontSize: 52, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'], letterSpacing: 2 },
  lastJob:    { fontSize: 13, color: C.muted, textAlign: 'center' },

  // Confirm
  confirmBanner: {
    backgroundColor: '#0a1f10', borderRadius: 12, borderWidth: 1, borderColor: '#14532d',
    paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center',
  },
  confirmBannerText: { color: C.success, fontSize: 15, fontWeight: '700', textAlign: 'center' },

  // QC button
  qcBtn: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    backgroundColor: C.pink, borderRadius: 20, paddingVertical: 28,
    shadowColor: C.pink, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6,
  },
  qcBtnText: { fontSize: 28, fontWeight: '800', color: '#000' },

  // End Day
  endDayBtn: {
    alignItems: 'center', paddingVertical: 14, borderRadius: 14,
    backgroundColor: C.surface, borderWidth: 1, borderColor: '#333',
  },
  endDayText: { color: C.muted, fontSize: 14, fontWeight: '600' },

  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.75)' },
  modalBox: {
    backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  modalTitle:  { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  modalSub:    { fontSize: 13, color: C.muted, marginBottom: 20 },
  fieldLabel:  { fontSize: 10, fontWeight: '700', color: C.muted, letterSpacing: 0.9, textTransform: 'uppercase', marginBottom: 8 },
  input: {
    backgroundColor: C.input, borderRadius: 12, borderWidth: 1.5, borderColor: C.border,
    color: C.text, fontSize: 18, fontWeight: '700', paddingHorizontal: 14, paddingVertical: 14, marginBottom: 20,
    letterSpacing: 1,
  },
  submitBtn:     { backgroundColor: C.accent, borderRadius: 14, paddingVertical: 17, alignItems: 'center' },
  submitBtnOff:  { opacity: 0.35 },
  submitBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
});
