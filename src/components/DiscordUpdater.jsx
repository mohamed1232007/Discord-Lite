import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, CheckCircle2, Download, LoaderCircle } from 'lucide-react';
import { useVoice } from '../context/VoiceContext';

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function UpdateIcon({ state = 'ready' }) {
  const Icon = state === 'downloading'
    ? ArrowDownToLine
    : state === 'downloaded'
      ? CheckCircle2
      : Download;

  return (
    <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#7581ff]/25 to-[#5865f2]/10 text-[#c5cbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
      <Icon size={20} strokeWidth={2.2} aria-hidden="true" />
      {state === 'ready' && (
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#161727] bg-[#8b9bff]" />
      )}
    </span>
  );
}

export function UpdateActionButton({ visible, onClick }) {
  if (!visible) return null;

  return (
    <button
      type="button"
      className="update-action-enter inline-flex items-center gap-1.5 rounded-md bg-white/[0.05] px-2.5 py-1.5 text-xs font-semibold text-[#c5cbff] transition-all duration-300 ease-out hover:bg-white/[0.1] hover:text-white motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-[0_6px_18px_rgba(88,101,242,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7581ff]/70"
      onClick={onClick}
      title="Review available update"
      aria-label="Review available update"
    >
      <Download size={15} aria-hidden="true" />
      <span>Update</span>
    </button>
  );
}

export default function DiscordUpdater({ deferredUpdate, setDeferredUpdate }) {
  const { activeCall } = useVoice();
  const requestedPreview = import.meta.env.DEV && typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('updatePreview')
    : null;
  const requestedPreviewVersion = import.meta.env.DEV && typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('updateVersion')
    : null;
  const previewVersion = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(requestedPreviewVersion || '')
    ? requestedPreviewVersion
    : '';
  const previewMode = ['ready', 'downloading', 'downloaded'].includes(requestedPreview)
    ? requestedPreview
    : null;
  const updateRef = useRef(null);
  const previewTimerRef = useRef(null);
  const downloadingRef = useRef(false);
  const [status, setStatus] = useState(previewMode || 'idle');
  const [progress, setProgress] = useState(previewMode === 'downloading' ? 68 : 0);
  const [version, setVersion] = useState(previewMode ? previewVersion : '');
  const [installing, setInstalling] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [installError, setInstallError] = useState('');

  useEffect(() => {
    if (previewMode || typeof window === 'undefined' || !window.__TAURI_INTERNALS__) return undefined;

    let disposed = false;
    let checking = false;
    let interval;

    const checkForUpdates = async () => {
      if (disposed || checking || updateRef.current) return;
      checking = true;
      let update;

      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        update = await check();
        if (!update) return;
        if (disposed) {
          await update.close();
          return;
        }

        updateRef.current = update;
        setVersion(update.version);
        setProgress(0);
        setStatus('ready');
      } catch (error) {
        if (update && update !== updateRef.current) {
          await update.close().catch((closeError) => {
            console.warn('[Updater] Could not release an incomplete update:', closeError);
          });
        }
        if (!disposed) {
          setStatus('idle');
          console.warn('[Updater] Background update check failed:', error);
        }
      } finally {
        checking = false;
      }
    };

    const initialCheck = window.setTimeout(() => {
      void checkForUpdates();
      interval = window.setInterval(() => {
        void checkForUpdates();
      }, UPDATE_CHECK_INTERVAL_MS);
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(initialCheck);
      window.clearInterval(interval);
      if (updateRef.current) {
        const pendingUpdate = updateRef.current;
        updateRef.current = null;
        void pendingUpdate.close().catch((error) => {
          console.warn('[Updater] Could not release the pending update:', error);
        });
      }
    };
  }, [previewMode]);

  useEffect(() => () => {
    if (previewTimerRef.current) window.clearInterval(previewTimerRef.current);
  }, []);

  const downloadUpdate = async () => {
    if (status === 'downloading' || downloadingRef.current) return;
    setDeferredUpdate(false);
    setProgress(0);
    setDownloadError('');
    setStatus('downloading');

    if (previewMode) {
      let simulatedProgress = 0;
      previewTimerRef.current = window.setInterval(() => {
        simulatedProgress = Math.min(simulatedProgress + 5, 100);
        setProgress(simulatedProgress);
        if (simulatedProgress === 100) {
          window.clearInterval(previewTimerRef.current);
          previewTimerRef.current = null;
          setStatus('downloaded');
        }
      }, 100);
      return;
    }

    const update = updateRef.current;
    if (!update) {
      setStatus('idle');
      return;
    }

    downloadingRef.current = true;
    let downloaded = 0;
    let contentLength = 0;

    try {
      await update.download((event) => {
        if (event.event === 'Started') {
          contentLength = event.data.contentLength || 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            setProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
          }
        } else if (event.event === 'Finished') {
          setProgress(100);
        }
      });

      setProgress(100);
      setStatus('downloaded');
    } catch (error) {
      setStatus('ready');
      setDownloadError('The update could not be downloaded. Please try again.');
      console.error('[Updater] Could not download the update:', error);
    } finally {
      downloadingRef.current = false;
    }
  };

  const restartToUpdate = async () => {
    if (installing || previewMode || !updateRef.current || status !== 'downloaded') return;
    if (activeCall && !window.confirm('Restarting now will end your active call. Continue?')) return;

    setDeferredUpdate(false);
    setInstalling(true);
    setInstallError('');
    try {
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await updateRef.current.install({ restartAfterInstall: true });
      await relaunch();
    } catch (error) {
      setInstalling(false);
      setInstallError('The update could not be installed. Please try again later.');
      console.error('[Updater] Could not install the downloaded update:', error);
    }
  };

  if (status === 'idle' || deferredUpdate) return null;

  return (
    <aside
      className="updater-glass-card updater-toast-enter fixed bottom-4 right-4 z-[100] isolate w-[min(92vw,360px)] overflow-hidden rounded-2xl bg-white/[0.045] p-4 text-white shadow-[0_20px_70px_rgba(0,0,0,0.5)] backdrop-blur-2xl"
      aria-live="polite"
      aria-label="Application update"
    >
      <div className="updater-glass-tint pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="relative z-10">
        {status === 'downloading' ? (
          <>
            <div className="flex items-center gap-3">
              <UpdateIcon state="downloading" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Downloading update</p>
                <p className="mt-1 text-xs text-white/55">
                  {version ? `Version ${version} · ` : ''}{progress}%
                </p>
              </div>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10 ring-1 ring-inset ring-white/[0.06]" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#7581ff] via-[#5865f2] to-[#8c74ff] shadow-[0_0_14px_rgba(88,101,242,0.7)] transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </>
        ) : status === 'ready' ? (
          <div className="flex items-start gap-3">
            <UpdateIcon />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">A new update is ready</p>
              <p className="mt-1 text-xs text-white/55">
                {version ? `Version ${version}` : 'Previewing the available update'}
              </p>
              {downloadError && <p className="mt-2 text-xs text-red-300">{downloadError}</p>}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-gradient-to-br from-[#7581ff] to-[#5865f2] px-3 py-1.5 text-xs font-semibold shadow-[0_4px_16px_rgba(88,101,242,0.25)] transition hover:brightness-110"
                  onClick={() => void downloadUpdate()}
                >
                  Update now
                </button>
                <button
                  type="button"
                  className="rounded-lg px-3 py-1.5 text-xs text-white/65 transition-colors hover:bg-white/10 hover:text-white"
                  onClick={() => setDeferredUpdate(true)}
                >
                  Later
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            {installing ? <LoaderCircle size={20} className="mt-2 shrink-0 animate-spin text-[#aeb8ff]" aria-hidden="true" /> : <UpdateIcon state="downloaded" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {installing ? 'Installing update…' : 'Update downloaded'}
              </p>
              <p className="mt-1 text-xs text-white/55">
                {version ? `Version ${version} is ready to install` : 'Ready to install'}
              </p>
              {installError && <p className="mt-2 text-xs text-red-300">{installError}</p>}
              {!installing && (
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-gradient-to-br from-[#7581ff] to-[#5865f2] px-3 py-1.5 text-xs font-semibold shadow-[0_4px_16px_rgba(88,101,242,0.25)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => void restartToUpdate()}
                    disabled={Boolean(previewMode)}
                    title={previewMode ? 'Preview mode: installation is disabled' : undefined}
                  >
                    Restart now
                  </button>
                  <button
                    type="button"
                    className="rounded-lg px-3 py-1.5 text-xs text-white/65 transition-colors hover:bg-white/10 hover:text-white"
                    onClick={() => setDeferredUpdate(true)}
                  >
                    Later
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
