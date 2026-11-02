import {
  AppWindow,
  Camera,
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
  const [quality, setQuality] = useState('720');
  const [frameRate, setFrameRate] = useState(30);
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true);

  const isNativePicker = Array.isArray(nativeSources);

  const tabs = useMemo(() => {
    const list = [
      { id: 'screen', label: 'Screens', Icon: Monitor },
      { id: 'applications', label: 'Applications', Icon: AppWindow },
    ];
    if (isNativePicker) {
      list.push({ id: 'devices', label: 'Audio', Icon: Camera });
    }
    return list;
  }, [isNativePicker]);

  const visibleSources = useMemo(() => {
    if (!isNativePicker) return [];
    const sourceKind = activeTab === 'applications' ? 'window' : 'monitor';
    return nativeSources.filter((source) => source.kind === sourceKind);
  }, [activeTab, isNativePicker, nativeSources]);

  const selectedSource = visibleSources.find(({ id }) => id === selectedSourceId)
    || visibleSources[0]
    || null;

  if (!open) return null;

  const browserOptions = [
    { type: 'monitor', label: 'Entire screen', Icon: Monitor },
    { type: 'window', label: 'Application window', Icon: AppWindow },
  ];

  const startSharing = () => {
    if (activeTab === 'devices') {
      setActiveTab('screen');
      return;
    }
    if (!isNativePicker) {
      onSelect(selectedSourceId === 'monitor' ? 'monitor' : 'window', {
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
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <section
        className="flex max-h-[min(720px,90vh)] w-full max-w-[860px] flex-col overflow-hidden rounded-xl border border-[#2b2d31] bg-[#313338] text-white shadow-[0_24px_80px_rgba(0,0,0,0.7)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="screen-share-title"
      >
        <header className="px-4 pt-4 pb-0">
          <div className="flex items-start justify-between">
            <div>
              <h2 id="screen-share-title" className="text-base font-bold">Share your screen</h2>
              <p className="mt-0.5 text-xs text-[#b5bac1]">Select what you'd like to share</p>
            </div>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-md text-[#b5bac1] transition hover:bg-[#3f4147] hover:text-white"
              onClick={onCancel}
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <nav className="mt-3 flex gap-1 border-b border-[#3f4147]" aria-label="Share source type">
            {tabs.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setActiveTab(id);
                  if (!isNativePicker) setSelectedSourceId(id === 'screen' ? 'monitor' : 'window');
                }}
                className={`relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition ${
                  activeTab === id
                    ? 'text-white'
                    : 'text-[#949ba4] hover:text-[#dbdee1]'
                }`}
                aria-pressed={activeTab === id}
              >
                <Icon size={15} />
                {label}
                {activeTab === id && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full bg-[#5865f2]" />
                )}
              </button>
            ))}
          </nav>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-4 discord-scrollbar">
          {activeTab === 'devices' ? (
            <section className="mx-auto flex max-w-sm flex-col items-center rounded-lg bg-[#2b2d31] px-6 py-8 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#5865f2]/15 text-[#aeb8ff]">
                <Volume2 size={22} />
              </div>
              <h3 className="text-sm font-bold">System Audio</h3>
              <p className="mt-1.5 text-xs leading-5 text-[#b5bac1]">
                Share audio from your device along with your screen.
              </p>
              <button
                type="button"
                role="switch"
                aria-checked={includeSystemAudio}
                onClick={() => setIncludeSystemAudio((v) => !v)}
                className={`mt-4 flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  includeSystemAudio ? 'bg-[#23a55a]/15 text-[#57f287]' : 'bg-[#3f4147] text-[#b5bac1]'
                }`}
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded-full ${
                  includeSystemAudio ? 'bg-[#23a55a] text-white' : 'bg-[#4e5058]'
                }`}>
                  {includeSystemAudio && <Check size={11} />}
                </span>
                {includeSystemAudio ? 'Audio on' : 'Audio off'}
              </button>
            </section>
          ) : isNativePicker ? (
            <>
              {sourcesError && <p role="alert" className="mb-3 text-xs text-[#f23f43]">{sourcesError}</p>}
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-live="polite">
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
                      className={`group overflow-hidden rounded-lg border-2 text-left transition disabled:opacity-50 ${
                        isSelected
                          ? 'border-[#5865f2] bg-[#5865f2]/5'
                          : 'border-transparent hover:border-[#4e5058]'
                      }`}
                      aria-pressed={isSelected}
                    >
                      <div ref={previewRef} className="relative flex aspect-video items-center justify-center overflow-hidden rounded-t bg-[#1e1f22]">
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
                          <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#5865f2]">
                            <Check size={13} />
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 px-3 py-2">
                        <SourceIcon size={14} className="shrink-0 text-[#949ba4]" />
                        <span className="truncate text-xs font-medium">{source.name}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              {sourcesLoading && (
                <p className="py-6 text-center text-xs text-[#b5bac1]" role="status">Loading sources…</p>
              )}
              {!sourcesLoading && visibleSources.length === 0 && !sourcesError && (
                <p className="py-6 text-center text-xs text-[#b5bac1]">
                  No {activeTab === 'applications' ? 'application windows' : 'displays'} found.
                </p>
              )}
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {browserOptions.map(({ type, label, Icon }) => {
                const isSelected = selectedSourceId === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSelectedSourceId(type)}
                    className={`overflow-hidden rounded-lg border-2 text-left transition ${
                      isSelected
                        ? 'border-[#5865f2] bg-[#5865f2]/5'
                        : 'border-transparent hover:border-[#4e5058]'
                    }`}
                    aria-pressed={isSelected}
                  >
                    <div className="flex aspect-video items-center justify-center bg-[#1e1f22]">
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#2b2d31] text-[#949ba4]">
                        <Icon size={32} />
                      </div>
                    </div>
                    <div className="px-3 py-2.5 text-sm font-medium">{label}</div>
                  </button>
                );
              })}
            </div>
          )}
        </main>

        <footer className="flex items-center justify-between border-t border-[#3f4147] px-4 py-3">
          <div className="flex items-center gap-2">
            {activeTab !== 'devices' && (
              <>
                <div className="flex items-center gap-1 rounded-md bg-[#2b2d31] p-0.5">
                  {qualityPresets.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setQuality(value)}
                      className={`rounded px-2.5 py-1 text-xs font-semibold transition ${
                        quality === value
                          ? 'bg-[#5865f2] text-white'
                          : 'text-[#949ba4] hover:text-white'
                      }`}
                      aria-pressed={quality === value}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="mx-1 h-4 w-px bg-[#3f4147]" />

                <div className="flex items-center gap-1 rounded-md bg-[#2b2d31] p-0.5">
                  {fpsPresets.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFrameRate(value)}
                      className={`rounded px-2 py-1 text-xs font-semibold transition ${
                        frameRate === value
                          ? 'bg-[#5865f2] text-white'
                          : 'text-[#949ba4] hover:text-white'
                      }`}
                      aria-pressed={frameRate === value}
                    >
                      {label} FPS
                    </button>
                  ))}
                </div>
              </>
            )}
            {!isNativePicker && activeTab !== 'devices' && (
              <>
                <div className="mx-1 h-4 w-px bg-[#3f4147]" />
                <button
                  type="button"
                  role="switch"
                  aria-checked={includeSystemAudio}
                  onClick={() => setIncludeSystemAudio((v) => !v)}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                    includeSystemAudio ? 'bg-[#23a55a]/15 text-[#57f287]' : 'bg-[#2b2d31] text-[#b5bac1]'
                  }`}
                >
                  <Volume2 size={13} />
                  Audio {includeSystemAudio ? 'on' : 'off'}
                </button>
              </>
            )}
            {isNativePicker && activeTab !== 'devices' && (
              <>
                <div className="mx-1 h-4 w-px bg-[#3f4147]" />
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-md bg-[#2b2d31] px-2.5 py-1.5 text-xs font-medium text-[#b5bac1] transition hover:text-white disabled:opacity-50"
                  onClick={onRefreshSources}
                  disabled={sourcesLoading}
                >
                  <RefreshCw size={12} className={sourcesLoading ? 'animate-spin' : ''} />
                  Refresh
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md px-4 py-1.5 text-sm font-medium text-[#dbdee1] transition hover:underline"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md bg-[#5865f2] px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-[#4752c4] disabled:opacity-50"
              onClick={startSharing}
              disabled={isNativePicker && activeTab !== 'devices' && (!selectedSource || sourcesLoading)}
            >
              {activeTab === 'devices' ? 'Go Live' : 'Go Live'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
