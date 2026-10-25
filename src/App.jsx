import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { VoiceProvider, useVoice } from './context/VoiceContext';
import { ToastProvider } from './context/ToastContext';
import ServerSidebar from './components/ServerSidebar';
import DMSidebar from './components/DMSidebar';
import FriendsView from './components/FriendsView';
import ChatView from './components/ChatView';
import CallScreen from './components/CallScreen';
import CallOverlay from './components/CallOverlay';
import LandingPage from './components/LandingPage';
import LoginPage from './components/LoginPage';

function MainApp() {
  const { user, loading } = useAuth();
  const { activeCall } = useVoice();

  // تذكّر الصفحة المفضلة، وإذا كان المستخدم مسجل دخوله في جلسة سابقة يدخل مباشرة للـ app
  const [currentView, setCurrentView] = useState(() => {
    const savedView = localStorage.getItem('dis_lite_view');
    const token = localStorage.getItem('dis_lite_token');
    if (token) return 'app';
    return savedView || 'landing';
  });

  const [activeTab, setActiveTab] = useState('dm');
  const [selectedChat, setSelectedChat] = useState(null);

  // حفظ الـ view عند تغييره لضمان عدم فقدانه عند عمل Refresh
  const changeView = (view) => {
    setCurrentView(view);
    localStorage.setItem('dis_lite_view', view);
  };

  // لو المستخدم سجل دخوله، نقدر نوجهه للتطبيق فوراً لو هو كان في صفحة اللوجين
  React.useEffect(() => {
    if (user && (currentView === 'login' || currentView === 'landing')) {
      // إذا كان المستخدم مسجلاً ولديه توكن، وجهه مباشرة للتطبيق عند الريفرش أو بعد تسجيل الدخول
      const savedView = localStorage.getItem('dis_lite_view');
      if (savedView === 'landing' && !localStorage.getItem('dis_lite_token')) {
        // إذا اختار عمداً البقاء في الـ landing
      } else {
        changeView('app');
      }
    } else if (!user && !loading && currentView === 'app') {
      // عند تسجيل الخروج أو عدم وجود جلسة صالحة، يرجع فوراً لصفحة تسجيل الدخول
      changeView('login');
    }
  }, [user, loading, currentView]);

  // لو في مكالمة جارية وهو في الـ landing أو login، ننقله للـ app فوراً عشان يشوف المكالمة
  React.useEffect(() => {
    if (activeCall && currentView !== 'app') {
      changeView('app');
    }
  }, [activeCall]);

  if (loading) {
    return (
      <div className="h-screen w-screen bg-[#111214] flex flex-col items-center justify-center text-white gap-4 select-none">
        <div className="w-12 h-12 border-4 border-[#5865f2] border-t-transparent rounded-full animate-spin" />
        <span className="text-sm font-semibold text-[#949ba4] tracking-wide">Starting Discord Lite...</span>
      </div>
    );
  }

  return (
    <>
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
          onBackToLanding={() => changeView('landing')}
          onSuccess={() => changeView('app')}
        />
      ) : (
        <div className="flex h-screen w-screen overflow-hidden bg-[#000000] text-[#dbdee1] font-sans antialiased flex-col">
          {/* إشعار الرنين الوارد للمكالمات */}
          <CallOverlay />

          <div className="flex-1 flex overflow-hidden">
            {/* 1. Leftmost Server Sidebar الثابت (بدون زر هوم كما طلبت) */}
            <ServerSidebar 
              activeTab={activeTab} 
              setActiveTab={setActiveTab} 
            />

            {/* 2. القائمة الجانبية الأصلية للرسائل والأصدقاء */}
            <DMSidebar 
              selectedChat={selectedChat} 
              setSelectedChat={setSelectedChat} 
              onOpenAuth={() => changeView('login')}
            />

            {/* 3. الجانب الأيمن: شاشة الكول الكبيرة أو الشات أو الأصدقاء */}
            {activeCall ? (
              <CallScreen />
            ) : selectedChat ? (
              <ChatView user={selectedChat} onBack={() => setSelectedChat(null)} />
            ) : (
              <FriendsView 
                onStartChat={(u) => setSelectedChat(u)} 
              />
            )}
          </div>
        </div>
      )}
    </>
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
