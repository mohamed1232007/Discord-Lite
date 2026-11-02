import {
  AppWindow,
  Camera,
  Check,
  Mic,
  Monitor,
  RefreshCw,
  Settings,
  ShieldCheck,
  Video,
  Volume2,
} from 'lucide-react';
import { useMemo, useState } from 'react';

const modalPanel = 'w-full max-w-md rounded-2xl border border-[#2b2d31] bg-[#1e1f22] p-6 text-white shadow-2xl';
const secondaryButton = 'rounded-lg border border-[#3f4147] px-4 py-2 text-sm font-semibold text-[#dbdee1] transition hover:bg-white/[0.06]';
const primaryButton = 'rounded-lg bg-[#5865f2] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#4752c4]';

export function MediaPermissionModal({ request, onContinue, onCancel }) {
  if (!request) return null;

  const isCamera = request.kind === 'camera';
  const Icon = isCamera ? Video : Mic;
  const deviceName = isCamera ? 'microphone and camera' : 'microphone';

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <section className={modalPanel} role="dialog" aria-modal="true" aria-labelledby="media-permission-title">
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
          <button type="button" className={secondaryButton} onClick={onCancel}>Not now</button>
          <button type="button" className={primaryButton} onClick={onContinue}>Continue</button>
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
}) {
  const [activeTab, setActiveTab] = useState('applications');
  const [selectedSourceId, setSelectedSourceId] = useState('window');
  const [quality, setQuality] = useState('hd');
  const [frameRate, setFrameRate] = useState(30);
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const isNativePicker = Array.isArray(nativeSources);
  const visibleSources = useMemo(() => {
    if (!isNativePicker) return [];
    const sourceKind = activeTab === 'applications' ? 'window' : 'monitor';
    return nativeSources.filter((source) => source.kind === sourceKind);
  }, [activeTab, isNativePicker, nativeSources]);
  const selectedSource = visibleSources.find(({ id }) => id === selectedSourceId)
    || visibleSources[0]
    || null;

  if (!open) return null;

  const options = [
    { type: 'monitor', label: 'Entire screen', Icon: Monitor },
    { type: 'window', label: 'Application window', Icon: AppWindow },
  ];
  const tabs = [
    { id: 'applications', label: 'Applications', Icon: AppWindow },
    { id: 'screen', label: 'Entire Screen', Icon: Monitor },
    ...(isNativePicker ? [{ id: 'devices', label: 'Devices', Icon: Camera }] : []),
  ];

  const startSharing = () => {
    if (activeTab === 'devices') {
      setActiveTab('screen');
      return;
    }
    if (!isNativePicker) {
      onSelect(selectedSourceId === 'monitor' ? 'monitor' : 'window');
      return;
    }
    if (!selectedSource) return;
    onSelect(selectedSource, { quality, frameRate, includeSystemAudio });
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <section
        className="flex max-h-[min(760px,92vh)] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-[#353740] bg-[#1e1f22] text-white shadow-[0_24px_90px_rgba(0,0,0,0.75)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="screen-share-title"
      >
        <header className="flex items-center justify-between border-b border-[#2b2d31] px-6 py-5">
          <div>
            <h2 id="screen-share-title" className="text-lg font-bold">Share your screen</h2>
            <p className="mt-1 text-sm text-[#b5bac1]">Choose an application, display, or audio device.</p>
          </div>
          <button type="button" className={secondaryButton} onClick={onCancel} aria-label="Close screen sharing">
            Esc
          </button>
        </header>

        <nav className="mx-6 mt-5 grid grid-cols-3 rounded-xl bg-[#111214] p-1" aria-label="Share source type">
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setActiveTab(id);
                if (!isNativePicker) setSelectedSourceId(id === 'screen' ? 'monitor' : 'window');
              }}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                activeTab === id ? 'bg-[#2b2d31] text-white shadow' : 'text-[#b5bac1] hover:text-white'
              }`}
              aria-pressed={activeTab === id}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>

        <main className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {activeTab === 'devices' ? (
            <section className="mx-auto flex max-w-xl flex-col items-center rounded-2xl border border-[#353740] bg-[#17181c] px-8 py-10 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#5865f2]/15 text-[#aeb8ff]">
                <Volume2 size={26} />
              </div>
              <h3 className="text-base font-bold">Share system audio</h3>
              <p className="mt-2 text-sm leading-6 text-[#b5bac1]">
                Audio from your default Windows output device can be sent with the screen share.
              </p>
              <button
                type="button"
                role="switch"
                aria-checked={includeSystemAudio}
                onClick={() => setIncludeSystemAudio((enabled) => !enabled)}
                className={`mt-5 flex items-center gap-3 rounded-full px-4 py-2 text-sm font-semibold transition ${
                  includeSystemAudio ? 'bg-[#23a55a]/15 text-[#57f287]' : 'bg-[#2b2d31] text-[#b5bac1]'
                }`}
              >
                <span className={`flex h-5 w-5 items-center justify-center rounded-full ${
                  includeSystemAudio ? 'bg-[#23a55a] text-white' : 'bg-[#4e5058]'
                }`}>
                  {includeSystemAudio && <Check size={13} />}
                </span>
                {includeSystemAudio ? 'System audio on' : 'System audio off'}
              </button>
            </section>
          ) : isNativePicker ? (
            <>
              {sourcesError && <p role="alert" className="mb-3 text-sm text-[#f23f43]">{sourcesError}</p>}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-live="polite">
                {visibleSources.map((source) => {
                  const Icon = source.kind === 'monitor' ? Monitor : AppWindow;
                  const isSelected = (selectedSource?.id || selectedSourceId) === source.id;
                  return (
                    <button
                      key={source.id}
                      type="button"
                      disabled={sourcesLoading}
                      onClick={() => setSelectedSourceId(source.id)}
                      className={`group overflow-hidden rounded-xl border text-left transition disabled:opacity-50 ${
                        isSelected
                          ? 'border-[#5865f2] ring-2 ring-[#5865f2]/30'
                          : 'border-[#353740] hover:border-[#686b75]'
                      }`}
                      aria-pressed={isSelected}
                    >
                      <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-[#101114]">
                        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-[#34364a] via-[#191a20] to-[#101114]" />
                        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-black/30 text-[#aeb8ff]">
                          <Icon size={30} />
                        </div>
                        {isSelected && (
                          <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-[#5865f2]">
                            <Check size={15} />
                          </span>
                        )}
                        <span className="absolute bottom-3 left-3 rounded-md bg-black/70 px-2 py-1 text-[11px] font-medium text-white">
                          {source.width} × {source.height}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 bg-[#232428] px-4 py-3">
                        <Icon size={17} className="shrink-0 text-[#b5bac1]" />
                        <span className="truncate text-sm font-semibold">{source.name}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              {sourcesLoading && (
                <p className="py-8 text-center text-sm text-[#b5bac1]" role="status">Loading share sources…</p>
              )}
              {!sourcesLoading && visibleSources.length === 0 && !sourcesError && (
                <p className="py-8 text-center text-sm text-[#b5bac1]">
                  No {activeTab === 'applications' ? 'application windows' : 'displays'} found.
                </p>
              )}
            </>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {options.map(({ type, label, Icon }) => {
                const isSelected = selectedSourceId === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSelectedSourceId(type)}
                    className={`overflow-hidden rounded-xl border text-left transition ${
                      isSelected ? 'border-[#5865f2] ring-2 ring-[#5865f2]/30' : 'border-[#353740] hover:border-[#686b75]'
                    }`}
                    aria-pressed={isSelected}
                  >
                    <div className="flex aspect-video items-center justify-center bg-[#101114] text-[#aeb8ff]">
                      <Icon size={38} />
                    </div>
                    <span className="block bg-[#232428] px-4 py-3 text-sm font-semibold">{label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-[#2b2d31] px-6 py-4">
          <div className="flex items-center gap-3">
            {isNativePicker && activeTab !== 'devices' && (
              <>
                <span className="text-xs font-semibold uppercase tracking-wide text-[#949ba4]">Quality</span>
                <div className="flex rounded-lg bg-[#111214] p-1">
                  {['sd', 'hd'].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setQuality(preset)}
                      className={`rounded-md px-3 py-1.5 text-xs font-bold uppercase ${
                        quality === preset ? 'bg-[#353740] text-white' : 'text-[#949ba4] hover:text-white'
                      }`}
                      aria-pressed={quality === preset}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setShowSettings((shown) => !shown)}
                  className={secondaryButton}
                  aria-expanded={showSettings}
                  aria-label="Advanced screen sharing settings"
                >
                  <Settings size={16} />
                </button>
                {showSettings && (
                  <label className="flex items-center gap-2 text-xs text-[#b5bac1]">
                    Frame rate
                    <select
                      value={frameRate}
                      onChange={(event) => setFrameRate(Number(event.target.value))}
                      className="rounded-md border border-[#353740] bg-[#111214] px-2 py-1.5 text-white"
                    >
                      <option value={15}>15 FPS</option>
                      <option value={30}>30 FPS</option>
                      <option value={60}>60 FPS</option>
                    </select>
                  </label>
                )}
              </>
            )}
            {isNativePicker && activeTab === 'devices' && (
              <button
                type="button"
                className={`${secondaryButton} flex items-center gap-2`}
                onClick={onRefreshSources}
                disabled={sourcesLoading}
              >
                <RefreshCw size={15} className={sourcesLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            )}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <button type="button" className={secondaryButton} onClick={onCancel}>Cancel</button>
            <button
              type="button"
              className={primaryButton}
              onClick={startSharing}
              disabled={isNativePicker && activeTab !== 'devices' && (!selectedSource || sourcesLoading)}
            >
              {activeTab === 'devices' ? 'Choose screen' : 'Share'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
