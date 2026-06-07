// Sections — split out to keep files small

const Nav = () => (
  <div className="nav-wrap">
    <div className="container nav">
      <a className="nav-logo" href="#">
        <LogoMark />
        <span>inline<b>IQ</b></span>
      </a>
      <nav className="nav-links">
        <a href="#features">Features</a>
        <a href="#intel">Intelligence</a>
        <a href="#pricing">Pricing</a>
        <a href="#contact">Contact</a>
      </nav>
      <div className="nav-cta">
        <a href="#" style={{fontSize:14, color:'var(--ink-dim)'}}>Sign in</a>
        <a className="btn btn-primary" href="#cta">Start free trial</a>
      </div>
    </div>
  </div>
);

const HEADLINES = {
  brand: { h1: <>InlineIQ runs your shop <em>so you can run your business.</em></>,
           sub: 'The 1–2 tap shop floor system that captures every minute, every part, and every dollar — then turns it into the data your bids have always been missing.' },
  problem: { h1: <>Your floor is blind. <em>Your bids are guesses.</em></>,
             sub: 'InlineIQ is the shop floor workflow app that finally connects what your crew is doing to what your business needs to know.' },
  tagline: { h1: <>Keep your shop <em>sharp.</em></>,
             sub: 'A 1–2 tap workflow app for the floor. A live command view for supervisors. The labor and cost data your business has never had — until now.' },
};

const Hero = ({ headline }) => {
  const h = HEADLINES[headline] || HEADLINES.brand;
  return (
    <section className="hero">
      <div className="container hero-grid">
        <div>
          <div className="row" style={{marginBottom:24, gap:8}}>
            <span className="pill" style={{fontSize:11}}>● Live on the floor</span>
            <span className="small muted">Cabinetry · Metalwork · Stone · Custom Fab</span>
          </div>
          <h1>{h.h1}</h1>
          <p className="hero-sub" style={{marginTop:24}}>{h.sub}</p>
          <div className="hero-actions">
            <a className="btn btn-primary" href="#cta">Start free trial <I.arrow size={16}/></a>
            <a className="btn btn-ghost" href="#features">See it work</a>
          </div>
          <div className="hero-meta">
            <div className="item"><b>1–2 taps</b><span>per action</span></div>
            <div className="item"><b>100%</b><span>labor logged</span></div>
            <div className="item"><b>6 AM</b><span>AI brief, daily</span></div>
          </div>
        </div>
        <div className="hero-visual">
          <div className="laptop">
            <div className="laptop-bar">
              <span className="dot"/><span className="dot"/><span className="dot"/>
              <div className="url">app.inlineiq.com / supervisor</div>
            </div>
            <div style={{height:'calc(100% - 28px)'}}><SupervisorDash/></div>
          </div>
          <div className="phone"><CrewPhone/></div>
        </div>
      </div>
    </section>
  );
};

const CAPS = [
  ['scan', 'QR + AI Part Scanning', 'Scan a part, time logs to the right job. No label? Camera ID by photo.'],
  ['clock', 'Automatic Time Tracking', 'Every scan opens an entry. Every switch closes one. Zero timesheets.'],
  ['swap', 'Quick Switch', 'One tap moves crew between jobs, cleaning, maintenance — every transition stamped.'],
  ['brief', 'AI Morning Brief', '6 AM, on your phone: jobs over budget, materials to order, what matters.'],
  ['track', 'Real-Time Part Tracking', 'Every scan confirms a part. Where it is, who touched it, and when.'],
  ['damage', 'Damage Reporting', 'Photo + one sentence. Supervisor notified, system flagged, in 30 seconds.'],
  ['inv', 'Inventory Needs', 'Crew submits a need in one field. Materials get ordered before work stops.'],
  ['craft', 'Craftsman QC Workflow', 'Live timer for raw lumber and custom millwork. True cost, finally captured.'],
  ['command', 'Supervisor Command View', 'Who\u2019s on what, for how long. Damage and inventory resolved in one tap.'],
  ['cost', 'Job Costing Intelligence', 'Actual hours vs estimate — per job, per crew. The data that tightens bids.'],
  ['msg', 'Crew Messaging', 'Department-scoped chat. Mention a job number, it posts as a job note.'],
  ['doc', 'SOPs & Job Drawings', 'Right SOP, right plan, right moment. No binders, no email digging.'],
];

const Capabilities = () => (
  <section className="section" id="features">
    <div className="container">
      <div className="section-head">
        <span className="eyebrow">The system</span>
        <h2>Twelve capabilities. <span className="text-teal">One unified shop floor.</span></h2>
        <p>Every InlineIQ feature is built around the same rule: 1–2 taps on the floor, real data in the office. Nothing else.</p>
      </div>
      <div className="cap-grid">
        {CAPS.map(([icon, title, desc]) => {
          const Ico = I[icon];
          return (
            <div className="cap" key={title}>
              <div className="cap-icon"><Ico size={18}/></div>
              <h4>{title}</h4>
              <p>{desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  </section>
);

const DeepDive = ({ flip, eyebrow, title, body, bullets, visual }) => (
  <div className={`deep ${flip ? 'flip' : ''}`}>
    <div className="deep-copy">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p>{body}</p>
      <ul className="deep-list">
        {bullets.map((b,i) => <li key={i}><span className="dot"/>{b}</li>)}
      </ul>
    </div>
    <div className="deep-visual">{visual}</div>
  </div>
);

const Deepdives = () => (
  <section className="section-tight" style={{borderTop:'1px solid var(--line)'}}>
    <div className="container">
      <DeepDive
        eyebrow="01 · The scan"
        title={<>One tap on the floor. <span className="text-teal">Every minute, on the right job.</span></>}
        body="A QR scan or — when the label is gone — a photo. The AI matches material, dimensions, and markings to the active work order. The crew confirms once. Time logs. The part is marked confirmed."
        bullets={[
          'AI part identification from photo when QR is missing or damaged',
          'Confirms material, dimensions, and the active work order in under 2 seconds',
          'Opens the time entry automatically — no manual start/stop',
        ]}
        visual={<ScanMock/>}
      />
      <DeepDive
        flip
        eyebrow="02 · The labor log"
        title={<>Every hour accounted for. <span className="text-teal">Without anyone filling out a timesheet.</span></>}
        body="Every scan opens a time entry. Every Quick Switch closes the previous one and opens a new one. Every End Day closes the final entry. The labor log writes itself — accurately — for every employee, every day."
        bullets={[
          'Automatic time entries on scan, switch, and end-of-day',
          'Quick Switch covers production, cleaning, maintenance, receiving',
          'Job-level actuals feed straight into costing and bids',
        ]}
        visual={<TimeTrackMock/>}
      />
      <DeepDive
        eyebrow="03 · The morning brief"
        title={<>Walk in already knowing <span className="text-teal">what matters.</span></>}
        body="Every morning at 6 AM, InlineIQ analyzes your floor data and delivers a complete shop status to your phone. Jobs over budget. Materials to order. Open damage reports. Yesterday's crew summary. Before anyone asks you a question, you have the answer."
        bullets={[
          'Daily 6 AM brief, generated from yesterday\u2019s floor data',
          'Surfaces over-budget jobs, low materials, and open issues first',
          'Gets sharper the longer InlineIQ runs in your shop',
        ]}
        visual={<AIBriefMock/>}
      />
    </div>
  </section>
);

const Intel = () => (
  <section className="section" id="intel">
    <div className="container">
      <div className="intel">
        <div className="intel-grid">
          <div>
            <span className="eyebrow">Intelligence Layer</span>
            <h2 style={{marginTop:14}}>AI that <span className="text-teal">learns your shop.</span></h2>
            <p>InlineIQ doesn't just collect data — it gets smarter the longer you use it. The AI learns your production patterns, your job types, your crew behaviors, and your cost structures over time. The morning brief gets sharper. Part identification gets faster. Cost comparisons get more accurate.</p>
            <p style={{marginTop:14}}>Every shop is different. InlineIQ adapts to yours.</p>
            <div className="intel-pills">
              <span className="pill">Pattern recognition</span>
              <span className="pill">Job type modeling</span>
              <span className="pill">Bid calibration</span>
              <span className="pill">Anomaly detection</span>
              <span className="pill">Photo \u2192 Part matching</span>
            </div>
          </div>
          <div style={{
            position:'relative', minHeight:340,
            border:'1px solid var(--line-strong)', borderRadius:14,
            background:'#06080a', padding:24, overflow:'hidden'
          }}>
            <div style={{position:'absolute', inset:0, background:'radial-gradient(circle at 30% 40%, rgba(45,225,201,0.18), transparent 50%)'}}/>
            <div style={{position:'relative', display:'flex', flexDirection:'column', gap:14}}>
              <div style={{fontSize:10, color:'#9AAAA7', letterSpacing:'0.12em', textTransform:'uppercase'}}>Bid Calibration · 90 days</div>
              <div style={{display:'grid', gridTemplateColumns:'1fr auto', alignItems:'baseline', gap:8}}>
                <div style={{fontSize:13, color:'#E6F0EE'}}>Estimate accuracy</div>
                <div style={{fontSize:32, color:'#5EEAD4', fontWeight:600, letterSpacing:'-0.02em'}}>+18.4%</div>
              </div>
              <svg viewBox="0 0 300 90" style={{width:'100%', height:90}}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#5EEAD4" stopOpacity="0.4"/>
                    <stop offset="1" stopColor="#5EEAD4" stopOpacity="0"/>
                  </linearGradient>
                </defs>
                <path d="M0,70 L30,68 L60,60 L90,62 L120,52 L150,48 L180,42 L210,30 L240,28 L270,18 L300,12 L300,90 L0,90 Z" fill="url(#g1)"/>
                <path d="M0,70 L30,68 L60,60 L90,62 L120,52 L150,48 L180,42 L210,30 L240,28 L270,18 L300,12" fill="none" stroke="#5EEAD4" strokeWidth="1.5"/>
              </svg>
              <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:10, marginTop:8}}>
                {[['Days', '90'], ['Jobs', '184'], ['Hours', '11.2k']].map(([l,v]) => (
                  <div key={l} style={{padding:'10px 12px', border:'1px solid var(--line)', borderRadius:8}}>
                    <div style={{fontSize:9, color:'#9AAAA7', letterSpacing:'0.08em', textTransform:'uppercase'}}>{l}</div>
                    <div style={{fontSize:18, color:'#E6F0EE', fontWeight:600, marginTop:3, letterSpacing:'-0.02em'}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

const PRICING = [
  { name: 'Starter', price: 0, priceLabel: 'Free', period: '30-day trial',
    desc: 'Get the full system in your shop for a month. No credit card.',
    cta: 'Start 30-day free trial',
    features: ['Full crew + supervisor apps', 'Scan + automatic time tracking', 'Damage & inventory reports', 'Email support', 'Convert anytime'] },
  { name: 'Shop', price: 399, period: 'per shop / month', featured: true,
    desc: 'The full InlineIQ system for a working production shop.',
    cta: 'Start free trial',
    features: ['Unlimited crew per shop', 'AI Part Identification', 'AI Morning Brief', 'Job Costing Intelligence', 'Crew messaging + SOPs', 'Priority support'] },
  { name: 'Operations', price: 599, period: 'per shop / month',
    desc: 'For multi-shop operators and custom-fab businesses that need more.',
    cta: 'Talk to sales',
    features: ['Everything in Shop', 'Multi-shop rollouts', 'API + ERP integrations (QuickBooks, etc.)', 'Custom AI tuning', 'Dedicated success manager', 'SSO + audit logs'] },
];

const Pricing = () => (
  <section className="section" id="pricing">
    <div className="container">
      <div className="section-head">
        <span className="eyebrow">Pricing</span>
        <h2>One price per shop. <span className="text-teal">Unlimited crew.</span></h2>
        <p>No per-seat math. Add every supervisor, every crew member, every department — one flat monthly price for the whole floor.</p>
      </div>
      <div className="price-grid">
        {PRICING.map(t => (
          <div key={t.name} className={`price-card ${t.featured ? 'featured' : ''}`}>
            <div className="price-name">{t.name}</div>
            <div>
              <div className="price-amount">
                {t.price === 0 ? (
                  <b>{t.priceLabel}</b>
                ) : (
                  <><b>${t.price}</b><span>/ {t.period}</span></>
                )}
              </div>
              {t.price === 0 && <div style={{fontSize:13, color:'var(--ink-mute)', marginTop:4}}>{t.period}</div>}
              <div className="price-desc" style={{marginTop:10}}>{t.desc}</div>
            </div>
            <a className={`btn ${t.featured ? 'btn-primary' : 'btn-ghost'}`} style={{justifyContent:'center'}} href="#cta">
              {t.cta}
            </a>
            <ul className="price-features">
              {t.features.map(f => (
                <li key={f}><I.check size={14}/><span>{f}</span></li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  </section>
);

const FinalCTA = () => (
  <section className="final" id="cta">
    <div className="container">
      <span className="eyebrow">Keep your shop sharp</span>
      <h2 style={{marginTop:18}}>Connect your floor to your business <span className="text-teal">in under a week.</span></h2>
      <p>30-day free trial. No credit card. Bring one supervisor and one crew member — we'll have them scanning before lunch.</p>
      <div className="row center" style={{gap:14, flexWrap:'wrap'}}>
        <a className="btn btn-primary" href="#">Start free trial <I.arrow size={16}/></a>
        <a className="btn btn-ghost" href="#">Book a demo</a>
      </div>
    </div>
  </section>
);

const Footer = () => (
  <footer id="contact">
    <div className="container foot">
      <div className="row" style={{gap:10}}>
        <LogoMark size={22}/>
        <span style={{fontSize:14}}>inline<b style={{color:'var(--teal)'}}>IQ</b></span>
        <span className="muted small" style={{marginLeft:8}}>· Keep your shop sharp.</span>
      </div>
      <div className="foot-links">
        <a href="#features">Features</a>
        <a href="#pricing">Pricing</a>
        <a href="#">Privacy</a>
        <a href="#">Terms</a>
        <a href="mailto:hello@inlineiq.com">hello@inlineiq.com</a>
      </div>
      <div className="muted small">© 2026 InlineIQ, Inc.</div>
    </div>
  </footer>
);

Object.assign(window, { Nav, Hero, Capabilities, Deepdives, Intel, Pricing, FinalCTA, Footer, HEADLINES });
