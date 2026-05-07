import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  SafeAreaView, StatusBar, ActivityIndicator, RefreshControl,
  Linking, Alert, Modal, TextInput, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from '../lib/supabase';
import { getTenantId } from '../lib/tenant';

const C = {
  bg:      '#07090F',
  surface: '#0D1117',
  input:   '#111620',
  border:  '#1A2535',
  text:    '#FFFFFF',
  muted:   '#2D8A94',
  accent:  '#00C5CC',
  blue:    '#3b82f6',
  blueBg:  '#0d1f3c',
};

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

async function openPlan(drawing) {
  const url = drawing.file_url || drawing.external_url;
  if (!url) { Alert.alert('No Link', 'This plan has no file or link attached.'); return; }
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      Alert.alert('Cannot Open', 'Unable to open this file. Make sure a PDF viewer is installed.');
    }
  } catch (e) {
    Alert.alert('Error', 'Could not open the plan: ' + e.message);
  }
}

// ── Plan row ──────────────────────────────────────────────────
function PlanRow({ drawing }) {
  const [pressing, setPressing] = useState(false);
  const isExternal = !drawing.file_url && !!drawing.external_url;
  return (
    <TouchableOpacity
      style={[styles.planRow, pressing && { opacity: 0.7 }]}
      onPressIn={() => setPressing(true)}
      onPressOut={() => setPressing(false)}
      onPress={() => openPlan(drawing)}
      activeOpacity={0.75}
    >
      <View style={styles.planIconWrap}>
        <Ionicons
          name={isExternal ? 'link-outline' : 'document-text-outline'}
          size={22}
          color={C.blue}
        />
      </View>
      <View style={styles.planInfo}>
        <Text style={styles.planLabel}>{drawing.plan_name || drawing.label}</Text>
        <Text style={styles.planMeta} numberOfLines={1}>
          {drawing.job_number || drawing.job_id}
          {isExternal ? ' · Link' : ' · PDF'}
          {drawing.uploaded_by ? ` · ${drawing.uploaded_by}` : ''}
        </Text>
        <Text style={styles.planDate}>{fmtDate(drawing.created_at)}</Text>
      </View>
      <View style={styles.planOpenBtn}>
        <Ionicons name="open-outline" size={16} color={C.blue} />
        <Text style={styles.planOpenText}>Open</Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Job group header ──────────────────────────────────────────
function JobHeader({ jobId, count, expanded, onToggle }) {
  return (
    <TouchableOpacity style={styles.jobHeader} onPress={onToggle} activeOpacity={0.7}>
      <View style={styles.jobHeaderLeft}>
        <Text style={styles.jobId}>{jobId}</Text>
      </View>
      <View style={styles.jobHeaderRight}>
        <View style={styles.planCountBadge}>
          <Text style={styles.planCountText}>{count}</Text>
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={C.muted}
        />
      </View>
    </TouchableOpacity>
  );
}

// ── Main Screen ───────────────────────────────────────────────
export default function PlansScreen({ route }) {
  const { userName } = route.params ?? {};

  const [drawings,   setDrawings]   = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded,   setExpanded]   = useState({});

  // Upload modal state
  const [addVisible,    setAddVisible]    = useState(false);
  const [draftJobNum,   setDraftJobNum]   = useState('');
  const [draftPlanName, setDraftPlanName] = useState('');
  const [draftFile,     setDraftFile]     = useState(null);
  const [draftDriveUrl, setDraftDriveUrl] = useState('');
  const [uploading,     setUploading]     = useState(false);

  const fetchDrawings = useCallback(async () => {
    const { data } = await supabase
      .from('job_drawings')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setDrawings(data);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchDrawings();
      setLoading(false);
    })();

    const ch = supabase
      .channel('plans-screen')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_drawings' }, (p) => {
        if (p.eventType === 'INSERT') setDrawings((prev) => [p.new, ...prev]);
        if (p.eventType === 'DELETE') setDrawings((prev) => prev.filter((d) => d.id !== p.old.id));
      })
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [fetchDrawings]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchDrawings();
    setRefreshing(false);
  }, [fetchDrawings]);

  const toggleJob = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // Group by job_number (fallback to job_id)
  const groups = (() => {
    const map = {};
    drawings.forEach((d) => {
      const key = d.job_number || d.job_id || 'Unknown';
      if (!map[key]) map[key] = { jobId: key, items: [] };
      map[key].items.push(d);
    });
    return Object.values(map);
  })();

  const listData = [];
  groups.forEach((g) => {
    const key    = g.jobId;
    const isOpen = expanded[key] !== false;
    listData.push({ type: 'header', key, group: g, isOpen });
    if (isOpen) g.items.forEach((d) => listData.push({ type: 'row', key: d.id, drawing: d }));
  });

  const renderItem = ({ item }) => {
    if (item.type === 'header') {
      return (
        <JobHeader
          jobId={item.group.jobId}
          count={item.group.items.length}
          expanded={item.isOpen}
          onToggle={() => toggleJob(item.key)}
        />
      );
    }
    return <PlanRow drawing={item.drawing} />;
  };

  // ── Pick file ─────────────────────────────────────────────────
  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets?.length > 0) {
        const asset = result.assets[0];
        setDraftFile({ uri: asset.uri, name: asset.name });
      }
    } catch (e) {
      Alert.alert('Error', 'Could not pick file: ' + e.message);
    }
  };

  // ── Submit upload ─────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!draftJobNum.trim() || !draftPlanName.trim()) return;
    if (!draftFile && !draftDriveUrl.trim()) {
      Alert.alert('Required', 'Upload a PDF or paste a link.');
      return;
    }
    setUploading(true);
    try {
      const tenantId = await getTenantId();
      let fileUrl = null;

      if (draftFile) {
        const safeName = draftFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${tenantId || 'shared'}/${draftJobNum.trim().replace(/\//g, '-')}/${Date.now()}_${safeName}`;
        const resp = await fetch(draftFile.uri);
        const blob = await resp.blob();
        const { error: upErr } = await supabase.storage
          .from('job-drawings')
          .upload(path, blob, { contentType: 'application/pdf', upsert: true });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = supabase.storage.from('job-drawings').getPublicUrl(path);
        fileUrl = publicUrl;
      }

      const { error: insErr } = await supabase.from('job_drawings').insert({
        tenant_id:    tenantId,
        job_number:   draftJobNum.trim(),
        job_id:       draftJobNum.trim(),
        plan_name:    draftPlanName.trim(),
        label:        draftPlanName.trim(),
        file_url:     fileUrl,
        external_url: draftDriveUrl.trim() || null,
        uploaded_by:  userName,
      });
      if (insErr) throw insErr;

      setAddVisible(false);
      setDraftJobNum(''); setDraftPlanName('');
      setDraftFile(null); setDraftDriveUrl('');
    } catch (e) {
      Alert.alert('Upload Failed', e.message);
    } finally {
      setUploading(false);
    }
  };

  const canSubmit = draftJobNum.trim() && draftPlanName.trim() && (draftFile || draftDriveUrl.trim()) && !uploading;

  const closeModal = () => {
    if (uploading) return;
    setAddVisible(false);
    setDraftJobNum(''); setDraftPlanName('');
    setDraftFile(null); setDraftDriveUrl('');
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />

      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Job Plans</Text>
          {userName ? <Text style={styles.headerSub}>{userName}</Text> : null}
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setAddVisible(true)} activeOpacity={0.8}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.addBtnText}>Add Plan</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={C.accent} />
        </View>
      ) : drawings.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="document-text-outline" size={52} color={C.border} />
          <Text style={styles.emptyTitle}>No plans uploaded yet</Text>
          <Text style={styles.emptyBody}>Tap "Add Plan" to upload a PDF or paste a Google Drive link.</Text>
        </View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item) => String(item.key)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.accent}
              colors={[C.accent]}
            />
          }
        />
      )}

      {/* Add Plan Modal */}
      <Modal visible={addVisible} animationType="slide" transparent onRequestClose={closeModal}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalBox}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Add Plan</Text>
              <TouchableOpacity onPress={closeModal} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={C.muted} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>JOB NUMBER</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. P-26-1001"
                placeholderTextColor={C.muted}
                value={draftJobNum}
                onChangeText={setDraftJobNum}
                autoCapitalize="characters"
                returnKeyType="next"
              />

              <Text style={styles.fieldLabel}>PLAN NAME</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Kitchen Elevations"
                placeholderTextColor={C.muted}
                value={draftPlanName}
                onChangeText={setDraftPlanName}
                returnKeyType="done"
              />

              <Text style={styles.fieldLabel}>UPLOAD PDF</Text>
              <TouchableOpacity style={styles.uploadBtn} onPress={handlePickFile} activeOpacity={0.8}>
                <Ionicons
                  name={draftFile ? 'document-attach' : 'document-attach-outline'}
                  size={20}
                  color={draftFile ? C.accent : C.blue}
                />
                <Text style={[styles.uploadBtnText, draftFile && { color: C.accent }]} numberOfLines={1}>
                  {draftFile ? draftFile.name : 'Choose PDF File'}
                </Text>
                {draftFile && (
                  <TouchableOpacity onPress={() => setDraftFile(null)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Ionicons name="close-circle" size={18} color={C.muted} />
                  </TouchableOpacity>
                )}
              </TouchableOpacity>

              <Text style={styles.orDivider}>— or —</Text>

              <Text style={styles.fieldLabel}>PASTE GOOGLE DRIVE LINK</Text>
              <TextInput
                style={styles.input}
                placeholder="https://drive.google.com/..."
                placeholderTextColor={C.muted}
                value={draftDriveUrl}
                onChangeText={setDraftDriveUrl}
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <TouchableOpacity
                style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]}
                onPress={handleSubmit}
                disabled={!canSubmit}
                activeOpacity={0.85}
              >
                {uploading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.submitBtnText}>Save Plan</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: C.bg },
  centered: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 32, gap: 12,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  headerSub:   { fontSize: 13, color: C.muted, marginTop: 2 },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.blue, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  addBtnText: { fontSize: 13, fontWeight: '700', color: '#fff' },

  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.muted, textAlign: 'center' },
  emptyBody:  { fontSize: 13, color: C.muted, textAlign: 'center', lineHeight: 20 },

  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 },

  // Job group header
  jobHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: C.blueBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.blue + '30',
    marginBottom: 6,
    marginTop: 10,
  },
  jobHeaderLeft:  { flex: 1 },
  jobId:          { fontSize: 13, fontWeight: '800', color: C.blue, letterSpacing: 0.3 },
  jobHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  planCountBadge: {
    backgroundColor: C.blue + '30',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  planCountText: { fontSize: 11, fontWeight: '700', color: C.blue },

  // Plan row
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    borderLeftWidth: 3,
    borderLeftColor: C.blue,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 7,
    gap: 12,
  },
  planIconWrap: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: C.blue + '18',
    justifyContent: 'center', alignItems: 'center',
  },
  planInfo:    { flex: 1 },
  planLabel:   { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 3 },
  planMeta:    { fontSize: 12, color: C.muted, marginBottom: 1 },
  planDate:    { fontSize: 11, color: C.muted },
  planOpenBtn: {
    flexDirection: 'column', alignItems: 'center', gap: 2,
    paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8,
    backgroundColor: C.blue + '18', borderWidth: 1, borderColor: C.blue + '40',
  },
  planOpenText: { fontSize: 10, fontWeight: '700', color: C.blue },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  modalBox: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 40,
    maxHeight: '92%',
  },
  modalHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4,
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: C.text },
  fieldLabel: {
    fontSize: 10, fontWeight: '700', color: C.muted,
    letterSpacing: 0.9, textTransform: 'uppercase', marginBottom: 8, marginTop: 18,
  },
  input: {
    backgroundColor: C.input, borderRadius: 12, borderWidth: 1.5, borderColor: C.border,
    color: C.text, fontSize: 15, paddingHorizontal: 14, paddingVertical: 13,
  },
  uploadBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.input, borderRadius: 12, borderWidth: 1.5, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 14,
  },
  uploadBtnText: { fontSize: 14, color: C.blue, fontWeight: '600', flex: 1 },
  orDivider: {
    textAlign: 'center', color: C.muted, fontSize: 12,
    marginTop: 16, marginBottom: 0,
  },
  submitBtn: {
    backgroundColor: C.blue, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', marginTop: 20, marginBottom: 8,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
