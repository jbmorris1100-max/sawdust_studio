'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from './supabase';
import type { Tenant } from './auth';
import { isTenantExpired } from './auth';

export type SessionState = {
  loading:  boolean;
  tenant:   Tenant | null;
  email:    string;
};

export function useSession(): SessionState {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tenant,  setTenant]  = useState<Tenant | null>(null);
  const [email,   setEmail]   = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setEmail(session.user.email ?? '');
      supabase
        .from('tenants')
        .select('*')
        .eq('owner_user_id', session.user.id)
        .single()
        .then(({ data }) => {
          if (!data) { router.replace('/signup'); return; }
          if (isTenantExpired(data as Tenant)) { router.replace('/pricing'); return; }
          setTenant(data as Tenant);
          setLoading(false);
        });
    });
  }, [router]);

  return { loading, tenant, email };
}
