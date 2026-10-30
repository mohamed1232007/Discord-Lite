import { useState, useEffect } from 'react';
import { Check, Download, LoaderCircle, RefreshCw, Sparkles } from 'lucide-react';

const DISCORD_FACTS = [
  'Spinning the hamster wheels...',
  'Checking for updates...',
  'Warming up voice channels...',
  'Connecting to Discord Lite...',
  'Did you know? Discord Lite is super fast & native!'
];

const UPDATE_CHECK_TIMEOUT_MS = 5000;

export default function DiscordUpdater({ onFinished }) {
  const [status, setStatus] = useState('checking'); // 'checking' | 'found' | 'downloading' | 'installing' | 'upToDate' | 'ready'
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('Checking for updates...');
  const [downloadStats, setDownloadStats] = useState('');
  const [factIndex, setFactIndex] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  const StatusIcon = status === 'upToDate'
    ? Check
    : status === 'downloading'
      ? Download
      : status === 'installing'
        ? RefreshCw
        : status === 'ready'
          ? Sparkles
          : LoaderCircle;

  // تدوير عبارات ديسكورد الطريفة أثناء الفحص
  useEffect(() => {
    const timer = setInterval(() => {
      setFactIndex((prev) => (prev + 1) % DISCORD_FACTS.length);
    }, 2200);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let isMounted = true;
    let progressTimer;

    async function checkForUpdates() {
      // 1. هل يعمل التطبيق داخل بيئة Tauri للديسكتوب؟
      const isTauri = typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__);

      if (!isTauri) {
        // في المتصفح العادي: تخطي فوري وسلس
        setTimeout(() => {
          if (!isMounted) return;
          setStatus('ready');
          setStatusText('Starting Discord Lite...');
          setTimeout(() => {
            setFadeOut(true);
            setTimeout(onFinished, 400);
          }, 600);
        }, 1000);
        return;
      }

      try {
        // 2. استدعاء مكتبة Tauri Auto-Updater
        const { check } = await import('@tauri-apps/plugin-updater');
        const { relaunch } = await import('@tauri-apps/plugin-process');

        setStatusText('Checking for updates...');
        let updateCheckTimeout;
        let update;
        try {
          update = await Promise.race([
            check(),
            new Promise((_, reject) => {
              updateCheckTimeout = setTimeout(
                () => reject(new Error('Update check timed out.')),
                UPDATE_CHECK_TIMEOUT_MS,
              );
            }),
          ]);
        } finally {
          clearTimeout(updateCheckTimeout);
        }

        if (update && update.available) {
          console.log('[Updater] Update found:', update.version);
          if (!isMounted) return;

          // إظهار تنبيه بوجود تحديث جديد باللغة الإنجليزية كما طلب المستخدم
          setStatus('found');
          setStatusText('Update Available! Preparing download...');

          // انتظار ثانية ونصف ليرى المستخدم تنبيه التحديث بوضوح
          await new Promise((r) => setTimeout(r, 1500));
          if (!isMounted) return;

          setStatus('downloading');
          setStatusText('Downloading Update...');

          let downloaded = 0;
          let contentLength = 0;

          await update.downloadAndInstall((event) => {
            switch (event.event) {
              case 'Started':
                contentLength = event.data.contentLength || 0;
                if (contentLength > 0) {
                  clearInterval(progressTimer);
                  progressTimer = undefined;
                  setProgress(0);
                } else {
                  progressTimer = setInterval(() => {
                    setProgress((current) => Math.min(current + 2, 95));
                  }, 250);
                }
                break;
              case 'Progress':
                downloaded += event.data.chunkLength;
                if (contentLength > 0) {
                  const percent = Math.min(100, Math.round((downloaded / contentLength) * 100));
                  const dlMb = (downloaded / (1024 * 1024)).toFixed(1);
                  const totalMb = (contentLength / (1024 * 1024)).toFixed(1);
                  setProgress(percent);
                  setStatusText(`Downloading Update... ${percent}%`);
                  setDownloadStats(`${dlMb} MB / ${totalMb} MB`);
                } else if (!progressTimer) {
                  progressTimer = setInterval(() => {
                    setProgress((current) => Math.min(current + 2, 95));
                  }, 250);
                }
                break;
              case 'Finished':
                clearInterval(progressTimer);
                progressTimer = undefined;
                setProgress(100);
                setStatus('installing');
                setStatusText('Installing update & restarting...');
                break;
            }
          });

          if ('caches' in window) {
            try {
              const cacheNames = await window.caches.keys();
              await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
            } catch (error) {
              console.warn('[Updater] Could not clear outdated web caches:', error);
            }
          }

          // إعادة تشغيل التطبيق بالنسخة الجديدة فوراً
          clearInterval(progressTimer);
          setProgress(100);
          setStatusText('Update complete! Restarting Discord Lite...');
          setTimeout(async () => {
            await relaunch();
          }, 1200);
        } else {
          // لا يوجد تحديث جديد (التطبيق بأحدث نسخة)
          if (!isMounted) return;
          setStatus('upToDate');
          setStatusText('Discord Lite is up to date!');
          setTimeout(() => {
            setFadeOut(true);
            setTimeout(onFinished, 500);
          }, 900);
        }
      } catch (err) {
        clearInterval(progressTimer);
        console.warn('[Updater] Check failed or offline:', err);
        if (!isMounted) return;
        setStatus('ready');
        setStatusText('Starting Discord Lite...');
        setTimeout(() => {
          setFadeOut(true);
          setTimeout(onFinished, 500);
        }, 800);
      }
    }

    checkForUpdates();

    return () => {
      isMounted = false;
      clearInterval(progressTimer);
    };
  }, [onFinished]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#111214] select-none transition-opacity duration-500 ${
        fadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden bg-[radial-gradient(ellipse_at_50%_38%,_#202b66_0%,_#111735_38%,_#090a0d_78%)]" />
      <div className="pointer-events-none absolute -left-32 -top-40 h-96 w-96 rounded-full bg-[#5865f2]/15 blur-[110px]" />
      <div className="pointer-events-none absolute -bottom-48 -right-32 h-[32rem] w-[32rem] rounded-full bg-[#7289ff]/10 blur-[130px]" />

      <div className="relative w-[min(90vw,440px)] overflow-hidden rounded-[28px] border border-white/[0.1] bg-[#111522]/85 p-7 shadow-[0_32px_100px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:p-9">
        <div className="flex items-center gap-4">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] bg-gradient-to-br from-[#7289ff] to-[#4752c4] shadow-[0_10px_32px_rgba(88,101,242,0.35)]">
            <div className="absolute inset-0 rounded-[18px] bg-white/10" />
            <svg className="relative h-8 w-8 fill-white" viewBox="0 0 127.14 96.36" aria-hidden="true">
              <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,45.91,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,45.91,96.12,53,91.08,65.69,84.69,65.69Z" />
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-extrabold tracking-tight text-white">Discord Lite</h1>
            <p className="mt-1 text-sm text-white/50">A lighter place to connect</p>
          </div>
          <span className="ml-auto rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/40">
            Startup
          </span>
        </div>

        <div className="my-7 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        <div className="flex items-center gap-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${
            status === 'upToDate'
              ? 'border-[#74e0bd]/20 bg-[#35c99a]/10 text-[#74e0bd]'
              : status === 'downloading'
                ? 'border-[#aeb8ff]/20 bg-[#5865f2]/10 text-[#aeb8ff]'
                : 'border-white/10 bg-white/[0.04] text-[#aeb8ff]'
          }`}>
            <StatusIcon
              size={19}
              strokeWidth={2}
              className={status === 'checking' || status === 'found' || status === 'installing' ? 'animate-spin' : ''}
              aria-hidden="true"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-white">{statusText}</p>
            <p className="mt-1 text-xs text-white/45">
              {status === 'downloading' ? 'Updating your app' : status === 'installing' ? 'Almost ready' : 'Getting your app ready'}
            </p>
          </div>
          {(status === 'found' || status === 'downloading') && (
            <span className="shrink-0 rounded-full border border-[#74e0bd]/20 bg-[#35c99a]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#74e0bd]">
              Update
            </span>
          )}
        </div>

        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-white/40">
            <span>{status === 'downloading' || status === 'installing' ? 'Installing update' : 'Starting Discord Lite'}</span>
            {(status === 'downloading' || status === 'installing') && <span>{progress}%</span>}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]" role="progressbar" aria-valuenow={status === 'downloading' || status === 'installing' ? progress : undefined} aria-valuemin="0" aria-valuemax="100">
            {status === 'downloading' || status === 'installing' ? (
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#5865f2] to-[#74e0bd] transition-[width] duration-300"
                style={{ width: `${progress}%` }}
              />
            ) : (
              <div className="screen-loading-progress h-full w-2/5 rounded-full bg-gradient-to-r from-[#5865f2] to-[#9b8cff]" />
            )}
          </div>
          {status === 'downloading' && downloadStats && (
            <p className="mt-2 text-right text-[11px] tabular-nums text-white/40">{downloadStats}</p>
          )}
        </div>

        <div className="mt-6 flex items-center gap-2 border-t border-white/[0.07] pt-4">
          <Sparkles size={13} className="shrink-0 text-[#aeb8ff]/70" aria-hidden="true" />
          <p className="truncate text-xs text-white/40">{DISCORD_FACTS[factIndex]}</p>
        </div>
      </div>
    </div>
  );
}
