import React, { useState } from 'react';
import { 
  Download, 
  ChevronDown
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import heroImg from '../assets/discord-landing-hero.png';

export default function LandingPage({ onOpenApp, onOpenLogin }) {
  const { user } = useAuth();
  const toast = useToast();

  const handleOpenDiscord = () => {
    if (user) {
      onOpenApp();
    } else {
      onOpenLogin();
    }
  };

  const navLinks = [
    { label: 'Download', href: '#' },
    { label: 'Nitro', href: '#' },
    { label: 'Discover', hasDropdown: true },
    { label: 'Safety', hasDropdown: true },
    { label: 'Quests', hasDropdown: true },
    { label: 'Support', hasDropdown: true },
    { label: 'Blog', hasDropdown: true },
    { label: 'Developers', hasDropdown: true },
    { label: 'Careers', href: '#' },
  ];

  return (
    <div className="min-h-screen w-full bg-[#1b2559] text-white flex flex-col font-sans select-none overflow-x-hidden relative bg-gradient-to-b from-[#0c122b] via-[#141c42] to-[#1a2354]">
      
      {/* ── 1. Top Navbar (طابق 100% مع هيدر الصورة) ── */}
      <header className="w-full max-w-[1440px] mx-auto px-6 lg:px-14 h-20 flex items-center justify-between z-50 relative shrink-0">
        {/* Discord Logo & Brand */}
        <div 
          onClick={handleOpenDiscord}
          className="flex items-center gap-2.5 cursor-pointer transition hover:opacity-95"
        >
          <svg className="w-9 h-9 fill-white" viewBox="0 0 127.14 96.36">
            <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,45.91,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,45.91,96.12,53,91.08,65.69,84.69,65.69Z"/>
          </svg>
          <span className="font-extrabold text-[22px] tracking-tight text-white font-['Ginto',sans-serif]">Discord Lite</span>
        </div>

        {/* Center Nav Links */}
        <nav className="hidden lg:flex items-center gap-7 text-[15px] font-semibold text-white/95">
          {navLinks.map((item) => (
            <div 
              key={item.label}
              className="cursor-pointer hover:underline hover:text-white flex items-center gap-1 transition select-none"
              onClick={() => toast.info('Under development')}
            >
              <span>{item.label}</span>
              {item.hasDropdown && <ChevronDown size={14} className="text-white/80" />}
            </div>
          ))}
        </nav>

        {/* Right CTA Button: Open Discord */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleOpenDiscord}
            className="px-4 py-2 rounded-full bg-white hover:bg-white/95 text-[#23272a] text-sm font-semibold shadow-md transition transform hover:scale-[1.02] active:scale-95 cursor-pointer"
          >
            Open Discord Lite
          </button>
        </div>
      </header>

      {/* ── 2. Hero Section ── */}
      <main className="w-full max-w-[1440px] mx-auto px-6 lg:px-14 flex-1 flex flex-col justify-between pt-4 pb-12 relative z-10">
        
        {/* Main Content Grid: Text on left + Visual Image on right */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 items-center my-auto">
          
          {/* Left Text Column */}
          <div className="lg:col-span-5 flex flex-col gap-6 text-left">
            <h1 className="text-white text-5xl md:text-6xl lg:text-[68px] font-black leading-[0.93] tracking-tighter uppercase drop-shadow-[0_4px_30px_rgba(0,0,0,0.6)]">
              GROUP CHAT<br />
              THAT’S ALL<br />
              FUN & GAMES
            </h1>

            <p className="text-white/90 text-base md:text-lg leading-relaxed font-normal max-w-md">
              Discord Lite is great for playing games and chilling with friends, or even building a worldwide community. Customize your own space to talk, play, and hang out.
            </p>
          </div>

          {/* Right Visual Image Column */}
          <div className="lg:col-span-7 relative flex items-center justify-center">
            <div className="relative w-full max-w-[760px] rounded-2xl overflow-hidden shadow-[0_25px_70px_rgba(0,0,0,0.7)] border border-white/10 group">
              <img 
                src={heroImg} 
                alt="Discord Lite Group Chat" 
                className="w-full h-auto object-cover transform transition duration-500 group-hover:scale-[1.01]" 
              />
            </div>
          </div>

        </div>

        {/* ── 3. Bottom Two Action Buttons (طابق 100% مع الصورة التانية) ── */}
        <div className="flex flex-wrap items-center justify-center gap-4 pt-10">
          {/* 1. White Button: Download for Windows */}
          <button
            type="button"
            onClick={() => toast.info('Under development')}
            className="px-8 py-4 rounded-full bg-white hover:bg-[#f2f3f5] text-[#23272a] font-bold text-base flex items-center gap-3 shadow-xl transition transform hover:scale-[1.03] active:scale-[0.98] cursor-pointer"
          >
            <Download size={22} className="stroke-[2.5]" />
            <span>Download for Windows</span>
          </button>

          {/* 2. Blurple Button: Open Discord In your browser */}
          <button
            type="button"
            onClick={handleOpenDiscord}
            className="px-8 py-4 rounded-full bg-[#5865f2] hover:bg-[#4752c4] text-white font-bold text-base shadow-xl transition transform hover:scale-[1.03] active:scale-[0.98] cursor-pointer"
          >
            <span>Open Discord Lite in your browser</span>
          </button>
        </div>

      </main>

    </div>
  );
}
