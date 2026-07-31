'use client';

import { useState } from 'react';
import Link from 'next/link';
import { INITIAL_MEMBERS } from '@/lib/mock-data';
import { UserPlus, Search, Share2, Check, Phone, Mail, QrCode, Sparkles } from 'lucide-react';

export default function FriendsPage() {
  const [friends, setFriends] = useState(INITIAL_MEMBERS.slice(1));
  const [search, setSearch] = useState('');
  const [newFriendName, setNewFriendName] = useState('');
  const [newFriendPhone, setNewFriendPhone] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const filteredFriends = friends.filter(
    (f) =>
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      f.phone.includes(search)
  );

  const handleAddFriend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFriendName.trim()) return;

    const newFriend = {
      id: `user-${Date.now()}`,
      name: newFriendName,
      avatar: '👤',
      phone: newFriendPhone || '+7 (999) 000-00-00',
      email: `${newFriendName.toLowerCase().replace(/\s+/g, '')}@splitit.app`,
      role: 'member' as const,
    };

    setFriends([...friends, newFriend]);
    setNewFriendName('');
    setNewFriendPhone('');
    setShowAddModal(false);
  };

  const handleCopyInviteLink = () => {
    navigator.clipboard.writeText('https://splitit.app/join/friend-invite');
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900">Мои друзья и контакты</h2>
          <p className="text-xs text-slate-500 font-medium">
            Добавляйте близких для совместного учета расходов
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(!showAddModal)}
          className="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-blue-500/20 transition-all active:scale-95"
        >
          <UserPlus className="w-4 h-4" />
          <span>Добавить</span>
        </button>
      </div>

      {/* Invite Link & QR Banner */}
      <div className="stitch-card p-5 bg-gradient-to-br from-indigo-900 to-slate-900 text-white shadow-xl space-y-3 relative overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-300">
              Персональная инвайт-ссылка
            </span>
          </div>
          <QrCode className="w-5 h-5 text-indigo-300" />
        </div>

        <p className="text-xs text-slate-300">
          Поделитесь ссылкой в Telegram или WhatsApp, чтобы сразу добавить друзей в приложение.
        </p>

        <button
          onClick={handleCopyInviteLink}
          className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold flex items-center justify-center gap-2 transition-all"
        >
          <Share2 className="w-4 h-4" />
          <span>{copiedLink ? 'Ссылка скопирована!' : 'Скопировать инвайт-ссылку'}</span>
        </button>
      </div>

      {/* Add Friend Form Modal */}
      {showAddModal && (
        <form onSubmit={handleAddFriend} className="stitch-card p-5 space-y-3 border-blue-300 bg-blue-50/30 animate-in fade-in duration-200">
          <h4 className="font-bold text-slate-900 text-sm">Добавить нового друга</h4>
          
          <div className="space-y-2">
            <input
              type="text"
              required
              placeholder="Имя и фамилия"
              value={newFriendName}
              onChange={(e) => setNewFriendName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <input
              type="tel"
              placeholder="+7 (999) 000-00-00"
              value={newFriendPhone}
              onChange={(e) => setNewFriendPhone(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm"
            >
              Сохранить
            </button>
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              className="px-4 py-2.5 rounded-xl bg-slate-200 text-slate-700 text-xs font-semibold"
            >
              Отмена
            </button>
          </div>
        </form>
      )}

      {/* Search Input */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
        <input
          type="text"
          placeholder="Поиск по имени или телефону..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
      </div>

      {/* Friends List */}
      <div className="space-y-2.5">
        {filteredFriends.map((friend) => (
          <div key={friend.id} className="stitch-card p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center text-lg shadow-xs">
                {friend.avatar}
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-sm">{friend.name}</h4>
                <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3 text-slate-400" />
                    {friend.phone}
                  </span>
                </div>
              </div>
            </div>

            <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg">
              Активен
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
