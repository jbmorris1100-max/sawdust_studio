'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Nav, Footer, BgLayers, LogoMark } from '@/components/shared';
import { supabase } from '@/lib/supabase';

function FaceIDIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/>
      <path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
      <path d="M9 10h.01"/><path d="M15 10h.01"/>
      <path d="M9 15a3 3 0 0 0 6 0"/>
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        setError('Invalid email or password.');
        return;
      }
      router.replace('/app');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <BgLayers />
      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Nav />
        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 20px' }}>
          <div style={{ width: '100%', maxWidth: 420 }}>
            <div style={{ textAlign: 'center', marginBottom: 40 }}>
              <LogoMark size={40} />
              <h2 style={{ marginTop: 20, fontSize: 28 }}>Sign in</h2>
              <p style={{ marginTop: 8, fontSize: 15 }}>Welcome back to InlineIQ</p>
            </div>

            <div style={{
              background: 'var(--bg-1)', border: '1px solid var(--line-strong)',
              borderRadius: 16, padding: '32px 28px',
              display: 'flex', flexDirection: 'column', gap: 20,
            }}>
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                <div className="form-field">
                  <label className="form-label" htmlFor="email">Email</label>
                  <input
                    id="email" className="form-input" type="email"
                    placeholder="you@yourshop.com"
                    value={email} onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email" required
                  />
                </div>

                <div className="form-field">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label className="form-label" htmlFor="password" style={{ marginBottom: 0 }}>Password</label>
                    <a href="#" style={{ fontSize: 12, color: 'var(--teal-dim)' }}>Forgot password?</a>
                  </div>
                  <input
                    id="password" className="form-input" type="password"
                    placeholder="••••••••"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password" required
                  />
                </div>

                {error && (
                  <div style={{
                    padding: '10px 14px', borderRadius: 8,
                    background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)',
                    fontSize: 13, color: 'var(--danger)',
                  }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit" className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 4, opacity: loading ? 0.7 : 1 }}
                  disabled={loading}
                >
                  {loading ? 'Signing in…' : 'Sign in'}
                </button>
              </form>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
                <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>or</span>
                <div style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              </div>

              <button className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center', gap: 10 }} type="button">
                <FaceIDIcon />
                Sign in with Face ID
              </button>

              <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>
                No account?{' '}
                <Link href="/signup" style={{ color: 'var(--teal)', fontWeight: 600 }}>Start free trial</Link>
              </p>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    </>
  );
}
