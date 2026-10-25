import React, { createContext, useContext, useState, useCallback } from 'react';
import { 
  CheckCircle2, 
  AlertCircle, 
  Info, 
  AlertTriangle, 
  X, 
  Sparkles 
} from 'lucide-react';

const ToastContext = createContext(null);

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = Date.now() + Math.random().toString(36).substring(2, 5);
    setToasts((prev) => [...prev, { id, message, type }]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = {
    success: (msg, dur) => addToast(msg, 'success', dur),
    error: (msg, dur) => addToast(msg, 'error', dur),
    info: (msg, dur) => addToast(msg, 'info', dur),
    warning: (msg, dur) => addToast(msg, 'warning', dur),
    feature: (msg, dur) => addToast(msg, 'feature', dur),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}

      {/* Toast Notifications Container - تظهر في الأسفل بأسلوب ديسكورد الأنيق */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col-reverse gap-2 items-center pointer-events-none select-none max-w-md w-auto px-4">
        {toasts.map((t) => {
          let icon = <Info size={17} className="text-[#5865f2] shrink-0" />;
          let borderColor = 'border-[#2b2d31]';
          let glowColor = 'shadow-[0_8px_30px_rgba(0,0,0,0.8)]';

          if (t.type === 'success') {
            icon = <CheckCircle2 size={17} className="text-[#23a55a] shrink-0" />;
            borderColor = 'border-[#23a55a]/40';
          } else if (t.type === 'error') {
            icon = <AlertCircle size={17} className="text-[#f23f43] shrink-0" />;
            borderColor = 'border-[#f23f43]/40';
          } else if (t.type === 'warning') {
            icon = <AlertTriangle size={17} className="text-[#f0b132] shrink-0" />;
            borderColor = 'border-[#f0b132]/40';
          } else if (t.type === 'feature') {
            icon = <Sparkles size={17} className="text-[#eb459e] shrink-0" />;
            borderColor = 'border-[#eb459e]/40';
          }

          return (
            <div
              key={t.id}
              className={`pointer-events-auto bg-[#111214]/95 backdrop-blur-md border ${borderColor} text-[#dbdee1] py-2.5 px-4 rounded-xl ${glowColor} flex items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-4 duration-200 transition-all shadow-2xl`}
            >
              <div className="flex items-center gap-2.5 whitespace-nowrap">
                {icon}
                <span className="text-xs font-semibold text-white">
                  {t.message}
                </span>
              </div>
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                className="text-[#80848e] hover:text-white p-0.5 rounded transition cursor-pointer shrink-0 ml-1"
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    // Fallback if rendered outside provider
    return {
      success: (msg) => console.log('[Toast Success]', msg),
      error: (msg) => console.error('[Toast Error]', msg),
      info: (msg) => console.log('[Toast Info]', msg),
      warning: (msg) => console.warn('[Toast Warning]', msg),
      feature: (msg) => console.log('[Toast Feature]', msg),
    };
  }
  return context;
};

