# Handoff: InlineIQ Marketing Landing Page

## Overview
Public marketing/landing site for **InlineIQ** — a 1–2 tap shop floor workflow + production app for custom fabrication shops (cabinets, metal, stone, millwork). The page targets shop owners and supervisors equally, with a primary "Start free trial" conversion goal. Tagline: **"Keep your shop sharp."**

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype showing the intended look, copy, layout, and behavior. They are **not production code to copy directly**. Recreate these designs in InlineIQ's target codebase (likely the same Next.js/Vercel app at sawdust-studio.vercel.app, or a dedicated marketing site repo) using its established patterns, component primitives, and routing conventions. If no marketing-site environment exists yet, pick a framework appropriate for static-marketing pages (Next.js + Tailwind is a strong default) and implement there.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, copy, and interactions are intended to ship. Developer should recreate pixel-perfectly using the target codebase's component library / Tailwind / etc.

## Page Structure (in order)
1. **Sticky nav** — logo (left) · Features / Intelligence / Pricing / Contact (center) · Sign in + primary CTA (right)
2. **Hero** — eyebrow chip "● Live on the floor · Cabinetry · Metalwork · Stone · Custom Fab", H1, subhead, two CTAs (Start free trial / See it work), 3 stat tiles (1–2 taps, 100% labor logged, 6 AM AI brief). Right side: laptop mockup of supervisor dashboard with a phone mockup of crew app overlapping the lower-right corner. The phone has a thick black ring + cyan glow so it occludes the laptop.
3. **Capabilities grid** — 4×3 tight grid of all 12 features (1px teal-tinted gutters between cells)
4. **Three deep-dives** — alternating left/right layout with copy + a realistic UI mock:
   - **01 The Scan** — phone with camera frame containing a QR code on a wood-toned part placeholder, animated cyan scan line. Right side shows AI Match Found card with Door Panel · 18"×30" · Maple, Job number, Confidence 98.2%, "Confirm — Start Time" CTA.
   - **02 The Labor Log** — Marcus T. day timeline (multicolor stacked bar) + event log (scan, quick switch, scan, damage report)
   - **03 The Morning Brief** — phone-card style summary with three priority rows: Over Budget (red), Order Today (amber), Yesterday recap (teal)
5. **Intelligence Layer** — full-bleed dark card with copy on left, "Bid Calibration · 90 days · +18.4%" stat card with line chart on right, plus pill tags (Pattern recognition, Job type modeling, Bid calibration, Anomaly detection, Photo → Part matching)
6. **Pricing** — 3 tiers, per-shop pricing, **Shop tier featured (most popular)**:
   - Starter — Free / 30-day trial — "Start 30-day free trial"
   - Shop — $399 / per shop / month — "Start free trial" (FEATURED)
   - Operations — $599 / per shop / month — "Talk to sales"
7. **Final CTA** — centered "Connect your floor to your business in under a week." + Start free trial / Book a demo
8. **Footer** — logo, tagline, links, copyright

## Background Treatment
- Pure black base (#050608)
- **Logo watermark** — fixed-position (does not scroll), full-screen, the InlineIQ network/diamond logo centered, sized min(120vw, 1600px) wide, opacity 0.18, with a radial-gradient mask that fades the edges to black so it doesn't fight foreground content
- Subtle 56px cyan grid overlay also fixed, with its own radial fade
- Cyan radial glow at top of hero

## Design Tokens

### Colors
```
--bg:           #050608   (page background)
--bg-1:         #0a0d10   (card surface 1)
--bg-2:         #0f1418   (card surface 2)
--ink:          #E6F0EE   (primary text)
--ink-dim:      #9AAAA7   (secondary text)
--ink-mute:     #5F6F6C   (tertiary / labels)
--teal:         #5EEAD4   (accent — borders, dim CTAs)
--teal-bright:  #2DE1C9   (primary CTA fill, glow)
--teal-deep:    #14B8A6
--teal-dim:     rgba(94,234,212,0.55)
--line:         rgba(94,234,212,0.12)   (hairline borders)
--line-strong:  rgba(94,234,212,0.22)
--danger:       #F87171   (damage badge, over-budget)
--violet:       #A78BFA   (messages icon in app)
--amber:        #FBBF24   (idle / order-today)
--green:        #34D399   (run / confirmed)
```

### Typography
- Display + body: **Inter Tight** (Google Fonts), weights 400/500/600/700
- Mono (timestamps, URLs, job IDs): **JetBrains Mono**
- H1: clamp(44px, 6.2vw, 84px), -0.035em tracking, line-height 1.05, weight 600
- H2: clamp(32px, 4vw, 52px), -0.03em
- Body: 16px / 1.55 line-height
- Hero subhead: 19px / 1.5
- Eyebrow labels: 11px, 0.18em letter-spacing, uppercase, weight 600, color teal-dim

### Spacing & shape
- Section padding: 120px (large) / 80px (tight) vertical
- Container max-width: 1240px, side padding 32px
- Border radius: 14px (cards), 10px (small), 22px (large feature blocks), 999px (pills/buttons)
- Card border: 1px solid var(--line)

### Buttons
- **Primary:** teal-bright fill, dark teal text (#001917), full pill, glow shadow stack: `0 0 0 1px rgba(45,225,201,0.6), 0 0 40px rgba(45,225,201,0.35), 0 10px 40px rgba(45,225,201,0.18)` — intensifies on hover
- **Ghost:** transparent fill, 1px line-strong border, ink text, teal tint on hover

## Copy (final — use as-is)

### Hero (default headline)
> InlineIQ runs your shop **so you can run your business.**
>
> The 1–2 tap shop floor system that captures every minute, every part, and every dollar — then turns it into the data your bids have always been missing.

(Two alternative headlines exist in the prototype's tweaks panel — "Your floor is blind. Your bids are guesses." and "Keep your shop sharp." — included as A/B options if the team wants to test.)

### 12 Capabilities (icon · title · 1-line description)
1. QR + AI Part Scanning — Scan a part, time logs to the right job. No label? Camera ID by photo.
2. Automatic Time Tracking — Every scan opens an entry. Every switch closes one. Zero timesheets.
3. Quick Switch — One tap moves crew between jobs, cleaning, maintenance — every transition stamped.
4. AI Morning Brief — 6 AM, on your phone: jobs over budget, materials to order, what matters.
5. Real-Time Part Tracking — Every scan confirms a part. Where it is, who touched it, and when.
6. Damage Reporting — Photo + one sentence. Supervisor notified, system flagged, in 30 seconds.
7. Inventory Needs — Crew submits a need in one field. Materials get ordered before work stops.
8. Craftsman QC Workflow — Live timer for raw lumber and custom millwork. True cost, finally captured.
9. Supervisor Command View — Who's on what, for how long. Damage and inventory resolved in one tap.
10. Job Costing Intelligence — Actual hours vs estimate — per job, per crew. The data that tightens bids.
11. Crew Messaging — Department-scoped chat. Mention a job number, it posts as a job note.
12. SOPs & Job Drawings — Right SOP, right plan, right moment. No binders, no email digging.

### Intelligence Layer (full copy)
> **AI that learns your shop.**
>
> InlineIQ doesn't just collect data — it gets smarter the longer you use it. The AI learns your production patterns, your job types, your crew behaviors, and your cost structures over time. The morning brief gets sharper. Part identification gets faster. Cost comparisons get more accurate.
>
> Every shop is different. InlineIQ adapts to yours.

### Pricing header
> **One price per shop. Unlimited crew.**
>
> No per-seat math. Add every supervisor, every crew member, every department — one flat monthly price for the whole floor.

### Final CTA
> **Connect your floor to your business in under a week.**
>
> 30-day free trial. No credit card. Bring one supervisor and one crew member — we'll have them scanning before lunch.

## Interactions & Behavior
- **Sticky nav** — translucent black with backdrop-blur(14px) once scrolled
- **Primary CTAs** — translateY(-1px) + intensified glow on hover (transition .15s ease)
- **Capability cells** — background lifts from var(--bg-1) to #0e1418 on hover (transition .2s)
- **Pricing cards** — border lifts from var(--line) to var(--line-strong) on hover; featured card has persistent teal glow
- **Scan line animation** in deep-dive 01 — vertical sweep, 2s linear infinite, cyan gradient with cyan box-shadow glow
- **Anchor scrolling** — Features / Intelligence / Pricing / Contact links scroll to sections
- All transitions use simple ease curves (.15s–.25s); no fancy choreography

## Responsive Behavior
- **≥980px** — full grid layouts as designed
- **<980px** — hero stacks (copy on top), capability grid → 2 cols, deep-dives stack (copy above visual), intel grid stacks, pricing stacks
- **<768px** — nav center links hide (logo + CTA only); a hamburger menu should be added in production
- **<560px** — capability grid → 1 col

## State Management
This is a static marketing page. The only stateful element is the in-prototype Tweaks panel (developer-side tool only — **strip in production**). Real state needs:
- Email/lead capture form on "Start free trial" → POST to backend or Calendly/HubSpot equivalent
- Optional: theme toggle (currently dark-only)
- Anchor-link scroll position

## Assets
- `assets/inlineiq-logo.png` — provided by user; used as the fixed-position background watermark (full opacity in the source file, displayed at 18% via CSS opacity + radial mask). Also used inline as an SVG recreation in the nav and footer.
- App screenshot (`assets/app-screenshot.png`) — reference for visual matching only; do not ship.
- Inter Tight + JetBrains Mono via Google Fonts CDN.
- All other "screenshots" in the design (supervisor dashboard, crew phone, AI brief, scan UI, time-track timeline) are **HTML/CSS recreations** — re-implement as components, do not screenshot-and-embed.

  **Dashboard hero illustration was redesigned (latest):** sleeker icon-rail sidebar (52px), KPI cards with sparklines + colored accent bars, split layout — Active Crew panel with per-job progress rails on the left, Department Load panel with horizontal capacity bars + 30-day Bid Accuracy callout on the right. See `mocks.jsx` → `SupervisorDash` and `styles.css` → `.dash`/`.kpi`/`.panel`/`.crew-row`/`.dept-row` blocks.

## Files in this bundle
- `InlineIQ Landing.html` — root document; ties everything together
- `styles.css` — all design tokens + layout
- `icons.jsx` — 17-icon line-icon set (currentColor, 1.6 stroke)
- `mocks.jsx` — Logo SVG + product UI recreations (SupervisorDash, CrewPhone, AIBriefMock, ScanMock, TimeTrackMock)
- `sections.jsx` — Nav, Hero, Capabilities, Deepdives, Intel, Pricing, FinalCTA, Footer
- `assets/inlineiq-logo.png` — official logo

## Implementation Notes for Claude Code
1. **Strip the Tweaks panel and `tweaks-panel.jsx` import** — it's a design-time tool only.
2. The hero headline switcher exposes 3 copy options. **Default to the "brand" option** unless the team has tested otherwise.
3. The supervisor dashboard / crew phone / AI brief / scan UI / time-track mocks should become **reusable marketing components** — they'll likely be reused on feature pages, blog posts, etc.
4. Replace `<script type="text/babel">` runtime Babel with a build step (Next.js / Vite). The JSX as written maps cleanly to function components.
5. Logo watermark CSS needs the asset path adjusted to wherever your build serves static files (`/public/inlineiq-logo.png` in Next.js).
6. Add real meta tags (OG image, Twitter card, description) — currently only title is set.
7. Wire "Start free trial" / "Book a demo" CTAs to the real conversion endpoints.
