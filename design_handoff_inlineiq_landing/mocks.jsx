// Realistic dashboard + phone screen mocks used inside hero / deep-dives

const LogoMark = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
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

const Sparkline = ({ points, color = '#5EEAD4', area = true }) => {
  const w = 80, h = 14;
  const max = Math.max(...points), min = Math.min(...points);
  const range = max - min || 1;
  const path = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w;
    const y = h - ((p - min) / range) * h;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{width:'100%'}}>
      {area && <path d={`${path} L${w},${h} L0,${h} Z`} fill={color} fillOpacity="0.12"/>}
      <path d={path} fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
};

const SupervisorDash = () => (
  <div className="dash">
    <aside className="dash-side">
      <div className="brand"><LogoMark size={20}/></div>
      <a className="active"><I.command size={14}/></a>
      <a><I.track size={14}/></a>
      <a><I.cost size={14}/></a>
      <a><I.damage size={14}/></a>
      <a><I.inv size={14}/></a>
      <a><I.msg size={14}/></a>
      <a><I.doc size={14}/></a>
      <div className="spacer"/>
      <a><I.spark size={14}/></a>
    </aside>
    <main className="dash-main">
      <div className="dash-topbar">
        <div className="crumb">
          <b>Floor</b>
          <span className="sep">/</span>
          <span style={{color:'var(--ink-dim)'}}>Live</span>
          <span className="live">Live</span>
        </div>
        <div className="meta">
          <span>Tue · Mar 4</span>
          <span className="clock">11:42:08</span>
          <span style={{color:'var(--teal)'}}>14 clocked in</span>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="accent"/>
          <div className="label">On Job</div>
          <div className="val">11<small>+2</small></div>
          <Sparkline points={[6,7,7,8,9,9,10,11]}/>
        </div>
        <div className="kpi">
          <div className="accent"/>
          <div className="label">Hours Today</div>
          <div className="val">86.4<small>hrs</small></div>
          <Sparkline points={[10,28,42,58,70,80,86]}/>
        </div>
        <div className="kpi warn">
          <div className="accent"/>
          <div className="label">Over Budget</div>
          <div className="val">2<small>jobs</small></div>
          <Sparkline points={[1,1,2,2,2,2,2]} color="#FBBF24"/>
        </div>
        <div className="kpi bad">
          <div className="accent"/>
          <div className="label">Open Issues</div>
          <div className="val">4<small>new</small></div>
          <Sparkline points={[2,2,3,3,4,4,4]} color="#F87171"/>
        </div>
      </div>

      <div className="dash-split">
        <div className="panel">
          <div className="panel-head">
            <span className="title">Active Crew</span>
            <span className="count">14 / 16</span>
          </div>
          <div style={{flex:1, overflow:'hidden'}}>
            <div className="crew-row">
              <div className="name">
                <div className="ava">M</div>
                <div>
                  <b>Marcus T.</b>
                  <div className="role">Production</div>
                </div>
              </div>
              <div className="job">
                <b>JOB-2841 · Door Frames</b>
                <div className="progress"><div style={{right:'30%'}}/></div>
              </div>
              <div className="time">02:14:08</div>
              <div><span className="badge run">RUN</span></div>
            </div>
            <div className="crew-row">
              <div className="name">
                <div className="ava">A</div>
                <div>
                  <b>Ana R.</b>
                  <div className="role">QC</div>
                </div>
              </div>
              <div className="job">
                <b>JOB-2839 · Drawer Fronts</b>
                <div className="progress"><div style={{right:'18%'}}/></div>
              </div>
              <div className="time">01:47:33</div>
              <div><span className="badge qc">QC</span></div>
            </div>
            <div className="crew-row">
              <div className="name">
                <div className="ava">D</div>
                <div>
                  <b>Devon W.</b>
                  <div className="role">Maint.</div>
                </div>
              </div>
              <div className="job">
                <b>Maintenance — CNC #2</b>
                <div className="progress"><div style={{right:'60%', background:'#FBBF24', boxShadow:'0 0 6px #FBBF24'}}/></div>
              </div>
              <div className="time">00:22:11</div>
              <div><span className="badge idle">SWITCH</span></div>
            </div>
            <div className="crew-row">
              <div className="name">
                <div className="ava">J</div>
                <div>
                  <b>Jason P.</b>
                  <div className="role">Production</div>
                </div>
              </div>
              <div className="job">
                <b>JOB-2841 · Damage Pending</b>
                <div className="progress"><div style={{right:'85%', background:'#F87171', boxShadow:'0 0 6px #F87171'}}/></div>
              </div>
              <div className="time">00:04:52</div>
              <div><span className="badge dmg">DMG</span></div>
            </div>
            <div className="crew-row">
              <div className="name">
                <div className="ava">S</div>
                <div>
                  <b>Sara K.</b>
                  <div className="role">Assembly</div>
                </div>
              </div>
              <div className="job">
                <b>JOB-2843 · Assembly</b>
                <div className="progress"><div style={{right:'10%'}}/></div>
              </div>
              <div className="time">03:08:40</div>
              <div><span className="badge run">RUN</span></div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="title">Department Load</span>
            <span className="count">% of capacity</span>
          </div>
          <div style={{padding:'4px 0'}}>
            <div className="dept-row">
              <span className="lbl">Production</span>
              <div className="bar"><div style={{right:'10%', background:'linear-gradient(90deg, #5EEAD4, #2DE1C9)', boxShadow:'0 0 6px rgba(45,225,201,0.5)'}}/></div>
              <span className="num">90%</span>
            </div>
            <div className="dept-row">
              <span className="lbl">Assembly</span>
              <div className="bar"><div style={{right:'28%', background:'linear-gradient(90deg, #5EEAD4, #2DE1C9)'}}/></div>
              <span className="num">72%</span>
            </div>
            <div className="dept-row">
              <span className="lbl">QC</span>
              <div className="bar"><div style={{right:'45%', background:'linear-gradient(90deg, #5EEAD4, #14B8A6)'}}/></div>
              <span className="num">55%</span>
            </div>
            <div className="dept-row">
              <span className="lbl">Receiving</span>
              <div className="bar"><div style={{right:'70%', background:'#FBBF24'}}/></div>
              <span className="num">30%</span>
            </div>
            <div className="dept-row">
              <span className="lbl">Maint.</span>
              <div className="bar"><div style={{right:'85%', background:'rgba(94,234,212,0.4)'}}/></div>
              <span className="num">15%</span>
            </div>
          </div>
          <div style={{marginTop:'auto', padding:'10px 12px', borderTop:'1px solid var(--line)', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <div>
              <div style={{fontSize:8.5, color:'var(--ink-mute)', letterSpacing:'0.12em', textTransform:'uppercase', fontWeight:600}}>Bid Accuracy · 30d</div>
              <div style={{fontSize:18, color:'var(--teal)', fontWeight:600, marginTop:2, letterSpacing:'-0.02em'}}>+18.4%</div>
            </div>
            <I.spark size={20} style={{color:'var(--teal)', opacity:0.8}}/>
          </div>
        </div>
      </div>
    </main>
  </div>
);

const CrewPhone = () => (
  <div className="phone-inner" style={{display:'flex', flexDirection:'column'}}>
    <div className="ph-status"><span>9:41</span><span>●●● 5G</span></div>
    <div className="ph-body" style={{flex:1, display:'flex', flexDirection:'column'}}>
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <LogoMark size={18}/>
        <div style={{display:'flex', alignItems:'center', gap:4}}>
          <div style={{width:5, height:5, borderRadius:99, background:'#34D399'}}/>
          <span style={{fontSize:8, color:'#9AAAA7'}}>Marcus T.</span>
        </div>
      </div>
      <div className="ph-current">
        <div className="lbl">Current Job</div>
        <div className="val">JOB-2841 · Door Frames</div>
        <div className="meta"><span>⏱ 02:14:08</span><span>Production</span></div>
      </div>
      <div className="ph-row">
        <div className="ph-cell"><I.inv size={11}/><b style={{color:'#E6F0EE'}}>Log Need</b></div>
        <div className="ph-cell" style={{color:'#F87171'}}><I.damage size={11}/><b style={{color:'#E6F0EE'}}>Damage</b></div>
      </div>
      <div style={{flex:1}}/>
      <div className="ph-cta">⌗ Scan New Part</div>
      <div style={{textAlign:'center', fontSize:9, color:'#5F6F6C', marginTop:6}}>⇄ Quick Switch</div>
    </div>
  </div>
);

// Compact AI brief mock for deep-dive
const AIBriefMock = () => (
  <div style={{
    border:'1px solid var(--line-strong)', borderRadius:18, padding:24,
    background:'linear-gradient(180deg, rgba(45,225,201,0.04), rgba(5,7,9,0.9))',
    fontSize:13, display:'flex', flexDirection:'column', gap:16, position:'relative', overflow:'hidden'
  }}>
    <div style={{position:'absolute', top:-30, right:-30, width:160, height:160, background:'radial-gradient(circle, rgba(45,225,201,0.18), transparent 70%)', filter:'blur(20px)'}}/>
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
      <div style={{display:'flex', alignItems:'center', gap:8}}>
        <div style={{width:28, height:28, borderRadius:8, background:'rgba(94,234,212,0.1)', display:'grid', placeItems:'center', color:'#5EEAD4'}}>
          <I.spark size={14}/>
        </div>
        <div>
          <div style={{fontSize:10, color:'#9AAAA7', letterSpacing:'0.1em', textTransform:'uppercase'}}>AI Morning Brief</div>
          <div style={{fontSize:13, color:'#E6F0EE', fontWeight:600, letterSpacing:'-0.01em'}}>Tuesday · 6:00 AM</div>
        </div>
      </div>
      <div style={{fontSize:10, color:'#5EEAD4'}}>● Live</div>
    </div>

    <div style={{display:'flex', flexDirection:'column', gap:10}}>
      <div style={{display:'flex', gap:10, alignItems:'flex-start', padding:12, border:'1px solid var(--line)', borderRadius:10, background:'rgba(248,113,113,0.04)'}}>
        <div style={{width:6, height:6, borderRadius:99, background:'#F87171', marginTop:6, flex:'none', boxShadow:'0 0 8px #F87171'}}/>
        <div style={{flex:1}}>
          <div style={{fontSize:11, color:'#F87171', letterSpacing:'0.08em', textTransform:'uppercase', fontWeight:600}}>2 Jobs Over Budget</div>
          <div style={{fontSize:13, color:'#E6F0EE', marginTop:3}}>JOB-2841 at 118% · JOB-2839 at 104%. Both still in production.</div>
        </div>
      </div>
      <div style={{display:'flex', gap:10, alignItems:'flex-start', padding:12, border:'1px solid var(--line)', borderRadius:10, background:'rgba(251,191,36,0.04)'}}>
        <div style={{width:6, height:6, borderRadius:99, background:'#FBBF24', marginTop:6, flex:'none'}}/>
        <div style={{flex:1}}>
          <div style={{fontSize:11, color:'#FBBF24', letterSpacing:'0.08em', textTransform:'uppercase', fontWeight:600}}>Order Today</div>
          <div style={{fontSize:13, color:'#E6F0EE', marginTop:3}}>3/4" maple ply · soft-close hinges (×24) · drawer slides 18".</div>
        </div>
      </div>
      <div style={{display:'flex', gap:10, alignItems:'flex-start', padding:12, border:'1px solid var(--line)', borderRadius:10}}>
        <div style={{width:6, height:6, borderRadius:99, background:'#5EEAD4', marginTop:6, flex:'none', boxShadow:'0 0 8px #5EEAD4'}}/>
        <div style={{flex:1}}>
          <div style={{fontSize:11, color:'#5EEAD4', letterSpacing:'0.08em', textTransform:'uppercase', fontWeight:600}}>Yesterday</div>
          <div style={{fontSize:13, color:'#E6F0EE', marginTop:3}}>14 crew · 112.4 hrs logged · 8 parts confirmed · 1 damage report.</div>
        </div>
      </div>
    </div>
  </div>
);

const ScanMock = () => (
  <div style={{
    border:'1px solid var(--line-strong)', borderRadius:18, padding:24,
    background:'linear-gradient(180deg, rgba(10,14,17,0.9), rgba(5,7,9,0.95))',
    display:'flex', gap:20, alignItems:'center', position:'relative'
  }}>
    {/* Phone with scan */}
    <div style={{
      width:200, aspectRatio:'9/19', flex:'none',
      borderRadius:24, background:'#000', border:'1px solid var(--line-strong)',
      padding:6, position:'relative', boxShadow:'0 20px 50px rgba(0,0,0,0.5), 0 0 50px rgba(45,225,201,0.12)'
    }}>
      <div style={{
        background:'#0a0d10', height:'100%', borderRadius:18, position:'relative', overflow:'hidden',
        display:'flex', flexDirection:'column'
      }}>
        <div style={{padding:'8px 10px', fontSize:8, color:'#9AAAA7', display:'flex', justifyContent:'space-between'}}>
          <span>9:41</span><span>5G</span>
        </div>
        <div style={{flex:1, position:'relative', margin:'0 12px', borderRadius:12, border:'1px dashed rgba(94,234,212,0.4)', overflow:'hidden', background:'#020303'}}>
          {/* part placeholder w/ QR */}
          <div style={{position:'absolute', inset:'24% 16%', borderRadius:6, background:'linear-gradient(135deg, #1a1410, #2d2218)', border:'1px solid rgba(255,255,255,0.05)', display:'grid', placeItems:'center'}}>
            <svg viewBox="0 0 21 21" style={{width:'58%', height:'58%', background:'#fff', padding:2, borderRadius:2}} shapeRendering="crispEdges">
              {/* QR-like pattern */}
              <rect x="0" y="0" width="21" height="21" fill="#fff"/>
              {/* Three position markers */}
              {[[0,0],[14,0],[0,14]].map(([x,y],i)=>(
                <g key={i}>
                  <rect x={x} y={y} width="7" height="7" fill="#000"/>
                  <rect x={x+1} y={y+1} width="5" height="5" fill="#fff"/>
                  <rect x={x+2} y={y+2} width="3" height="3" fill="#000"/>
                </g>
              ))}
              {/* Data pattern */}
              {[
                [8,0],[10,0],[12,0],[8,2],[11,2],[9,3],[12,3],[8,4],[10,4],[12,4],
                [0,8],[2,8],[3,8],[5,8],[8,8],[10,8],[12,8],[14,8],[16,8],[18,8],[20,8],
                [1,9],[4,9],[7,9],[11,9],[13,9],[15,9],[17,9],[19,9],
                [0,10],[2,10],[3,10],[6,10],[9,10],[12,10],[14,10],[16,10],[18,10],[20,10],
                [1,11],[5,11],[8,11],[10,11],[13,11],[17,11],[19,11],
                [0,12],[3,12],[6,12],[8,12],[11,12],[12,12],[14,12],[16,12],[18,12],[20,12],
                [8,14],[10,14],[12,14],[14,14],[16,14],[18,14],[20,14],
                [9,15],[11,15],[13,15],[15,15],[17,15],[19,15],
                [8,16],[10,16],[12,16],[14,16],[16,16],[18,16],[20,16],
                [9,17],[11,17],[13,17],[15,17],[17,17],[19,17],
                [8,18],[10,18],[12,18],[14,18],[16,18],[18,18],[20,18],
                [9,19],[11,19],[13,19],[15,19],[17,19],[19,19],
                [8,20],[10,20],[12,20],[14,20],[16,20],[18,20],[20,20],
              ].map(([x,y],i) => <rect key={i} x={x} y={y} width="1" height="1" fill="#000"/>)}
            </svg>
          </div>
          {/* scan line */}
          <div style={{position:'absolute', left:0, right:0, top:0, height:3, background:'linear-gradient(90deg, transparent, #5EEAD4, transparent)', boxShadow:'0 0 12px #5EEAD4', animation:'scan 2s infinite linear'}}/>
          {/* corners */}
          {[['T','L'],['T','R'],['B','L'],['B','R']].map(([v,h],i)=>(
            <div key={i} style={{position:'absolute', width:14, height:14, borderColor:'#5EEAD4', borderStyle:'solid', borderWidth:0,
              [v==='T'?'top':'bottom']:8, [h==='L'?'left':'right']:8,
              [v==='T'?'borderTopWidth':'borderBottomWidth']:2,
              [h==='L'?'borderLeftWidth':'borderRightWidth']:2}}/>
          ))}
        </div>
        <div style={{padding:'10px 12px', fontSize:9, color:'#9AAAA7', textAlign:'center'}}>Identifying part…</div>
      </div>
    </div>
    {/* Match card */}
    <div style={{flex:1, display:'flex', flexDirection:'column', gap:12}}>
      <div style={{fontSize:10, color:'#5EEAD4', letterSpacing:'0.12em', textTransform:'uppercase', fontWeight:600, display:'flex', alignItems:'center', gap:6}}>
        <I.spark size={11}/> AI Match Found
      </div>
      <div style={{fontSize:18, color:'#E6F0EE', fontWeight:600, letterSpacing:'-0.02em'}}>Door Panel · 18" × 30" · Maple</div>
      <div style={{display:'flex', flexDirection:'column', gap:6, fontSize:12, color:'#9AAAA7'}}>
        <div style={{display:'flex', justifyContent:'space-between', borderBottom:'1px solid var(--line)', paddingBottom:6}}>
          <span>Work Order</span><span style={{color:'#E6F0EE', fontFamily:'JetBrains Mono, monospace'}}>JOB-2841</span>
        </div>
        <div style={{display:'flex', justifyContent:'space-between', borderBottom:'1px solid var(--line)', paddingBottom:6}}>
          <span>Stage</span><span style={{color:'#E6F0EE'}}>Production</span>
        </div>
        <div style={{display:'flex', justifyContent:'space-between', borderBottom:'1px solid var(--line)', paddingBottom:6}}>
          <span>Confidence</span><span style={{color:'#5EEAD4'}}>98.2%</span>
        </div>
      </div>
      <div style={{
        marginTop:4, padding:'10px 14px', background:'#2DE1C9', color:'#001917', borderRadius:8,
        textAlign:'center', fontSize:13, fontWeight:700, boxShadow:'0 0 24px rgba(45,225,201,0.4)'
      }}>Confirm — Start Time</div>
    </div>
  </div>
);

const TimeTrackMock = () => (
  <div style={{
    border:'1px solid var(--line-strong)', borderRadius:18, padding:24,
    background:'linear-gradient(180deg, rgba(10,14,17,0.9), rgba(5,7,9,0.95))',
    display:'flex', flexDirection:'column', gap:14
  }}>
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
      <div>
        <div style={{fontSize:10, color:'#9AAAA7', letterSpacing:'0.1em', textTransform:'uppercase'}}>Marcus T. · Tuesday</div>
        <div style={{fontSize:18, color:'#E6F0EE', fontWeight:600, marginTop:3, letterSpacing:'-0.02em'}}>8h 04m logged · 100% accounted</div>
      </div>
      <div style={{fontSize:11, color:'#5EEAD4', display:'flex', alignItems:'center', gap:6}}>
        <I.check size={12}/> Auto-tracked
      </div>
    </div>
    {/* timeline */}
    <div style={{display:'flex', height:36, borderRadius:6, overflow:'hidden', border:'1px solid var(--line)'}}>
      <div style={{flex:3, background:'rgba(52,211,153,0.5)', display:'grid', placeItems:'center', fontSize:10, color:'#001917', fontWeight:700}}>JOB-2841</div>
      <div style={{flex:0.4, background:'rgba(251,191,36,0.4)', display:'grid', placeItems:'center', fontSize:9, color:'#001917', fontWeight:700}}>SW</div>
      <div style={{flex:1.5, background:'rgba(94,234,212,0.4)', display:'grid', placeItems:'center', fontSize:10, color:'#001917', fontWeight:700}}>Assembly</div>
      <div style={{flex:0.3, background:'rgba(167,139,250,0.4)'}}/>
      <div style={{flex:2.4, background:'rgba(52,211,153,0.5)', display:'grid', placeItems:'center', fontSize:10, color:'#001917', fontWeight:700}}>JOB-2843</div>
      <div style={{flex:0.4, background:'rgba(251,191,36,0.4)'}}/>
    </div>
    <div style={{display:'grid', gridTemplateColumns:'repeat(7, 1fr)', fontSize:9, color:'#5F6F6C', fontFamily:'JetBrains Mono, monospace'}}>
      <span>6:00</span><span>7:00</span><span>9:00</span><span>10:30</span><span>12:00</span><span>13:00</span><span>15:00</span>
    </div>
    {/* events */}
    <div style={{display:'flex', flexDirection:'column', gap:8, marginTop:6}}>
      {[
        ['06:02', 'Scan', 'JOB-2841 · Door Panel', '#34D399'],
        ['09:14', 'Quick Switch', 'Assembly', '#5EEAD4'],
        ['10:48', 'Scan', 'JOB-2843 · Drawer Fronts', '#34D399'],
        ['14:31', 'Damage Report', 'JOB-2843 · photo + note', '#F87171'],
      ].map(([t, ev, det, c], i) => (
        <div key={i} style={{display:'grid', gridTemplateColumns:'56px 110px 1fr', gap:10, fontSize:12, alignItems:'center', padding:'6px 0', borderTop: i===0?'none':'1px solid var(--line)'}}>
          <span style={{color:'#9AAAA7', fontFamily:'JetBrains Mono, monospace'}}>{t}</span>
          <span style={{color:c, fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase', fontWeight:600}}>{ev}</span>
          <span style={{color:'#E6F0EE'}}>{det}</span>
        </div>
      ))}
    </div>
  </div>
);

Object.assign(window, { LogoMark, SupervisorDash, CrewPhone, AIBriefMock, ScanMock, TimeTrackMock });
