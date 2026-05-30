import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Copy, Loader2, Search, SlidersHorizontal, X } from 'lucide-react';
import { Toaster, toast } from 'sonner';

import { TopNav } from './components/TopNav';
import { Studio } from './components/Studio';

export interface Shot {
  id: string;
  name: string;
  description: string;
  category: string;
  thumbnail: string;
  video?: string;
  promptHint: string;
}

interface SessionState {
  connected: boolean;
  plan: string;
  credits: number;
  sessionId?: string;
}

interface DesignTweaks {
  accent: string;
  density: 'comfortable' | 'compact';
  contrast: 'balanced' | 'high';
}

interface OAuthFlowState {
  active: boolean;
  status: 'idle' | 'starting' | 'waiting' | 'authorizing' | 'success' | 'error' | 'needs_config';
  deviceCode?: string;
  userCode?: string;
  verificationUri?: string;
  verificationUriComplete?: string;
  error?: string;
}

interface GenerationPayload {
  prompt: string;
  shot: Shot;
  trim: { start: number; duration: number };
  faceDescription: string;
  images: { file: File }[];
  audio: File | null;
}

interface GenerateResult {
  ok: boolean;
  message: string;
}

const STORAGE_KEYS = {
  tweaks: 'gvid_tweaks',
  session: 'gvid_session',
  realSession: 'gvid_real_session',
};

const BACKEND = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:8787';

const SHOTS: Shot[] = [
  { id: 'on-the-radar', name: 'On The Radar', category: 'Urban', description: 'Moody nighttime rooftop with glowing city skyline', thumbnail: '/assets/shots/3.jpg', video: '/assets/videos/1.mp4', promptHint: 'urban rooftop night performance, city lights, cinematic energy' },
  { id: 'analog-reverie', name: 'Analog Reverie', category: 'Studio', description: 'Warm vintage tape studio with golden filmic lighting', thumbnail: '/assets/shots/1.jpg', video: '/assets/videos/2.mp4', promptHint: 'intimate analog studio, reel-to-reel, warm nostalgic tone' },
  { id: 'skyward-freefall', name: 'Skyward Freefall', category: 'Epic', description: 'Epic suspended performance in dramatic open sky', thumbnail: '/assets/shots/2.jpg', video: '/assets/videos/3.mp4', promptHint: 'epic sky performance, god rays, wind, cinematic scale' },
  { id: 'blue-cube-studio', name: 'Blue Cube Studio', category: 'Studio', description: 'Minimalist deep blue geometric cube with perfect light', thumbnail: '/assets/shots/5.jpg', video: '/assets/videos/3.mp4', promptHint: 'architectural blue cube, dramatic cool lighting, modern luxury' },
  { id: 'blue-studio-stance', name: 'Blue Studio Stance', category: 'Studio', description: 'Powerful dramatic stance in rich blue environment', thumbnail: '/assets/shots/4.jpg', promptHint: 'intense single-key portrait lighting, confident performance' },
  { id: 'amber-newsroom', name: 'Amber Lit Newsroom', category: 'Cinematic', description: 'Dramatic warm amber broadcast newsroom tension', thumbnail: '/assets/shots/6.jpg', promptHint: 'warm practical lighting, vintage broadcast cameras, gravitas' },
  { id: 'blue-turntable', name: 'Blue Studio Turntable', category: 'Studio', description: 'Sleek modern DJ setup with cyan-blue accents', thumbnail: '/assets/shots/7.jpg', promptHint: 'premium electronic studio, multiple turntables, focused energy' },
  { id: 'amp-stack', name: 'Amp Stack Session', category: 'Raw', description: 'Raw powerful energy surrounded by towering amps', thumbnail: '/assets/shots/8.jpg', promptHint: 'rock intensity, Marshall stacks, smoke, stage power' },
  { id: 'bodega-groove', name: 'Bodega Aisle Groove', category: 'Urban', description: 'Authentic late-night New York bodega performance', thumbnail: '/assets/shots/9.jpg', promptHint: 'raw street authenticity, fluorescent + product lighting' },
  { id: 'neon-rooftop', name: 'Neon Rooftop Drift', category: 'Neon', description: 'Dreamy pink-cyan neon reflections on wet rooftop', thumbnail: '/assets/shots/11.jpg', promptHint: 'high fashion neon city night, wet reflections, dreamy' },
  { id: 'crimson-warehouse', name: 'Crimson Warehouse Flow', category: 'Raw', description: 'Massive industrial space drenched in dramatic crimson', thumbnail: '/assets/shots/10.jpg', promptHint: 'raw industrial power, red dramatic lighting, concrete' },
];

const TWEAK_DEFAULTS: DesignTweaks = {
  accent: '#3b82f6',
  density: 'comfortable',
  contrast: 'balanced',
};

function useDesignTweaks() {
  const [tweaks, setTweaks] = useState<DesignTweaks>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.tweaks);
      return saved ? { ...TWEAK_DEFAULTS, ...JSON.parse(saved) } : TWEAK_DEFAULTS;
    } catch {
      return TWEAK_DEFAULTS;
    }
  });

  const updateTweaks = (patch: Partial<DesignTweaks>) => {
    setTweaks((current) => {
      const next = { ...current, ...patch };
      try {
        localStorage.setItem(STORAGE_KEYS.tweaks, JSON.stringify(next));
      } catch {
        // no-op
      }
      return next;
    });
  };

  const resetTweaks = () => {
    setTweaks(TWEAK_DEFAULTS);
    try {
      localStorage.removeItem(STORAGE_KEYS.tweaks);
    } catch {
      // no-op
    }
  };

  return { tweaks, updateTweaks, resetTweaks };
}

const accentVariants = {
  '#3b82f6': { hover: '#2563eb', warm: '#60a5fa' },
  '#22c55e': { hover: '#16a34a', warm: '#4ade80' },
  '#f97316': { hover: '#ea580c', warm: '#fb923c' },
  '#e11d48': { hover: '#be123c', warm: '#fb7185' },
} as const;

const DEFAULT_SESSION: SessionState = {
  connected: false,
  plan: 'SuperGrok Demo',
  credits: 0,
};

function App() {
  const [showCreate, setShowCreate] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [showShotsModal, setShowShotsModal] = useState(false);
  const [showTweaks, setShowTweaks] = useState(false);
  const [showOAuthModal, setShowOAuthModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [selectedShotForStudio, setSelectedShotForStudio] = useState<Shot | undefined>(undefined);
  const [oauthFlow, setOauthFlow] = useState<OAuthFlowState>({ active: false, status: 'idle' });

  const [session, setSession] = useState<SessionState>(DEFAULT_SESSION);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [lastGeneration, setLastGeneration] = useState<{ prompt: string; shot: Shot; message: string; credits?: number } | null>(null);

  const { tweaks, updateTweaks, resetTweaks } = useDesignTweaks();

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.session);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<SessionState>;
        setSession((prev) => ({ ...prev, ...parsed }));
      }
    } catch (error) {
      console.warn('Failed to hydrate session', error);
      localStorage.removeItem(STORAGE_KEYS.session);
    } finally {
      setSessionLoading(false);
    }
  }, []);

  useEffect(() => {
    const savedReal = localStorage.getItem(STORAGE_KEYS.realSession);
    if (!savedReal || session.connected) return;

    let cancelled = false;
    setSessionLoading(true);

    fetch(`${BACKEND}/auth/session/${savedReal}`)
      .then((r) => r.json())
      .then((sessionData) => {
        if (cancelled) return;
        if (sessionData.connected) {
          updateSession({
            connected: true,
            plan: sessionData.plan || 'SuperGrok',
            credits: sessionData.credits || 1842,
            sessionId: savedReal,
          });
        } else {
          localStorage.removeItem(STORAGE_KEYS.realSession);
        }
      })
      .catch(() => {
        if (cancelled) return;
        localStorage.removeItem(STORAGE_KEYS.realSession);
      })
      .finally(() => {
        if (!cancelled) setSessionLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.connected]);

  const updateSession = (updates: Partial<SessionState>) => {
    setSession((prev) => {
      const next = { ...prev, ...updates };
      try {
        if (next.connected) {
          localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(next));
        } else {
          localStorage.removeItem(STORAGE_KEYS.session);
        }
      } catch {
        // no-op
      }
      return next;
    });
  };

  const startRealDeviceAuth = async () => {
    setOauthFlow({ active: true, status: 'starting' });

    try {
      const res = await fetch(`${BACKEND}/auth/device/start`, { method: 'POST' });
      const data = await res.json();

      if (!res.ok || !data.device_code) {
        setOauthFlow({
          active: false,
          status: 'needs_config',
          error: data.error_description || data.message || 'XAI_CLIENT_ID is not configured on the backend.',
        });
        return;
      }

      setOauthFlow({
        active: true,
        status: 'waiting',
        deviceCode: data.device_code,
        userCode: data.user_code,
        verificationUri: data.verification_uri || 'https://auth.x.ai/activate',
        verificationUriComplete: data.verification_uri_complete,
      });

      pollForAuthorization(data.device_code, data.interval || 5);
    } catch (error) {
      console.error('OAuth start failed', error);
      setOauthFlow({
        active: false,
        status: 'error',
        error: 'Cannot reach OAuth backend. Make sure the server is running on port 8787.',
      });
    }
  };

  const pollForAuthorization = async (deviceCode: string, interval: number) => {
    const maxAttempts = 120;
    let attempts = 0;

    const tick = async () => {
      attempts += 1;
      if (attempts > maxAttempts) {
        setOauthFlow((prev) => ({ ...prev, status: 'error', error: 'Authorization timed out.' }));
        return;
      }

      try {
        const res = await fetch(`${BACKEND}/auth/device/status?device_code=${encodeURIComponent(deviceCode)}`);
        const data = await res.json();

        if (data.status === 'authorized' && data.sessionId) {
          const sessionRes = await fetch(`${BACKEND}/auth/session/${data.sessionId}`);
          const sessionData = await sessionRes.json();

          if (sessionData.connected) {
            localStorage.setItem(STORAGE_KEYS.realSession, data.sessionId);
            updateSession({
              connected: true,
              plan: sessionData.plan || 'SuperGrok',
              credits: sessionData.credits || 1842,
              sessionId: data.sessionId,
            });
            setOauthFlow({ active: false, status: 'success' });
            setShowOAuthModal(false);
            toast.success('Connected to SuperGrok', { description: 'Real OAuth session active.' });
            return;
          }
        }

        if (data.status === 'slow_down') {
          setTimeout(tick, ((data.interval || interval) + 2) * 1000);
          return;
        }

        if (data.status === 'error' || data.error) {
          setOauthFlow((prev) => ({ ...prev, status: 'error', error: data.error || 'OAuth polling error' }));
          return;
        }

        setOauthFlow((prev) => ({ ...prev, status: 'authorizing' }));
        setTimeout(tick, interval * 1000);
      } catch (error) {
        setTimeout(tick, interval * 1000);
      }
    };

    setTimeout(tick, 2500);
  };

  const handleConnectClick = () => {
    setSessionError(null);
    setShowOAuthModal(true);
    setOauthFlow({ active: false, status: 'idle' });
  };

  const handleLocalDevMode = () => {
    updateSession({ connected: true, plan: 'SuperGrok (local dev)', credits: 9999, sessionId: undefined });
    setShowOAuthModal(false);
    setOauthFlow({ active: false, status: 'idle' });
    setShowCreate(true);
  };

  const disconnect = async () => {
    const realSession = localStorage.getItem(STORAGE_KEYS.realSession);
    if (realSession) {
      try {
        await fetch(`${BACKEND}/auth/disconnect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: realSession }),
        });
      } catch (err) {
        console.warn('Disconnect failed', err);
      }
      localStorage.removeItem(STORAGE_KEYS.realSession);
    }

    setSession(DEFAULT_SESSION);
    try {
      localStorage.removeItem(STORAGE_KEYS.session);
    } catch {
      // no-op
    }
    setShowCreate(false);
    setOauthFlow({ active: false, status: 'idle' });
    toast.info('Disconnected');
  };

  const categories = useMemo(() => ['All', ...Array.from(new Set(SHOTS.map((s) => s.category)))], []);

  const filteredShots = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return SHOTS.filter((shot) => {
      const matchesSearch = search.length === 0 || shot.name.toLowerCase().includes(search) || shot.description.toLowerCase().includes(search);
      const matchesCategory = activeCategory === 'All' || shot.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [activeCategory, searchTerm]);

  const featuredShots = useMemo(() => SHOTS.slice(0, 3), []);
  const galleryShots = useMemo(() => SHOTS.slice(3, 9), []);

  const openStudioWithShot = (shot: Shot) => {
    setSelectedShotForStudio(shot);
    setShowCreate(true);
    setShowShotsModal(false);
  };

  const handleGenerate = async (payload: GenerationPayload): Promise<GenerateResult> => {
    if (!session.connected || !session.sessionId) {
      return { ok: false, message: 'Please connect your SuperGrok account to generate.' };
    }

    const formData = new FormData();
    formData.append('prompt', payload.prompt);
    formData.append('shotName', payload.shot.name);
    formData.append('trimStart', payload.trim.start.toString());
    formData.append('trimDuration', payload.trim.duration.toString());
    formData.append('faceDescription', payload.faceDescription);
    formData.append('sessionId', session.sessionId);
    payload.images.forEach((image, index) => {
      formData.append('images', image.file, image.file.name || `photo-${index}.jpg`);
    });
    if (payload.audio) {
      formData.append('audio', payload.audio, payload.audio.name);
    }

    try {
      const response = await fetch(`${BACKEND}/generate`, {
        method: 'POST',
        body: formData,
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || body.message || 'Failed to queue your clip.');
      }

      setLastGeneration({
        prompt: payload.prompt,
        shot: payload.shot,
        message: body.message || 'Prompt accepted',
        credits: body.estimatedCredits,
      });

      return { ok: true, message: body.message || 'Prompt accepted' };
    } catch (error: any) {
      return { ok: false, message: error.message || 'Generation failed' };
    }
  };

  const accentSet = accentVariants[tweaks.accent as keyof typeof accentVariants] ?? accentVariants['#3b82f6'];

  const themeVars = {
    '--accent': tweaks.accent,
    '--accent-hover': accentSet.hover,
    '--accent-warm': accentSet.warm,
    '--surface-glass': tweaks.contrast === 'high' ? 'rgba(17,17,19,0.92)' : 'rgba(17,17,19,0.75)',
    '--border': tweaks.contrast === 'high' ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.08)',
  } as CSSProperties;

  const connectionLabel = sessionLoading
    ? 'Checking session…'
    : session.connected
      ? `Connected · ${session.plan}`
      : 'Not connected';

  return (
    <div style={themeVars} className="page-shell relative min-h-screen text-[var(--text)] overflow-x-hidden">
      <Toaster position="top-center" richColors closeButton />
      <div className="noise-overlay" aria-hidden />

      <TopNav
        session={session}
        loading={sessionLoading}
        statusLabel={connectionLabel}
        onConnect={handleConnectClick}
        onDisconnect={disconnect}
        onNewClip={() => setShowCreate(true)}
        onShowShots={() => setShowShotsModal(true)}
        onShowHowItWorks={() => setShowHowItWorks(true)}
      />

      <main className="pt-28 pb-28 space-y-20">
        <section className="page-container hero-section">
          <div className="hero-grid">
            <div className="hero-copy">
              <div className="hero-kicker eyebrow">GROK 4.3 VIDEO ENGINE</div>
              <h1 className="hero-title">Cinematic 8-second music videos, built from your refs.</h1>
              <p className="hero-subtitle text-[#c8c8d4] max-w-2xl">
                Upload your best angles, pair them with a live vocal take, and queue a customized Grok clip. Real device OAuth keeps everything in-browser until you generate.
              </p>

              <div className="hero-actions">
                <button onClick={() => setShowCreate(true)} className="btn btn-primary px-6 py-3 text-sm font-semibold">
                  Start a new clip
                </button>
                <button onClick={() => setShowShotsModal(true)} className="btn btn-secondary px-5 py-3 text-sm">
                  Browse curated shots
                </button>
                <button onClick={() => setShowHowItWorks(true)} className="btn btn-ghost px-5 py-3 text-sm">
                  How it works
                </button>
              </div>

              <div className="hero-meta-rail">
                <div className="meta-card">
                  <div className="meta-label">Session</div>
                  <div className="meta-value">{connectionLabel}</div>
                </div>
                <div className="meta-card">
                  <div className="meta-label">Library</div>
                  <div className="meta-value">{SHOTS.length} scenes</div>
                  <div className="meta-hint">Urban · Studio · Neon · Raw</div>
                </div>
                <div className="meta-card">
                  <div className="meta-label">Last prompt</div>
                  {lastGeneration ? (
                    <>
                      <div className="meta-value">{lastGeneration.shot.name}</div>
                      <div className="meta-hint line-clamp-2">{lastGeneration.message}</div>
                    </>
                  ) : (
                    <div className="meta-hint">Queue a shot to see the live log</div>
                  )}
                </div>
              </div>
              {sessionError && <div className="meta-alert">{sessionError}</div>}
            </div>

            <div className="hero-media">
              <div className="hero-media__frame">
                <img src={SHOTS[0].thumbnail} className="w-full h-full object-cover" alt={SHOTS[0].name} />
                <div className="hero-media__glow" />
                <div className="hero-media__tag">Featured scene</div>
                <div className="hero-media__caption">
                  <div className="hero-media__title">{SHOTS[0].name}</div>
                  <p className="hero-media__desc">{SHOTS[0].description}</p>
                  <div className="hero-media__actions">
                    <button onClick={() => openStudioWithShot(SHOTS[0])} className="btn btn-primary btn-sm">Use this shot</button>
                    <button onClick={() => setShowHowItWorks(true)} className="btn btn-secondary btn-sm">See the flow</button>
                  </div>
                </div>
              </div>

              <div className="hero-media__strip">
                {featuredShots.slice(1, 3).map((shot) => (
                  <button
                    key={shot.id}
                    type="button"
                    onClick={() => openStudioWithShot(shot)}
                    className="hero-thumb"
                    aria-label={`Use shot ${shot.name}`}
                  >
                    <img src={shot.thumbnail} alt={shot.name} />
                    <div className="hero-thumb__label">{shot.name}</div>
                    <div className="hero-thumb__pill">{shot.category}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="page-container section-block">
          <div className="section-head">
            <div className="space-y-3">
              <div className="eyebrow text-[11px] text-text-secondary">Shot gallery</div>
              <h2 className="section-title">Curated scenes, ready to remix.</h2>
              <p className="section-subtitle text-text-secondary max-w-2xl">
                Pick a premium canvas and Grok balances lighting, motion, and lip sync against your reference set. No generic towers — every shot is a cinematic micro-world.
              </p>
            </div>
            <div className="section-actions">
              <button onClick={() => setShowShotsModal(true)} className="btn btn-secondary px-4 py-2 text-xs">
                View full library
              </button>
              <button onClick={() => setShowCreate(true)} className="btn btn-primary px-4 py-2 text-xs">
                Open Studio
              </button>
            </div>
          </div>

          <div className="featured-shots-grid">
            {featuredShots.map((shot, idx) => (
              <button
                key={shot.id}
                onClick={() => openStudioWithShot(shot)}
                className="featured-shot-card"
                type="button"
                aria-label={`Use shot ${shot.name}`}
              >
                <img src={shot.thumbnail} alt={shot.name} />
                <div className="featured-shot-card__gradient" />
                <div className="featured-shot-card__top">
                  <span className="featured-shot-card__pill">{shot.category}</span>
                  <span className="featured-shot-card__index">0{idx + 1}</span>
                </div>
                <div className="featured-shot-card__body">
                  <div className="featured-shot-card__title">{shot.name}</div>
                  <div className="featured-shot-card__desc">{shot.description}</div>
                  <div className="featured-shot-card__cta">Use shot ↗</div>
                </div>
              </button>
            ))}
          </div>

          <div className="shot-rail">
            {galleryShots.map((shot) => (
              <button
                key={shot.id}
                onClick={() => openStudioWithShot(shot)}
                className="shot-rail-card"
                type="button"
                aria-label={`Use ${shot.name}`}
              >
                <div className="shot-rail-card__image">
                  <img src={shot.thumbnail} alt={shot.name} />
                  <div className="shot-rail-card__overlay" />
                  <span className="shot-rail-card__pill">{shot.category}</span>
                </div>
                <div className="shot-rail-card__body">
                  <div className="shot-rail-card__title">{shot.name}</div>
                  <p className="shot-rail-card__desc">{shot.description}</p>
                </div>
              </button>
            ))}
          </div>
        </section>
      </main>

      {showCreate && (
        <Studio
          onClose={() => setShowCreate(false)}
          session={session}
          onConnect={handleConnectClick}
          SHOTS={SHOTS}
          initialShot={selectedShotForStudio}
          onGenerate={handleGenerate}
        />
      )}

      <AnimatePresence>
        {showOAuthModal && (
          <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/85 p-6" onClick={() => setShowOAuthModal(false)}>
            <div className="max-w-xl w-full glass rounded-3xl p-7 md:p-8" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <div className="text-[#3b82f6] text-xs tracking-[2px]">SUPERGROK OAUTH</div>
                  <h3 className="text-2xl font-semibold tracking-[-0.8px] mt-1">Connect your account</h3>
                </div>
                <button onClick={() => setShowOAuthModal(false)} className="btn btn-ghost p-2" aria-label="Close OAuth modal">
                  <X size={18} />
                </button>
              </div>

              {(oauthFlow.status === 'idle' || oauthFlow.status === 'starting') && (
                <div className="space-y-4">
                  <p className="text-[#a1a1aa] text-sm leading-relaxed">
                    Use xAI Device Code OAuth to connect your SuperGrok session.
                  </p>
                  <button onClick={startRealDeviceAuth} disabled={oauthFlow.status === 'starting'} className="btn btn-primary w-full py-3">
                    {oauthFlow.status === 'starting' ? (
                      <><Loader2 className="animate-spin" size={16} /> Starting OAuth…</>
                    ) : (
                      'Start real OAuth'
                    )}
                  </button>
                  <div className="text-[11px] text-[#71717a] text-center pt-1">
                    Requires XAI_CLIENT_ID configured on the backend.
                  </div>
                </div>
              )}

              {(oauthFlow.status === 'waiting' || oauthFlow.status === 'authorizing') && (
                <div className="space-y-4">
                  <div className="bg-[#111113] border border-white/10 rounded-2xl p-4">
                    <div className="text-xs text-[#8f8fa0] mb-2">Verification code</div>
                    <div className="font-mono text-xl tracking-[0.24em] text-white">{oauthFlow.userCode}</div>
                  </div>

                  <div className="text-sm text-[#a1a1aa] leading-relaxed">
                    Open <span className="text-white">{oauthFlow.verificationUri || 'https://auth.x.ai/activate'}</span> and enter the code.
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={async () => {
                        if (!oauthFlow.userCode) return;
                        await navigator.clipboard.writeText(oauthFlow.userCode);
                        toast.success('Code copied');
                      }}
                      className="btn btn-secondary flex-1"
                    >
                      <Copy size={14} /> Copy code
                    </button>
                    <a
                      className="btn btn-primary flex-1 text-center"
                      href={oauthFlow.verificationUriComplete || oauthFlow.verificationUri || 'https://auth.x.ai/activate'}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open verification page
                    </a>
                  </div>

                  <div className="text-xs text-[#7a7a82]">
                    {oauthFlow.status === 'authorizing' ? 'Waiting for approval…' : 'Ready for approval'}
                  </div>
                </div>
              )}

              {(oauthFlow.status === 'needs_config' || oauthFlow.status === 'error') && (
                <div className="space-y-4">
                  <div className="bg-[#2a1114] border border-[#5a1d26] rounded-2xl p-4 text-sm text-[#f3b8c1]">
                    {oauthFlow.error || 'OAuth setup issue'}
                  </div>

                  <div className="text-xs text-[#8f8fa0] leading-relaxed space-y-2">
                    <p>
                      Device OAuth requires a registered <code className="text-white">XAI_CLIENT_ID</code>.
                    </p>
                    <p>
                      1. Register an OAuth client with xAI (console.x.ai or support).<br />
                      2. Add it to <code className="text-white">server/.env</code> as <code className="text-white">XAI_CLIENT_ID=your_id_here</code><br />
                      3. Restart the backend.
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <button onClick={startRealDeviceAuth} className="btn btn-secondary flex-1">Retry real OAuth</button>
                    <button
                      onClick={handleLocalDevMode}
                      className="btn btn-primary flex-1"
                    >
                      Continue in local dev mode
                    </button>
                  </div>

                  <div className="text-[10px] text-[#6b6b78] text-center">
                    The "local dev mode" button lets you test the full Studio flow without a real client ID.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showShotsModal && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-6" onClick={() => setShowShotsModal(false)}>
            <div className="max-w-6xl w-full glass rounded-3xl p-6 md:p-8 max-h-[85vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <div className="text-[#3b82f6] text-xs tracking-[2px]">SHOT LIBRARY</div>
                  <h3 className="text-3xl font-semibold tracking-[-1px] mt-1">Find your scene</h3>
                </div>
                <button onClick={() => setShowShotsModal(false)} className="btn btn-ghost p-2" aria-label="Close shots modal">
                  <X size={18} />
                </button>
              </div>

              <div className="flex flex-col md:flex-row md:items-center gap-4 mb-4">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#71717a]" />
                  <input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search shots"
                    className="w-full bg-[#171717] border border-[#262626] rounded-xl pl-9 pr-3 py-2.5 text-sm focus:border-[#3b82f6] outline-none"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {categories.map((category) => (
                    <button
                      key={category}
                      onClick={() => setActiveCategory(category)}
                      className={`px-3 py-1.5 rounded-full text-xs border transition ${
                        activeCategory === category
                          ? 'bg-[#3b82f6]/20 border-[#3b82f6] text-white'
                          : 'bg-[#111113] border-[#2a2a2d] text-[#a1a1aa] hover:text-white'
                      }`}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-auto pr-1 max-h-[58vh]">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredShots.map((shot) => (
                    <button
                      type="button"
                      key={shot.id}
                      onClick={() => openStudioWithShot(shot)}
                      className="text-left shot-card focus:outline-none focus:ring-2 focus:ring-[#3b82f6]"
                    >
                      <img src={shot.thumbnail} alt={shot.name} className="absolute inset-0 w-full h-full object-cover" />
                      <div className="absolute bottom-0 left-0 right-0 p-5 bg-gradient-to-t from-black/90 via-black/70 to-transparent">
                        <div className="font-semibold tracking-tight">{shot.name}</div>
                        <div className="text-sm text-[#d4d4d8] mt-0.5 line-clamp-1">{shot.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
                {filteredShots.length === 0 && <div className="text-center py-14 text-[#71717a] text-sm">No matching shots found.</div>}
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showHowItWorks && (
          <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/90 p-6" onClick={() => setShowHowItWorks(false)}>
            <div className="max-w-2xl w-full glass rounded-3xl p-10" onClick={(e) => e.stopPropagation()}>
              <div className="text-5xl tracking-[-1.5px] font-semibold mb-10">How g-vid works</div>
              <div className="space-y-9 text-[17px]">
                {[
                  ['1. Upload your face', '3–5 high-quality selfies. Different angles = dramatically better consistency.'],
                  ['2. Drop your audio', 'A clean 8–15 second vocal performance. The AI uses this for perfect lip sync.'],
                  ['3. Pick a shot', 'Choose from 100+ cinematic, studio, neon and narrative environments.'],
                  ['4. Generate with Grok', 'g-vid + Grok 4.3 Video creates the clip.'],
                ].map(([title, desc], i) => (
                  <div key={i} className="flex gap-6">
                    <div className="font-mono text-[#3b82f6] text-sm pt-1 w-8 flex-shrink-0">{title.split('.')[0]}</div>
                    <div>
                      <div className="font-medium mb-1">{title.split('. ')[1]}</div>
                      <div className="text-[#a1a1aa] leading-snug">{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => { setShowHowItWorks(false); setShowCreate(true); }} className="btn btn-primary mt-10 w-full py-4 rounded-2xl text-base">Start your first clip</button>
            </div>
          </div>
        )}
      </AnimatePresence>

      <div className={`fixed right-5 bottom-5 z-[95] ${showCreate ? 'opacity-30 pointer-events-none' : ''}`}>
        {showTweaks ? (
          <div className="glass rounded-2xl w-[280px] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium">Production Tweaks</div>
              <button type="button" onClick={() => setShowTweaks(false)} className="text-[#a1a1aa] hover:text-white" aria-label="Close tweaks">
                <X size={14} />
              </button>
            </div>

            <label className="block text-xs text-[#a1a1aa] mb-1">Accent</label>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {Object.keys(accentVariants).map((color) => (
                <button
                  type="button"
                  key={color}
                  onClick={() => updateTweaks({ accent: color })}
                  className={`h-8 rounded-md border ${tweaks.accent === color ? 'border-white' : 'border-white/15'}`}
                  style={{ background: color }}
                  aria-label={`Set accent ${color}`}
                />
              ))}
            </div>

            <label className="block text-xs text-[#a1a1aa] mb-1">Density</label>
            <select
              value={tweaks.density}
              onChange={(e) => updateTweaks({ density: e.target.value as DesignTweaks['density'] })}
              className="w-full mb-3 bg-[#171717] border border-[#2a2a2d] rounded-md px-2 py-2 text-sm"
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>

            <label className="block text-xs text-[#a1a1aa] mb-1">Contrast</label>
            <select
              value={tweaks.contrast}
              onChange={(e) => updateTweaks({ contrast: e.target.value as DesignTweaks['contrast'] })}
              className="w-full mb-4 bg-[#171717] border border-[#2a2a2d] rounded-md px-2 py-2 text-sm"
            >
              <option value="balanced">Balanced</option>
              <option value="high">High</option>
            </select>

            <button type="button" onClick={resetTweaks} className="btn btn-ghost w-full text-xs py-2">Reset</button>
          </div>
        ) : (
          <button type="button" onClick={() => setShowTweaks(true)} className="btn btn-secondary px-4 py-2 text-xs rounded-full inline-flex items-center gap-2">
            <SlidersHorizontal size={14} /> Tweaks
          </button>
        )}
      </div>
    </div>
  );
}

export default App;
