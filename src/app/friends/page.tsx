'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { UserPlus, Search, Share2, Check, Phone, Mail, QrCode, Sparkles, Trash2, Send, MessageCircle, MessageSquare } from 'lucide-react';
import { getSavedFriends, saveFriends, subscribeToRealtimeSync } from '@/lib/supabase';

export default function FriendsPage() {
  const [friends, setFriends] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [newFriendName, setNewFriendName] = useState('');
  const [newFriendPhone, setNewFriendPhone] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    // Load persistent friends list
    setFriends(getSavedFriends());

    // Subscribe to realtime changes across devices
    const unsubscribe = subscribeToRealtimeSync(() => {
      setFriends(getSavedFriends());
    });

    return () => unsubscribe();
  }, []);

  const filteredFriends = friends.filter(
    (f) =>
      f.name?.toLowerCase().includes(search.toLowerCase()) ||
      (f.phone && f.phone.includes(search))
  );

  const handleAddFriend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFriendName.trim()) return;

    const newFriend = {
      id: `user-${Date.now()}`,
      name: newFriendName.trim(),
      avatar: '👤',
      phone: newFriendPhone.trim() || '+7 (999) 000-00-00',
      email: `${newFriendName.toLowerCase().trim().replace(/\s+/g, '')}@splitit.app`,
      role: 'member' as const,
    };

    const updatedFriends = [newFriend, ...friends];
    setFriends(updatedFriends);
    saveFriends(updatedFriends);

    setNewFriendName('');
    setNewFriendPhone('');
    setShowAddModal(false);
  };

  const handleDeleteFriend = (id: string, name: string) => {
    if (confirm(`Удалить «${name}» из списка друзей?`)) {
      const updated = friends.filter((f) => f.id !== id);
      setFriends(updated);
      saveFriends(updated);
    }
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://splitit.app';
  const inviteLink = `${origin}/auth?invite=friend`;
  const inviteText = `Привет! Добавляйся ко мне в друзья в приложение SplitIT для совместного учета чеков и расходов:`;

  const handleCopyInviteLink = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-md mx-auto px-1 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">Мои друзья и контакты</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            Добавляйте друзей для совместного учета расходов
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(!showAddModal)}
          className="px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-blue-500/20 transition-all active:scale-95"
        >
          <UserPlus className="w-4 h-4" />
          <span>Добавить</span>
        </button>
      </div>

      {/* Invite Link & Share Banner */}
      <div className="stitch-card p-5 bg-gradient-to-br from-indigo-900 to-slate-900 text-white shadow-xl space-y-3 relative overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-300">
              Персональная ссылка-приглашение
            </span>
          </div>
          <QrCode className="w-5 h-5 text-indigo-300" />
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          Отправьте рабочую ссылку через Telegram, WhatsApp или SMS, чтобы друзья могли сразу зайти в ваше событие.
        </p>

        {/* Share buttons grid */}
        <div className="grid grid-cols-3 gap-2 pt-1">
          <a
            href={`https://t.me/share/url?url=${encodeURIComponent(inviteLink)}&text=${encodeURIComponent(inviteText)}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs transition-all"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Telegram</span>
          </a>

          <a
            href={`https://wa.me/?text=${encodeURIComponent(inviteText + ' ' + inviteLink)}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            <span>WhatsApp</span>
          </a>

          <a
            href={`sms:?body=${encodeURIComponent(inviteText + ' ' + inviteLink)}`}
            className="flex items-center justify-center gap-1.5 p-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs transition-all"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>SMS</span>
          </a>
        </div>

        <button
          onClick={handleCopyInviteLink}
          className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-extrabold flex items-center justify-center gap-2 border border-white/20 transition-all"
        >
          <Share2 className="w-4 h-4 text-indigo-300" />
          <span>{copiedLink ? 'Рабочая ссылка скопирована!' : 'Скопировать рабочую ссылку'}</span>
        </button>
      </div>

      {/* Add Friend Form Modal */}
      {showAddModal && (
        <form onSubmit={handleAddFriend} className="stitch-card p-5 space-y-3 border-blue-300 bg-white dark:bg-slate-800 animate-in fade-in duration-200">
          <h4 className="font-extrabold text-slate-900 dark:text-white text-sm">Добавить друга вручную</h4>
          
          <div className="space-y-2">
            <input
              type="text"
              required
              placeholder="Имя и фамилия"
              value={newFriendName}
              onChange={(e) => setNewFriendName(e.target.value)}
              className="w-full h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <input
              type="tel"
              placeholder="+7 (999) 000-00-00"
              value={newFriendPhone}
              onChange={(e) => setNewFriendPhone(e.target.value)}
              className="w-full h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              className="flex-1 h-11 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-sm transition-all"
            >
              Сохранить друга
            </button>
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              className="px-4 h-11 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold"
            >
              Отмена
            </button>
          </div>
        </form>
      )}

      {/* Search Input */}
      <div className="relative flex items-center">
        <Search className="w-4 h-4 absolute left-3.5 text-slate-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Поиск по имени или телефону..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
      </div>

      {/* Friends List Feed */}
      <div className="space-y-2.5">
        {filteredFriends.length === 0 ? (
          <div className="stitch-card p-6 text-center text-slate-500 dark:text-slate-400 text-xs">
            Друзья не найдены. Нажмите «Добавить», чтобы ввести контакты!
          </div>
        ) : (
          filteredFriends.map((friend) => (
            <div key={friend.id} className="stitch-card p-4 flex items-center justify-between bg-white dark:bg-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-lg shadow-xs">
                  {friend.avatar || '👤'}
                </div>
                <div>
                  <h4 className="font-extrabold text-slate-900 dark:text-white text-sm">{friend.name}</h4>
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    <span className="flex items-center gap-1 font-medium">
                      <Phone className="w-3 h-3 text-slate-400" />
                      {friend.phone || '+7 (999) 000-00-00'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 rounded-lg">
                  Активен
                </span>
                <button
                  type="button"
                  onClick={() => handleDeleteFriend(friend.id, friend.name)}
                  className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-all"
                  title="Удалить из друзей"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
