import {
  AppWindow,
  Check,
  Mic,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Video,
  Volume2,
} from 'lucide-react';
import { useMemo, useState } from 'react';

export function MediaPermissionModal({ request, onContinue, onCancel }) {
  if (!request) return null;

  const isCamera = request.kind === 'camera';
  const Icon = isCamera ? Video : Mic;
  const deviceName = isCamera ? 'microphone and camera' : 'microphone';

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <section
        className="w-full max-w-md rounded-2xl border border-[#2b2d31] bg-[#1e1f22] p-6 text-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="media-permission-title"
      >
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#5865f2]/15 text-[#aeb8ff]">
          <Icon size={24} />
        </div>
        <h2 id="media-permission-title" className="text-lg font-bold">Allow {deviceName} access</h2>
        <p className="mt-2 text-sm leading-6 text-[#b5bac1]">
          Discord Lite needs your {deviceName} to join the call. You only need to approve access once.
          Windows may then show its secure permission prompt.
        </p>
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-[#2b2d31] p-3 text-xs leading-5 text-[#b5bac1]">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[#23a55a]" />
          <span>You can change device permissions later in Windows Settings.</span>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-lg border border-[#3f4147] px-4 py-2 text-sm font-semibold text-[#dbdee1] transition hover:bg-white/[0.06]"
            onClick={onCancel}
          >
            Not now
          </button>
          <button
            type="button"
            className="rounded-lg bg-[#5865f2] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#4752c4]"
            onClick={onContinue}
          >
            Continue
          </button>
        </div>
      </section>
    </div>
  );
}

export function ScreenSharePicker({
  open,
  onCancel,
  onSelect,
  nativeSources,
  sourcesLoading = false,
  sourcesError = '',
  onRefreshSources,
  onLoadPreview,
  nativeSharePreviews = {},
}) {
  const [activeTab, setActiveTab] = useState('screen');
  const [selectedSourceId, setSelectedSourceId] = useState('monitor');
  const [quality, setQuality] = useState('1080');
  const [frameRate, setFrameRate] = useState(30);
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true);

  const isNativePicker = Array.isArray(nativeSources);

  const tabs = useMemo(() => [
    { id: 'applications', label: 'Applications', Icon: AppWindow },
    { id: 'screen', label: 'Entire Screen', Icon: Monitor },
  ], []);

  const visibleSources = useMemo(() => {
    if (!isNativePicker) return [];
    const sourceKind = activeTab === 'applications' ? 'window' : 'monitor';
    return nativeSources.filter((source) => source.kind === sourceKind);
  }, [activeTab, isNativePicker, nativeSources]);

  const selectedSource = visibleSources.find(({ id }) => id === selectedSourceId)
    || visibleSources[0]
    || null;

  if (!open) return null;

  const startSharing = () => {
    if (!isNativePicker) {
      onSelect('monitor', {
        quality,
        frameRate,
        includeSystemAudio,
      });
      return;
    }
    if (!selectedSource) return;
    onSelect(selectedSource, { quality, frameRate, includeSystemAudio });
  };

  const qualityPresets = [
    { value: '480', label: '480p' },
    { value: '720', label: '720p' },
    { value: '1080', label: '1080p' },
  ];

  const fpsPresets = [
    { value: 15, label: '15' },
    { value: 30, label: '30' },
    { value: 60, label: '60' },
  ];

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6">
      <section
        className={`flex max-h-[88vh] ${
          isNativePicker ? 'w-[min(860px,94vw)]' : 'w-[min(680px,94vw)]'
        } flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-black/85 text-white shadow-[0_28px_100px_rgba(0,0,0,0.8)] backdrop-blur-xl`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="screen-share-title"
      >
        <header className="px-4 pt-4 sm:px-5 sm:pt-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 id="screen-share-title" className="text-lg font-bold tracking-tight">Share your screen</h2>
              <p className="mt-1 text-xs text-[#949ba4]">Choose a screen or app to share with your call</p>
            </div>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[#949ba4] transition hover:bg-white/[0.08] hover:text-white"
              onClick={onCancel}
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {isNativePicker && (
            <nav className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-[#0d0e10] p-1" aria-label="Share source type">
              {tabs.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                    activeTab === id
                      ? 'bg-[#303136] text-white shadow-sm'
                      : 'text-[#949ba4] hover:bg-white/[0.04] hover:text-[#dbdee1]'
                  }`}
                  aria-pressed={activeTab === id}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </nav>
          )}
        </header>

        <main className={`min-h-0 overflow-y-auto px-4 py-4 discord-scrollbar sm:px-5 sm:py-5 ${isNativePicker ? 'flex-1' : ''}`}>
          {isNativePicker ? (
            <>
              {sourcesError && (
                <p role="alert" className="mb-4 rounded-lg border border-[#f23f43]/25 bg-[#f23f43]/10 px-3 py-2 text-xs text-[#ff8b8e]">
                  {sourcesError}
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4" aria-live="polite">
                {visibleSources.map((source) => {
                  const SourceIcon = source.kind === 'monitor' ? Monitor : AppWindow;
                  const isSelected = (selectedSource?.id || selectedSourceId) === source.id;
                  const preview = nativeSharePreviews[source.id];
                  const previewRef = (element) => {
                    if (!element || preview || !onLoadPreview) return;
                    const observer = new IntersectionObserver((entries) => {
                      if (entries.some((entry) => entry.isIntersecting)) {
                        observer.disconnect();
                        onLoadPreview(source.id);
                      }
                    }, { rootMargin: '120px' });
                    observer.observe(element);
                  };
                  return (
                    <button
                      key={source.id}
                      type="button"
                      disabled={sourcesLoading}
                      onClick={() => setSelectedSourceId(source.id)}
                      className={`group overflow-hidden rounded-xl border text-left transition disabled:opacity-50 ${
                        isSelected
                          ? 'border-[#5865f2] bg-[#5865f2]/[0.08] ring-1 ring-[#5865f2]/40'
                          : 'border-white/[0.08] bg-[#202126] hover:border-white/20 hover:bg-[#25262c]'
                      }`}
                      aria-pressed={isSelected}
                    >
                      <div ref={previewRef} className="relative flex aspect-video items-center justify-center overflow-hidden bg-[#0b0c0e]">
                        {preview ? (
                          <img
                            src={preview}
                            alt={`Preview of ${source.name}`}
                            className="absolute inset-0 h-full w-full object-contain"
                          />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#2b2d31] text-[#949ba4]">
                            <SourceIcon size={24} />
                          </div>
                        )}
                        {isSelected && (
                          <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#5865f2] text-white shadow-lg">
                            <Check size={14} strokeWidth={3} />
                          </span>
                        )}
                        <span className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/50 to-transparent" />
                      </div>
                      <div className="flex min-h-11 items-center gap-2.5 px-3 py-2">
                        <SourceIcon size={15} className={`shrink-0 ${isSelected ? 'text-[#aeb8ff]' : 'text-[#949ba4]'}`} />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{source.name}</span>
                        {isSelected && <span className="text-[10px] font-bold uppercase tracking-wide text-[#aeb8ff]">Selected</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
              {sourcesLoading && (
                <p className="py-10 text-center text-sm text-[#949ba4]" role="status">Loading sources…</p>
              )}
              {!sourcesLoading && visibleSources.length === 0 && !sourcesError && (
                <p className="py-10 text-center text-sm text-[#949ba4]">
                  No {activeTab === 'applications' ? 'application windows' : 'displays'} found.
                </p>
              )}
            </>
          ) : (
            <div className="flex items-center gap-4 rounded-lg border border-[#3f4147] bg-[#1e1f22] px-5 py-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#2b2d31] text-[#aeb8ff]">
                <Monitor size={32} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">Choose a screen or window</h3>
                <p className="mt-1 text-xs leading-5 text-[#b5bac1]">
                  Select “Choose screen” to open the browser’s secure picker with live previews. Select your source there
                  to start sharing.
                </p>
              </div>
            </div>
          )}
        </main>

        <footer className="flex flex-col gap-3 border-t border-white/[0.08] bg-black/35 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-[#25262b] p-1">
              {qualityPresets.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setQuality(value)}
                  className={`rounded px-2.5 py-1 text-xs font-semibold transition ${
                    quality === value
                      ? 'bg-[#5865f2] text-white shadow-sm'
                      : 'text-[#949ba4] hover:text-white'
                  }`}
                  aria-pressed={quality === value}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mx-0.5 hidden h-5 w-px bg-white/10 sm:block" />

            <div className="flex items-center gap-1 rounded-lg bg-[#25262b] p-1">
              {fpsPresets.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFrameRate(value)}
                  className={`rounded px-2 py-1 text-xs font-semibold transition ${
                    frameRate === value
                      ? 'bg-[#5865f2] text-white shadow-sm'
                      : 'text-[#949ba4] hover:text-white'
                  }`}
                  aria-pressed={frameRate === value}
                >
                  {label} FPS
                </button>
              ))}
            </div>

            <div className="mx-0.5 hidden h-5 w-px bg-white/10 sm:block" />
            <button
              type="button"
              role="switch"
              aria-checked={includeSystemAudio}
              onClick={() => setIncludeSystemAudio((v) => !v)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                includeSystemAudio ? 'bg-[#23a55a]/15 text-[#57f287]' : 'bg-[#25262b] text-[#b5bac1]'
              }`}
            >
              <Volume2 size={13} />
              Audio {includeSystemAudio ? 'on' : 'off'}
            </button>
            {isNativePicker && (
              <>
                <div className="mx-0.5 hidden h-5 w-px bg-white/10 sm:block" />
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg bg-[#25262b] px-2.5 py-2 text-xs font-medium text-[#b5bac1] transition hover:text-white disabled:opacity-50"
                  onClick={onRefreshSources}
                  disabled={sourcesLoading}
                >
                  <RefreshCw size={12} className={sourcesLoading ? 'animate-spin' : ''} />
                  Refresh
                </button>
              </>
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm font-semibold text-[#b5bac1] transition hover:bg-white/[0.06] hover:text-white"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-[#5865f2] px-5 py-2 text-sm font-bold text-white shadow-lg shadow-[#5865f2]/15 transition hover:bg-[#4752c4] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={startSharing}
              disabled={isNativePicker && (!selectedSource || sourcesLoading)}
            >
              {isNativePicker ? 'Go Live' : 'Choose screen'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
