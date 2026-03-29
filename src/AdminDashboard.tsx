import React, { useState, useEffect } from 'react';
import { Users, Ticket, Trash2, Plus, Shield, Search, Activity, Clock, Send, RefreshCw, CalendarPlus, MessageSquare, CreditCard, CheckCircle, LogOut } from 'lucide-react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

export default function AdminDashboard() {
  const [password, setPassword] = useState(localStorage.getItem('admin_pass') || '');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginError, setLoginError] = useState('');
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'users' | 'promos' | 'withdrawals'>('users');
  const [users, setUsers] = useState<any[]>([]);
  const [promos, setPromos] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterPaid, setFilterPaid] = useState(false);
  
  const [messageModal, setMessageModal] = useState<{isOpen: boolean, userId: string | string[], message: string}>({
    isOpen: false,
    userId: '',
    message: ''
  });
  const [addDaysModal, setAddDaysModal] = useState<{isOpen: boolean, userId: string | string[], days: number}>({
    isOpen: false,
    userId: '',
    days: 30
  });
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [notification, setNotification] = useState<{text: string, type: 'success'|'error'} | null>(null);
  const [deletePromoModal, setDeletePromoModal] = useState<string | null>(null);

  const [isSyncing, setIsSyncing] = useState(false);

  const DEFAULT_INSTRUCTION = `📱 *Инструкция по подключению VPN*\n\n1. Скачайте приложение *V2Ray* или *v2rayNG* (для Android) / *V2Ray Tun* или *Streisand* (для iOS).\n2. Скопируйте ваш VPN конфиг (начинается с vless://).\n3. Откройте приложение и нажмите кнопку "+" (Добавить из буфера обмена).\n4. Нажмите кнопку подключения (обычно круглая кнопка внизу).\n\nЕсли у вас возникли проблемы, напишите в поддержку!`;
  
  // Promo code form
  const [newPromoCode, setNewPromoCode] = useState('');
  const [newPromoDays, setNewPromoDays] = useState(7);
  const [newPromoUses, setNewPromoUses] = useState(10);

  useEffect(() => {
    axios.defaults.headers.common['Authorization'] = password;
    if (password) {
      fetchData();
    }
  }, [activeTab, password]);

  const fetchData = async () => {
    try {
      if (activeTab === 'users') {
        const res = await axios.get('/api/users');
        setUsers(res.data);
      } else if (activeTab === 'promos') {
        const res = await axios.get('/api/promos');
        setPromos(res.data);
      } else if (activeTab === 'withdrawals') {
        const res = await axios.get('/api/withdrawals');
        setWithdrawals(res.data);
      }
      setIsAuthenticated(true);
      setLoginError('');
    } catch (e: any) {
      console.error('Failed to fetch data', e);
      if (e.response?.status === 401) {
        setIsAuthenticated(false);
        setLoginError('Неверный пароль');
      }
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('admin_pass', password);
    axios.defaults.headers.common['Authorization'] = password;
    fetchData();
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_pass');
    setIsAuthenticated(false);
    setPassword('');
    navigate('/');
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
        <form onSubmit={handleLogin} className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 max-w-sm w-full">
          <div className="flex justify-center mb-6">
            <div className="bg-indigo-600 p-3 rounded-xl">
              <Shield className="w-8 h-8 text-white" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-center text-slate-800 mb-6">Вход в панель</h2>
          {loginError && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm mb-4 text-center">
              {loginError}
            </div>
          )}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль администратора"
            className="w-full px-4 py-3 border border-slate-200 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit"
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-xl transition-colors"
          >
            Войти
          </button>
        </form>
      </div>
    );
  }

  const handleCreatePromo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPromoCode) return;
    try {
      await axios.post('/api/promos', {
        code: newPromoCode,
        days: newPromoDays,
        maxUses: newPromoUses
      });
      setNewPromoCode('');
      setNotification({ text: 'Промокод успешно создан!', type: 'success' });
      setTimeout(() => setNotification(null), 3000);
      fetchData();
    } catch (e: any) {
      console.error('Failed to create promo', e);
      setNotification({ text: `Ошибка: ${e?.response?.data?.error || e.message || 'Не удалось создать промокод'}`, type: 'error' });
      setTimeout(() => setNotification(null), 5000);
    }
  };

  const confirmDeletePromo = async () => {
    if (!deletePromoModal) return;
    try {
      await axios.delete(`/api/promos/${deletePromoModal}`);
      fetchData();
      setDeletePromoModal(null);
      setNotification({ text: 'Промокод удален', type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    } catch (e: any) {
      console.error('Failed to delete promo', e);
      setNotification({ text: `Ошибка: ${e?.response?.data?.error || e.message || 'Не удалось удалить промокод'}`, type: 'error' });
      setTimeout(() => setNotification(null), 5000);
    }
  };

  const openMessageModal = (userId: string) => {
    setMessageModal({
      isOpen: true,
      userId,
      message: DEFAULT_INSTRUCTION
    });
  };

  const openAddDaysModal = (userId: string) => {
    setAddDaysModal({
      isOpen: true,
      userId,
      days: 30
    });
  };

  const handleSendMessage = async () => {
    try {
      if (Array.isArray(messageModal.userId)) {
        const res = await axios.post('/api/users/bulk/send-message', {
          userIds: messageModal.userId,
          message: messageModal.message
        });
        setNotification({ text: `Успешно отправлено: ${res.data.successCount}, Ошибок: ${res.data.failCount}`, type: 'success' });
        setSelectedUsers([]);
      } else {
        await axios.post(`/api/users/${messageModal.userId}/send-message`, {
          message: messageModal.message
        });
        setNotification({ text: 'Сообщение успешно отправлено!', type: 'success' });
      }
      setMessageModal({ isOpen: false, userId: '', message: '' });
      setTimeout(() => setNotification(null), 3000);
    } catch (e) {
      console.error('Failed to send message', e);
      setNotification({ text: 'Ошибка при отправке.', type: 'error' });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  const handleAddDays = async () => {
    try {
      if (Array.isArray(addDaysModal.userId)) {
        const res = await axios.post('/api/users/bulk/add-days', {
          userIds: addDaysModal.userId,
          days: addDaysModal.days
        });
        setNotification({ text: `Успешно добавлено: ${res.data.successCount}, Ошибок: ${res.data.failCount}`, type: 'success' });
        setSelectedUsers([]);
      } else {
        await axios.post(`/api/users/${addDaysModal.userId}/add-days`, {
          days: addDaysModal.days
        });
        setNotification({ text: `Успешно добавлено ${addDaysModal.days} дней!`, type: 'success' });
      }
      setAddDaysModal({ isOpen: false, userId: '', days: 30 });
      fetchData(); // Refresh the list
      setTimeout(() => setNotification(null), 3000);
    } catch (e) {
      console.error('Failed to add days', e);
      setNotification({ text: 'Ошибка при добавлении дней.', type: 'error' });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  const handleSyncWithPanel = async () => {
    if (!confirm('Запустить синхронизацию с 3x-ui? Это обновит лимиты и сроки действия всех пользователей в панели.')) return;
    setIsSyncing(true);
    try {
      const res = await axios.post('/api/sync');
      setNotification({ 
        text: `Синхронизация завершена! Обновлено: ${res.data.syncedCount}, Восстановлено: ${res.data.createdCount}, Ошибок: ${res.data.errorCount}`, 
        type: 'success' 
      });
      setTimeout(() => setNotification(null), 5000);
      fetchData();
    } catch (e) {
      console.error('Failed to sync', e);
      setNotification({ text: 'Ошибка при синхронизации с 3x-ui.', type: 'error' });
      setTimeout(() => setNotification(null), 3000);
    } finally {
      setIsSyncing(false);
    }
  };

  const filteredUsers = users.filter(u => {
    const matchesSearch = u.telegram_id.toString().includes(searchQuery) || 
      (u.username && u.username.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesPaid = filterPaid ? (u.total_spent > 0) : true;
    return matchesSearch && matchesPaid;
  });

  const toggleSelectAll = () => {
    if (selectedUsers.length === filteredUsers.length && filteredUsers.length > 0) {
      setSelectedUsers([]);
    } else {
      setSelectedUsers(filteredUsers.map(u => u.telegram_id.toString()));
    }
  };

  const toggleSelectUser = (id: string) => {
    if (selectedUsers.includes(id)) {
      setSelectedUsers(selectedUsers.filter(uId => uId !== id));
    } else {
      setSelectedUsers([...selectedUsers, id]);
    }
  };

  const handleCompleteWithdrawal = async (id: number) => {
    if (!confirm('Подтвердить выполнение заявки на вывод? Это отправит уведомление пользователю.')) return;
    try {
      await axios.post(`/api/withdrawals/${id}/complete`);
      setNotification({ text: 'Заявка выполнена!', type: 'success' });
      fetchData();
    } catch (e) {
      console.error('Failed to complete withdrawal', e);
      setNotification({ text: 'Ошибка при выполнении заявки.', type: 'error' });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <div className="bg-indigo-600 p-2 rounded-lg">
                <Shield className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-xl font-bold text-slate-800 tracking-tight">ДзенVPN Панель</h1>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-sm text-slate-500 flex items-center gap-1">
                <Activity className="w-4 h-4 text-emerald-500" />
                Бот активен
              </div>
              <button onClick={handleLogout} className="text-sm text-slate-500 hover:text-slate-700 font-medium">
                Выйти
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex items-center gap-4">
            <div className="bg-blue-50 p-4 rounded-xl text-blue-600">
              <Users className="w-8 h-8" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Всего пользователей</p>
              <p className="text-3xl font-bold text-slate-800">{users.length || '-'}</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex items-center gap-4">
            <div className="bg-emerald-50 p-4 rounded-xl text-emerald-600">
              <Activity className="w-8 h-8" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Активные подписки</p>
              <p className="text-3xl font-bold text-slate-800">
                {users.filter(u => new Date(u.subscription_ends_at) > new Date()).length || '-'}
              </p>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 flex items-center gap-4">
            <div className="bg-purple-50 p-4 rounded-xl text-purple-600">
              <Ticket className="w-8 h-8" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">Активные промокоды</p>
              <p className="text-3xl font-bold text-slate-800">{promos.length || '-'}</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex space-x-1 bg-slate-200/50 p-1 rounded-xl w-max mb-6">
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'users' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users className="w-4 h-4" />
            Пользователи
          </button>
          <button
            onClick={() => setActiveTab('promos')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'promos' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Ticket className="w-4 h-4" />
            Промокоды
          </button>
          <button
            onClick={() => setActiveTab('withdrawals')}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'withdrawals' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            Выводы
          </button>
        </div>

        {/* Content */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {activeTab === 'users' && (
            <div>
              <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
                <div className="flex items-center gap-4">
                  <h2 className="text-lg font-semibold text-slate-800">Список пользователей</h2>
                  <button
                    onClick={handleSyncWithPanel}
                    disabled={isSyncing}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                    {isSyncing ? 'Синхронизация...' : 'Синхронизировать с 3x-ui'}
                  </button>
                </div>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer hover:text-slate-900 transition-colors">
                    <input 
                      type="checkbox" 
                      checked={filterPaid} 
                      onChange={(e) => setFilterPaid(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    Только оплатившие
                  </label>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Поиск по ID или @username..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent w-64"
                    />
                  </div>
                </div>
              </div>
              
              {selectedUsers.length > 0 && (
                <div className="bg-indigo-50 border-b border-indigo-100 p-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-indigo-800">
                    Выбрано пользователей: {selectedUsers.length}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAddDaysModal({ isOpen: true, userId: selectedUsers, days: 30 })}
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-indigo-200 hover:bg-indigo-100 text-indigo-700 text-sm font-medium rounded-lg transition-colors"
                    >
                      <Clock className="w-4 h-4" />
                      Продлить всем
                    </button>
                    <button
                      onClick={() => setMessageModal({ isOpen: true, userId: selectedUsers, message: '' })}
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-indigo-200 hover:bg-indigo-100 text-indigo-700 text-sm font-medium rounded-lg transition-colors"
                    >
                      <MessageSquare className="w-4 h-4" />
                      Отправить сообщение
                    </button>
                    <button
                      onClick={() => setSelectedUsers([])}
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-600 text-sm font-medium rounded-lg transition-colors ml-2"
                    >
                      Отменить
                    </button>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 font-medium w-12">
                        <input 
                          type="checkbox" 
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          checked={selectedUsers.length === filteredUsers.length && filteredUsers.length > 0}
                          onChange={toggleSelectAll}
                        />
                      </th>
                      <th className="px-6 py-4 font-medium">ID / Username</th>
                      <th className="px-6 py-4 font-medium">Пригласил</th>
                      <th className="px-6 py-4 font-medium">Статус подписки</th>
                      <th className="px-6 py-4 font-medium">Лимит устр.</th>
                      <th className="px-6 py-4 font-medium">Потрачено</th>
                      <th className="px-6 py-4 font-medium">VPN Конфиг</th>
                      <th className="px-6 py-4 font-medium text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredUsers.map((user) => {
                      const isExpired = new Date(user.subscription_ends_at) < new Date();
                      const isSelected = selectedUsers.includes(user.telegram_id.toString());
                      return (
                        <tr key={user.id} className={`transition-colors ${isSelected ? 'bg-indigo-50/50 hover:bg-indigo-50' : 'hover:bg-slate-50/50'}`}>
                          <td className="px-6 py-4">
                            <input 
                              type="checkbox" 
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                              checked={isSelected}
                              onChange={() => toggleSelectUser(user.telegram_id.toString())}
                            />
                          </td>
                          <td className="px-6 py-4">
                            <div className="font-medium text-slate-900">{user.telegram_id}</div>
                            <div className="text-slate-500">{user.username ? `@${user.username}` : 'Нет username'}</div>
                          </td>
                          <td className="px-6 py-4 text-slate-600">
                            {user.inviter_id ? (
                              <span className="text-indigo-600 font-medium">{user.inviter_id}</span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${isExpired ? 'bg-red-500' : 'bg-emerald-500'}`} />
                              <span className={isExpired ? 'text-red-600' : 'text-emerald-600'}>
                                {new Date(user.subscription_ends_at).toLocaleDateString('ru-RU')}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-slate-600">{user.connection_limit}</td>
                          <td className="px-6 py-4 font-medium text-slate-700">{user.total_spent} ₽</td>
                          <td className="px-6 py-4">
                            {user.vpn_config ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                Выдан
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                                Нет
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => openAddDaysModal(user.telegram_id)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 text-xs font-medium rounded-lg transition-colors"
                                title="Продлить подписку"
                              >
                                <CalendarPlus className="w-3.5 h-3.5" />
                                Продлить
                              </button>
                              <button
                                onClick={() => openMessageModal(user.telegram_id)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs font-medium rounded-lg transition-colors"
                                title="Написать сообщение"
                              >
                                <Send className="w-3.5 h-3.5" />
                                Написать
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredUsers.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                          Пользователи не найдены
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'promos' && (
            <div className="flex flex-col md:flex-row">
              {/* Create Promo Form */}
              <div className="w-full md:w-1/3 border-r border-slate-200 p-6 bg-slate-50/30">
                <h2 className="text-lg font-semibold text-slate-800 mb-4">Создать промокод</h2>
                <form onSubmit={handleCreatePromo} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Код</label>
                    <input
                      type="text"
                      required
                      value={newPromoCode}
                      onChange={(e) => setNewPromoCode(e.target.value.toUpperCase())}
                      placeholder="Например: SUMMER2026"
                      className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Дней</label>
                      <input
                        type="number"
                        min="1"
                        required
                        value={newPromoDays}
                        onChange={(e) => setNewPromoDays(parseInt(e.target.value))}
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Макс. активаций</label>
                      <input
                        type="number"
                        min="1"
                        required
                        value={newPromoUses}
                        onChange={(e) => setNewPromoUses(parseInt(e.target.value))}
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Создать
                  </button>
                </form>
              </div>

              {/* Promos List */}
              <div className="w-full md:w-2/3">
                <div className="p-4 border-b border-slate-200 bg-slate-50/50">
                  <h2 className="text-lg font-semibold text-slate-800">Активные промокоды</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4 font-medium">Код</th>
                        <th className="px-6 py-4 font-medium">Бонус</th>
                        <th className="px-6 py-4 font-medium">Использования</th>
                        <th className="px-6 py-4 font-medium text-right">Действия</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {promos.map((promo) => (
                        <tr key={promo.code} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4 font-mono font-medium text-indigo-600">{promo.code}</td>
                          <td className="px-6 py-4">
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                              <Clock className="w-3 h-3" />
                              +{promo.days} дней
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-full bg-slate-200 rounded-full h-2 max-w-[100px]">
                                <div 
                                  className="bg-indigo-600 h-2 rounded-full" 
                                  style={{ width: `${Math.min(100, (promo.current_uses / promo.max_uses) * 100)}%` }}
                                ></div>
                              </div>
                              <span className="text-xs text-slate-500 font-medium">
                                {promo.current_uses} / {promo.max_uses}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => setDeletePromoModal(promo.code)}
                              className="text-red-500 hover:text-red-700 p-2 hover:bg-red-50 rounded-lg transition-colors"
                              title="Удалить"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      {promos.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center text-slate-500">
                            Нет активных промокодов
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'withdrawals' && (
            <div>
              <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
                <h2 className="text-lg font-semibold text-slate-800">Заявки на вывод</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-600">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                    <tr>
                      <th className="px-6 py-4">ID</th>
                      <th className="px-6 py-4">Пользователь</th>
                      <th className="px-6 py-4">Сумма</th>
                      <th className="px-6 py-4">Реквизиты</th>
                      <th className="px-6 py-4">Статус</th>
                      <th className="px-6 py-4">Дата</th>
                      <th className="px-6 py-4 text-right">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {withdrawals.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                          Нет заявок на вывод
                        </td>
                      </tr>
                    ) : (
                      withdrawals.map((w) => (
                        <tr key={w.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4 font-mono text-xs">{w.id}</td>
                          <td className="px-6 py-4 font-medium text-slate-900">{w.user_id}</td>
                          <td className="px-6 py-4 font-bold text-emerald-600">{w.amount} ₽</td>
                          <td className="px-6 py-4">
                            <div className="max-w-xs truncate" title={w.details}>
                              {w.details}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              w.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              {w.status === 'pending' ? 'Ожидает' : 'Выполнено'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-slate-500">
                            {new Date(w.created_at).toLocaleString('ru-RU')}
                          </td>
                          <td className="px-6 py-4 text-right">
                            {w.status === 'pending' && (
                              <button
                                onClick={() => handleCompleteWithdrawal(w.id)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-lg text-sm font-medium transition-colors"
                              >
                                <CheckCircle className="w-4 h-4" />
                                Выполнить
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Message Modal */}
      {messageModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
            <h3 className="text-lg font-bold text-slate-800 mb-4">
              {Array.isArray(messageModal.userId) 
                ? `Отправить сообщение (${messageModal.userId.length} пользователей)` 
                : 'Отправить сообщение пользователю'}
            </h3>
            <textarea
              value={messageModal.message}
              onChange={(e) => setMessageModal({ ...messageModal, message: e.target.value })}
              className="w-full h-48 px-4 py-3 border border-slate-200 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              placeholder="Введите текст сообщения (поддерживается Markdown)..."
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setMessageModal({ isOpen: false, userId: '', message: '' })}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleSendMessage}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                Отправить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Days Modal */}
      {addDaysModal.isOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-bold text-slate-800 mb-4">
              {Array.isArray(addDaysModal.userId) 
                ? `Продлить подписку (${addDaysModal.userId.length} пользователей)` 
                : 'Продлить подписку'}
            </h3>
            <p className="text-sm text-slate-600 mb-4">
              {Array.isArray(addDaysModal.userId) 
                ? `Укажите количество дней для добавления выбранным пользователям. Это автоматически обновит дату в базе и в панели 3x-ui.` 
                : `Укажите количество дней для добавления пользователю ${addDaysModal.userId}. Это автоматически обновит дату в базе и в панели 3x-ui.`}
            </p>
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Количество дней
              </label>
              <input
                type="number"
                min="1"
                value={addDaysModal.days}
                onChange={(e) => setAddDaysModal({ ...addDaysModal, days: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setAddDaysModal({ isOpen: false, userId: '', days: 30 })}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleAddDays}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <CalendarPlus className="w-4 h-4" />
                Продлить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Promo Modal */}
      {deletePromoModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 text-center">
            <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-800 mb-2">Удалить промокод?</h3>
            <p className="text-slate-500 mb-6">Вы уверены, что хотите удалить промокод <b>{deletePromoModal}</b>? Это действие нельзя отменить.</p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setDeletePromoModal(null)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-medium transition-colors w-full"
              >
                Отмена
              </button>
              <button
                onClick={confirmDeletePromo}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors w-full"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notification Toast */}
      {notification && (
        <div className={`fixed bottom-4 right-4 px-6 py-3 rounded-xl shadow-lg text-white font-medium z-50 transition-all ${
          notification.type === 'success' ? 'bg-emerald-500' : 'bg-red-500'
        }`}>
          {notification.text}
        </div>
      )}
    </div>
  );
}
