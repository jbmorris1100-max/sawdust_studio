import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import {
  hasInnergy, getWorkOrders, getMaterialsToBuy,
  getLaborKanbanItems, getDateManagement,
} from '../lib/innergy';
import { getTenant } from '../lib/tenant';

const C = {
  bg:      '#07090F',
  surface: '#0D1117',
  border:  '#1A2535',
  text:    '#FFFFFF',
  muted:   '#2D8A94',
  accent:  '#00C5CC',
  success: '#22c55e',
  danger:  '#ef4444',
  blue:    '#3b82f6',
  orange:  '#f97316',
};

function SectionHeader({ icon, label, count, color }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionIcon]}>{icon}</Text>
      <Text style={[styles.sectionLabel, { color: color ?? C.muted }]}>{label}</Text>
      {count != null && count > 0 && (
        <View style={[styles.countBadge, { backgroundColor: (color ?? C.muted) + '22' }]}>
          <Text style={[styles.countBadgeText, { color: color ?? C.muted }]}>{count}</Text>
        </View>
      )}
    </View>
  );
}

function EmptyRow({ text }) {
  return (
    <View style={styles.emptyRow}>
      <Text style={styles.emptyRowText}>{text}</Text>
    </View>
  );
}

function BriefCard({ children, borderColor }) {
  return (
    <View style={[styles.briefCard, borderColor && { borderLeftColor: borderColor }]}>
      {children}
    </View>
  );
}

export default function MorningBriefScreen({ userName }) {
  const [loading,   setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasErp,    setHasErp]    = useState(false);
  const [shopName,  setShopName]  = useState('');

  const [urgent,      setUrgent]      = useState([]);
  const [watch,       setWatch]       = useState([]);
  const [dueThisWeek, setDueThisWeek] = useState([]);
  const [impediments, setImpediments] = useState([]);
  const [materials,   setMaterials]   = useState([]);
  const [openDamage,  setOpenDamage]  = useState([]);
  const [openMsgs,    setOpenMsgs]    = useState([]);

  const load = useCallback(async () => {
    try {
      const [erpOn, tenant] = await Promise.all([hasInnergy(), getTenant()]);
      setHasErp(erpOn);
      setShopName(tenant?.shop_name ?? '');

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const now = new Date();
      const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      // Supabase queries
      const [dmgRes, matRes, msgRes] = await Promise.all([
        supabase.from('damage_reports').select('*').eq('status', 'open').order('created_at', { ascending: false }),
        supabase.from('inventory_needs').select('*').eq('status', 'pending').order('created_at', { ascending: false }),
        supabase.from('messages').select('*').gt('created_at', yesterday).order('created_at', { ascending: false }).limit(20),
      ]);
      setOpenDamage(dmgRes.data ?? []);
      setOpenMsgs(msgRes.data ?? []);

      // ERP queries (only if connected)
      if (erpOn) {
        const [wos, kanban, mats] = await Promise.all([
          getWorkOrders(),
          getLaborKanbanItems(),
          getMaterialsToBuy(),
        ]);

        // Date management for current month
        const dateData = await getDateManagement(now.getFullYear(), now.getMonth() + 1);

        // Classify work orders by urgency
        const urgentList = [];
        const watchList  = [];
        const dueList    = [];
        const impedList  = [];

        (wos ?? []).forEach(wo => {
          const planned = wo.PlannedHours ?? wo.BudgetedHours ?? 0;
          const actual  = wo.ActualHours  ?? wo.LoggedHours   ?? 0;
          if (planned > 0) {
            const pct = actual / planned;
            if (pct > 1.0)  urgentList.push({ ...wo, pct });
            else if (pct >= 0.9) watchList.push({ ...wo, pct });
          }
          if (wo.DueDate && wo.DueDate <= weekFromNow && wo.DueDate >= now.toISOString()) {
            dueList.push(wo);
          }
          if (wo.HasImpediments || wo.ImpedimentCount > 0) {
            impedList.push(wo);
          }
        });

        setUrgent(urgentList.slice(0, 10));
        setWatch(watchList.slice(0, 10));
        setDueThisWeek(dueList.slice(0, 10));
        setImpediments(impedList.slice(0, 10));
        setMaterials((mats ?? []).slice(0, 20));
      } else {
        setMaterials((matRes.data ?? []).slice(0, 20));
      }
    } catch (e) {
      console.error('[MorningBrief] load error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, []);

  const onRefresh = () => { setRefreshing(true); load(); };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={C.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Morning Brief</Text>
          <Text style={styles.headerSub}>{shopName || 'Shop Floor'} · {new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}</Text>
        </View>
        {!hasErp && (
          <TouchableOpacity style={styles.connectBadge} activeOpacity={0.7}>
            <Ionicons name="link-outline" size={12} color={C.blue} />
            <Text style={styles.connectBadgeText}>Connect ERP for full sync</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 🔴 URGENT */}
      {hasErp && (
        <>
          <SectionHeader icon="🔴" label="URGENT — Over planned hours" count={urgent.length} color={C.danger} />
          {urgent.length === 0
            ? <EmptyRow text="No jobs over budget — great shape!" />
            : urgent.map((wo, i) => (
                <BriefCard key={i} borderColor={C.danger}>
                  <Text style={styles.cardTitle}>{wo.ProjectName ?? wo.WoNumber ?? 'Unknown'}</Text>
                  <Text style={styles.cardMeta}>
                    {Math.round((wo.pct - 1) * 100)}% over budget · WO #{wo.WoNumber ?? wo.Id}
                  </Text>
                </BriefCard>
              ))
          }
        </>
      )}

      {/* 🟡 WATCH */}
      {hasErp && (
        <>
          <SectionHeader icon="🟡" label="WATCH — 90%+ of planned hours" count={watch.length} color={C.accent} />
          {watch.length === 0
            ? <EmptyRow text="No jobs approaching budget limit" />
            : watch.map((wo, i) => (
                <BriefCard key={i} borderColor={C.accent}>
                  <Text style={styles.cardTitle}>{wo.ProjectName ?? wo.WoNumber ?? 'Unknown'}</Text>
                  <Text style={styles.cardMeta}>
                    {Math.round(wo.pct * 100)}% of budget used · WO #{wo.WoNumber ?? wo.Id}
                  </Text>
                </BriefCard>
              ))
          }
        </>
      )}

      {/* 🟢 DUE THIS WEEK */}
      {hasErp && (
        <>
          <SectionHeader icon="🟢" label="DUE THIS WEEK" count={dueThisWeek.length} color={C.success} />
          {dueThisWeek.length === 0
            ? <EmptyRow text="Nothing due this week" />
            : dueThisWeek.map((wo, i) => (
                <BriefCard key={i} borderColor={C.success}>
                  <Text style={styles.cardTitle}>{wo.ProjectName ?? wo.WoNumber ?? 'Unknown'}</Text>
                  <Text style={styles.cardMeta}>
                    Due {new Date(wo.DueDate).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </Text>
                </BriefCard>
              ))
          }
        </>
      )}

      {/* ⚠️ OPEN IMPEDIMENTS */}
      {hasErp && impediments.length > 0 && (
        <>
          <SectionHeader icon="⚠️" label="OPEN IMPEDIMENTS" count={impediments.length} color={C.orange} />
          {impediments.map((wo, i) => (
            <BriefCard key={i} borderColor={C.orange}>
              <Text style={styles.cardTitle}>{wo.ProjectName ?? wo.WoNumber ?? 'Unknown'}</Text>
              <Text style={styles.cardMeta}>WO #{wo.WoNumber ?? wo.Id}</Text>
            </BriefCard>
          ))}
        </>
      )}

      {/* 📦 MATERIALS NEEDED */}
      <SectionHeader icon="📦" label="MATERIALS NEEDED" count={materials.length} color={C.blue} />
      {materials.length === 0
        ? <EmptyRow text="No pending material needs" />
        : materials.slice(0, 8).map((m, i) => (
            <BriefCard key={i} borderColor={C.blue}>
              <Text style={styles.cardTitle}>{m.item ?? m.MaterialName ?? m.Name ?? 'Material'}</Text>
              <Text style={styles.cardMeta}>
                {m.dept ?? m.Dept ?? ''}{m.job_id || m.WoNumber ? ` · Job #${m.job_id ?? m.WoNumber}` : ''}
              </Text>
            </BriefCard>
          ))
      }

      {/* 🔧 OPEN DAMAGE */}
      <SectionHeader icon="🔧" label="OPEN DAMAGE REPORTS" count={openDamage.length} color={C.danger} />
      {openDamage.length === 0
        ? <EmptyRow text="No open damage reports" />
        : openDamage.slice(0, 6).map((d, i) => (
            <BriefCard key={i} borderColor={C.danger}>
              <Text style={styles.cardTitle}>{d.part_name}</Text>
              <Text style={styles.cardMeta}>
                {d.dept}{d.job_id ? ` · Job #${d.job_id}` : ''} · {d.notes?.slice(0, 40) ?? ''}
              </Text>
            </BriefCard>
          ))
      }

      {/* Yesterday's messages */}
      {openMsgs.length > 0 && (
        <>
          <SectionHeader icon="💬" label="MESSAGES FROM YESTERDAY" count={openMsgs.length} color={C.muted} />
          {openMsgs.slice(0, 5).map((m, i) => (
            <BriefCard key={i}>
              <Text style={styles.cardTitle}>{m.sender_name}</Text>
              <Text style={styles.cardMeta}>{(m.body ?? '').slice(0, 80)}</Text>
            </BriefCard>
          ))}
        </>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex:    { flex: 1, backgroundColor: C.bg },
  centered:{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg },
  scroll:  { paddingHorizontal: 16, paddingBottom: 40 },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingTop: 16, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: C.border, marginBottom: 16,
  },
  headerTitle: { fontSize: 22, fontWeight: '800', color: C.text, letterSpacing: -0.3 },
  headerSub:   { fontSize: 12, color: C.muted, marginTop: 3 },

  connectBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#0d1f3c', borderRadius: 99, borderWidth: 1, borderColor: '#1e3a5f',
    paddingHorizontal: 10, paddingVertical: 5,
  },
  connectBadgeText: { fontSize: 10, color: C.blue, fontWeight: '700' },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 20, marginBottom: 8,
  },
  sectionIcon:  { fontSize: 14 },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase', flex: 1 },
  countBadge: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 99,
  },
  countBadgeText: { fontSize: 10, fontWeight: '800' },

  briefCard: {
    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: '#222',
    borderLeftWidth: 3, borderLeftColor: C.border,
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 6,
  },
  cardTitle: { fontSize: 14, fontWeight: '700', color: C.text, marginBottom: 2 },
  cardMeta:  { fontSize: 12, color: C.muted },

  emptyRow: {
    backgroundColor: C.surface, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 6,
  },
  emptyRowText: { fontSize: 12, color: C.muted, fontStyle: 'italic' },
});
