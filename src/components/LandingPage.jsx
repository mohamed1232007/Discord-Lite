import {
  ArrowDown,
  ArrowRight,
  Cpu,
  Download,
  MemoryStick,
  MessageCircle,
  Mic,
  MonitorUp,
  Sparkles,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import heroImg from '../assets/discord-landing-hero.png';

export default function LandingPage({ onOpenApp, onOpenLogin }) {
  const { user } = useAuth();

  const handleOpenDiscord = () => {
    if (user) {
      onOpenApp();
    } else {
      onOpenLogin();
    }
  };

  const features = [
    {
      icon: MessageCircle,
      title: 'Messages that stay in sync',
      description: 'Chat with friends directly and keep unread messages easy to spot.',
    },
    {
      icon: Users,
      title: 'Friends and group calls',
      description: 'Find friends, start a voice call, and invite others into the conversation.',
    },
    {
      icon: Mic,
      title: 'Clearer voice',
      description: 'Choose a microphone and adjust on-device noise suppression for your voice.',
    },
    {
      icon: MonitorUp,
      title: 'Video and screen sharing',
      description: 'Turn on your camera or share your screen when the conversation needs it.',
    },
  ];

  return (
    <div id="landing-page" className="landing-page-scrollbar h-screen w-full scroll-smooth bg-[#1b2559] text-white flex flex-col font-sans overflow-x-hidden overflow-y-auto relative bg-gradient-to-b from-[#0c122b] via-[#141c42] to-[#1a2354] motion-reduce:scroll-auto">
      
      {/* ── 1. Top Navbar (طابق 100% مع هيدر الصورة) ── */}
      <header className="relative z-50 mx-auto flex h-[76px] w-full max-w-[1440px] shrink-0 items-center justify-between px-6 lg:px-14">
        {/* Discord Logo & Brand */}
        <a
          href="/"
          aria-label="Discord Lite homepage"
          className="flex items-center gap-2.5 transition hover:opacity-95"
        >
          <svg className="w-9 h-9 fill-white" viewBox="0 0 127.14 96.36">
            <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,45.91,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,45.91,96.12,53,91.08,65.69,84.69,65.69Z"/>
          </svg>
          <span className="font-extrabold text-[22px] tracking-tight text-white font-['Ginto',sans-serif]">Discord Lite</span>
        </a>

        <nav aria-label="Main navigation" className="hidden items-center gap-5 text-sm font-semibold text-white/75 md:flex">
          <a href="#features" className="transition-colors duration-200 hover:text-white">Features</a>
          <a href="#lightweight" className="transition-colors duration-200 hover:text-white">Built to stay light</a>
          <a href="https://github.com/mohamed1232007/Discord-Lite/releases/latest" className="transition-colors duration-200 hover:text-white">Download</a>
        </nav>

        {/* Right CTA Button: Open Discord */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleOpenDiscord}
            className="rounded-full bg-white px-4 py-2.5 text-sm font-bold text-[#23272a] shadow-[0_8px_30px_rgba(255,255,255,0.12)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#f2f3ff] active:scale-95 motion-reduce:transform-none motion-reduce:transition-none"
          >
            Open Discord Lite
          </button>
        </div>
      </header>

      {/* ── 2. Hero Section ── */}
      <main className="relative z-10 mx-auto flex w-full max-w-[1440px] flex-1 flex-col justify-center px-6 pb-8 pt-6 lg:min-h-[640px] lg:px-14 lg:pb-12 lg:pt-16">
        <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-12 lg:gap-12">
          <div className="flex flex-col items-center text-center md:col-span-6 md:items-start md:text-left lg:col-span-5">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#aeb8ff]/20 bg-[#5865f2]/10 px-3 py-1.5 text-xs font-bold tracking-wide text-[#c5cbff]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#8e9bff] shadow-[0_0_12px_#8e9bff]" />
              A LIGHTER WAY TO STAY CONNECTED
            </div>
            <h1 className="text-4xl font-black uppercase leading-[0.96] tracking-[-0.055em] text-white drop-shadow-[0_4px_30px_rgba(0,0,0,0.45)] sm:text-5xl md:text-4xl lg:text-6xl">
              YOUR CHAT.<br />
              YOUR PEOPLE.<br />
              LESS CLUTTER.
            </h1>

            <p className="mt-4 max-w-md text-base leading-relaxed text-white/70 lg:text-lg">
              A lightweight desktop chat for staying close to friends. Message, talk, and share your screen without the extra noise.
            </p>

            <div className="mt-5 flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row md:justify-start">
              <a
                href="https://github.com/mohamed1232007/Discord-Lite/releases/latest"
                className="inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-full bg-white px-4 py-3.5 text-sm font-bold text-[#23272a] shadow-[0_12px_35px_rgba(255,255,255,0.13)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#f2f3ff] active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none lg:px-6"
              >
                <Download size={18} aria-hidden="true" />
                Download for Windows
              </a>
              <button
                type="button"
                onClick={handleOpenDiscord}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-full border border-white/15 bg-white/[0.06] px-4 py-3.5 text-sm font-bold text-white transition duration-200 hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/10 active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none lg:px-6"
              >
                Open Discord Lite
              </button>
            </div>
          </div>

          <div className="relative flex items-center justify-center md:col-span-6 lg:col-span-7">
            <div className="absolute inset-8 rounded-full bg-[#5865f2]/20 blur-[90px]" aria-hidden="true" />
            <div className="landing-hero-float group relative w-full max-w-[860px] overflow-hidden rounded-2xl border border-white/[0.14] bg-[#0a0d1c] shadow-[0_30px_90px_rgba(0,0,0,0.48)] ring-1 ring-white/[0.04]">
              <img 
                src={heroImg} 
                alt="Discord Lite Group Chat" 
                className="h-auto w-full object-cover transition duration-700 ease-out group-hover:scale-[1.015] motion-reduce:transform-none motion-reduce:transition-none"
              />
            </div>
          </div>
        </div>
      </main>

      <section id="features" className="w-full scroll-mt-6 border-t border-white/[0.08] bg-[#0c122b]/45 px-6 py-24 lg:px-14 lg:py-28">
        <div className="mx-auto max-w-[1360px]">
          <div className="mx-auto mb-14 max-w-3xl text-center">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-[#aeb8ff]">Made for conversations</p>
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl lg:text-5xl">Everything you need to keep in touch</h2>
            <p className="mt-5 text-base leading-relaxed text-white/70 sm:text-lg">
              The everyday tools for chatting and calling, gathered in one simple desktop app.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon: Icon, title, description }) => (
              <article
                key={title}
                className="min-h-56 rounded-2xl border border-white/[0.09] bg-gradient-to-br from-white/[0.065] to-white/[0.025] p-7 transition duration-300 ease-out hover:-translate-y-1 hover:border-[#8792ff]/40 hover:bg-white/[0.08] motion-reduce:transform-none motion-reduce:transition-none sm:p-8"
              >
                <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#5865f2]/20 text-[#b8c0ff]">
                  <Icon size={26} aria-hidden="true" />
                </div>
                <h3 className="text-xl font-bold text-white">{title}</h3>
                <p className="mt-3 text-base leading-relaxed text-white/65">{description}</p>
              </article>
            ))}
          </div>

          <div className="mt-16">
            <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#aeb8ff]">Lightweight by design</p>
                <h3 className="mt-2 text-2xl font-bold text-white">Uses less RAM and CPU during everyday use.</h3>
              </div>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
            {[
              {
                icon: Cpu,
                title: 'Lower CPU usage',
                subtitle: 'Less processor power',
                detail: 'Designed to use less CPU while you chat and stay connected.',
                color: 'text-[#aeb8ff]',
                glow: 'bg-[#5865f2]/10',
              },
              {
                icon: MemoryStick,
                title: 'Lower RAM usage',
                subtitle: 'Less memory used',
                detail: 'Designed to use less memory during everyday use.',
                color: 'text-[#74e0bd]',
                glow: 'bg-[#35c99a]/10',
              },
            ].map(({ icon: Icon, title, subtitle, detail, color, glow }) => (
              <article
                key={title}
                className="group relative flex min-h-36 items-center gap-6 overflow-hidden rounded-2xl border border-white/[0.09] bg-gradient-to-br from-white/[0.065] to-white/[0.02] p-6 transition duration-300 ease-out hover:-translate-y-1 hover:border-white/20 motion-reduce:transform-none motion-reduce:transition-none sm:p-7"
              >
                <div className={`absolute -right-6 -top-8 h-28 w-28 rounded-full blur-3xl ${glow}`} aria-hidden="true" />
                <div className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.05] ${color}`}>
                  <Icon size={28} strokeWidth={1.8} aria-hidden="true" />
                </div>
                <div className="relative min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h3 className="text-base font-bold text-white">{title}</h3>
                    <span className={`text-[11px] font-bold uppercase tracking-wide ${color}`}>{subtitle}</span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-white/60">{detail}</p>
                </div>
              </article>
            ))}
            </div>
            <article className="group relative mt-5 overflow-hidden rounded-3xl border border-[#8792ff]/25 bg-gradient-to-r from-[#5865f2]/20 via-[#252f70]/45 to-[#35c99a]/10 p-6 shadow-[0_24px_70px_rgba(4,8,28,0.28)] transition duration-300 hover:border-[#aeb8ff]/45 sm:p-8 lg:p-10 motion-reduce:transition-none">
              <div className="pointer-events-none absolute -right-12 -top-20 h-64 w-64 rounded-full bg-[#5865f2]/20 blur-[90px]" aria-hidden="true" />
              <div className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-[#35c99a]/10 blur-[80px]" aria-hidden="true" />
              <div className="relative flex flex-col gap-7 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-5 sm:gap-7">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.07] text-[#aeb8ff] shadow-inner sm:h-20 sm:w-20">
                    <ArrowDown size={38} strokeWidth={2.5} aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#c5cbff]">A lighter Discord experience</p>
                    <h3 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">Up to 95% less resource use*</h3>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/70 sm:text-base">
                      Uses less CPU and RAM than the standard Discord app, so more of your device stays available for you.
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 pl-[5.25rem] md:pl-0">
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/15 px-3 py-2 text-sm font-semibold text-white/85">
                    <Cpu size={16} className="text-[#aeb8ff]" aria-hidden="true" />
                    Less CPU
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/15 px-3 py-2 text-sm font-semibold text-white/85">
                    <MemoryStick size={16} className="text-[#74e0bd]" aria-hidden="true" />
                    Less RAM
                  </span>
                </div>
              </div>
              <p className="relative mt-5 text-xs leading-relaxed text-white/45">
                *Actual resource usage varies by device, settings, and usage. Compared with the standard Discord app.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section id="lightweight" className="w-full px-6 py-20 lg:px-14">
        <div className="relative mx-auto max-w-[1360px] overflow-hidden rounded-[2rem] border border-[#8792ff]/20 bg-gradient-to-br from-[#202b66] via-[#171f49] to-[#111735] p-8 shadow-[0_30px_90px_rgba(4,8,28,0.35)] sm:p-12 lg:p-16">
          <div className="pointer-events-none absolute -right-20 -top-32 h-96 w-96 rounded-full bg-[#5865f2]/20 blur-[100px]" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-40 left-1/4 h-72 w-72 rounded-full bg-[#35c99a]/10 blur-[100px]" aria-hidden="true" />
          <div className="relative grid items-center gap-12 lg:grid-cols-[1fr_auto]">
            <div className="max-w-2xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#aeb8ff]/20 bg-[#5865f2]/15 px-3 py-1.5 text-sm font-semibold text-[#c5cbff]">
                <Sparkles size={16} aria-hidden="true" />
                Your conversations, without the extra load
              </div>
              <h2 className="text-4xl font-black leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">
                Stay connected.
                <span className="block text-[#aeb8ff]">Keep your PC light.</span>
              </h2>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-white/70 sm:text-lg">
                Chat, call, and share your screen in a lighter desktop app made for your everyday conversations.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href="https://github.com/mohamed1232007/Discord-Lite/releases/latest"
                  className="inline-flex items-center justify-center gap-2.5 rounded-full bg-white px-6 py-3.5 text-sm font-bold text-[#23272a] shadow-[0_12px_35px_rgba(255,255,255,0.13)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#f2f3ff] active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none"
                >
                  <Download size={18} aria-hidden="true" />
                  Download for Windows
                </a>
                <button
                  type="button"
                  onClick={handleOpenDiscord}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/[0.04] px-6 py-3.5 text-sm font-bold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-white/10 active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none"
                >
                  Open Discord Lite
                  <ArrowRight size={17} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="relative mx-auto w-full max-w-sm">
              <div className="absolute inset-0 scale-90 rounded-full bg-[#5865f2]/20 blur-3xl" aria-hidden="true" />
              <div className="relative rounded-3xl border border-white/10 bg-[#0c122b]/65 p-6 shadow-2xl backdrop-blur-sm sm:p-7">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/45">Made for the way you chat</p>
                <div className="mt-6 space-y-4">
                  {[
                    { icon: MessageCircle, label: 'Messages', color: 'text-[#aeb8ff]', width: 'w-4/5' },
                    { icon: Mic, label: 'Voice calls', color: 'text-[#74e0bd]', width: 'w-3/5' },
                    { icon: MonitorUp, label: 'Screen sharing', color: 'text-[#f0b8ff]', width: 'w-2/3' },
                  ].map(({ icon: Icon, label, color, width }) => (
                    <div key={label} className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3.5">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] ${color}`}>
                        <Icon size={20} aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white/90">{label}</p>
                        <div className="mt-2 h-1.5 rounded-full bg-white/[0.08]">
                          <div className={`h-full rounded-full bg-gradient-to-r from-[#5865f2] to-[#74e0bd] ${width}`} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex flex-col gap-2 border-t border-white/[0.08] pt-4 text-xs font-medium text-white/50">
                  <span>One app. All your people.</span>
                  <span className="inline-flex items-center gap-1.5 text-[#74e0bd]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#74e0bd]" />
                    Ready when you are
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 px-6 py-6 text-center text-sm text-white/45">
        Discord Lite · Chat, voice, and screen sharing with friends.
      </footer>
    </div>
  );
}
