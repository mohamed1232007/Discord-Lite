import { 
  PhoneOff, 
  PhoneCall, 
  Phone
} from 'lucide-react';
import { useVoice } from '../context/VoiceContext';

export default function CallOverlay({ onCallStarted }) {
  const { 
    incomingCall, 
    answerCall, 
    endCall 
  } = useVoice();

  // إظهار نافذة الرنين فقط في حال وجود مكالمة واردة
  if (!incomingCall) return null;

  // استخراج الاسم بأمان تام
  const callerName = incomingCall.callerName || incomingCall.callerDisplayName || 'Friend';
  const callerInitials = callerName ? callerName.substring(0, 2).toUpperCase() : 'FR';
  const handleAnswer = async () => {
    await answerCall();
    onCallStarted?.();
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 select-none">
      {/* Container with Ringing Shake & Bounce Animation */}
      <div className="relative bg-[#111214] border border-[#2b2d31] p-4 rounded-2xl shadow-[0_10px_40px_rgba(0,0,0,0.8)] flex items-center gap-4 animate-bounce duration-1000">
        
        {/* Glow Ring Effect around the card */}
        <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-[#23a55a]/30 to-[#5865f2]/30 blur-sm -z-10 animate-pulse" />

        {/* Animated Avatar with Pulse Ring */}
        <div className="relative shrink-0">
          <div className="w-12 h-12 rounded-full bg-[#5865f2] text-white font-bold flex items-center justify-center text-lg shadow-md animate-pulse">
            {callerInitials}
          </div>
          {/* Green Radar Ring Wave */}
          <span className="absolute -inset-1 rounded-full border-2 border-[#23a55a] animate-ping opacity-75 pointer-events-none" />
        </div>

        {/* Caller Info */}
        <div className="min-w-0 pr-2">
          <div className="text-white font-bold text-sm truncate max-w-[130px]">{callerName}</div>
          <div className="text-xs text-[#23a55a] flex items-center gap-1.5 font-medium mt-0.5 whitespace-nowrap">
            <PhoneCall size={13} className="animate-bounce text-[#23a55a]" />
            <span className="tracking-wide">Incoming Call...</span>
          </div>
        </div>

        {/* Action Buttons with Interactive Hover Scales */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Accept Button - Green with continuous pulse */}
          <button
            type="button"
            onClick={handleAnswer}
            className="relative w-10 h-10 rounded-full bg-[#23a55a] hover:bg-[#1a7e44] text-white flex items-center justify-center shadow-lg transition-transform hover:scale-110 active:scale-95 cursor-pointer"
            title="Accept Call"
          >
            <Phone size={18} className="animate-pulse" />
            <span className="absolute -inset-1 rounded-full border border-[#23a55a] animate-ping opacity-50 pointer-events-none" />
          </button>

          {/* Decline Button - Red */}
          <button
            type="button"
            onClick={() => endCall(true)}
            className="w-10 h-10 rounded-full bg-[#f23f43] hover:bg-[#c93034] text-white flex items-center justify-center shadow-lg transition-transform hover:scale-110 active:scale-95 cursor-pointer"
            title="Decline Call"
          >
            <PhoneOff size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
