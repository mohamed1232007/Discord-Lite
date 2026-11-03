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
    <div className="flex h-full min-h-screen w-full flex-1 items-center justify-center overflow-hidden bg-black text-white">
      <div className="flex flex-col items-center gap-5">
        <div className="flex items-center justify-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-[22px] bg-[#5865f2]">
          <svg className="h-9 w-9 fill-white" viewBox="0 0 127.14 96.36" aria-hidden="true">
            <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,45.91,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,45.91,96.12,53,91.08,65.69,84.69,65.69Z" />
          </svg>
        </div>
        <p className="text-xl font-semibold tracking-wide">Discord Lite</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-white/60">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#5865f2] border-t-transparent motion-reduce:animate-none" />
          <span>Getting things ready…</span>
        </div>
      </div>
    </div>
  );
}

function MainApp() {
  const { user, loading } = useAuth();
  const { activeCall } = useVoice();
  // فحص التحديثات يعمل داخل Tauri فقط، ولا يتداخل مع نسخة المتصفح
  const isTauriApp = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
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

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center overflow-hidden bg-black text-white select-none">
        <div className="flex flex-col items-center gap-5">
          <div className="flex items-center justify-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[22px] bg-[#5865f2]">
            <svg className="h-9 w-9 fill-white" viewBox="0 0 127.14 96.36" aria-hidden="true">
              <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,45.91,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,45.91,96.12,53,91.08,65.69,84.69,65.69Z" />
              </svg>
            </div>
          <h1 className="text-xl font-bold tracking-wide">Discord Lite</h1>
          </div>
          <div className="flex items-center gap-2 text-sm text-white/60">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#5865f2] border-t-transparent motion-reduce:animate-none" />
            <span>Getting everything ready</span>
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
              isChatVisible={isChatVisible}
              onSelectChat={openChat}
              onShowCall={() => setIsChatVisible(false)}
              onOpenAuth={() => changeView('login')}
            />

            {/* 3. الجانب الأيمن: شاشة الكول الكبيرة أو الشات أو الأصدقاء */}
            {activeCall ? (
              <div className={!isChatVisible ? 'flex min-w-0 flex-1' : 'hidden'}>
                <Suspense fallback={<ScreenFallback />}>
                  <CallScreen onOpenChat={(participant) => {
                    const chatUser = participant?.id ? participant : activeCall.friend;
                    if (chatUser?.id) openChat(chatUser);
                  }} />
                </Suspense>
              </div>
            ) : null}

            {selectedChat ? (
              <div className={activeCall && !isChatVisible ? 'hidden' : 'flex min-w-0 flex-1'}>
                <ChatView
                  key={selectedChat.id}
                  user={selectedChat}
                  onBack={() => openChat(null)}
                  onCallStarted={() => setIsChatVisible(false)}
                />
              </div>
            ) : !activeCall ? (
              <FriendsView
                onStartChat={openChat}
              />
            ) : null}
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
          <DiscordUpdater />
          <MainApp />
        </VoiceProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
