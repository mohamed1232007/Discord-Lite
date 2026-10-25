import React from 'react';
import { 
  Compass, 
  Plus
} from 'lucide-react';
import { useToast } from '../context/ToastContext';

export default function ServerSidebar({ activeTab, setActiveTab }) {
  const toast = useToast();
  return (
    <div className="w-[72px] bg-[#000000] border-r border-[#1e1f22]/40 flex flex-col items-center py-3 gap-2 select-none z-20 shrink-0">
      {/* Discord Home / DMs button */}
      <button 
        type="button"
        onClick={() => setActiveTab('dm')}
        className={`relative group flex items-center justify-center w-12 h-12 rounded-3xl hover:!rounded-2xl transition-all duration-200 cursor-pointer ${
          activeTab === 'dm' ? '!rounded-2xl bg-[#5865f2] text-white' : 'bg-[#111214] hover:bg-[#5865f2] text-[#dbdee1] hover:text-white'
        }`}
        title="Direct Messages"
      >
        <span className={`absolute left-0 w-1 bg-white rounded-r-full transition-all duration-200 ${
          activeTab === 'dm' ? 'h-10' : 'h-0 group-hover:h-5'
        }`} />
        <svg className="w-7 h-7 fill-current" viewBox="0 0 127.14 96.36">
          <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,45.91,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,45.91,96.12,53,91.08,65.69,84.69,65.69Z"/>
        </svg>
      </button>

      <div className="w-8 h-0.5 bg-[#1e1f22] rounded my-1" />

      {/* Buttons */}
      <div className="flex-1 w-full flex flex-col items-center gap-2 overflow-y-auto no-scrollbar">
        {/* Add Server Button */}
        <button 
          type="button"
          onClick={() => toast.info('Under development')}
          className="group flex items-center justify-center w-12 h-12 rounded-3xl hover:!rounded-2xl bg-[#111214] hover:bg-[#23a55a] text-[#23a55a] hover:text-white transition-all duration-200 cursor-pointer"
          title="Add a Server"
        >
          <Plus size={22} />
        </button>

        {/* Explore Button */}
        <button 
          type="button"
          onClick={() => toast.info('Under development')}
          className="group flex items-center justify-center w-12 h-12 rounded-3xl hover:!rounded-2xl bg-[#111214] hover:bg-[#5865f2] text-[#23a55a] hover:text-white transition-all duration-200 cursor-pointer"
          title="Explore Discoverable Servers"
        >
          <Compass size={22} />
        </button>
      </div>
    </div>
  );
}
