import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function LoginPage({ onBackToLanding, onSuccess }) {
  const { signIn, signUp } = useAuth();
  const toast = useToast();

  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isRegisterMode) {
        if (!email || !password || !username) {
          toast.warning('Please fill in all required fields');
          setLoading(false);
          return;
        }
        await signUp(email, password, username, displayName || username);
        toast.success('Account created successfully!');
      } else {
        if (!email || !password) {
          toast.warning('Please enter email and password');
          setLoading(false);
          return;
        }
        await signIn(email, password);
        toast.success('Logged in successfully!');
      }
      if (onSuccess) onSuccess();
    } catch (err) {
      toast.error(err.message || 'An error occurred during authentication');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex flex-col items-center justify-center bg-[#1b2559] select-none overflow-x-hidden font-sans">
      
      {/* ── Background: Discord Galaxy Gradient ── */}
      <div 
        className="absolute inset-0 bg-cover bg-center opacity-90 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 40%, #202b66 0%, #151b47 45%, #0d1230 100%)'
        }}
      />

      {/* Floating subtle star particles effect */}
      <div className="absolute inset-0 bg-[radial-gradient(white,transparent_1px)] [background-size:32px_32px] opacity-15 pointer-events-none" />

      {/* ── Top Left: Discord Logo ── */}
      <header className="absolute top-8 left-8 sm:left-12 flex items-center gap-2.5 z-20 cursor-pointer" onClick={onBackToLanding}>
        <svg className="w-9 h-9 fill-white" viewBox="0 0 127.14 96.36">
          <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,45.91,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,45.91,96.12,53,91.08,65.69,84.69,65.69Z"/>
        </svg>
        <span className="font-extrabold text-[22px] tracking-tight text-white font-['Ginto',sans-serif]">Discord Lite</span>
      </header>

      {/* ── Main Modal Card (طابق 100% مع الصورة) ── */}
      <div className="relative z-10 w-full max-w-[784px] mx-4 bg-[#313338] text-[#dbdee1] rounded-lg shadow-[0_2px_10px_0_rgba(0,0,0,0.2)] p-8 flex flex-col md:flex-row gap-8 items-center transition-all duration-300">
        
        {/* Left Side: Form */}
        <div className="w-full md:w-[440px] flex flex-col">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-white tracking-wide">
              {isRegisterMode ? 'Create an account' : 'Welcome back!'}
            </h2>
            <p className="text-[#949ba4] text-sm mt-1">
              {isRegisterMode ? "We're excited to have you join us!" : "We're so excited to see you again!"}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-left">
            
            {/* Input: Email */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#b5bac1] mb-2">
                {isRegisterMode ? 'Email *' : 'Email or Phone Number *'}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-[#1e1f22] text-white px-3 py-2.5 rounded text-sm outline-none border border-transparent focus:border-[#5865f2] transition duration-200"
              />
            </div>

            {/* In Register Mode: Username & Display Name */}
            {isRegisterMode && (
              <>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#b5bac1] mb-2">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Optional"
                    className="w-full bg-[#1e1f22] text-white px-3 py-2.5 rounded text-sm outline-none border border-transparent focus:border-[#5865f2] transition duration-200"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#b5bac1] mb-2">
                    Username *
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    className="w-full bg-[#1e1f22] text-white px-3 py-2.5 rounded text-sm outline-none border border-transparent focus:border-[#5865f2] transition duration-200"
                  />
                </div>
              </>
            )}

            {/* Input: Password */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-[#b5bac1] mb-2">
                Password *
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-[#1e1f22] text-white px-3 py-2.5 rounded text-sm outline-none border border-transparent focus:border-[#5865f2] transition duration-200"
              />
              {!isRegisterMode && (
                <div 
                  onClick={() => toast.info('Under development')}
                  className="text-xs text-[#00a8fc] hover:underline cursor-pointer mt-1 font-medium select-none"
                >
                  Forgot your password?
                </div>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 bg-[#5865f2] hover:bg-[#4752c4] active:bg-[#3c45a5] text-white font-medium text-sm rounded transition duration-200 cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Please wait...
                </span>
              ) : (
                isRegisterMode ? 'Continue' : 'Log In'
              )}
            </button>

            {/* Mode Switcher Footer */}
            <div className="text-xs text-[#949ba4] mt-2 select-none">
              {isRegisterMode ? (
                <span>
                  Already have an account?{' '}
                  <span 
                    onClick={() => setIsRegisterMode(false)}
                    className="text-[#00a8fc] hover:underline cursor-pointer font-medium"
                  >
                    Log In
                  </span>
                </span>
              ) : (
                <span>
                  Need an account?{' '}
                  <span 
                    onClick={() => setIsRegisterMode(true)}
                    className="text-[#00a8fc] hover:underline cursor-pointer font-medium"
                  >
                    Register
                  </span>
                </span>
              )}
            </div>

          </form>
        </div>

        {/* Vertical divider or right column (QR Code Section) */}
        {!isRegisterMode && (
          <div className="hidden md:flex flex-col items-center justify-center text-center pl-8 border-l border-[#3f4147]/50 w-[240px]">
            {/* QR Code Container */}
            <div className="relative p-2.5 bg-white rounded-lg shadow-inner group cursor-pointer" onClick={() => toast.info('Under development')}>
              {/* Clean SVG QR Code Representation with Discord logo */}
              <svg className="w-36 h-36" viewBox="0 0 100 100" fill="#2b2d31">
                {/* Outer corners */}
                <rect x="5" y="5" width="28" height="28" rx="4" fill="#000" />
                <rect x="9" y="9" width="20" height="20" rx="2" fill="#fff" />
                <rect x="13" y="13" width="12" height="12" rx="1" fill="#000" />

                <rect x="67" y="5" width="28" height="28" rx="4" fill="#000" />
                <rect x="71" y="9" width="20" height="20" rx="2" fill="#fff" />
                <rect x="75" y="13" width="12" height="12" rx="1" fill="#000" />

                <rect x="5" y="67" width="28" height="28" rx="4" fill="#000" />
                <rect x="9" y="71" width="20" height="20" rx="2" fill="#fff" />
                <rect x="13" y="75" width="12" height="12" rx="1" fill="#000" />

                {/* Random QR Pixels */}
                <rect x="38" y="10" width="5" height="5" />
                <rect x="48" y="10" width="10" height="5" />
                <rect x="40" y="20" width="8" height="8" />
                <rect x="55" y="24" width="6" height="6" />

                <rect x="10" y="38" width="8" height="6" />
                <rect x="22" y="42" width="6" height="8" />
                <rect x="36" y="38" width="5" height="5" />
                <rect x="58" y="38" width="10" height="6" />
                <rect x="75" y="38" width="8" height="6" />
                <rect x="88" y="44" width="7" height="8" />

                <rect x="10" y="52" width="14" height="6" />
                <rect x="72" y="52" width="8" height="8" />
                <rect x="85" y="56" width="10" height="5" />

                <rect x="38" y="68" width="6" height="8" />
                <rect x="48" y="74" width="10" height="6" />
                <rect x="62" y="68" width="5" height="12" />
                <rect x="75" y="72" width="8" height="8" />
                <rect x="40" y="86" width="14" height="6" />
                <rect x="60" y="86" width="8" height="8" />
                <rect x="75" y="86" width="18" height="6" />
              </svg>

              {/* Discord Mini Center Logo */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-9 h-9 rounded-full bg-white shadow flex items-center justify-center p-1 border-2 border-white">
                  <div className="w-full h-full rounded-full bg-[#5865f2] flex items-center justify-center">
                    <svg className="w-5 h-5 fill-white" viewBox="0 0 127.14 96.36">
                      <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,45.91,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,45.91,96.12,53,91.08,65.69,84.69,65.69Z"/>
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            <h3 className="text-white text-lg font-bold mt-6">
              Log in with QR Code
            </h3>
            
            <p className="text-[#949ba4] text-sm mt-1 leading-snug">
              Scan this with the <span className="font-semibold text-[#dbdee1]">Discord Lite mobile app</span> to log in instantly.
            </p>

            <div 
              onClick={() => toast.info('Under development')}
              className="text-xs text-[#00a8fc] hover:underline cursor-pointer mt-3 select-none"
            >
              Or sign in with a passkey
            </div>
          </div>
        )}

      </div>

    </div>
  );
}

