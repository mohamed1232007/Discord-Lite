import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Loader2 } from 'lucide-react';

export default function AuthModal({ isOpen, onClose }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  const { signIn, signUp } = useAuth();

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      if (isLogin) {
        // signIn/signUp ترمي استثناءً عند الفشل، ولا تُرجع كائن { error }
        await signIn(email, password);
        onClose();
      } else {
        if (!username.trim()) throw new Error('Username is required');
        await signUp(email, password, username, displayName);
        onClose();
      }
    } catch (err) {
      setErrorMsg(err.message || 'An error occurred during authentication');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 select-none">
      <div className="w-full max-w-[480px] bg-[#111214] border border-[#1e1f22] rounded-lg p-8 shadow-2xl relative">
        {/* Discord Logo / Header */}
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-[#5865f2] rounded-2xl mx-auto flex items-center justify-center text-white mb-3 shadow-lg shadow-[#5865f2]/20">
            <svg className="w-7 h-7 fill-current" viewBox="0 0 127.14 96.36">
              <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,45.91,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,45.91,96.12,53,91.08,65.69,84.69,65.69Z"/>
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white">
            {isLogin ? 'Welcome back!' : 'Create an account'}
          </h2>
          <p className="text-sm text-[#80848e] mt-1">
            {isLogin ? "We're so excited to see you again!" : 'Join your friends on Discord Lite!'}
          </p>
        </div>

        {errorMsg && (
          <div className="bg-[#f23f43]/10 border border-[#f23f43]/30 text-[#f23f43] text-xs p-3 rounded mb-4">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#b5bac1] mb-1.5">
              Email <span className="text-[#f23f43]">*</span>
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[#000000] border border-[#1e1f22] text-white text-sm rounded p-2.5 focus:outline-none focus:border-[#5865f2] transition"
            />
          </div>

          {!isLogin && (
            <>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#b5bac1] mb-1.5">
                  Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="How friends see you"
                  className="w-full bg-[#000000] border border-[#1e1f22] text-white text-sm rounded p-2.5 focus:outline-none focus:border-[#5865f2] transition"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-[#b5bac1] mb-1.5">
                  Username <span className="text-[#f23f43]">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="unique_username"
                  className="w-full bg-[#000000] border border-[#1e1f22] text-white text-sm rounded p-2.5 focus:outline-none focus:border-[#5865f2] transition"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-[#b5bac1] mb-1.5">
              Password <span className="text-[#f23f43]">*</span>
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[#000000] border border-[#1e1f22] text-white text-sm rounded p-2.5 focus:outline-none focus:border-[#5865f2] transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#5865f2] hover:bg-[#4752c4] text-white font-semibold py-2.5 rounded transition flex items-center justify-center gap-2 mt-2 disabled:opacity-50"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            <span>{isLogin ? 'Log In' : 'Continue'}</span>
          </button>
        </form>

        <div className="mt-4 text-xs text-[#80848e]">
          {isLogin ? (
            <span>
              Need an account?{' '}
              <button 
                type="button" 
                onClick={() => { setIsLogin(false); setErrorMsg(''); }} 
                className="text-[#00a8fc] hover:underline"
              >
                Register
              </button>
            </span>
          ) : (
            <span>
              Already have an account?{' '}
              <button 
                type="button" 
                onClick={() => { setIsLogin(true); setErrorMsg(''); }} 
                className="text-[#00a8fc] hover:underline"
              >
                Log In
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
