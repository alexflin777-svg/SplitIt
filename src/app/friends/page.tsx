'use client';

import { useState, useEffect } from 'react';
import { UserPlus, Search, Phone, Info, Trash2 } from 'lucide-react';
import { getSavedFriends, saveFriends, subscribeToLocalSync } from '@/lib/supabase';
import { useI18n } from '@/lib/i18n/provider';

export default function FriendsPage() {
  const { t } = useI18n();
  const [friends, setFriends] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [newFriendName, setNewFriendName] = useState('');
  const [newFriendPhone, setNewFriendPhone] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [importError, setImportError] = useState('');
  const [isCapacitor, setIsCapacitor] = useState(false);
  useEffect(() => {
    const checkCapacitor = async () => {
      const { Capacitor } = await import('@capacitor/core');
      setIsCapacitor(Capacitor.isNativePlatform());
    };
    checkCapacitor();
  }, []);

  const handleImportContacts = async () => {
    setImportError('');
    try {
      const { Contacts } = await import('@capacitor-community/contacts');
      const permission = await Contacts.requestPermissions();
      if (permission.contacts === 'granted') {
        const result = await Contacts.getContacts({
          projection: { name: true, phones: true }
        });
        const newFriends = result.contacts.map((contact) => ({
          id: crypto.randomUUID(),
          name: contact.name?.display || 'Без имени',
          phone: contact.phones?.[0]?.number || undefined,
          avatar: '👤',
          role: 'member' as const,
        }));
        const updatedFriends = [...newFriends, ...friends];
        const error = saveFriends(updatedFriends);
        if (error) {
          setImportError(error);
        } else {
          setFriends(updatedFriends);
        }
      } else {
        setImportError(t('friends.permissionDenied') || 'Нет доступа к контактам');
      }
    } catch (e: any) {
      setImportError(e.message || 'Failed to import contacts.');
    }
  };

  useEffect(() => {
    // Load persistent friends list
    setFriends(getSavedFriends());

    // Соседняя вкладка этого браузера могла изменить локальный список.
    const unsubscribe = subscribeToLocalSync(() => {
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
      id: crypto.randomUUID(),
      name: newFriendName.trim(),
      avatar: '👤',
      phone: newFriendPhone.trim() || undefined,
      role: 'member' as const,
    };

    const updatedFriends = [newFriend, ...friends];
    const error = saveFriends(updatedFriends);
    if (error) {
      setSaveError(error);
      return;
    }

    setFriends(updatedFriends);
    setSaveError('');
    setNewFriendName('');
    setNewFriendPhone('');
    setShowAddModal(false);
  };

  const handleDeleteFriend = (id: string, name: string) => {
    if (confirm(t('friends.confirmDelete', { name }))) {
      const updated = friends.filter((f) => f.id !== id);
      const error = saveFriends(updated);
      if (error) {
        setSaveError(error);
        return;
      }
      setFriends(updated);
      setSaveError('');
    }
  };

  return (
    <div className="space-y-6 max-w-md mx-auto px-1 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white">{t('friends.title')}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
            {t('friends.subtitle')}
          </p>
        </div>

        <button
          onClick={() => setShowAddModal(!showAddModal)}
          className="px-3.5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-blue-500/20 transition-all active:scale-95"
        >
          <UserPlus className="w-4 h-4" />
          <span>{t('friends.add')}</span>
        </button>

        {isCapacitor && (
          <button
            onClick={handleImportContacts}
            className="px-3.5 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-green-500/20 transition-all active:scale-95"
          >
            <Phone className="w-4 h-4" />
            <span>{t('friends.import')}</span>
          </button>
        )}
      </div>

      <div className="stitch-card p-4 flex items-start gap-3 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900">
        <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          {t('friends.localOnlyNote')}
        </p>
      </div>

      {saveError && (
        <p role="alert" className="text-xs font-semibold text-rose-600 dark:text-rose-400">
          {saveError}
        </p>
      )}

      {/* Add Friend Form Modal */}
      {showAddModal && (
        <form onSubmit={handleAddFriend} className="stitch-card p-5 space-y-3 border-blue-300 bg-white dark:bg-slate-800 animate-in fade-in duration-200">
          <h4 className="font-extrabold text-slate-900 dark:text-white text-sm">{t('friends.addManual')}</h4>
          
          <div className="space-y-2">
            <input
              type="text"
              required
              placeholder={t('friends.fullNamePlaceholder')}
              value={newFriendName}
              onChange={(e) => setNewFriendName(e.target.value)}
              className="w-full h-11 px-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <input
              type="tel"
              placeholder={t('friends.phonePlaceholder')}
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
              {t('friends.save')}
            </button>
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              className="px-4 h-11 rounded-xl bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold"
            >
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {/* Search Input */}
      <div className="relative flex items-center">
        <Search className="w-4 h-4 absolute left-3.5 text-slate-400 pointer-events-none" />
        <input
          type="text"
          placeholder={t('friends.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/30"
        />
      </div>

      {/* Friends List Feed */}
      <div className="space-y-2.5">
        {filteredFriends.length === 0 ? (
          <div className="stitch-card p-6 text-center text-slate-500 dark:text-slate-400 text-xs">
            {t('friends.empty')}
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
                      {friend.phone || t('friends.phoneNotSet')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 px-2.5 py-1 rounded-lg">
                  {t('friends.localContact')}
                </span>
                <button
                  type="button"
                  onClick={() => handleDeleteFriend(friend.id, friend.name)}
                  className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-all"
                  title={t('friends.removeTitle')}
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
