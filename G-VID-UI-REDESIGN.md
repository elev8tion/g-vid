# g-vid UI Redesign: Matching the grok.com Product Aesthetic

**Author:** Systems Architect (placeholder for implementation owner)  
**Date:** 2026-05-28  
**Status:** Draft  
**Project:** /Users/kc/g-vid (Vite + React 19 + TypeScript + Tailwind 4 + Framer Motion + lucide-react + sonner)  
**Target Runtime:** http://localhost:5175 (strictPort in vite.config.ts)

---

## Overview

This document specifies a complete ground-up redesign of the g-vid single-page web application to adopt the visual language, typography, spacing, interaction patterns, and overall product feel of grok.com (and related x.ai properties). 

The current implementation (`src/App.tsx`, 1408-line monolith — wc -l confirmed) is a single React component delivering real functionality — drag-and-drop image references (up to 5), Web Audio API-powered smart 8-second audio trimming with energy analysis, a curated library of 11 high-quality Shots backed by public thumbnail + preview video assets in `public/assets/`, a 4-step creation wizard, real xAI Device Code OAuth (via Express backend at `http://localhost:8787` using correct `auth.x.ai` endpoints per `server/index.js:37-42`), production prompt construction (`buildProductionPrompt`), generation progress simulation, and result playback/download. However, its visual system is a hybrid of an earlier "cinematic luxury" gold prototype (`#c5a46e` accents, Playfair Display headings) and cyan/magenta neon elements (`#00e5ff`, `#ff2d95`) carried over from VisualEssential.com inspiration (see `README.md:3-5` and superseded high-fidelity static at `/Users/kc/g-vid-design/index.html`). Static analysis shows 111 inline hex color literals.

The proposed solution replaces the entire design language while preserving 100% of existing behavior and backend contracts. The result will feel like a native first-class Grok tool ("g-vid" or "Grok Studio") — calm, minimalist, breathable, sophisticated, and confident — using deepest black surfaces, Inter/system typography, restrained electric-blue accents, generous whitespace, subtle elevation via borders and layered surfaces, and restrained micro-interactions powered by the existing framer-motion dependency. Creation becomes the immersive hero experience rather than a heavy modal.

---

## Background & Motivation

g-vid was originally built as a high-fidelity functional clone of VisualEssential to demonstrate direct integration with SuperGrok quotas via real OAuth Device Authorization Grant (RFC 8628). The aesthetic choices (gold primary buttons in `tailwind.config.js:20-25` and `src/index.css:122-133`, heavy `.shot-card` hover lifts/scales + cinematic gradient overlays in `index.css:64-108`, mixed neon accents, serif display font, glassmorphism with gold borders) were appropriate for a "premium cinematic music video" marketing prototype.

These choices now create a stark mismatch with grok.com:

- grok.com uses near-black (`#000000` / "darkest mode") backgrounds, high-contrast zinc/white text, electric blue/cyan accents for interactive elements, and Inter (or system-ui equivalent) exclusively for a clean, geometric, content-first reading experience.
- Navigation is minimal and calm (logo + sparse controls left, model/user controls right).
- Components favor restraint: subtle 1px borders (`#262626` range), rounded-md/lg surfaces, no dramatic lifts or neon glows, generous padding (Tailwind 8–16+), focus rings that are purposeful rather than flashy.
- Creative tools (Imagine flows for images/video) feel immersive yet calm, with progressive disclosure and excellent typography hierarchy rather than "wizard in a glowing box."

Current pain points (directly observable in running app at :5175 and source; static analysis confirms **111 inline hex color literals** in `src/App.tsx` alone):

- `src/App.tsx:615` root `bg-[#08080c]` + 111 scattered hex values (`#00e5ff` gradients in nav logo at 623, `#c5a46e` in session/credits, `#ff2d95` error states, `#39ff14` pricing, cyan STEP labels and dropzone accents throughout wizard 910-1163 and OAuth dialog 1297-1338, etc.) + undefined `.neon-btn` classes create visual fatigue and inconsistency next to grok.com.
- `index.css:123` `.btn-primary { background: var(--accent-gold) }` and heavy `.shot-card` cinematic transforms (lines 79-86) plus glassmorphism.
- `tailwind.config.js:29` includes `Playfair Display` (serif display font) — absent from grok.com.
- The entire creation experience lives inside a single 4-step modal (`App.tsx:876-1231`) with dense "STEP 01 / 04" cyan typography, production/demo toggle, and the full hybrid aesthetic.
- Because the majority of the mismatch is *inline in JSX* (not centralized in CSS), any realistic phased plan must include an explicit early mechanical color+class migration step before claiming visible landing improvements on the running dev server.

The redesign is required to make g-vid feel like it ships from the same team and design system as the core Grok product.

---

## Goals & Non-Goals

**Goals**
- Deliver a fully native grok.com-feeling UI: deepest dark palette, Inter typography only, restrained blue accent, breathable spacing, calm interactions.
- Preserve 100% functional parity and backend integration (OAuth device flow, smart trim logic at `App.tsx:409-446`, prompt builder `467-488`, 11 Shots, credits, production pending path, etc.).
- Make the creation experience the hero via elegant progressive disclosure / focused workspace rather than a heavy temporary modal.
- Componentize the app: break the 1400-line `App.tsx` monolith into focused, reviewable pieces under `src/components/`, `src/hooks/`, `src/lib/`.
- Provide a concrete, small-PR implementation plan that a senior engineer can execute with incremental review.
- Quantified targets: creation flow latency unchanged, visual weight reduced (fewer decorative gradients/shadows), excellent keyboard + screen-reader support on core flows.

**Non-Goals**
- No changes to `server/index.js` or OAuth contracts (port 8787 remains authoritative for device code).
- No new major runtime dependencies (keep listed stack; react-router optional but not required — prefer state-driven views).
- No alterations to public asset structure (`public/assets/shots/*.jpg`, `videos/*.mp4`) or Shot data shape.
- No real video generation backend wiring (current `PRODUCTION_PENDING` + `(window as any).__GROK_VISUAL_LAST_PROMPT__` exposure at `App.tsx:568` stays; UI only surfaces it more elegantly).
- No light mode or theme switching.
- No commercial pricing engine or credit purchasing UI (display-only, as today).

---

## Proposed Design

### Information Architecture & Primary User Flows

```mermaid
flowchart TD
    subgraph Shell["Persistent Shell (always visible)"]
        TN["TopNav<br/>• Logo 'g-vid'<br/>• Minimal links (Shots, How it works)<br/>• Status/credits pill (if connected)<br/>• User chip + dropdown<br/>• Primary 'New clip' button (blue accent)"]
    end

    subgraph Landing["Landing / Browse (default)"]
        H["Hero (clean Inter headline + CTAs)"]
        S["Stats row (4 clean metrics)"]
        P["Pricing comparison (subtle cards)"]
        SP["Shots preview grid (8 cards) → opens full browser or Studio"]
        T["Testimonials (clean quotes)"]
        F["FAQ (restrained accordion)"]
        CTA["Final CTA → Studio"]
    end

    subgraph Studio["Studio Workspace (immersive hero mode)"]
        ST["Horizontal Stepper (1–4) + 'Exit studio'"]
        subgraph StepperContent
            S1["Step 1: Reference Photos<br/>Clean dropzone + grid (2–5 images)"]
            S2["Step 2: Audio<br/>Upload + smart trim slider + energy analysis<br/>(encapsulated in AudioTrimPanel)"]
            S3["Step 3: Scene<br/>Full ShotBrowser (search + category pills + 11 cards with video hover preview)"]
            S4["Step 4: Review & Generate<br/>Live summary cards + editable face desc + production prompt + Generate CTA"]
        end
        SIDE["Persistent Context Sidebar<br/>• Selected shot thumbnail<br/>• Refs count + previews<br/>• Audio window<br/>• Credits cost estimate"]
        GEN["Generation progress (calm, no neon) or Result player + Download"]
    end

    TN -->|New clip| Studio
    SP -->|Select shot| Studio
    H -->|Start creating| Studio
    Landing -.->|Back / Esc| Landing
    Studio -->|Generate (real or demo)| GEN
```

**Primary happy path (new aesthetic):**
1. User lands on clean grok.com-like marketing surface.
2. Clicks prominent "New clip" in TopNav or hero → main content area transitions (framer-motion layout) into focused Studio workspace (keeps TopNav, adds calm "Exit" affordance). This makes creation feel like the primary powerful native surface.
3. Steps are advanced via a clean horizontal stepper or numbered progression with generous padding. Live summary sidebar updates.
4. OAuth connect (if needed) surfaces a beautiful, minimal centered Dialog (device code screen is calm, high-contrast, copy-paste friendly).
5. On generate: calm progress → result playback (existing video assets or PRODUCTION_PENDING prompt display, polished).

**Secondary flow:** From any ShotCard (landing preview or full browser) → directly enters Studio at Step 3 with that shot pre-selected.

### Visual Specification (Concrete Tokens)

Update `tailwind.config.js` and `src/index.css` (replacing the cinematic block at lines 8-196).

**Color Palette (Grok-native, deepest dark)**
```css
:root {
  --bg: #000000;
  --surface: #0a0a0a;
  --surface-2: #121212;
  --surface-elevated: #1a1a1a;
  --border: #262626;
  --border-strong: #3f3f46;

  --text-primary: #f4f4f5;
  --text-secondary: #a1a1aa;
  --text-tertiary: #71717a;

  --accent: #3b82f6;        /* Electric blue — matches grok.com interactive emphasis */
  --accent-hover: #2563eb;
  --accent-subtle: rgba(59, 130, 246, 0.1);

  --success: #22c55e;
  --warning: #eab308;
}
```

- No gold (`#c5a46e` removed entirely).
- No cyan/magenta neon.
- Surfaces use layered darks + 1px borders for elevation (no heavy box-shadows except for focused modals).
- Focus rings: `ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]`.

**Typography**
- Only Inter (keep the Google import, drop Playfair Display).
- Headings: `font-semibold tracking-[-0.025em]` or tighter for display sizes.
- Body: `text-[15px]` / `text-base` with excellent line-height.
- Monospace remains for codes, prompts, timestamps (JetBrains Mono or system).

**Spacing & Layout**
- Generous: default section padding `py-20` or `py-16`, inner `p-8` / `p-10` / `p-12`.
- Consistent 4 / 6 / 8 / 12 / 16 scale (Tailwind). Studio content uses `max-w-6xl` or wider for breathing room.
- Grid gaps: 24px+ for shot grids (was 20px).

**Border Radius**
- Cards / surfaces: `rounded-xl` (12px) or `rounded-2xl` (16px) for larger containers.
- Buttons / pills: `rounded-full` for primary CTAs (grok signature), `rounded-lg` for secondary.
- Avoid ultra-pill on everything.

**Elevation & Cards**
- `.surface { background: var(--surface); border: 1px solid var(--border); }`
- `.card { @apply surface rounded-2xl p-6; }` — no hover lift by default. Subtle `hover:border-[var(--border-strong)]` only.
- Shot cards: clean 16/9, minimal gradient overlay (or none), strong typography labels. Hover: `border-[var(--accent)]` + very subtle scale (1.01) via framer if desired; video preview on hover using existing mp4s (delightful, low-cost).

**Buttons (new primitives — Tailwind theme extension + CSS var fallback)**

**Recommended consumption strategy (decided for PR 1):**
- Extend the Tailwind theme in `tailwind.config.js` with the new tokens (`accent`, `surface`, `text-primary`, etc.). This gives clean utilities: `bg-accent`, `text-text-secondary`, `border-border`, `focus:ring-accent`, etc.
- Also expose the same values as CSS custom properties in `:root` for any cases that need runtime or arbitrary values (`bg-[var(--accent)]`).
- Prefer the Tailwind utilities everywhere for consistency and purging; fall back to the CSS vars only for dynamic/interpolated cases.

```tsx
// Primary (CTAs) — using extended theme (preferred)
<button className="inline-flex items-center justify-center gap-2 rounded-full bg-accent px-8 py-3 text-sm font-semibold text-white transition active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
  ...
</button>

// Secondary — using extended theme
<button className="inline-flex items-center ... border border-border-strong bg-transparent text-text-primary hover:bg-surface-2">
```

(Full theme extension example goes in the color audit PR 1.)

**Motion (existing framer-motion)**
- Restrained: `duration-150` or `duration-200`, `ease-out`.
- Step transitions: `AnimatePresence` + `motion.div` with `initial={{opacity:0, y:8}}` `animate={{opacity:1,y:0}}`.
- No bouncy or cinematic 600ms transforms.
- Respect `prefers-reduced-motion`.

**Toast (sonner) overrides**
Add CSS in `index.css` for dark grok surface toasts (no bright colored borders unless semantic success).

**Shot Grid**
- `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4` with 24px gap (more breathable than current 20px / 300px minmax).
- Category filter as clean pill buttons (active = filled blue, otherwise subtle surface).

### Recommended React Component Structure & File Organization

Move away from the giant `App.tsx` (current anti-pattern containing types, 11 SHOTS, ARTISTS, TESTIMONIALS, all handlers, 4 modals, wizard JSX).

Proposed structure (all new files under `src/`):

```
src/
├── main.tsx
├── App.tsx                 # Thin shell: TopNav + view state (landing | studio) + Toaster
├── index.css               # Full visual refresh + CSS primitives
├── types/
│   └── index.ts            # Shot, UploadedImage, UserSession, AudioTrim, etc.
├── lib/
│   ├── constants.ts        # SHOTS (moved verbatim), CATEGORIES, ARTISTS, TESTIMONIALS, FAQS
│   ├── prompts.ts          # buildProductionPrompt (moved)
│   └── utils.ts            # (optional) formatTime etc.
├── hooks/
│   ├── useSuperGrokAuth.ts # All OAuth state + polling + localStorage (extracted from App:197-338)
│   ├── useAudioTrim.ts     # Smart trim Web Audio logic + slider state (from App:371-446)
│   └── useStudioState.ts   # Wizard step, uploadedImages, selectedShot, generation etc.
├── components/
│   ├── TopNav.tsx
│   ├── Studio.tsx          # The new focused creation workspace (replaces ~300 lines of wizard JSX)
│   ├── ShotCard.tsx
│   ├── ShotGrid.tsx
│   ├── ShotBrowser.tsx     # Search + filters + grid; supports direct-to-studio entry
│   ├── ImageUploader.tsx   # Dropzone + preview grid
│   ├── AudioTrimPanel.tsx  # Encapsulates upload + slider + "Smart Trim" button
│   ├── GenerationProgress.tsx
│   ├── ResultPlayer.tsx
│   ├── OAuthDialog.tsx     # Clean grok-style device code UI
│   └── ui/
│       ├── Button.tsx      # Composable primitives (or use Tailwind + variants)
│       ├── Dialog.tsx      # Lightweight framer-backed modal primitive
│       └── Stepper.tsx
└── App.css                 # Delete or empty (legacy)
```

`App.tsx` shrinks to <150 lines orchestrating `<TopNav />`, conditional `<Landing />` or `<Studio open ... />`, and global state via the hooks.

This enables parallel work, easy review, and future addition of real routing if the product grows.

### Refined Creation Flow in New Aesthetic

**Studio workspace (when active):**
- Persistent TopNav (slightly condensed).
- Calm header: "Create clip" + stepper: `1 References → 2 Audio → 3 Scene → 4 Generate` (clickable, with checkmarks for completed).
- Two- or three-column spacious layout (`gap-8`):
  - Left/main: Step content area with generous `p-10` internal padding. Step 1 = large clean dropzone + responsive image grid (remove heavy borders). Step 2 = AudioTrimPanel (existing logic, new calm visuals, prominent "Smart Trim" using existing energy detection). Step 3 = ShotBrowser (full 11, better search input with lucide icon, category pills). Step 4 = review grid of summary surfaces + face description input (existing) + scrollable production prompt preview.
  - Right (sticky or flex): Live context panel showing current shot (with thumbnail or video), refs count, exact audio window, estimated credit cost, "Edit" links that jump steps.
- Footer bar: Back / Continue (or Generate) buttons — large, calm, blue primary when enabled.
- Generation: Full-bleed calm progress surface (existing stages from `App.tsx:545-551` or demo path) with percentage + stage text in Inter. No gradient bars.
- Result: Clean video container + two primary actions (Download / Create another). For `PRODUCTION_PENDING` state, show beautifully formatted prompt block + "Copy prompt" + "Trigger Grok generation" (existing clipboard behavior polished).

**Improvements that fit naturally (non-breaking):**
- Shot hover previews: on mouseenter play the corresponding `video` asset (muted, loop) using `<video>` + framer opacity crossfade. Assets already exist.
- Better empty states and validation messaging using existing sonner but calmer styling.
- Keyboard: Arrow keys in shot grid, Esc to exit studio or close dialogs.

The old 4-step modal (`App.tsx:878`) is fully replaced; no "glass" "neon-btn" remnants.

### Elevated OAuth Experience

The real Device Code flow (currently triggered at `App.tsx:197`, modal at `1284-1372`) is a strength. In the new UI:

- Triggered from TopNav "Connect SuperGrok" (or inline in Studio if generation attempted while disconnected).
- New `OAuthDialog` uses the same `useSuperGrokAuth` hook.
- Visuals: centered high-contrast surface, large mono userCode display, clear "Open auth.x.ai/activate" primary button, status messages ("Waiting for authorization...") in secondary text.
- Success: toast + immediate credit/plan update in TopNav (existing persistence logic unchanged).
- Demo fallback path preserved exactly.

This turns a functional prototype screen into a first-class grok.com authentication surface.

### Behavior Preservation Matrix & Executable Contracts (for the full rebuild)

To enable a senior engineer to perform a complete ground-up componentized rebuild of `src/App.tsx` + CSS while guaranteeing **zero behavioral or functional regression** on every real path, the following matrix and contracts are authoritative. All logic must be moved *verbatim* (identical output for identical input) into the new owners.

#### Behavior Preservation Matrix (current monolith locations → new owner)

| Functional Area (with representative line ranges in current `App.tsx`) | Current Owner | New Owner (hook / component / lib) | Preservation Requirement (exact fidelity) | Notes / Edge Cases |
|-----------------------------------------------------------------------|---------------|------------------------------------|-------------------------------------------|--------------------|
| `SHOTS` array (11 items), `categories`, `ARTISTS`, `TESTIMONIALS`, `FAQS` (40-131) | Inline consts | `src/lib/constants.ts` (exported) | Identical objects, thumbnail/video paths (`/assets/...`), `promptHint` strings | No changes to data shape or asset references |
| `buildProductionPrompt()` (467-488) — faceDescription, trimInfo, shot.name/desc/promptHint interpolation, "Exactly 8 seconds..." suffix | Inline function | `src/lib/prompts.ts:buildProductionPrompt(shot, audioTrim, faceDescription, isProductionMode?)` | Byte-for-byte identical string for same inputs (including the exact punctuation and "Cinematic 8-second..." prefix) | Called from review step and PRODUCTION_PENDING display |
| Smart trim energy analysis + Web Audio decode (409-446): `smartTrimAudio`, hopSize/windowSize, bestEnergy loop, fallback to mid | Inline + AudioContext | `src/hooks/useAudioTrim.ts:smartTrimAudio(file, duration)` + `updateAudioTrim` | Identical 8s window returned for the same audio file (energy calc must match the 32-sample stride and 0.5s hop exactly) | Must handle decode errors the same way (mid fallback + toast) |
| Audio upload + duration + preferredStart default (371-398), `updateAudioTrim` clamping (402-406) | Handlers + state | `src/hooks/useAudioTrim.ts` + `<AudioTrimPanel>` | Same `audioDuration`, `audioTrim: {start, duration:8}` shape; slider max = duration-8; "Smart Trim" button triggers identical analysis | 8s is hard constant |
| Image upload (drag/drop + FileReader + limit 5, remove) (341-368) + validation (only image/*) | Handlers | `src/components/ImageUploader.tsx` + `useStudioState` or parent | Same `UploadedImage[]` shape (`id`, `file`, `preview` data URL); max 5; min 2 for canProceed | Previews are object URLs or data: in current code |
| OAuth Device Code full flow: `handleSuperGrokConnect`, `startRealDeviceAuth`, `pollForAuthorization` (197-299), `disconnect` (301-317), auto-restore on load (320-338), localStorage keys `gvid_session` + `gvid_real_session` | All inline in App | `src/hooks/useSuperGrokAuth.ts` (full export of session state + actions + `BACKEND` const) + `OAuthDialog` | Exact same fetch URLs (`/auth/device/start`, `/auth/device/status?device_code=...`, `/auth/session/${id}`, `/auth/disconnect`), same polling (max 120 attempts, interval backoff, slow_down handling), same fallback demo path, same session shape updates | Real vs demo sessionId persistence must be identical |
| Wizard step state + canProceed (161, 459-464): 0=images>=2, 1=audioFile, 2=selectedShot, 3=always | `wizardStep`, `canProceed` | `src/hooks/useStudioState.ts` (or `useCreationFlow`) + `<Studio step>` | Same 4-step progression, same guard logic, "Back" always allowed except step 0 | Stepper in new UI may allow non-linear nav with warnings (see UX Edge Cases) |
| Generation orchestration + stages (501-581): demo path (stages 12-100%, credit -48, pre-generated video), production path (stages, prompt build, credit -52, `PRODUCTION_PENDING`, window globals) | `startGeneration`, `isGenerating`, `generationProgress/Stage`, `generatedVideo` | `src/hooks/useStudioState.ts` (or dedicated `useGeneration`) + `<GenerationProgress>` / `<ResultPlayer>` | Exact same stage labels and timing (or acceptably close), identical credit math, identical `setGeneratedVideo("PRODUCTION_PENDING")` + `__GROK_VISUAL_LAST_PROMPT__` / `__GROK_VISUAL_LAST_SHOT__` assignment, identical download filename logic | PRODUCTION_PENDING display (1161-1186) must be replicated in ResultPlayer (prompt block, copy, trigger button) |
| `isProductionMode` checkbox + label (1106-1112, 1117-1120) | Local state in review step | Passed into `useStudioState` / Studio review panel | Same boolean default true; same effect on generation path and button label | See Key Decision below for new calm labeling |
| Reset / close behavior (583-599, 603-612) | `resetWizard`, `closeCreate`, `downloadVideo` | `useStudioState.reset()`, Studio onClose, ResultPlayer | All fields cleared to initial; download uses same `<a>` + filename pattern; toasts preserved (via sonner) | Unsaved work warning on exit (new) |
| Old modals (shots full gallery 1233-1282 with search/filter, OAuth 1284-1372, HowItWorks 1374-1402) + show* state (155-158) | Inline | New `<ShotBrowser>` (replaces old), `<OAuthDialog>`, simple `<HowItWorks>` or inline content in landing | Search/filter on 11 items identical; category pills; direct "use shot" jumps to Studio step 3 with preselection | Old showShotsModal etc. deleted in PR 8 |

#### TypeScript Contracts (minimum for the core new pieces)

```ts
// src/types/index.ts (additive; existing interfaces moved here)
export interface Shot { id: string; name: string; description: string; category: string; thumbnail: string; video?: string; promptHint: string; }
export interface UploadedImage { id: string; file: File; preview: string; }
export interface UserSession { connected: boolean; name: string; handle: string; plan: string; credits: number; accessToken?: string; }
export interface AudioTrim { start: number; duration: 8; }  // duration is always the constant 8

// src/hooks/useSuperGrokAuth.ts
export function useSuperGrokAuth(): {
  session: UserSession;
  connect: () => void;           // shows OAuthDialog + starts real flow
  disconnect: () => Promise<void>;
  isConnecting: boolean;
  oauthFlow: OAuthFlowState;     // the deviceCode/userCode/waiting/error shape
  // ... (full shape from current oauthFlow + poll logic)
};

// src/hooks/useAudioTrim.ts
export function useAudioTrim(initialFile?: File): {
  audioFile: File | null;
  audioDuration: number;
  audioTrim: AudioTrim;
  upload: (file: File) => Promise<void>;
  smartTrim: () => Promise<void>;   // must produce identical bestStart as today
  updateTrim: (start: number) => void;
  // error/loading state for decode failures
};

// src/hooks/useStudioState.ts (or useCreationFlow)
export function useStudioState(): {
  step: 0 | 1 | 2 | 3;
  uploadedImages: UploadedImage[];
  // ... (all other state: audioTrim, selectedShot, faceDescription, isGenerating, generatedVideo, isProductionMode, etc.)
  canProceed: boolean;
  nextStep: () => void;
  prevStep: () => void;
  reset: () => void;
  startGeneration: () => Promise<void>;  // delegates to buildProductionPrompt + credit math + window globals exactly
  // flag-aware entry
};

// src/components/Studio.tsx
export function Studio(props: {
  open: boolean;
  onClose: (reason: 'complete' | 'cancel' | 'error') => void;
  initialShot?: Shot;                 // support direct-from-shot-card entry
  featureFlag?: boolean;
}): JSX.Element;

// PRODUCTION_PENDING handoff (unchanged contract)
(window as any).__GROK_VISUAL_LAST_PROMPT__ = finalPrompt;
(window as any).__GROK_VISUAL_LAST_SHOT__ = selectedShot.name;
setGeneratedVideo("PRODUCTION_PENDING");
```

#### Notable Edge Cases That Must Be Preserved or Explicitly Improved

- Audio < 8s: current code allows (trim start clamped); new UI must surface clear warning but not break.
- Image count exactly 2 min for "Continue" in step 0; 5 max enforced on upload.
- Smart trim on very quiet or silent files falls back gracefully (current behavior).
- OAuth demo_fallback path when backend returns `demo_fallback: true` (graceful local dev).
- Credit decrement happens *before* real generation in production path (48 vs 52).
- `isProductionMode` affects only the label and which stage set is used; the window global handoff only happens in production path.
- Download works for both demo video URLs and (future) real results.
- No new network calls or asset uploads are introduced.

These contracts + matrix turn the high-level component tree into an executable spec for the rebuild.

### Studio UX Edge Cases & Interaction Model

**Entry points (must all work identically):**
- TopNav "New clip" button → opens Studio (or focuses it if already open).
- Hero "Start creating" CTA → same.
- Any ShotCard (landing preview grid or ShotBrowser) "click to use" → opens Studio at step 3 with that shot pre-selected (`initialShot` prop).
- OAuth "Connect now" inside the old (or new) flow when generation attempted while disconnected.

**Exit / dismissal:**
- Explicit "Exit studio" or "Back to browse" (top of Studio header) or X.
- Browser back button (if we later add shallow history via a tiny sync hook — see nits).
- Esc key (global listener when Studio open, unless focus is in an input that uses Esc).
- On exit with in-progress work (images or audio selected but not yet generated): show a calm confirmation "Discard draft?" (Yes / Cancel). Draft state is **not** persisted across reloads or exits in v1 (in-memory only; explicit "Save draft" is out of scope for this wave).

**Stepper navigation:**
- Horizontal stepper is clickable (non-linear) after PR 7.
- Clicking a prior step is always allowed.
- Clicking a future step shows inline validation warning ("Upload at least 2 photos to continue") and does not advance if `!canProceed`.
- "Continue" footer button remains the primary linear affordance.

**Keyboard model (minimum):**
- ShotBrowser grid: Arrow keys move focus, Enter/Space selects and advances to review or jumps step.
- Trim slider: standard range input keyboard support + visible focus ring.
- Dropzones: Tab into, Enter/Space activates the hidden file input.
- Global: Esc closes topmost Dialog or exits Studio (with warning if dirty). Focus trap inside any Dialog (OAuth, future settings).
- All interactive elements have visible focus states using the new accent ring.

**Reduced motion:**
- `prefers-reduced-motion: reduce` disables:
  - Video autoplay/preview on ShotCard hover (static thumbnail only, or a subtle one-time crossfade if the video is already buffered).
  - Step transition animations (instant opacity change only).
  - Any framer layout animations on Studio open/close.
- Video hover previews are gated behind `!prefers-reduced-motion` media query + a user preference if needed.

**Mobile specifics:**
- Trim slider: larger thumb hit target (via Tailwind or custom CSS `accent-color` + padding wrapper); "Smart Trim" button becomes full-width or prominent below the slider.
- Image grid: 2-col on small screens, easy remove targets (44x44px minimum).
- ShotBrowser: comfortable card touch targets; category pills wrap and scroll horizontally if needed.
- No hover-only interactions for core flow.

**Idempotency / "New clip" while already in Studio:**
- If the user is already inside Studio with partial work and clicks "New clip" again, focus the Studio (or offer "Start fresh?" confirmation that calls `reset()`).

**Draft state on reload:**
- v1: purely in-memory (lost on hard reload or flag toggle). Future improvement (post-redesign) could sync minimal serializable state (image count + metadata, audio filename + trim numbers, selected shot id) to localStorage with a "Resume draft" banner. Not required for this wave.

**Other polish called out in Goals:**
- Excellent screen-reader support: ARIA labels on steppers ("Step 2 of 4: Audio, current"), live regions for generation progress, proper alt text or `aria-describedby` on shot cards.
- All form controls (faceDescription input, trim range, production checkbox) have associated labels.

Implementer may choose reasonable details within the above constraints as long as the 100% behavior preservation matrix and the "calm, breathable, grok-native" visual + motion language are respected.

---

## API / Interface Changes

**No external API or backend changes.** All `fetch` calls to `BACKEND` (`App.tsx:195`) remain identical.

**Internal React surface (before/after highlights):**

- Old: Single `showCreate` + `wizardStep` + 20+ state variables + 300+ lines of JSX inside `App.tsx`.
- New: `<Studio step={studioStep} ... onStepChange ... onGenerate={startGeneration} />` + extracted hooks. Parent App only manages high-level `isStudioOpen` and session via `useSuperGrokAuth`.

Button and card class names change (`.btn-primary` → new accent blue variants). Consumers (the new components) use the primitives.

Shot selection callback signature stays compatible (`(shot: Shot) => void`).

---

## Data Model Changes

None. 

- `Shot` interface, `SHOTS` array, `UploadedImage[]`, `AudioTrim`, `UserSession` move verbatim into `src/lib/constants.ts` and `src/types/`.
- `localStorage` keys (`gvid_session`, `gvid_real_session`) unchanged.
- Prompt construction and credit decrement logic identical.

Migration: none required (client-only).

---

## Alternatives Considered

**1. Incremental restyling of the existing modal wizard + landing (minimal structural change)**  
Trade-offs: Lowest risk, fastest to ship (mostly CSS + class swaps in `App.tsx`).  
Rejected: Does not achieve "completely replace the visual design language, component aesthetics, layout, typography, and interaction patterns." The heavy modal + "STEP 01 / 04" language and dense layout would still feel like a prototype bolted onto grok.com rather than a native tool. Insufficient for the stated goal.

**2. Introduce react-router-dom + dedicated routes (`/`, `/studio`, `/shots`)**  
Trade-offs: Excellent URL semantics, shareable studio state (with query params for selected shot), feels like a real web app, easier deep-linking in future.  
Rejected for v1 redesign (adds ~10-15KB runtime, requires more wiring for auth/session persistence across routes, history management for "back from studio"). Prefer pure React state + framer layout animations for this scope; router can be a follow-up once the aesthetic is proven.

**3. Retain gold accent and cinematic film-grain language as "premium creative differentiator"**  
Trade-offs: Would preserve some current visual equity and differentiate from pure chat Grok.  
Rejected: Explicitly conflicts with the task ("avoid the current heavy neon + gold cinematic luxury", "feel like a first-class, native Grok product/tool on grok.com or x.ai", "calm confidence and clarity like the main Grok interface").

**4. Aggressive logic extraction into hooks + calm primitive components first (while keeping the full creation experience inside the existing modal structure), followed by a later "promote to immersive Studio workspace" PR (or separate wave).**  
Trade-offs: 
- **Lower integration/regression risk** — the single largest and most complex PR (#7 Studio workspace) shrinks dramatically because the 4-step flow, canProceed, generation orchestration, PRODUCTION_PENDING handoff, etc. continue to live in the (now token-migrated + partially componentized) old modal for several PRs. The color audit + hook extraction + test harness can land and be exercised against the proven old wizard paths for many weeks.
- **Earlier visible value and review checkpoints** — landing surfaces, TopNav, Shot primitives, OAuthDialog, AudioTrimPanel, and ImageUploader can be wired into the *existing* modal early (PR 4-6), giving the team real grok-native polish and reusable components without a flag or dual-UI period for the entire creation flow.
- **Shorter duration of dual-UI maintenance** in `App.tsx`.
- **Downsides**: The "creation experience as the immersive hero" (the key conceptual shift away from "heavy temporary modal") is delayed until a follow-up PR/wave. The "wow" factor of the full redesign lands later. Some re-work of step orchestration may be needed when promoting the flow out of the modal wrapper.
- This path is **materially lower risk** for a 1400+ LOC monolith with zero existing tests and 111 inline colors. It also aligns with the "small independently reviewable PRs" mandate.

**Recommended path (revised after review):** PR 1-6 exactly as written (color audit + foundation + extraction of hooks + primitives + test harness + flag helper), **but** keep the creation experience inside a (visually refreshed, token-migrated) version of the existing modal structure through PR 6. Promote to the full immersive non-modal Studio workspace (current PR 7) only after the aesthetic system, all hooks, and the test harness have proven stable against the old (now calm) wizard paths. The final cutover PR 8 then deletes the old modal entirely. This hybrid gives most of the safety of Alternative 4 while still delivering the full native experience in the same overall redesign wave. The plan above already incorporates the spirit of this by making the Studio PR explicitly "behind flag" and the color audit a first-class early deliverable.

(The original "big-bang Studio in one PR" risk is now mitigated by the explicit test harness, feature flag, and color audit PR.)

---

## Security & Privacy Considerations

- **OAuth unchanged and already strong:** Device Code flow (server/index.js:54-97) uses official `auth.x.ai` endpoints with correct scopes (`openid profile email api:access offline_access`). No client secrets in browser. User completes auth on the official site. Session ID only persisted in localStorage (current design); production would benefit from short-lived + refresh but is out of scope.
- UI changes have zero impact on threat model: no new network surfaces, no credential handling in new components.
- Image/audio files: remain client-side only (object URLs + File objects). Never uploaded to g-vid servers in current architecture.
- Generated prompt exposure (`__GROK_VISUAL_LAST_PROMPT__`) is intentional for the current real-gen handoff; keep behind user action.
- Accessibility: New UI must maintain (and improve) focus management, ARIA on steppers, dialogs, grids. Sonner toasts are already polite.

Risk (low severity): localStorage session replay on shared devices — same as today; document in README if needed.

---

## Observability

Current: sonner toasts + `console.error` in OAuth paths + generation simulation. **Zero automated tests today** (no `test/` dir, no testing libraries in `package.json`).

**Mandatory additions in this redesign (see PR 6 and Rollout):**
- **ErrorBoundary** (simple, production-grade) wrapping the root and Studio paths. Must be landed in PR 1 (color audit) or PR 2. Surfaces calm grok-native error UI + "Reset studio" / "Reload app" actions. All generation, OAuth poll, and Web Audio paths wrapped.
- **Minimal test harness** (landed in PR 6):
  - Vitest + React Testing Library (devDependencies).
  - Unit tests for all pure/extractable functions: `buildProductionPrompt` (exact string fidelity across multiple shot + trim + faceDescription combinations), the core energy analysis loop of smart trim (given a synthetic AudioBuffer, produces the expected bestStart), session update helpers, and canProceed logic.
  - Lightweight Playwright (or Cypress) smoke E2E spec exercising the *old wizard* happy path end-to-end during the transition period (upload 3 images + audio file + smart trim + any of the 11 shots + review + generate demo + PRODUCTION_PENDING + download). This spec must pass on every PR that touches creation-related code.
- Performance marks + console groups around the expensive paths (smart trim decode, generation simulation) for local debugging only.
- All existing sonner toasts + critical error paths (8787 unreachable, audio decode failure, OAuth timeout/poll exhaustion) must continue to fire and are restyled to the new calm surface. No new production telemetry is added.

No new alerting (client-only Vite app).

---

## Rollout Plan

**Phased via small PRs with explicit dual-UI safety (see revised PR Plan).** Because the current application has **zero tests** and a 1408-line monolith with 111 inline colors + complex real OAuth + Web Audio logic, the following risk mitigations are **non-negotiable**:

- A proper feature flag (simple, removable) controls exposure of the new immersive Studio. Recommended implementation (landed PR 6): `useFeatureFlag('gvid_studio_v2')` reading `localStorage.getItem('gvid_ui') === 'studio_v2' || new URLSearchParams(location.search).get('ui') === 'studio_v2'`. The flag is **only** used in PR 7 (Studio behind flag) and fully removed + deleted in PR 8.
- The old 4-step modal wizard (with all its proven paths) remains the default creation surface and the only way to exercise real functionality until the test harness + primitives are proven. It receives the color token migration in PR 1 so it looks calmer, but its behavior is frozen.
- **ErrorBoundary** lands early (PR 1/2).
- Automated regression coverage (unit + smoke E2E against the old wizard) lands in PR 6 and must stay green on every subsequent PR.
- A documented pre-merge manual regression checklist (focused on the old wizard paths) is required for any PR that touches creation, auth, or audio logic.

### Detailed Rollout Steps (updated for safety)

1. **PR 1 (color audit + foundation + ErrorBoundary)**: Bulk replacement of all 111 hex + undefined classes. Early landing surfaces (nav, pricing, stats, testimonials, hero) now use grok tokens and look materially better on the running 5175 server. Wizard and modals also receive the migration (calmer but still functional old structure). ErrorBoundary added. `npm run dev` and full manual smoke (all 11 shots, smart trim, real+demo OAuth, PRODUCTION_PENDING) required before merge. No new tests yet.

2. **PRs 2-5 (extraction + primitives)**: TopNav, constants/prompts, Shot components, Auth hook+Dialog, Audio/Image components. The old wizard continues to be the only creation surface and is exercised by the team. Optional: wire a couple of the new calm primitives (e.g. new ShotCard) into the old wizard for early validation. No Studio code yet.

3. **PR 6 (test harness + feature flag helper + last extractions)**: Add Vitest/RTL + Playwright smoke (happy path through the *old* wizard). Implement the feature flag helper. All hooks complete. Pre-merge checklist for any creation-touching PR is now enforced. At the end of this PR the team has a green safety net and can begin the Studio implementation with confidence.

4. **PR 7 (Studio workspace core, behind flag only)**: Full `<Studio>` + `useStudioState` + supporting components implemented and wired **only** when the feature flag is true. The old wizard remains the default and fully functional. All behavior contracts from the Preservation Matrix are validated by manual + the new smoke E2E (now also run against Studio when flag is on). Reduced-motion, a11y, mobile touch targets for trim, Esc handling, and unsaved-work warning are implemented and tested here. Reviewers can toggle the flag locally or via `?ui=studio_v2` for focused testing.

5. **PR 8 (final cutover + deletion + cleanup)**: Remove the feature flag and all dual-UI code. Delete the old wizard JSX, modals, neon/gold/cyan literals, and `src/App.css`. Refresh the landing fully. Remove any temporary "old wizard" paths. Run the full (now expanded) verification matrix (manual + automated) against the *new* Studio as the only surface. Update docs. `npm run dev` on 5175 + real backend 8787 must be green with identical functional outcomes for every user path that existed before the redesign.

### Verification Matrix (mandatory, manual + automated)

- Happy path end-to-end through Studio (and, during transition, the old wizard): 2–5 images (including drag/drop + remove), any-length audio + smart trim (verify exact 8s window and energy fallback), every one of the 11 Shots (including direct-from-card entry), faceDescription input, review summary, isProductionMode toggle, generate (demo path + PRODUCTION_PENDING path), prompt copy, download, "Create another", credit decrement (48/52).
- OAuth: demo fallback + real device code flow (if CLIENT_ID configured), poll success/timeout/slow_down, disconnect, persistence across hard reload via both localStorage keys.
- Mobile (iOS Safari + Android Chrome): all dropzones, trim slider thumb affordance (larger hit target), ShotBrowser grid, stepper touch, video hover (or graceful no-hover fallback).
- Keyboard + a11y + reduced-motion: arrow navigation in Shot grids, focus management in dropzones and trim, Enter to advance when valid, Esc to exit Studio/Dialogs, focus trap in modals, `prefers-reduced-motion` disables video previews and step animations.
- Error paths: Web Audio decode failure, backend 8787 unreachable during OAuth, generation simulation errors (caught by ErrorBoundary).
- No regressions in: exact prompt strings, credit math, download filenames, localStorage roundtrips, 11 Shot thumbnail/video paths.
- Performance/latency: creation flow steps feel snappy; smart trim on typical files completes in <1s (same as today); no jank on step transitions.

### Rollback Strategy

- **During PR 1-6 (pre-Studio):** Revert is trivial (mostly mechanical color changes + new files). The old wizard is untouched in behavior.
- **During PR 7 (Studio behind flag):** Simply set the flag off (or remove the query param). The old wizard continues to work exactly as before the PR. No user impact.
- **After PR 8 (post-cutover):** Single `git revert` of the final wiring + deletion commit restores the previous (calm but still containing old structure) state. Because all logic was moved rather than rewritten, and the test harness exists, recovery is fast. For emergency, a one-line feature flag re-introduction can be hot-patched if needed (though the plan makes this unnecessary).
- No data loss ever (client-only, localStorage + in-memory File objects).

Post-rollout: monitor qualitative feedback on "feels like Grok" via any available channels; quantitative (generation success rate, time-to-first-clip, error rate) must remain unchanged or improve. The new automated smoke E2E becomes part of CI.

---

## Cleanup Scope (explicit declaration for implementers)

The phrase "completely replace the visual design language" and "delete the old UI design" refers **only** to the runtime application code that ships in the Vite build (the hybrid gold+neon cinematic aesthetic in the single `src/App.tsx` monolith, the old 4-step modal + three other modals, the 111 inline hex values, `.neon-btn` and cinematic rules in `src/index.css`, legacy `src/App.css`, Playfair Display usage, and all related JSX/className strings).

**Explicitly out of scope for deletion or modification in this redesign wave:**
- `/Users/kc/g-vid-design/` (the superseded high-fidelity static HTML prototype). This directory is historical reference only. It **must be left untouched** (recommended) or archived with a README note if the team later decides on a broader repo cleanup. No PR in this plan touches it.
- `dist/` — fully regenerated by `npm run build`; no action required.
- `server/uploads/` and any runtime artifacts under `server/`.
- `public/assets/shots/` and `public/assets/videos/` (and the 11 Shot definitions) — frozen assets and data.
- `server/index.js`, OAuth contracts, and the entire backend on port 8787 (frozen per Non-Goals).
- `package.json` scripts, `vite.config.ts` (port 5175 strict), `index.html` favicon (unless a new one is explicitly designed), or any non-UI configuration.

**In-scope cleanup (executed in PR 8):**
- `src/App.css` is deleted after confirming (via grep) that it has zero imports (already the case today; `main.tsx` imports only `index.css`).
- All old wizard/ modal JSX, state, and neon/gold/cyan className literals are removed from `App.tsx`.
- Unused CSS rules in the final `index.css` (old cinematic glass/shot-card transforms, gold button defs, etc.) are stripped.
- Incidental docs: `README.md` language and screenshots are refreshed; `index.html` title may be lightly updated for branding consistency.

This declaration removes ambiguity for the implementer and prevents accidental over-deletion.

---

## Open Questions (prioritized; blocking items called out)

**Blocking / pre-PR 1 (must be resolved before the color audit PR begins):**
1. **Accent hue confirmation (blocking):** Proposed `#3b82f6` (blue-500) or a close variant. Confirm the exact interactive blue (or other accent) currently shipping on grok.com / x.ai production surfaces as of the implementation start date. A fresh visual reference or design token from the grok.com team is required before any CSS or className work. Without this, the foundation PR cannot claim "grok-native."

**High priority (decide by end of PR 6 / before Studio PR 7):**
2. **Product naming & positioning:** "g-vid" is the current working title (README, title tag, TopNav). Is the long-term intent "Grok Studio", "Grok • Video", "Imagine — Video", or similar? This affects TopNav logo treatment, marketing copy in hero/FAQ, and potential favicon.

3. **Waveform visualization for audio trim (scope decision for AudioTrimPanel in PR 6):** The smart trim (Web Audio energy analysis) is powerful. Adding a lightweight zero-dep canvas waveform visualization (or simple bar visualization) in `<AudioTrimPanel>` would be high-value polish and improves the "curated, high-quality" feel. In or out of the initial redesign wave? (Affects the AudioTrimPanel component contract.)

**Post-redesign / future waves (nice to have; do not block PR 8):**
4. **Real video result integration:** The current PRODUCTION_PENDING path surfaces the prompt for external/agentic generation. Once the `video_gen` capability in this environment can return actual fresh clips, how should successful results surface back into the Studio result area (replace the pending state, new "Regenerate" flow, etc.)?

5. **Analytics / instrumentation:** Any preference (or prohibition) for client-side event surface (e.g., lightweight custom events, data attributes for later instrumentation, or simple `window.gtag` / existing xAI analytics) on key actions (step completed, shot selected, generation started, OAuth success)? Future-proofing note: the Studio and hook surfaces should expose stable data-* attributes or a tiny optional URL sync hook so deep-linking / shareable studio state can be added later without a full router migration.

---

## Key Decisions

- **Studio as immersive workspace, not modal:** Creation is the hero. A focused, full-content transition (with persistent TopNav) communicates that this is a powerful native Grok creative tool, not a temporary wizard.
- **Zero new runtime dependencies:** All behavior achieved with existing React 19, TS, Tailwind 4, framer-motion, lucide-react, sonner. (Optional future router addition explicitly called out.)
- **Logic preservation over rewrite:** Every line of smart trim, OAuth polling, prompt construction, and generation staging moves verbatim into hooks/lib. Only presentation + file organization changes.
- **Shot hover video previews as safe delight:** Low-cost (assets already shipped) and elevates the "curated high-quality asset browser" goal without altering data model.
- **Pure Inter, no serif:** Removes Playfair Display entirely for exact brand alignment with grok.com.
- **isProductionMode toggle labeling & visibility in the calm aesthetic:** In the old wizard the checkbox reads "Production mode (real Grok)" with a long explanatory paragraph. In the new Studio review step (and any advanced settings surface) it will be relabeled to a calmer, less "internal prototype" string such as "Use real Grok 4.3 Video generation (consumes SuperGrok quota)" or moved behind a subtle "Advanced" disclosure. Default remains `true`. The behavior (which stage labels and credit math are used, whether the window global handoff occurs) is unchanged. This decision was made to avoid neon/demo-vs-prod language in the final grok-native UI.

---

## References

- Current implementation: `/Users/kc/g-vid/src/App.tsx` (full 1408 LOC, especially wizard at 876-1231, OAuth at 1284-1372, audio logic 409-446)
- Styling system to replace: `/Users/kc/g-vid/src/index.css` (cinematic shot cards 64-108, gold buttons 122-156), `/Users/kc/g-vid/tailwind.config.js:9-35`
- Backend contracts (no change): `/Users/kc/g-vid/server/index.js` (device code start 54+, polling, session), `server/README-OAUTH.md`
- Original inspiration + superseded prototype: `/Users/kc/g-vid/README.md:3`, `/Users/kc/g-vid-design/index.html`
- Target aesthetic source: `https://grok.com`, `https://x.ai/grok` (deepest dark, Inter, electric blue accents, minimal nav, content-first)
- Dependencies: `/Users/kc/g-vid/package.json` (React 19, framer-motion 12, sonner 2, lucide-react)
- Vite config: `/Users/kc/g-vid/vite.config.ts:8-10` (port 5175 strict)

---

## PR Plan (Small, Independently Reviewable PRs)

**Critical reality check (from static analysis of the 1408-line `App.tsx`):** There are **exactly 111 inline hex color literals** (`#00e5ff`, `#ff2d95`, `#c5a46e`, `#39ff14`, `#08080c`, `#555568`, etc.) plus undefined `.neon-btn` classes scattered across *both* the landing surfaces (nav logo gradient line 623, pricing at 722/739/744, testimonials 797/823/829, stats, footer) *and* the entire wizard + modals (STEP labels, dropzones, progress bars, OAuth dialog, etc.). Updating only `tailwind.config.js` + `index.css` produces almost no visible change on the running app until JSX is edited. The plan below therefore front-loads a dedicated, mechanical color+class audit PR so that early deliverables produce real, reviewable visual progress on the 5175 dev server while the old wizard remains 100% functional.

**Order is important — each builds on the previous without breaking the running app. Dual-UI (old wizard + new primitives/Studio behind flag) exists only for the minimum necessary PRs.**

1. **"chore: color & inline style audit + systematic token migration (foundation)"**  
   Files: `tailwind.config.js` (extend theme with new grok tokens: `colors: { bg: '#000000', surface: '#0a0a0a', ..., accent: '#3b82f6' }` and remove gold/Playfair), `src/index.css` (new `:root` vars + primitives for `.surface`, `.card`, `.btn-grok-*`, shot-card calm styles, sonner overrides, focus rings; delete all old cinematic rules).  
   **Core work:** In `src/App.tsx`, perform bulk mechanical replacement of all 111 inline hex + `text-[#8888a0]`-style values and `neon-btn` / `accent-[#00e5ff]` to semantic Tailwind (using the newly extended theme) or `style` vars where dynamic. Prioritize landing surfaces first (nav, pricing comparison, stats, hero, testimonials, FAQ) for early visible grok-native polish. Wizard and OAuth modal receive the same migration (so they look calmer even while still using the old 4-step structure).  
   Add `ErrorBoundary` wrapper around root/App.  
   **Checklist (must be completed and linked in PR):** 111 colors audited → mapped → replaced; no behavioral change to any handler or state; `npm run dev` green; manual smoke of all 11 shots + OAuth demo path + smart trim + PRODUCTION_PENDING.  
   Dependencies: none.  
   *This PR makes the "foundation" claim real and delivers the first meaningful visual delta on the live dev server.*

2. **"feat: new TopNav shell + session display (using migrated tokens)"**  
   New file: `src/components/TopNav.tsx` (clean grok.com layout with logo, minimal links, credits pill using new `text-text-secondary` etc., user chip + dropdown, prominent "New clip" in accent).  
   Update: `src/App.tsx` (render new TopNav; remove old nav JSX lines ~618-664). The old wizard is still triggered by the new CTA (via existing `showCreate` state) during transition.  
   Dependencies: PR 1.

3. **"refactor: extract constants, types, and prompt builder (pure logic move)"**  
   New: `src/types/index.ts`, `src/lib/constants.ts` (SHOTS[11], CATEGORIES, ARTISTS, TESTIMONIALS, FAQS verbatim), `src/lib/prompts.ts` (`buildProductionPrompt`).  
   Update: `App.tsx` (delete inline copies, import). No visual or behavior change.  
   Dependencies: none.

4. **"feat: ShotCard + ShotGrid + ShotBrowser components + early landing polish"**  
   New: `src/components/{ShotCard.tsx, ShotGrid.tsx, ShotBrowser.tsx}` (calm 16/9 cards with subtle accent border on select/hover; optional muted video preview on hover using existing `/assets/videos/*.mp4`; search + category pills).  
   Update: landing preview grid (lines ~769-790) and the full shots modal to use new components (or new browser). Remove heavy cinematic hover transforms.  
   Dependencies: PR 1 (tokens), PR 3 (constants).

5. **"refactor: extract useSuperGrokAuth hook + new OAuthDialog (calm aesthetic)"**  
   New: `src/hooks/useSuperGrokAuth.ts` (verbatim move of device start/poll/disconnect + localStorage logic from App:197-338 + 301-317 + auto-restore), `src/components/OAuthDialog.tsx` (re-implements the two screens in the new clean centered surface + large mono code + blue primary).  
   Update: TopNav + any remaining inline connect buttons. Old modal still works for the old wizard path.  
   Dependencies: PR 2.

6. **"feat: AudioTrimPanel + ImageUploader + useAudioTrim hook (plus minimal test harness)"**  
   New: `src/hooks/useAudioTrim.ts` (smart energy analysis + slider + update logic, verbatim from App:371-446 and 401-406), `src/components/{ImageUploader.tsx, AudioTrimPanel.tsx}` (dropzones, previews, "Smart Trim" button using existing Web Audio, calm visuals + validation).  
   **Also in this PR:** Add Vitest + @testing-library/react (devDeps), write first pure-function tests for `buildProductionPrompt` (from lib) and the core energy loop of smart trim. Add a Playwright smoke spec for the happy path through the (still-present) old wizard. Land a simple feature flag helper (`useFeatureFlag('studio_v2')` backed by localStorage + `?ui=studio`).  
   Dependencies: PR 3.

7. **"feat: Studio workspace — the new immersive creation experience (core, behind flag)"**  
   New: `src/components/Studio.tsx` (the full focused workspace with stepper, two/three-column layout, persistent sidebar, step content), `src/hooks/useStudioState.ts` (orchestrates the 4-step equivalent state machine + canProceed + reset + generation orchestration), supporting `GenerationProgress.tsx`, `ResultPlayer.tsx`, `Stepper.tsx`, and any final ui/ primitives.  
   The `<Studio>` is rendered (instead of or in addition to the old modal) only when the feature flag is true. All real behavior (image upload limits, exact audioTrim 8s windows, smart trim identical output, 11 shots, `buildProductionPrompt` fidelity, credit decrements 48/52, PRODUCTION_PENDING + `window.__GROK_VISUAL_LAST_PROMPT__` handoff + copy behavior, isProductionMode) is preserved exactly by delegating to the extracted hooks.  
   Add reduced-motion guards for video previews and step transitions.  
   Dependencies: PRs 1-6 (tokens, all hooks, primitives, flag helper, tests).

8. **"feat: final cutover — delete old wizard/modal + complete landing refresh + full cleanup"**  
   Update: `src/App.tsx` (remove all remaining old wizard JSX ~875-1402, `showCreate`/`wizardStep`/generation state that is now owned by Studio hook, the old full shots modal, the old OAuth modal, neon-btn and any leftover inline hex; wire permanent `<Studio>` entry points from TopNav/hero/ShotCard; keep thin shell + landing sections refreshed with new tokens).  
   Delete: old modal remnants, any unused CSS, `src/App.css` (confirmed zero imports).  
   Incidental updates: `index.html` (title/meta if "g-vid" branding evolves), `README.md` (update screenshots, "cinematic" language, add "npm test" and "npm run test:e2e" instructions), potential favicon if needed.  
   Remove the feature flag and dual-UI code paths.  
   Final comprehensive verification (manual + automated) that `npm run dev` on 5175 + real 8787 backend produces identical functional behavior for every path while the UI is now fully grok-native.  
   Dependencies: PR 7.

**Estimated total diff:** ~2100-2500 LOC added (new components + tests + docs), ~1100-1300 removed (monolith shrinkage + deleted CSS). The color audit PR is intentionally mechanical and reviewable in isolation. Each PR < ~400 LOC net where possible.

After PR 8: the app is fully transformed. Every line of real OAuth polling, smart trim Web Audio energy analysis, prompt construction, credit math, PRODUCTION_PENDING handoff, and Shot data has been preserved verbatim (only relocated into hooks/lib) and the old hybrid gold+neon cinematic design language has been completely excised from both landing and creation surfaces. The `g-vid-design/` directory is left untouched as historical reference (see Cleanup Scope).

---

*End of design document.*
