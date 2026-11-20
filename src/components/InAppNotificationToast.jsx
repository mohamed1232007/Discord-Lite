import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/** بطاقة إشعار مطابقة تماماً لشكل إشعار الويندوز / ديسكورد الرسمي */
function InAppToast({ toast, onDismiss, onOpen }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 6000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const handleClick = useCallback(() => {
    if (onOpen && toast.sender) onOpen(toast.sender, toast.messageId ?? null);
    onDismiss(toast.id);
  }, [toast, onDismiss, onOpen]);

  const handleClose = useCallback((e) => {
    e.stopPropagation();
    onDismiss(toast.id);
  }, [toast.id, onDismiss]);

  const initials = (toast.senderName || 'U').substring(0, 2).toUpperCase();
  const showRealAvatar = typeof toast.avatarUrl === 'string' &&
    (toast.avatarUrl.startsWith('http://') || toast.avatarUrl.startsWith('https://'));

  return (
    <div
      role="alert"
      aria-live="polite"
      className="w-[360px] rounded-xl shadow-[0_12px_36px_rgba(0,0,0,0.65)] overflow-hidden border border-[#2b2d31]/80 cursor-pointer select-none transition-all duration-200 hover:border-[#3f4147]"
      style={{
        background: '#1e1f22',
        animation: 'dlNotifSlideUp 0.25s cubic-bezier(0.16,1,0.3,1)',
      }}
      onClick={handleClick}
    >
      {/* ── الجزء العلوي (Header) ── */}
      <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-1 text-[#dbdee1]">
        {/* أيقونة التطبيق الرسمية */}
        <img
          src="/app-icon.png"
          alt="Discord Lite"
          className="w-4 h-4 object-contain shrink-0 rounded-xs"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
        <span className="text-[12px] font-medium text-[#dbdee1] flex-1 tracking-wide leading-none">
          Discord Lite
        </span>
        {/* زر الثلاث نقاط */}
        <span className="text-[#80848e] hover:text-white text-xs tracking-widest px-1 leading-none select-none">
          ···
        </span>
        {/* زر الإغلاق */}
        <button
          type="button"
          className="text-[#80848e] hover:text-white p-0.5 transition-colors rounded leading-none flex items-center justify-center cursor-pointer"
          onClick={handleClose}
          aria-label="Close notification"
        >
          <X size={14} />
        </button>
      </div>

      {/* ── الجزء السفلي (Body) ── */}
      <div className="flex items-start gap-3 px-3.5 pb-3 pt-1">
        {/* الصورة الدائرية لليوزر على اليسار */}
        <div className="shrink-0 w-9 h-9 rounded-full overflow-hidden bg-[#e3e5e8] flex items-center justify-center border border-white/10 mt-0.5">
          {showRealAvatar ? (
            <img
              src={toast.avatarUrl}
              alt={toast.senderName}
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <span className="text-[#111214] text-xs font-bold tracking-wider select-none">
              {initials}
            </span>
          )}
        </div>

        {/* النصوص على اليمين مباشرة تحت بعض */}
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="text-[14px] font-semibold text-white leading-tight truncate">
            {toast.senderName}
          </div>
          <div className="text-[13px] text-[#dbdee1] leading-snug mt-1 break-words line-clamp-2">
            {toast.body}
          </div>
        </div>
      </div>
    </div>
  );
}

/** الحاوية في أسفل يمين الشاشة تماماً مثل إشعار الويندوز */
export function InAppToastContainer({ toasts, onDismiss, onOpen }) {
  if (!toasts.length || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed bottom-5 right-5 z-[9999] flex flex-col gap-2.5 pointer-events-auto"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <InAppToast
          key={toast.id}
          toast={toast}
          onDismiss={onDismiss}
          onOpen={onOpen}
        />
      ))}
    </div>,
    document.body,
  );
}
