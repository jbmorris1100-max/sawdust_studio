import 'react-native-url-polyfill/auto';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Text, View, StyleSheet, TouchableOpacity,
  TextInput, SafeAreaView, StatusBar,
  KeyboardAvoidingView, Platform, Alert,
  Modal, FlatList, ActivityIndicator,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HomeIcon, MessagesIcon, InventoryIcon, DamageIcon, MoreIcon } from './src/components/NavIcon';

import { supabase } from './src/lib/supabase';
import { registerForPushNotifications } from './src/lib/notifications';
import InlineIQLogo from './src/components/InlineIQLogo';
import { RoleContext }       from './src/lib/RoleContext';
import { EndDayContext }     from './src/lib/EndDayContext';
import { SwitchDeptContext } from './src/lib/SwitchDeptContext';
import { getTenant, isTrialExpired } from './src/lib/tenant';
import HomeScreen         from './src/screens/HomeScreen';
import PartsScreen        from './src/screens/PartsScreen';
import InventoryScreen    from './src/screens/InventoryScreen';
import DamageScreen       from './src/screens/DamageScreen';
import MessagesScreen     from './src/screens/MessagesScreen';
import SOPsScreen         from './src/screens/SOPsScreen';
import PlansScreen        from './src/screens/PlansScreen';
import SupervisorApp      from './src/screens/SupervisorApp';
import OnboardingScreen   from './src/screens/OnboardingScreen';
import OnboardingFlow     from './src/screens/OnboardingFlow';
import CraftsmanHomeScreen from './src/screens/CraftsmanHomeScreen';
import MoreScreen         from './src/screens/MoreScreen';
import TrialExpiredScreen, { TrialExpiredBanner } from './src/screens/TrialExpiredScreen';

const Tab           = createBottomTabNavigator();
const CraftsmanTab  = createBottomTabNavigator();

const STORAGE = {
  NAME:      '@inline_user_name',
  DEPT:      '@inline_user_dept',
  ROLE:      '@inline_user_role',
  VERSION:   '@inline_app_version',
  DEVICE_ID: '@inline_device_id',
};

async function getDeviceId() {
  let id = await AsyncStorage.getItem(STORAGE.DEVICE_ID);
  if (!id) {
    id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    await AsyncStorage.setItem(STORAGE.DEVICE_ID, id);
  }
  return id;
}

const DEPT_COLORS = {
  Production: { bg: 'rgba(94,234,212,0.08)',  text: '#5EEAD4' },
  Assembly:   { bg: 'rgba(52,211,153,0.08)',  text: '#34D399' },
  Finishing:  { bg: 'rgba(251,191,36,0.08)',  text: '#FBBF24' },
  Craftsman:  { bg: 'rgba(167,139,250,0.08)', text: '#A78BFA' },
};

// ── Colors ────────────────────────────────────────────────────
const C = {
  bg:       '#050608',
  surface:  '#0a0d10',
  input:    '#0f1418',
  border:   'rgba(94,234,212,0.12)',
  text:     '#E6F0EE',
  muted:    '#9AAAA7',
  tabBar:   '#050608',
  active:   '#2DE1C9',
  inactive: '#9AAAA7',
  badge:    '#F87171',
  accent:   '#2DE1C9',
  danger:   '#F87171',
  violet:   '#A78BFA',
};

function TabButton({ children, onPress, accessibilityState, style }) {
  const focused = accessibilityState?.selected;
  return (
    <TouchableOpacity onPress={onPress} style={[style, styles.tabButton]} activeOpacity={0.7}>
      {focused && <View style={styles.tabAccent} />}
      {children}
    </TouchableOpacity>
  );
}

// ── Role Picker ───────────────────────────────────────────────
function RolePicker({ onSelect, tenant }) {
  const [pickingSupervisor, setPickingSupervisor] = useState(false);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  const handleSupervisorGo = async () => {
    if (loading || !name.trim()) return;
    console.log('[supervisor login] button pressed, name:', name.trim());
    setLoginError('');
    setLoading(true);
    try {
      await onSelect('supervisor', name.trim());
    } catch (e) {
      console.error('[supervisor login] error:', e);
      setLoginError('Login failed — please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={rp.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <KeyboardAvoidingView style={rp.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <InlineIQLogo size="medium" />
        <Text style={rp.heading}>Who are you?</Text>

        {!pickingSupervisor ? (
          <>
            <TouchableOpacity style={rp.roleCard} onPress={() => onSelect('crew')} activeOpacity={0.8}>
              <View style={[rp.roleIcon, { backgroundColor: 'rgba(45,225,201,0.1)' }]}>
                <Ionicons name="construct-outline" size={30} color={C.active} />
              </View>
              <View style={rp.roleText}>
                <Text style={rp.roleTitle}>I'm Crew</Text>
                <Text style={rp.roleDesc}>Log inventory, scan parts, report damage, send messages</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.muted} />
            </TouchableOpacity>

            <TouchableOpacity style={[rp.roleCard, rp.roleCardSup]} onPress={() => setPickingSupervisor(true)} activeOpacity={0.8}>
              <View style={[rp.roleIcon, { backgroundColor: 'rgba(167,139,250,0.1)' }]}>
                <Ionicons name="shield-checkmark-outline" size={30} color={C.violet} />
              </View>
              <View style={rp.roleText}>
                <Text style={[rp.roleTitle, { color: C.violet }]}>I'm Supervisor</Text>
                <Text style={rp.roleDesc}>Monitor crew, manage inventory, reply to messages</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.muted} />
            </TouchableOpacity>
          </>
        ) : (
          <View style={rp.nameBox}>
            <Text style={rp.fieldLabel}>SUPERVISOR NAME</Text>
            <TextInput
              style={rp.input} placeholder="e.g. Mike Torres"
              placeholderTextColor={C.muted} value={name}
              onChangeText={setName} autoFocus
              returnKeyType="go"
              onSubmitEditing={handleSupervisorGo}
            />
            {!!loginError && <Text style={rp.errorText}>{loginError}</Text>}
            <TouchableOpacity
              style={[rp.goBtn, (!name.trim() || loading) && rp.goBtnDisabled]}
              onPress={handleSupervisorGo}
              disabled={!name.trim() || loading}
              activeOpacity={0.85}
            >
              {loading
                ? <ActivityIndicator size="small" color="#001917" />
                : <Text style={rp.goBtnText}>Enter Supervisor Dashboard</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setPickingSupervisor(false); setName(''); setLoginError(''); }} style={rp.backBtn}>
              <Ionicons name="arrow-back" size={16} color={C.muted} style={{ marginRight: 5 }} />
              <Text style={rp.backBtnText}>Back</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Craftsman Navigator (QC workflow) ─────────────────────────
function CraftsmanNavigator({ userName, userDept, unreadCount, setUnreadCount }) {
  const params = { userName, userDept };
  return (
    <CraftsmanTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor:   C.violet,
        tabBarInactiveTintColor: C.inactive,
        tabBarShowLabel: false,
      }}
    >
      <CraftsmanTab.Screen
        name="CraftsmanHome"
        component={CraftsmanHomeScreen}
        initialParams={params}
        options={{
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ color }) => <HomeIcon color={color} />,
        }}
      />
      <CraftsmanTab.Screen
        name="Needs"
        component={InventoryScreen}
        initialParams={params}
        options={{
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ color }) => <InventoryIcon color={color} />,
        }}
      />
      <CraftsmanTab.Screen
        name="Damage"
        component={DamageScreen}
        initialParams={params}
        options={{
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ color }) => <DamageIcon color={color} />,
        }}
      />
      <CraftsmanTab.Screen
        name="Messages"
        component={MessagesScreen}
        initialParams={params}
        options={{
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ color }) => <MessagesIcon color={color} />,
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarBadgeStyle: styles.nativeBadge,
        }}
        listeners={{ tabPress: () => setUnreadCount(0) }}
      />
    </CraftsmanTab.Navigator>
  );
}

// ── Standard Crew Navigator ───────────────────────────────────
function CrewNavigator({ userName, userDept, unreadCount, setUnreadCount }) {
  const params = { userName, userDept };
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor:   C.active,
        tabBarInactiveTintColor: C.inactive,
        tabBarShowLabel: false,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        initialParams={{ ...params, onClearUnread: () => setUnreadCount(0) }}
        options={{
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ color }) => <HomeIcon color={color} />,
        }}
      />
      <Tab.Screen
        name="Needs"
        component={InventoryScreen}
        initialParams={params}
        options={{
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ color }) => <InventoryIcon color={color} />,
        }}
      />
      <Tab.Screen
        name="Damage"
        component={DamageScreen}
        initialParams={params}
        options={{
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ color }) => <DamageIcon color={color} />,
        }}
      />
      <Tab.Screen
        name="Messages"
        component={MessagesScreen}
        initialParams={params}
        options={{
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ color }) => <MessagesIcon color={color} />,
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarBadgeStyle: styles.nativeBadge,
        }}
        listeners={{ tabPress: () => setUnreadCount(0) }}
      />
      <Tab.Screen
        name="More"
        component={MoreScreen}
        initialParams={params}
        options={{
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ color }) => <MoreIcon color={color} />,
        }}
      />
      {/* Hidden tabs — reachable from MoreScreen */}
      <Tab.Screen
        name="ScanPart"
        component={PartsScreen}
        initialParams={params}
        options={{ title: 'Parts', tabBarButton: () => null }}
      />
      <Tab.Screen
        name="SOPs"
        component={SOPsScreen}
        initialParams={params}
        options={{ tabBarButton: () => null }}
      />
      <Tab.Screen
        name="Plans"
        component={PlansScreen}
        initialParams={params}
        options={{ tabBarButton: () => null }}
      />
      {/* Alias for backward-compat navigation */}
      <Tab.Screen
        name="LogInventory"
        component={InventoryScreen}
        initialParams={params}
        options={{ tabBarButton: () => null }}
      />
    </Tab.Navigator>
  );
}

// ── Supervisor Navigator ──────────────────────────────────────
const SupervisorTab = createBottomTabNavigator();
function SupervisorNavigator({ userName }) {
  return (
    <SupervisorTab.Navigator screenOptions={{ headerShown: false, tabBarStyle: { display: 'none' } }}>
      <SupervisorTab.Screen name="SupervisorMain" component={SupervisorApp} initialParams={{ userName }} />
    </SupervisorTab.Navigator>
  );
}

// ── App ───────────────────────────────────────────────────────
export default function App() {
  const [role,              setRole]              = useState(null);
  const [userName,          setUserName]          = useState('');
  const [userDept,          setUserDept]          = useState('');
  const [unreadCount,       setUnreadCount]       = useState(0);
  const [showOnboarding,    setShowOnboarding]    = useState(false);
  const [showFullOnboarding, setShowFullOnboarding] = useState(false);
  const [tenant,            setTenant]            = useState(null);
  const [trialExpired,      setTrialExpired]      = useState(false);
  const [deptPickerVisible, setDeptPickerVisible] = useState(false);
  const [pendingDept,       setPendingDept]       = useState('');
  const channelRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        // Expire stale supervisor sessions
        try {
          const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
          await supabase.from('supervisor_sessions')
            .update({ is_active: false, logged_out_at: new Date().toISOString() })
            .eq('is_active', true).lt('logged_in_at', cutoff);
        } catch (_) {}

        // Check for tenant config
        const tenantData = await getTenant();
        if (!tenantData) {
          // No tenant — show full onboarding flow
          setShowFullOnboarding(true);
          setRole('');
          return;
        }
        setTenant(tenantData);

        // Check trial expiry
        const expired = await isTrialExpired();
        setTrialExpired(expired);

        const [name, dept, storedRole, storedVersion] = await Promise.all([
          AsyncStorage.getItem(STORAGE.NAME),
          AsyncStorage.getItem(STORAGE.DEPT),
          AsyncStorage.getItem(STORAGE.ROLE),
          AsyncStorage.getItem(STORAGE.VERSION),
        ]);

        if (parseInt(storedVersion ?? '0', 10) < 2) {
          await Promise.all([
            AsyncStorage.removeItem(STORAGE.NAME),
            AsyncStorage.removeItem(STORAGE.DEPT),
            AsyncStorage.removeItem(STORAGE.ROLE),
            AsyncStorage.setItem(STORAGE.VERSION, '2'),
          ]);
          setRole('');
          return;
        }

        if (storedRole === 'supervisor' && name) {
          setRole('supervisor'); setUserName(name); setUserDept('Management');
          registerForPushNotifications(name, 'Supervisor').catch(console.warn);
        } else if (!storedRole && name && dept) {
          await AsyncStorage.setItem(STORAGE.ROLE, 'crew');
          setRole('crew'); setUserName(name); setUserDept(dept);
          registerForPushNotifications(name, dept).catch(console.warn);
        } else if (storedRole === 'crew' && name && dept) {
          setRole('crew'); setUserName(name); setUserDept(dept);
          registerForPushNotifications(name, dept).catch(console.warn);
        } else {
          setRole('');
        }
      } catch (e) {
        console.error('[App] startup error:', e);
      } finally {
        setRole(prev => prev === null ? '' : prev);
      }
    })();
  }, []);

  // Unread badge
  useEffect(() => {
    if (role !== 'crew') return;
    channelRef.current = supabase.channel('app-messages-badge')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        if (payload.new.sender_name !== userName) setUnreadCount(n => n + 1);
      })
      .subscribe();
    return () => { supabase.removeChannel(channelRef.current); };
  }, [role, userName]);

  const handleRoleSelect = async (selectedRole, name) => {
    console.log('[handleRoleSelect] role:', selectedRole, 'name:', name);
    try {
      const deviceId = await getDeviceId();

      if (selectedRole === 'supervisor' && name) {
        const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

        // Clear any stale sessions from this same device so it can always re-enter
        try {
          await supabase.from('supervisor_sessions')
            .update({ is_active: false, logged_out_at: new Date().toISOString() })
            .eq('device_id', deviceId).eq('is_active', true);
        } catch (_) {}

        // Block only if a DIFFERENT device has an active supervisor session
        const { data: otherSessions, error: sessErr } = await supabase
          .from('supervisor_sessions').select('name, device_id')
          .neq('device_id', deviceId)
          .eq('is_active', true).gte('logged_in_at', cutoff);
        if (sessErr) console.warn('[handleRoleSelect] sessions query error:', sessErr);

        if (otherSessions?.length > 0) {
          const other = otherSessions[0];
          Alert.alert(
            'Supervisor Active on Another Device',
            `${other.name} is currently logged in as supervisor on another device.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Force Login',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await supabase.from('supervisor_sessions')
                      .update({ is_active: false, logged_out_at: new Date().toISOString() })
                      .eq('is_active', true);
                    await supabase.from('supervisor_sessions').insert({ name, device_id: deviceId, is_active: true });
                  } catch (_) {}
                  await AsyncStorage.setItem(STORAGE.NAME, name);
                  setUserName(name); setUserDept('Management');
                  registerForPushNotifications(name, 'Supervisor').catch(console.warn);
                  await Promise.all([
                    AsyncStorage.setItem(STORAGE.ROLE, selectedRole),
                    AsyncStorage.setItem(STORAGE.VERSION, '2'),
                  ]);
                  try {
                    await supabase.from('login_log').insert({
                      worker_name: name, dept: 'Management', role: 'supervisor',
                      device_id: deviceId, app_version: '2',
                    });
                  } catch (_) {}
                  setRole(selectedRole);
                },
              },
            ]
          );
          return;
        }

        try {
          await supabase.from('supervisor_sessions').insert({ name, device_id: deviceId, is_active: true });
        } catch (e) {
          console.warn('[handleRoleSelect] session insert error (non-fatal):', e);
        }
        await AsyncStorage.setItem(STORAGE.NAME, name);
        setUserName(name); setUserDept('Management');
        registerForPushNotifications(name, 'Supervisor').catch(console.warn);
      }

      await Promise.all([
        AsyncStorage.setItem(STORAGE.ROLE, selectedRole),
        AsyncStorage.setItem(STORAGE.VERSION, '2'),
      ]);

      if (selectedRole === 'crew' && !name) {
        const storedName = await AsyncStorage.getItem(STORAGE.NAME);
        if (!storedName) {
          setRole('crew'); setShowOnboarding(true); return;
        }
        const storedDept = await AsyncStorage.getItem(STORAGE.DEPT);
        if (storedName) setUserName(storedName);
        if (storedDept) setUserDept(storedDept);
      }

      const displayName = name || (await AsyncStorage.getItem(STORAGE.NAME)) || 'Unknown';
      const dept = selectedRole === 'supervisor' ? 'Management' : (await AsyncStorage.getItem(STORAGE.DEPT)) || '';
      try {
        await supabase.from('login_log').insert({ worker_name: displayName, dept, role: selectedRole, device_id: deviceId, app_version: '2' });
      } catch (_) {}

      console.log('[handleRoleSelect] calling setRole:', selectedRole);
      setRole(selectedRole);
    } catch (e) {
      console.error('[handleRoleSelect] unexpected error:', e);
      // Last-resort: still try to set the role so the user isn't stuck
      try {
        await AsyncStorage.setItem(STORAGE.ROLE, selectedRole);
      } catch (_) {}
      setRole(selectedRole);
    }
  };

  // Full sign-out: clears name, dept, role
  const handleResetRole = useCallback(async () => {
    if (role === 'supervisor') {
      const deviceId = await getDeviceId();
      await supabase.from('supervisor_sessions')
        .update({ is_active: false, logged_out_at: new Date().toISOString() })
        .eq('device_id', deviceId).eq('is_active', true).catch(console.warn);
    }
    await Promise.all([
      AsyncStorage.removeItem(STORAGE.NAME),
      AsyncStorage.removeItem(STORAGE.DEPT),
      AsyncStorage.removeItem(STORAGE.ROLE),
    ]);
    setRole(''); setUserName(''); setUserDept('');
  }, [role]);

  // Light sign-out (End Day): preserves name/dept so next shift skips setup
  const handleEndDayReset = useCallback(async () => {
    await Promise.all([
      AsyncStorage.removeItem(STORAGE.ROLE),
      AsyncStorage.removeItem('@inline_current_task'),
      AsyncStorage.removeItem('@inline_shift_start'),
    ]);
    setRole(''); setUserName(''); setUserDept('');
  }, []);

  const tenantDepartments = useMemo(() => {
    const defaults = ['Production', 'Assembly', 'Finishing', 'Craftsman'];
    if (!tenant?.departments) return defaults;
    try {
      const d = typeof tenant.departments === 'string'
        ? JSON.parse(tenant.departments) : tenant.departments;
      if (!Array.isArray(d) || d.length === 0) return defaults;
      // Always include all four standard departments
      const merged = [...d];
      for (const dep of defaults) {
        if (!merged.includes(dep)) merged.push(dep);
      }
      return merged;
    } catch { return defaults; }
  }, [tenant]);

  const handleSwitchDept = useCallback(() => {
    setPendingDept(userDept);
    setDeptPickerVisible(true);
  }, [userDept]);

  const handleDeptConfirmed = useCallback(async (dept) => {
    if (!dept) return;
    await AsyncStorage.setItem(STORAGE.DEPT, dept);
    setUserDept(dept);
    setDeptPickerVisible(false);
    setPendingDept('');
  }, []);

  const resetRoleRef    = useRef(null); resetRoleRef.current    = handleResetRole;
  const endDayRef       = useRef(null); endDayRef.current       = handleEndDayReset;
  const switchDeptRef   = useRef(null); switchDeptRef.current   = handleSwitchDept;
  const stableReset     = useCallback(() => resetRoleRef.current?.(),  []);
  const stableEndDay    = useCallback(() => endDayRef.current?.(),     []);
  const stableSwitchDept = useCallback(() => switchDeptRef.current?.(), []);

  // Global supervisor sign-out hook
  useEffect(() => {
    if (role !== 'supervisor') { global.inlineSignOut = null; return; }
    global.inlineSignOut = async () => {
      try {
        await AsyncStorage.multiRemove(['@inline_user_name','@inline_user_dept','@inline_user_role','@inline_current_task']);
        await supabase.from('supervisor_sessions').update({ is_active: false, logged_out_at: new Date().toISOString() }).eq('is_active', true);
      } catch (_) {}
      setRole(''); setUserName(''); setUserDept('');
    };
    return () => { global.inlineSignOut = null; };
  }, [role]);

  const handleOnboardingComplete = useCallback((name) => {
    setUserName(name); setShowOnboarding(false);
  }, []);

  const handleFullOnboardingComplete = useCallback((tenantData, name, userRole) => {
    console.log('[App] handleFullOnboardingComplete called, name:', name, 'role:', userRole);
    setTenant(tenantData);
    setShowFullOnboarding(false);
    setUserName(name);
    setRole('');
  }, []);

  if (role === null) return null;

  // Show full onboarding for new installs
  if (showFullOnboarding) {
    console.log('[App] rendering OnboardingFlow (showFullOnboarding=true)');
    return (
      <SafeAreaProvider>
        <OnboardingFlow onComplete={handleFullOnboardingComplete} />
      </SafeAreaProvider>
    );
  }

  if (role === '') {
    return (
      <SafeAreaProvider>
        <RolePicker onSelect={handleRoleSelect} tenant={tenant} />
      </SafeAreaProvider>
    );
  }

  if (role === 'crew' && showOnboarding) {
    return (
      <SafeAreaProvider>
        <OnboardingScreen onComplete={handleOnboardingComplete} />
      </SafeAreaProvider>
    );
  }

  // Trial gate for supervisors (full screen)
  if (role === 'supervisor' && trialExpired) {
    return (
      <SafeAreaProvider>
        <TrialExpiredScreen shopName={tenant?.shop_name} />
      </SafeAreaProvider>
    );
  }

  const isCraftsman = userDept === 'Craftsman';

  return (
    <SafeAreaProvider>
      <RoleContext.Provider value={stableReset}>
        <EndDayContext.Provider value={stableEndDay}>
          <SwitchDeptContext.Provider value={stableSwitchDept}>
            {/* Trial expired banner for crew */}
            {trialExpired && role === 'crew' && <TrialExpiredBanner />}
            <NavigationContainer>
              {role === 'supervisor' ? (
                <SupervisorNavigator userName={userName} />
              ) : isCraftsman ? (
                <CraftsmanNavigator
                  userName={userName} userDept={userDept}
                  unreadCount={unreadCount} setUnreadCount={setUnreadCount}
                />
              ) : (
                <CrewNavigator
                  userName={userName} userDept={userDept}
                  unreadCount={unreadCount} setUnreadCount={setUnreadCount}
                />
              )}
            </NavigationContainer>

            {/* Dept picker — rendered outside NavigationContainer so it works from any screen */}
            <Modal
              visible={deptPickerVisible}
              animationType="slide"
              transparent
              onRequestClose={() => setDeptPickerVisible(false)}
            >
              <View style={dpStyles.overlay}>
                <View style={dpStyles.box}>
                  <View style={dpStyles.handle} />
                  <Text style={dpStyles.title}>Switch Department</Text>
                  {tenantDepartments.map(dept => {
                    const dc  = DEPT_COLORS[dept] ?? { bg: '#1f1f1f', text: '#888' };
                    const sel = dept === pendingDept;
                    return (
                      <TouchableOpacity
                        key={dept}
                        style={[dpStyles.option, sel && { borderColor: dc.text, backgroundColor: dc.bg }]}
                        onPress={() => setPendingDept(dept)}
                      >
                        <Text style={[dpStyles.optionText, sel && { color: dc.text, fontWeight: '700' }]}>{dept}</Text>
                        {sel && <Text style={{ color: dc.text, fontSize: 16 }}>✓</Text>}
                      </TouchableOpacity>
                    );
                  })}
                  <TouchableOpacity
                    style={[dpStyles.confirmBtn, !pendingDept && dpStyles.confirmBtnDisabled]}
                    onPress={() => handleDeptConfirmed(pendingDept)}
                    disabled={!pendingDept}
                    activeOpacity={0.85}
                  >
                    <Text style={dpStyles.confirmBtnText}>Switch Department</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={dpStyles.cancelBtn} onPress={() => setDeptPickerVisible(false)}>
                    <Text style={dpStyles.cancelText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>
          </SwitchDeptContext.Provider>
        </EndDayContext.Provider>
      </RoleContext.Provider>
    </SafeAreaProvider>
  );
}

// ── Styles ────────────────────────────────────────────────────
const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: C.tabBar, borderTopWidth: 1, borderTopColor: C.border,
    paddingBottom: 6, paddingTop: 6, height: 56,
  },
  tabButton: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    position: 'relative', overflow: 'visible',
  },
  tabAccent: {
    position: 'absolute', top: 0, left: 10, right: 10,
    height: 2.5, backgroundColor: '#2DE1C9',
    borderBottomLeftRadius: 2, borderBottomRightRadius: 2,
  },
  nativeBadge: { backgroundColor: '#FF4444', fontSize: 10, fontWeight: '700' },
});

const dpStyles = StyleSheet.create({
  overlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'flex-end' },
  box: {
    backgroundColor: '#0a0d10', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40,
  },
  handle:    { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(94,234,212,0.2)', alignSelf: 'center', marginBottom: 18 },
  title:     { fontSize: 20, fontWeight: '800', color: '#E6F0EE', letterSpacing: -0.3, marginBottom: 16 },
  option: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12, marginBottom: 6,
    backgroundColor: '#0f1418', borderWidth: 1.5, borderColor: 'rgba(94,234,212,0.12)',
  },
  optionText:      { color: '#9AAAA7', fontSize: 15, fontWeight: '500' },
  confirmBtn:      { marginTop: 18, backgroundColor: '#2DE1C9', borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  confirmBtnDisabled: { opacity: 0.35 },
  confirmBtnText:  { color: '#001917', fontSize: 16, fontWeight: '700' },
  cancelBtn:       { alignItems: 'center', paddingTop: 14 },
  cancelText:      { color: '#9AAAA7', fontSize: 14 },
});

const rp = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: '#050608' },
  container: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', alignItems: 'center' },
  heading:   { fontSize: 28, fontWeight: '800', color: '#E6F0EE', letterSpacing: -0.5, marginBottom: 32, marginTop: 24 },
  roleCard:  { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#0a0d10', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(94,234,212,0.12)', padding: 18, marginBottom: 12, width: '100%' },
  roleCardSup: { borderColor: 'rgba(167,139,250,0.2)' },
  roleIcon:  { width: 52, height: 52, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  roleText:  { flex: 1 },
  roleTitle: { fontSize: 17, fontWeight: '700', color: '#E6F0EE', marginBottom: 4 },
  roleDesc:  { fontSize: 12, color: '#9AAAA7', lineHeight: 17 },
  nameBox:   { marginTop: 8, width: '100%' },
  fieldLabel:{ fontSize: 10, fontWeight: '700', color: '#9AAAA7', letterSpacing: 0.9, marginBottom: 10 },
  input:     { backgroundColor: '#0f1418', borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(94,234,212,0.12)', color: '#E6F0EE', fontSize: 17, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 16 },
  goBtn:     { backgroundColor: '#2DE1C9', borderRadius: 14, paddingVertical: 17, alignItems: 'center', marginBottom: 14 },
  goBtnDisabled: { opacity: 0.35 },
  goBtnText:     { color: '#001917', fontSize: 16, fontWeight: '700' },
  errorText: { color: '#F87171', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  backBtn:   { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 8 },
  backBtnText: { color: '#9AAAA7', fontSize: 14 },
});
