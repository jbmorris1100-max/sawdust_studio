import 'react-native-url-polyfill/auto';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Text, View, StyleSheet, TouchableOpacity,
  TextInput, SafeAreaView, StatusBar,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './src/lib/supabase';
import { registerForPushNotifications } from './src/lib/notifications';
import InlineIQLogo from './src/components/InlineIQLogo';
import { RoleContext }    from './src/lib/RoleContext';
import { EndDayContext }  from './src/lib/EndDayContext';
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

// ── Colors ────────────────────────────────────────────────────
const C = {
  bg:       '#07090F',
  surface:  '#0D1117',
  input:    '#111620',
  border:   '#1A2535',
  text:     '#FFFFFF',
  muted:    '#2D8A94',
  tabBar:   '#07090F',
  active:   '#00C5CC',
  inactive: '#2D8A94',
  badge:    '#FF4444',
  blue:     '#3b82f6',
  pink:     '#f9a8d4',
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

  return (
    <SafeAreaView style={rp.safe}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <KeyboardAvoidingView style={rp.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <InlineIQLogo size="medium" />
        <Text style={rp.heading}>Who are you?</Text>

        {!pickingSupervisor ? (
          <>
            <TouchableOpacity style={rp.roleCard} onPress={() => onSelect('crew')} activeOpacity={0.8}>
              <View style={[rp.roleIcon, { backgroundColor: C.active + '22' }]}>
                <Ionicons name="construct-outline" size={30} color={C.active} />
              </View>
              <View style={rp.roleText}>
                <Text style={rp.roleTitle}>I'm Crew</Text>
                <Text style={rp.roleDesc}>Log inventory, scan parts, report damage, send messages</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.border} />
            </TouchableOpacity>

            <TouchableOpacity style={[rp.roleCard, rp.roleCardSup]} onPress={() => setPickingSupervisor(true)} activeOpacity={0.8}>
              <View style={[rp.roleIcon, { backgroundColor: C.blue + '22' }]}>
                <Ionicons name="shield-checkmark-outline" size={30} color={C.blue} />
              </View>
              <View style={rp.roleText}>
                <Text style={[rp.roleTitle, { color: C.blue }]}>I'm Supervisor</Text>
                <Text style={rp.roleDesc}>Monitor crew, manage inventory, reply to messages</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.border} />
            </TouchableOpacity>
          </>
        ) : (
          <View style={rp.nameBox}>
            <Text style={rp.fieldLabel}>SUPERVISOR NAME</Text>
            <TextInput
              style={rp.input} placeholder="e.g. Mike Torres"
              placeholderTextColor={C.muted} value={name}
              onChangeText={setName} autoFocus
            />
            <TouchableOpacity
              style={[rp.goBtn, !name.trim() && rp.goBtnDisabled]}
              onPress={() => onSelect('supervisor', name.trim())}
              disabled={!name.trim()} activeOpacity={0.85}
            >
              <Text style={rp.goBtnText}>Enter Supervisor Dashboard</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setPickingSupervisor(false); setName(''); }} style={rp.backBtn}>
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
        tabBarActiveTintColor:   C.pink,
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
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'checkmark-circle' : 'checkmark-circle-outline'} size={size} color={color} />
          ),
        }}
      />
      <CraftsmanTab.Screen
        name="Needs"
        component={InventoryScreen}
        initialParams={params}
        options={{
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'cube' : 'cube-outline'} size={size} color={color} />
          ),
        }}
      />
      <CraftsmanTab.Screen
        name="Damage"
        component={DamageScreen}
        initialParams={params}
        options={{
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'warning' : 'warning-outline'} size={size} color={color} />
          ),
        }}
      />
      <CraftsmanTab.Screen
        name="Messages"
        component={MessagesScreen}
        initialParams={params}
        options={{
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'} size={size} color={color} />
          ),
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
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ScanPart"
        component={PartsScreen}
        initialParams={params}
        options={{
          title: 'Parts',
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'scan' : 'scan-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Needs"
        component={InventoryScreen}
        initialParams={params}
        options={{
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'cube' : 'cube-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Damage"
        component={DamageScreen}
        initialParams={params}
        options={{
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'warning' : 'warning-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Messages"
        component={MessagesScreen}
        initialParams={params}
        options={{
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'} size={size} color={color} />
          ),
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarBadgeStyle: styles.nativeBadge,
        }}
        listeners={{ tabPress: () => setUnreadCount(0) }}
      />
      <Tab.Screen
        name="SOPs"
        component={SOPsScreen}
        initialParams={params}
        options={{
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'book' : 'book-outline'} size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Plans"
        component={PlansScreen}
        initialParams={params}
        options={{
          tabBarButton: (props) => <TabButton {...props} />,
          tabBarIcon: ({ focused, color, size }) => (
            <Ionicons name={focused ? 'document-text' : 'document-text-outline'} size={size} color={color} />
          ),
        }}
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
    const deviceId = await getDeviceId();

    if (selectedRole === 'supervisor' && name) {
      const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
      const { data: activeSessions } = await supabase
        .from('supervisor_sessions').select('name, device_id')
        .eq('is_active', true).gte('logged_in_at', cutoff);

      const conflict = activeSessions?.find(s => s.name.toLowerCase() !== name.toLowerCase());
      if (conflict) {
        Alert.alert('Supervisor Already Live', `Supervisor already logged in as ${conflict.name}.`);
        return;
      }
      await supabase.from('supervisor_sessions').insert({ name, device_id: deviceId, is_active: true });
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
    await supabase.from('login_log').insert({ worker_name: displayName, dept, role: selectedRole, device_id: deviceId, app_version: '2' }).catch(console.warn);

    setRole(selectedRole);
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

  const resetRoleRef  = useRef(null); resetRoleRef.current  = handleResetRole;
  const endDayRef     = useRef(null); endDayRef.current     = handleEndDayReset;
  const stableReset   = useCallback(() => resetRoleRef.current?.(),  []);
  const stableEndDay  = useCallback(() => endDayRef.current?.(),     []);

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
    setTenant(tenantData);
    setShowFullOnboarding(false);
    setUserName(name);
    setRole('');
  }, []);

  if (role === null) return null;

  // Show full onboarding for new installs
  if (showFullOnboarding) {
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
    height: 2.5, backgroundColor: '#00C5CC',
    borderBottomLeftRadius: 2, borderBottomRightRadius: 2,
  },
  nativeBadge: { backgroundColor: '#FF4444', fontSize: 10, fontWeight: '700' },
});

const rp = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: C.bg },
  container: { flex: 1, paddingHorizontal: 24, justifyContent: 'center', alignItems: 'stretch' },
  heading:   { fontSize: 28, fontWeight: '800', color: C.text, letterSpacing: -0.5, marginBottom: 32, marginTop: 24 },
  roleCard:  { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: '#222', padding: 18, marginBottom: 12 },
  roleCardSup: { borderColor: C.blue + '30' },
  roleIcon:  { width: 52, height: 52, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  roleText:  { flex: 1 },
  roleTitle: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 4 },
  roleDesc:  { fontSize: 12, color: C.muted, lineHeight: 17 },
  nameBox:   { marginTop: 8 },
  fieldLabel:{ fontSize: 10, fontWeight: '700', color: C.muted, letterSpacing: 0.9, marginBottom: 10 },
  input:     { backgroundColor: C.input, borderRadius: 14, borderWidth: 1.5, borderColor: C.border, color: C.text, fontSize: 17, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 16 },
  goBtn:     { backgroundColor: C.blue, borderRadius: 14, paddingVertical: 17, alignItems: 'center', marginBottom: 14 },
  goBtnDisabled: { opacity: 0.35 },
  goBtnText:     { color: '#fff', fontSize: 16, fontWeight: '700' },
  backBtn:   { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 8 },
  backBtnText: { color: C.muted, fontSize: 14 },
});
