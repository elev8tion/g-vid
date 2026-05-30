import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, X } from 'lucide-react';

interface TopNavProps {
  session: any;
  loading: boolean;
  statusLabel: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onNewClip: () => void;
  onShowShots?: () => void;
  onShowHowItWorks?: () => void;
}

const navLinks = [
  { label: 'Shots', actionKey: 'shots' },
  { label: 'How it works', actionKey: 'how' },
];

function StatusBadge({ label }: { label: string }) {
  return (
    <div className="text-[11px] px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[#d1d1d6]">
      {label}
    </div>
  );
}

export function TopNav({
  session,
  statusLabel,
  loading: _loading,
  onConnect,
  onDisconnect,
  onNewClip,
  onShowShots,
  onShowHowItWorks,
}: TopNavProps) {
  const [open, setOpen] = useState(false);

  const handleNavAction = (key: string) => {
    if (key === 'shots') onShowShots?.();
    if (key === 'how') onShowHowItWorks?.();
    setOpen(false);
  };

  return (
    <nav className="nav-floating">
      <div className="nav-shell w-[min(92vw,1180px)]">
        <div className="nav-core flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#3b82f6] to-[#60a5fa] shadow-[0_10px_30px_-12px_rgba(59,130,246,0.8)]" />
            <div>
              <div className="font-semibold tracking-[-0.6px] text-[18px]">g-vid</div>
              <div className="text-[10px] text-[#9ca3af] -mt-1 font-mono">BY XAI</div>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 text-sm text-[#d1d1d6]">
            {navLinks.map((link) => (
              <button
                key={link.label}
                type="button"
                onClick={() => handleNavAction(link.actionKey)}
                className="pill-btn pill-ghost px-4 py-2"
              >
                {link.label}
              </button>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-2">
            {session?.connected ? (
              <div className="flex items-center gap-2">
                <StatusBadge label={statusLabel} />
                <button
                  type="button"
                  onClick={onDisconnect}
                  className="pill-btn pill-ghost text-[13px] px-4"
                >
                  Sign out
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onConnect}
                className="pill-btn pill-secondary text-[13px] px-4"
              >
                Connect SuperGrok
                <span className="icon-island">
                  <Menu size={14} strokeWidth={1.6} />
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={onNewClip}
              className="pill-btn pill-primary text-[13px] px-5"
            >
              New clip
              <span className="icon-island">↗</span>
            </button>
          </div>

          <div className="md:hidden flex items-center gap-2">
            {session?.connected && <StatusBadge label={statusLabel} />}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="pill-btn pill-secondary px-3 py-2"
              aria-label="Toggle navigation"
            >
              {open ? <X size={16} strokeWidth={1.6} /> : <Menu size={16} strokeWidth={1.6} />}
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="nav-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="nav-overlay-panel"
              initial={{ y: 22, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 12, opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#3b82f6] to-[#60a5fa] shadow-[0_10px_30px_-12px_rgba(59,130,246,0.8)]" />
                  <div>
                    <div className="font-semibold tracking-[-0.6px] text-[18px]">g-vid</div>
                    <div className="text-[10px] text-[#9ca3af] -mt-1 font-mono">BY XAI</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="pill-btn pill-ghost px-3 py-2"
                  aria-label="Close menu"
                >
                  <X size={16} strokeWidth={1.6} />
                </button>
              </div>

              <div className="flex flex-col gap-3 text-base text-white">
                {navLinks.map((link, idx) => (
                  <motion.button
                    key={link.label}
                    type="button"
                    onClick={() => handleNavAction(link.actionKey)}
                    className="pill-btn pill-secondary w-full justify-between px-4 py-3"
                    initial={{ y: 12, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.06 * idx, duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
                  >
                    {link.label}
                    <span className="icon-island">↗</span>
                  </motion.button>
                ))}
              </div>

              <div className="mt-6 grid gap-3">
                {session?.connected ? (
                  <div className="flex items-center gap-2">
                    <StatusBadge label={statusLabel} />
                    <button
                      type="button"
                      onClick={() => {
                        onDisconnect();
                        setOpen(false);
                      }}
                      className="pill-btn pill-ghost w-full justify-between"
                    >
                      Sign out
                      <span className="icon-island">⟲</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onConnect();
                      setOpen(false);
                    }}
                    className="pill-btn pill-secondary w-full justify-between"
                  >
                    Connect SuperGrok
                    <span className="icon-island">↗</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    onNewClip();
                    setOpen(false);
                  }}
                  className="pill-btn pill-primary w-full justify-between"
                >
                  New clip
                  <span className="icon-island">🎥</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
