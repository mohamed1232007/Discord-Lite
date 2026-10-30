import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { VoiceProvider, useVoice } from './context/VoiceContext';
import { ToastProvider } from './context/ToastContext';
import ServerSidebar from './components/ServerSidebar';
import DMSidebar from './components/DMSidebar';
import FriendsView from './components/FriendsView';
import ChatView from './components/ChatView';
import CallOverlay from './components/CallOverlay';
import DiscordUpdater from './components/DiscordUpdater';

// الشاشات الثقيلة تُحمّل عند الحاجة فقط لتقليل حجم الحزمة الأساسية
const CallScreen = lazy(() => import('./components/CallScreen'));
const LandingPage = lazy(() => import('./components/LandingPage'));
const LoginPage = lazy(() => import('./components/LoginPage'));

function ScreenFallback() {
  return (
    <div className="flex h-full min-h-screen w-full flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_top,_#1a2457_0%,_#0c1027_48%,_#080a12_100%)] text-white">
      <div className="flex w-[min(88vw,320px)] flex-col items-center rounded-3xl border border-white/[0.08] bg-[#111318]/75 px-8 py-9 shadow-[0_24px_100px_rgba(0,0,0,0.4)] backdrop-blur-xl">
        <div className="relative mb-5 flex h-16 w-16 items-center justify-center rounded-[22px] bg-gradient-to-br from-[#7289ff] to-[#4752c4] shadow-[0_12px_40px_rgba(88,101,242,0.3)]">
          <div className="absolute -inset-1.5 rounded-[26px] border border-[#7289ff]/20 animate-pulse" />
          <svg className="h-9 w-9 fill-white" viewBox="0 0 127.14 96.36" aria-hidden="true">
            <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,45.91,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,45.91,96.12,53,91.08,65.69,84.69,65.69Z" />
          </svg>
        </div>
        <p className="text-sm font-semibold tracking-wide text-white/90">Discord Lite</p>
        <p className="mt-1 text-xs text-[#949ba4]">Getting things ready…</p>
        <div className="mt-6 h-1 w-full overflow-hidden rounded-full bg-white/[0.08]" aria-hidden="true">
          <div className="screen-loading-progress h-full w-2/5 rounded-full bg-gradient-to-r from-[#5865f2] to-[#9b8cff]" />
        </div>
      </div>
    </div>
  );
}

function MainApp() {
  const { user, loading } = useAuth();
  const { activeCall } = useVoice();
  // شاشة التحديث تظهر فقط داخل تطبيق الويندوز (Tauri)، ولا تظهر لزوار الموقع في المتصفح
  const isTauriApp = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
  const [updaterFinished, setUpdaterFinished] = useState(!isTauriApp);
  const finishUpdater = useCallback(() => setUpdaterFinished(true), []);

  // الصفحة المطلوبة من المستخدم (landing / login / app) مع حفظها للزيارة القادمة
  const [requestedView, setRequestedView] = useState(() => {
    const token = localStorage.getItem('dis_lite_token');
    if (token) return 'app';
    if (isTauriApp) return 'login';
    return window.location.pathname === '/login' ? 'login' : 'landing';
  });

  const changeView = useCallback((view, { replace = false } = {}) => {
    setRequestedView(view);

    if (isTauriApp) return;
    const path = view === 'login' ? '/login' : '/';
    if (window.location.pathname !== path) {
      const updateHistory = replace ? 'replaceState' : 'pushState';
      window.history[updateHistory]({ view }, '', path);
    }
  }, [isTauriApp]);

  useEffect(() => {
    if (isTauriApp) return undefined;

    const handlePopState = () => {
      const view = window.location.pathname === '/login' ? 'login' : 'landing';
      setRequestedView(view);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isTauriApp]);

  // الصفحة الفعلية مشتقة من حالة الدخول بدل تعديل الـ state داخل useEffect
  // (يمنع الـ re-render المزدوج ويمنع الدوران في حلقة تحديث)
  const currentView = user
    ? 'app'
    : (isTauriApp ? 'login' : (requestedView === 'landing' ? 'landing' : 'login'));

  const [activeTab, setActiveTab] = useState('dm');
  const [selectedChat, setSelectedChat] = useState(null);
  const [isChatVisible, setIsChatVisible] = useState(false);

  const openChat = useCallback((chat) => {
    setSelectedChat(chat);
    setIsChatVisible(!!chat);
  }, []);

  if (!updaterFinished) {
    return <DiscordUpdater onFinished={finishUpdater} />;
  }

  if (loading) {
    return (
      <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_50%_38%,_#202b66_0%,_#111735_38%,_#090a0d_78%)] text-white select-none">
        <div className="pointer-events-none absolute -left-32 -top-40 h-96 w-96 rounded-full bg-[#5865f2]/15 blur-[110px]" />
        <div className="pointer-events-none absolute -bottom-48 -right-32 h-[32rem] w-[32rem] rounded-full bg-[#7289ff]/10 blur-[130px]" />
        <div className="relative w-[min(90vw,440px)] rounded-[28px] border border-white/[0.1] bg-[#111522]/85 p-7 shadow-[0_32px_100px_rgba(0,0,0,0.5)] backdrop-blur-xl sm:p-9">
          <div className="flex items-center gap-4">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] bg-gradient-to-br from-[#7289ff] to-[#4752c4] shadow-[0_10px_32px_rgba(88,101,242,0.35)]">
              <svg className="h-8 w-8 fill-white" viewBox="0 0 127.14 96.36" aria-hidden="true">
              <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,45.91,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,45.91,96.12,53,91.08,65.69,84.69,65.69Z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-extrabold tracking-tight">Discord Lite</h1>
              <p className="mt-1 text-sm text-white/50">A lighter place to connect</p>
            </div>
          </div>
          <div className="my-7 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-[#aeb8ff]">
              <div className="h-[18px] w-[18px] animate-spin rounded-full border-2 border-[#7289ff] border-t-transparent motion-reduce:animate-none" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Getting everything ready</p>
              <p className="mt-1 text-xs text-white/45">Connecting to Discord Lite</p>
            </div>
          </div>
          <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]" aria-hidden="true">
            <div className="screen-loading-progress h-full w-2/5 rounded-full bg-gradient-to-r from-[#5865f2] to-[#9b8cff]" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<ScreenFallback />}>
      {currentView === 'landing' ? (
        <LandingPage
          onOpenApp={() => changeView('app')}
          onOpenLogin={() => {
            if (user) {
              changeView('app');
            } else {
              changeView('login');
            }
          }}
        />
      ) : currentView === 'login' ? (
        <LoginPage
          onBackToLanding={isTauriApp ? undefined : () => changeView('landing')}
          onSuccess={() => changeView('app', { replace: true })}
        />
      ) : (
        <div className="flex h-screen w-screen overflow-hidden bg-[#000000] text-[#dbdee1] font-sans antialiased flex-col">
          {/* إشعار الرنين الوارد للمكالمات */}
          <CallOverlay onCallStarted={() => setIsChatVisible(false)} />

          <div className="flex-1 flex overflow-hidden">
            {/* 1. Leftmost Server Sidebar الثابت (بدون زر هوم كما طلبت) */}
            <ServerSidebar
              activeTab={activeTab}
              setActiveTab={setActiveTab}
            />

            {/* 2. القائمة الجانبية الأصلية للرسائل والأصدقاء */}
            <DMSidebar
              selectedChat={selectedChat}
              onSelectChat={openChat}
              onShowCall={() => setIsChatVisible(false)}
              onOpenAuth={() => changeView('login')}
            />

            {/* 3. الجانب الأيمن: شاشة الكول الكبيرة أو الشات أو الأصدقاء */}
            {activeCall && !isChatVisible ? (
              <Suspense fallback={<ScreenFallback />}>
                <CallScreen onOpenChat={(participant) => {
                  const chatUser = participant?.id ? participant : activeCall.friend;
                  if (chatUser?.id) openChat(chatUser);
                }} />
              </Suspense>
            ) : selectedChat ? (
              <ChatView
                key={selectedChat.id}
                user={selectedChat}
                onBack={() => openChat(null)}
                onCallStarted={() => setIsChatVisible(false)}
              />
            ) : (
              <FriendsView
                onStartChat={openChat}
              />
            )}
          </div>
        </div>
      )}
    </Suspense>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <VoiceProvider>
          <MainApp />
        </VoiceProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
