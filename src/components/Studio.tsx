import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Upload, Music, Zap, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';

import type { Shot } from '../App';

const PROGRESS_STAGES = [
  { progress: 18, label: 'Sending references + 8s audio window to Grok' },
  { progress: 35, label: 'Grok analyzing face + scene composition' },
  { progress: 58, label: 'Grok 4.3 generating 8-second video with motion & lip sync' },
  { progress: 79, label: 'Applying cinematic grade and audio sync' },
  { progress: 100, label: 'Finalizing fresh personalized clip...' },
];

interface ReferenceImage {
  id: string;
  file: File;
  preview: string;
}

interface TrimWindow {
  start: number;
  duration: number;
}

interface StudioProps {
  onClose: () => void;
  session: any;
  onConnect: () => void;
  SHOTS: Shot[];
  initialShot?: Shot;
  onGenerate: (data: {
    prompt: string;
    shot: Shot;
    trim: TrimWindow;
    faceDescription: string;
    images: ReferenceImage[];
    audio: File | null;
    resolution?: '480p' | '720p';
  }) => Promise<{ ok: boolean; message: string }>;
}

export function Studio({ onClose, session, onConnect, SHOTS, initialShot, onGenerate }: StudioProps) {
  const studioVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.35 },
    },
  };

  const [step, setStep] = useState<0 | 1 | 2 | 3>(initialShot ? 2 : 0);
  const [uploadedImages, setUploadedImages] = useState<ReferenceImage[]>([]);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioTrim, setAudioTrim] = useState<TrimWindow>({ start: 0, duration: 8 });
  const [faceDescription, setFaceDescription] = useState('');
  const [selectedShot, setSelectedShot] = useState<Shot | null>(initialShot ?? null);
  const [videoQuality, setVideoQuality] = useState<'480p' | '720p'>('720p');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStage, setGenerationStage] = useState('');
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const progressRef = useRef<number>(0);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (initialShot) {
      setSelectedShot(initialShot);
      setStep((prev) => (prev < 2 ? 2 : prev));
    }
  }, [initialShot]);

  useEffect(() => {
    return () => {
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
      }
    };
  }, []);

  // Persist quality preference (long-term UX)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('gvid_video_quality');
      if (saved === '480p' || saved === '720p') {
        setVideoQuality(saved);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('gvid_video_quality', videoQuality);
    } catch {}
  }, [videoQuality]);

  const canProceed = () => {
    if (step === 0) return uploadedImages.length >= 2;
    if (step === 1) return audioFile !== null;
    if (step === 2) return selectedShot !== null;
    return true;
  };

  const buildPrompt = () => {
    if (!selectedShot) return '';
    const trimInfo = `${audioTrim.start.toFixed(1)}s–${(audioTrim.start + 8).toFixed(1)}s`;

    let prompt = 'Cinematic 8-second music video performance clip. ';

    if (faceDescription.trim()) {
      prompt += `The performer is: ${faceDescription.trim()}. Highly consistent face, accurate likeness. `;
    } else {
      prompt += 'The performer matches the uploaded reference photos exactly. ';
    }

    prompt += `Scene: ${selectedShot.name} — ${selectedShot.description}. ${selectedShot.promptHint}. `;
    prompt += `The artist is passionately performing and lip-syncing to an 8-second vocal clip taken from ${trimInfo} of the uploaded audio. `;
    prompt +=
      'Professional music video cinematography, dynamic camera movement, dramatic lighting, photorealistic, high production value, perfect lip synchronization. Exactly 8 seconds long. No text, no logos, clean output.';

    return prompt;
  };

  const resetProgressLoop = () => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }
    setGenerationStage('');
    setGenerationProgress(0);
    progressRef.current = 0;
  };

  const startProgressLoop = () => {
    resetProgressLoop();
    progressRef.current = 0;
    setGenerationStage(PROGRESS_STAGES[0].label);
    setGenerationProgress(PROGRESS_STAGES[0].progress);

    progressInterval.current = setInterval(() => {
      progressRef.current += 1;
      const stage = PROGRESS_STAGES[Math.min(progressRef.current, PROGRESS_STAGES.length - 1)];
      setGenerationStage(stage.label);
      setGenerationProgress(stage.progress);
    }, 700);
  };

  const handleGenerate = async () => {
    if (!selectedShot) return;

    const prompt = buildPrompt();
    if (!prompt) return;

    setIsGenerating(true);
    setMessage(null);
    startProgressLoop();

    const payload = {
      prompt,
      shot: selectedShot,
      trim: audioTrim,
      faceDescription,
      images: uploadedImages,
      audio: audioFile,
      resolution: videoQuality,
    };

    try {
      const result = await onGenerate(payload);
      resetProgressLoop();
      setIsGenerating(false);
      setGenerationProgress(100);
      setGenerationStage('Request completed');
      if (result.ok) {
        setMessage({ type: 'success', text: result.message });
        toast.success('Prompt ready for Grok', { description: result.message });
      } else {
        setMessage({ type: 'error', text: result.message });
      }
    } catch (error) {
      resetProgressLoop();
      setIsGenerating(false);
      setMessage({ type: 'error', text: (error as Error).message || 'Generation failed' });
    }
  };

  const handleNext = () => {
    if (step < 3) {
      setStep((prev) => (prev + 1) as 0 | 1 | 2 | 3);
      return;
    }

    if (!session?.connected) {
      onConnect();
      return;
    }

    handleGenerate();
  };

  const handleImageUpload = (files: FileList | null) => {
    if (!files) return;

    const remaining = 5 - uploadedImages.length;
    if (remaining <= 0) return;

    const candidates = Array.from(files)
      .filter((file) => file.type.startsWith('image/'))
      .slice(0, remaining);

    if (!candidates.length) return;

    const readers = candidates.map((file, index) =>
      new Promise<ReferenceImage>((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          resolve({
            id: `img-${Date.now()}-${index}`,
            file,
            preview: event.target?.result as string,
          });
        };
        reader.readAsDataURL(file);
      }),
    );

    Promise.all(readers).then((newEntries) => {
      setUploadedImages((prev) => {
        const combined = [...prev, ...newEntries].slice(0, 5);
        return combined;
      });
    });
  };

  const smartTrimAudio = async () => {
    if (!audioFile) return;

    try {
      const arrayBuffer = await audioFile.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const channelData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      const windowSize = Math.floor(8 * sampleRate);
      const hopSize = Math.floor(0.25 * sampleRate); // finer search for better results

      let bestStart = 0;
      let bestEnergy = 0;

      // Simple but effective energy-based window selection (highest activity / loudest section)
      for (let i = 0; i < channelData.length - windowSize; i += hopSize) {
        let energy = 0;
        // Sample every 16 samples for speed while keeping decent accuracy
        for (let j = 0; j < windowSize; j += 16) {
          const sample = channelData[i + j];
          energy += sample * sample; // RMS-style (squared) is better for detecting vocal energy
        }
        if (energy > bestEnergy) {
          bestEnergy = energy;
          bestStart = i / sampleRate;
        }
      }

      const maxStart = Math.max(0, audioDuration - 8);
      const clamped = Math.max(0, Math.min(bestStart, maxStart));

      // Keep 0.1s precision (matches the slider)
      const preciseStart = Math.round(clamped * 10) / 10;

      setAudioTrim({ start: preciseStart, duration: 8 });

      toast.success('Smart trim applied', {
        description: `Best 8s high-energy section found around ${preciseStart.toFixed(1)}s`,
      });
    } catch (err) {
      // Safe fallback: center of the file
      const mid = Math.max(0, Math.round((audioDuration / 2 - 4) * 10) / 10);
      setAudioTrim({ start: mid, duration: 8 });
      toast.info('Smart trim unavailable — using center section');
    }
  };

  const handleAudioUpload = (file: File) => {
    if (!file.type.startsWith('audio/')) return;

    const url = URL.createObjectURL(file);
    const audio = new Audio(url);

    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      setAudioDuration(duration);
      setAudioFile(file);
      const preferredStart = Math.max(0, Math.min(duration - 8, duration * 0.25));
      // Keep one decimal place for precision (slider supports 0.1s steps)
      const preciseStart = Math.round(preferredStart * 10) / 10;
      setAudioTrim({ start: preciseStart, duration: 8 });
      URL.revokeObjectURL(url);
    };
  };

  const resetSummary = () => {
    setMessage(null);
  };

  return (
    <motion.div className="fixed inset-0 bg-[#0a0a0a] z-[80] flex flex-col" variants={studioVariants} initial="hidden" animate="visible">
      <div className="h-14 border-b border-[#262626] flex items-center justify-between px-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded bg-[#3b82f6]" />
          <div>
            <div className="font-semibold">Studio</div>
            <div className="text-[10px] text-[#71717a] -mt-1">Grok 4.3 Video</div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {session?.connected && (
            <div className="text-xs px-3 py-1 rounded-full bg-[#171717] border border-[#262626] text-[#a1a1aa]">
              {session.credits} credits
            </div>
          )}
          <button type="button" onClick={onClose} className="text-[#a1a1aa] hover:text-white p-2" aria-label="Close studio" onMouseEnter={resetSummary}>
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col p-8 pb-12 overflow-auto min-h-0">
          <div className="max-w-4xl mx-auto w-full glass rounded-3xl p-8">
            <div className="mb-8">
              <div className="text-[#3b82f6] text-xs tracking-[2px] font-medium mb-2">STEP {step + 1} OF 4</div>
              <div className="text-4xl font-semibold tracking-[-1.5px]">
                {step === 0 && 'Upload your references'}
                {step === 1 && 'Add your performance audio'}
                {step === 2 && 'Choose your shot'}
                {step === 3 && 'Review & generate'}
              </div>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 12, filter: 'blur(3px)' }}
                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -12, filter: 'blur(3px)' }}
                transition={{ duration: 0.25 }}
              >
                {step === 0 && (
                  <div>
                    <p className="text-[#a1a1aa] mb-6">3–5 clear photos from different angles work best for consistent likeness.</p>

                    {uploadedImages.length > 0 && (
                      <div className="mb-6">
                        <div className="flex items-center justify-between mb-3 text-sm">
                          <span className="font-medium">Your references ({uploadedImages.length}/5)</span>
                          {uploadedImages.length >= 2 && (
                            <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
                              Ready to continue
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                          {uploadedImages.map((img) => (
                            <div key={img.id} className="relative rounded-xl overflow-hidden aspect-square border border-[#262626]">
                              <img src={img.preview} alt="Reference" className="object-cover w-full h-full" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {uploadedImages.length < 5 && (
                      <div
                        onClick={() => document.getElementById('studio-image-input')?.click()}
                        className={`border border-dashed border-[#262626] rounded-2xl text-center cursor-pointer hover:border-[#3b82f6]/50 transition mb-6 ${
                          uploadedImages.length > 0 ? 'p-8' : 'p-16'
                        }`}
                      >
                        <Upload className="mx-auto mb-3 text-[#3b82f6]" size={uploadedImages.length > 0 ? 32 : 42} />
                        <div className="font-medium">
                          {uploadedImages.length > 0 ? 'Add more photos' : 'Drop photos or click to upload'}
                        </div>
                        <div className="text-sm text-[#71717a] mt-1">JPG or PNG • Up to 5 images</div>
                        <input
                          id="studio-image-input"
                          type="file"
                          multiple
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleImageUpload(e.target.files)}
                        />
                      </div>
                    )}

                    {uploadedImages.length >= 2 && (
                      <div className="mt-6 pt-6 border-t border-[#262626]">
                        <div className="text-sm text-[#a1a1aa] mb-3">References complete. Ready for the next step.</div>
                        <button type="button" onClick={handleNext} className="btn btn-primary w-full py-4 text-base flex items-center justify-center gap-2">
                          Continue to Audio Upload <ArrowRight size={20} />
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {step === 1 && (
                  <div>
                    <p className="text-[#a1a1aa] mb-6">Any length is supported. Grok will intelligently create an 8-second clip.</p>

                    {!audioFile ? (
                      <label className="border border-dashed border-[#262626] rounded-2xl p-16 text-center cursor-pointer block hover:border-[#3b82f6]/50 transition">
                        <Music className="mx-auto mb-4 text-[#3b82f6]" size={42} />
                        <div className="font-medium">Drop audio file or click to upload</div>
                        <div className="text-sm text-[#71717a] mt-1">MP3, WAV, M4A — any length</div>
                        <input type="file" accept="audio/*" className="hidden" onChange={(e) => e.target.files && handleAudioUpload(e.target.files[0])} />
                      </label>
                    ) : (
                      <div className="bg-[#171717] border border-[#262626] rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <div className="font-medium">{audioFile.name}</div>
                            <div className="text-[#a1a1aa] text-sm">{audioDuration.toFixed(1)}s total</div>
                          </div>
                          <button type="button" onClick={smartTrimAudio} className="btn btn-secondary text-xs px-4 py-2 flex items-center gap-2">
                            <Zap size={14} /> Smart Trim
                          </button>
                        </div>

                        <div>
                          <div className="flex items-center justify-between text-xs mb-2">
                            <span className="text-[#a1a1aa]">8s window start</span>
                            <span className="font-mono text-[#3b82f6]">{audioTrim.start.toFixed(1)}s</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={Math.max(0, audioDuration - 8)}
                            step="0.1"
                            value={audioTrim.start}
                            onChange={(e) => {
                              const maxStart = Math.max(0, audioDuration - 8);
                              const val = Math.min(parseFloat(e.target.value), maxStart);
                              setAudioTrim({ start: val, duration: 8 });
                            }}
                            className="w-full accent-[#3b82f6]"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {step === 2 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {SHOTS.map((shot) => (
                      <motion.div
                        key={shot.id}
                        whileHover={{ scale: 1.01 }}
                        onClick={() => setSelectedShot(shot)}
                        className={`shot-card cursor-pointer overflow-hidden relative ${
                          selectedShot?.id === shot.id ? 'ring-2 ring-[#3b82f6]' : 'hover:ring-1 hover:ring-white/20'
                        }`}
                        role="button"
                        tabIndex={0}
                      >
                        <img src={shot.thumbnail} className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 pointer-events-none" />
                        {shot.video && (
                          <video
                            src={shot.video}
                            className="absolute inset-0 w-full h-full object-cover opacity-0 hover:opacity-60 transition-opacity duration-300 pointer-events-none"
                            muted
                            loop
                            playsInline
                          />
                        )}
                        <div className="absolute bottom-0 p-5 w-full bg-gradient-to-t from-black/90 via-black/70 to-transparent pointer-events-none">
                          <div className="font-semibold tracking-tight">{shot.name}</div>
                          <div className="text-sm text-[#a1a1aa] mt-0.5">{shot.description}</div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-6">
                    <div className="bg-[#171717] border border-[#262626] rounded-2xl p-6">
                      <div className="text-sm text-[#a1a1aa] mb-2 tracking-widest">YOUR SCENE</div>
                      <div className="text-2xl font-semibold">{selectedShot?.name}</div>
                    </div>

                    <div>
                      <div className="text-sm text-[#a1a1aa] mb-2">FACE DESCRIPTION (optional but recommended)</div>
                      <input
                        value={faceDescription}
                        onChange={(e) => setFaceDescription(e.target.value)}
                        placeholder="e.g. Young Black woman with long braids, wearing oversized hoodie"
                        className="w-full bg-[#171717] border border-[#262626] rounded-xl px-4 py-3 text-sm focus:border-[#3b82f6] outline-none"
                      />
                    </div>

                    <div className="text-xs text-[#71717a] pt-2">
                      {session?.connected
                        ? 'Ready to generate a fresh personalized 8-second clip using your SuperGrok quota.'
                        : 'You will be prompted to securely connect your SuperGrok account before generation.'}
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        <div className="w-80 border-l border-[#262626] p-6 flex-shrink-0 overflow-auto hidden lg:block">
          <div className="text-xs tracking-[2px] text-[#71717a] mb-3">SUMMARY</div>

          <div className="space-y-4 text-sm">
            <div>
              <div className="text-[#71717a]">References</div>
              <div className="font-medium">{uploadedImages.length} photo{uploadedImages.length === 1 ? '' : 's'}</div>
            </div>
            <div>
              <div className="text-[#71717a]">Audio</div>
              <div className="font-medium">{audioFile ? `${audioTrim.start.toFixed(1)}s – ${(audioTrim.start + 8).toFixed(1)}s` : '—'}</div>
            </div>
            <div>
              <div className="text-[#71717a]">Shot</div>
              <div className="font-medium">{selectedShot?.name || '—'}</div>
            </div>

            {/* Quality / Resolution Toggle - Long term play for credit control */}
            {step === 3 && (
              <div>
                <div className="text-[#71717a] mb-1.5">Quality</div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setVideoQuality('480p')}
                    className={`flex-1 rounded-xl border px-3 py-2 text-xs font-medium transition-all ${
                      videoQuality === '480p'
                        ? 'border-[#3b82f6] bg-[#3b82f6]/10 text-white'
                        : 'border-[#262626] hover:border-white/30 text-[#a1a1aa]'
                    }`}
                  >
                    480p
                    <div className="text-[10px] opacity-60 mt-0.5">Faster • Saves credits</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setVideoQuality('720p')}
                    className={`flex-1 rounded-xl border px-3 py-2 text-xs font-medium transition-all ${
                      videoQuality === '720p'
                        ? 'border-[#3b82f6] bg-[#3b82f6]/10 text-white'
                        : 'border-[#262626] hover:border-white/30 text-[#a1a1aa]'
                    }`}
                  >
                    720p
                    <div className="text-[10px] opacity-60 mt-0.5">Recommended</div>
                  </button>
                </div>
                <div className="text-[10px] text-[#71717a] mt-1.5 leading-tight">
                  480p uses significantly fewer credits. Great for testing.
                </div>
              </div>
            )}
          </div>

          {(message || session?.connected) && (
            <div className="mt-6 p-4 rounded-2xl border border-[#262626] bg-[#111113] text-xs text-[#c7c7cf] space-y-2">
              {message && (
                <div className={message.type === 'error' ? 'text-rose-400' : 'text-emerald-400'}>{message.text}</div>
              )}
              {session?.connected && <div>Powered by your SuperGrok subscription</div>}
            </div>
          )}
        </div>
      </div>

      <div className="h-16 border-t border-[#262626] flex items-center justify-between px-6 flex-shrink-0 bg-[#0a0a0a] relative z-[100]">
        <button type="button" onClick={() => setStep((prev) => (Math.max(0, prev - 1) as 0 | 1 | 2 | 3))} disabled={step === 0} className="btn btn-ghost disabled:opacity-40">
          Back
        </button>

        {step < 3 ? (
          <button type="button" onClick={handleNext} disabled={!canProceed()} className={`btn disabled:opacity-40 ${step === 0 && canProceed() ? 'btn-primary px-10 py-3 text-base font-semibold shadow-lg' : 'btn-primary'}`}>
            {step === 0 && canProceed() ? 'Continue to Audio' : 'Continue'} <ArrowRight size={16} />
          </button>
        ) : (
          <button type="button" onClick={handleNext} className="btn btn-primary px-8">
            {session?.connected ? 'Generate Fresh 8s Clip with Grok 4.3' : 'Connect SuperGrok to Generate'}
          </button>
        )}
      </div>

      {isGenerating && (
        <div className="absolute inset-0 bg-[#0a0a0a]/95 flex items-center justify-center">
          <div className="max-w-md w-full px-6">
            <div className="text-[#3b82f6] text-xs tracking-[2px] mb-3">GROK 4.3 VIDEO ENGINE</div>
            <div className="text-3xl font-semibold mb-8 tracking-[-1px]">{generationStage}</div>

            <div className="h-px bg-[#262626] mb-4">
              <div className="h-px bg-[#3b82f6]" style={{ width: `${generationProgress}%` }} />
            </div>
            <div className="text-xs text-[#71717a]">{generationProgress}%</div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
