'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <rect x="22" y="22" width="20" height="20" transform="rotate(45 32 32)" stroke="#5EEAD4" strokeWidth="1.4"/>
      <circle cx="32" cy="32" r="1.5" fill="#5EEAD4"/>
      <path d="M22 32 L8 26 M22 32 L8 32 M22 32 L8 38" stroke="#14B8A6" strokeWidth="1.2"/>
      <path d="M42 32 L56 26 M42 32 L56 32 M42 32 L56 38" stroke="#5EEAD4" strokeWidth="1.2"/>
      <circle cx="56" cy="26" r="1.6" fill="#5EEAD4"/>
      <circle cx="56" cy="32" r="2" fill="#5EEAD4"/>
      <circle cx="56" cy="38" r="1.6" fill="#5EEAD4"/>
      <circle cx="8" cy="26" r="1.4" fill="#14B8A6"/>
      <circle cx="8" cy="32" r="1.4" fill="#14B8A6"/>
      <circle cx="8" cy="38" r="1.4" fill="#14B8A6"/>
    </svg>
  );
}

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const isHome = pathname === '/';

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  useEffect(() => {
    if (menuOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const close = () => setMenuOpen(false);

  return (
    <div className={`nav-wrap${scrolled ? ' scrolled' : ''}`}>
      <div className="container nav">
        <Link href="/" className="nav-logo" onClick={close}>
          <LogoMark size={22} />
          <span>inline<b>IQ</b></span>
        </Link>
        <nav className="nav-links">
          <a href={isHome ? '#features' : '/#features'}>Features</a>
          <a href={isHome ? '#intel' : '/#intel'}>Intelligence</a>
          <Link href="/pricing">Pricing</Link>
          <a href="mailto:hello@inlineiq.app">Contact</a>
        </nav>
        <div className="nav-cta">
          <Link href="/login" className="nav-signin">Sign in</Link>
          <Link href="/signup" className="btn btn-primary">Start free trial</Link>
          <button
            className={`nav-hamburger${menuOpen ? ' open' : ''}`}
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            <span /><span /><span />
          </button>
        </div>
      </div>
      <div className={`mobile-menu${menuOpen ? ' open' : ''}`}>
        <a href={isHome ? '#features' : '/#features'} onClick={close}>Features</a>
        <a href={isHome ? '#intel' : '/#intel'} onClick={close}>Intelligence</a>
        <Link href="/pricing" onClick={close}>Pricing</Link>
        <a href="mailto:hello@inlineiq.app" onClick={close}>Contact</a>
        <div className="mobile-menu-actions">
          <Link href="/login" className="btn btn-ghost" onClick={close} style={{ justifyContent: 'center' }}>Sign in</Link>
          <Link href="/signup" className="btn btn-primary" onClick={close} style={{ justifyContent: 'center' }}>Start free trial</Link>
        </div>
      </div>
    </div>
  );
}

export function Footer() {
  return (
    <footer id="contact">
      <div className="container foot">
        <div className="foot-brand">
          <LogoMark size={22} />
          inline<b>IQ</b>
          <span style={{ fontSize: 13, color: 'var(--ink-mute)', marginLeft: 8 }}>· Keep your shop sharp.</span>
        </div>
        <div className="foot-links">
          <a href="/#features">Features</a>
          <Link href="/pricing">Pricing</Link>
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
          <a href="mailto:hello@inlineiq.app">hello@inlineiq.app</a>
        </div>
        <div className="foot-copy">© 2026 InlineIQ, Inc.</div>
      </div>
    </footer>
  );
}

export function BgLayers() {
  return (
    <>
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: 'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(45,225,201,0.1), transparent)',
      }} />
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        backgroundImage: 'linear-gradient(rgba(94,234,212,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(94,234,212,0.06) 1px, transparent 1px)',
        backgroundSize: '56px 56px',
        WebkitMaskImage: 'radial-gradient(ellipse 70% 70% at 50% 20%, black 30%, transparent 100%)',
        maskImage: 'radial-gradient(ellipse 70% 70% at 50% 20%, black 30%, transparent 100%)',
      }} />
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: 0.18,
        WebkitMaskImage: 'radial-gradient(ellipse 55% 55% at 50% 50%, black 20%, transparent 75%)',
        maskImage: 'radial-gradient(ellipse 55% 55% at 50% 50%, black 20%, transparent 75%)',
      }}>
        <LogoMark size={360} />
      </div>
    </>
  );
}
