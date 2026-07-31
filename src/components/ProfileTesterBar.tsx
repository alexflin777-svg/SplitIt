'use client';

import { useState, useEffect } from 'react';
import { getLocalSession, saveLocalSession, notifyRealtimeSync, UserProfile } from '@/lib/supabase';
import { UserCheck, Users, RefreshCw } from 'lucide-react';

export const TEST_PROFILES: UserProfile[] = [
  { id: 'user-anastasia', full_name: 'Анастасия', email: 'anastasia@example.com', avatar_url: '👑', preferred_currency: 'RUB', phone: '+7 (999) 111-22-33' },
  { id: 'user-maksim', full_name: 'Максим', email: 'maksim@example.com', avatar_url: '👤', preferred_currency: 'RUB', phone: '+7 (999) 222-33-44' },
  { id: 'user-elena', full_name: 'Елена', email: 'elena@example.com', avatar_url: '👩', preferred_currency: 'RUB', phone: '+7 (999) 333-44-55' },
  { id: 'user-dmitry', full_name: 'Дмитрий', email: 'dmitry@example.com', avatar_url: '👨', preferred_currency: 'RUB', phone: '+7 (999) 444-55-66' },
  { id: 'user-olga', full_name: 'Ольга', email: 'olga@example.com', avatar_url: '👩‍🦰', preferred_currency: 'RUB', phone: '+7 (999) 555-66-77' },
];

export default function ProfileTesterBar({ onProfileChanged }: { onProfileChanged?: (u: UserProfile) => void }) {
  const [currentProfile, setCurrentProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    setCurrentProfile(getLocalSession() || TEST_PROFILES[0]);
  }, []);

  const handleSwitchProfile = (p: UserProfile) => {
    saveLocalSession(p);
    setCurrentProfile(p);
    notifyRealtimeSync();
    if (onProfileChanged) {
      onProfileChanged(p);
    }
    // Dispatch custom event for instant UI update across components
    window.dispatchEvent(new Event('splitit_profile_changed'));
  };

  return (
    <div className="stitch-card p-3 bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white shadow-md space-y-2 border-blue-700/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-extrabold uppercase tracking-wider text-slate-200">
            Быстрое переключение профилей
          </span>
        </div>
        <span className="text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30 px-2 py-0.5 rounded-full">
          Тест 5 участников
        </span>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        {TEST_PROFILES.map((p) => {
          const isSelected = currentProfile?.id === p.id || currentProfile?.email === p.email;
          return (
            <button
              key={p.id}
              onClick={() => handleSwitchProfile(p)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                isSelected
                  ? 'bg-blue-600 text-white border border-blue-400 shadow-sm scale-102'
                  : 'bg-white/10 hover:bg-white/20 text-slate-300 border border-white/10'
              }`}
            >
              <span>{p.avatar_url}</span>
              <span>{p.full_name}</span>
              {isSelected && <UserCheck className="w-3.5 h-3.5 text-blue-200" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
