import React, { useState, useEffect } from 'react';
import { Shield, Activity, Clock, LogOut, Key, RefreshCw, Send } from 'lucide-react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

export default function UserDashboard() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('user_token');
    if (!token) {
      navigate('/');
      return;
    }

    axios.get('/api/user/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
    .then(res => {
      setUser(res.data);
      setLoading(false);
    })
    .catch(() => {
      localStorage.removeItem('user_token');
      navigate('/');
    });
  }, [navigate]);

  const handleLogout = () => {
    localStorage.removeItem('user_token');
    navigate('/');
  };

  const handleResetVpn = async () => {
    if (user.vpn_config && !window.confirm('Вы уверены, что хотите сбросить VPN конфиг? Старый конфиг перестанет работать.')) return;
    
    setResetting(true);
    try {
      const token = localStorage.getItem('user_token');
      const res = await axios.post('/api/user/reset-vpn', {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUser({ ...user, vpn_config: res.data.config });
      alert(user.vpn_config ? 'VPN конфиг успешно обновлен!' : 'VPN конфиг успешно сгенерирован!');
    } catch (e) {
      alert('Ошибка при генерации конфига');
    } finally {
      setResetting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    const formattedText = text.replace(/\r?\n/g, '\r\n');
    navigator.clipboard.writeText(formattedText);
    alert('Скопировано в буфер обмена!');
  };

  const handleLinkTelegram = async () => {
    try {
      const token = localStorage.getItem('user_token');
      const res = await axios.post('/api/user/sync-telegram', {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      window.open(res.data.link, '_blank');
    } catch (e: any) {
      alert(e.response?.data?.error || 'Ошибка при получении ссылки');
    }
  };

  const handleBuy = async (planId: string) => {
    try {
      const token = localStorage.getItem('user_token');
      const res = await axios.post('/api/user/pay', { plan_id: planId }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      window.location.href = res.data.confirmation_url;
    } catch (e: any) {
      alert(e.response?.data?.error || 'Ошибка при создании платежа');
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-gray-900 flex items-center justify-center text-white">Загрузка...</div>;
  }

  const isExpired = new Date(user.subscription_ends_at) < new Date();
  const isWebOnly = user.telegram_id >= 9000000000;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-3">
            <div className="bg-blue-500/20 p-2 rounded-lg">
              <Shield className="w-8 h-8 text-blue-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">DzenVDS</h1>
          </div>
          <button 
            onClick={handleLogout}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span className="hidden sm:inline">Выйти</span>
          </button>
        </div>

        {isWebOnly && (
          <div className="bg-blue-900/40 border border-blue-500/50 rounded-2xl p-6 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-white mb-1">Привяжите Telegram</h3>
              <p className="text-blue-200 text-sm">Получайте уведомления об окончании подписки и управляйте аккаунтом через удобного бота.</p>
            </div>
            <button 
              onClick={handleLinkTelegram}
              className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium transition-colors whitespace-nowrap"
            >
              Привязать аккаунт
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Subscription Status */}
          <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 shadow-xl">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-400" />
              Статус подписки
            </h2>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center p-4 bg-gray-900/50 rounded-xl">
                <span className="text-gray-400">Статус</span>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${isExpired ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
                  {isExpired ? 'Неактивна' : 'Активна'}
                </span>
              </div>
              
              <div className="flex justify-between items-center p-4 bg-gray-900/50 rounded-xl">
                <span className="text-gray-400">Действует до</span>
                <span className="text-white font-medium">
                  {new Date(user.subscription_ends_at).toLocaleDateString('ru-RU')}
                </span>
              </div>

              <div className="flex justify-between items-center p-4 bg-gray-900/50 rounded-xl">
                <span className="text-gray-400">Лимит устройств</span>
                <span className="text-white font-medium">{user.connection_limit}</span>
              </div>
            </div>
          </div>

          {/* VPN Config */}
          <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700 shadow-xl">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Key className="w-5 h-5 text-blue-400" />
              Ваш VPN ключ
            </h2>
            
            {user.vpn_config ? (
              <div className="space-y-4">
                <div className="p-4 bg-gray-900 rounded-xl border border-gray-700 break-all text-sm font-mono text-gray-300 whitespace-pre-wrap">
                  {user.vpn_config}
                </div>
                <div className="flex gap-3">
                  <button 
                    onClick={() => copyToClipboard(user.vpn_config)}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    Скопировать ключ
                  </button>
                  <button 
                    onClick={handleResetVpn}
                    disabled={resetting}
                    className="bg-gray-700 hover:bg-gray-600 text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                    title="Обновить ключ"
                  >
                    <RefreshCw className={`w-5 h-5 ${resetting ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-400 space-y-4">
                <p>У вас пока нет конфигурации VPN.</p>
                <button 
                  onClick={handleResetVpn}
                  disabled={resetting}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 px-6 rounded-lg transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {resetting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Key className="w-5 h-5" />}
                  Сгенерировать ключ
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Buy Subscription */}
        <div className="mt-6 bg-gray-800 rounded-2xl p-6 border border-gray-700 shadow-xl">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-400" />
            Продлить подписку
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { id: '1', label: '1 месяц', price: 99, desc: 'Базовый тариф' },
              { id: '3', label: '3 месяца', price: 249, desc: 'Экономия 16%' },
              { id: '6', label: '6 месяцев', price: 449, desc: 'Экономия 25%' },
              { id: '12', label: '12 месяцев', price: 799, desc: 'Экономия 33%' },
            ].map(plan => (
              <div key={plan.id} className="bg-gray-900/50 border border-gray-700 rounded-xl p-4 flex flex-col">
                <div className="text-lg font-bold text-white mb-1">{plan.label}</div>
                <div className="text-2xl font-black text-blue-400 mb-2">{plan.price} ₽</div>
                <div className="text-sm text-gray-400 mb-4 flex-1">{plan.desc}</div>
                <button 
                  onClick={() => handleBuy(plan.id)}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg transition-colors"
                >
                  Оплатить
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Instructions */}
        <div className="mt-6 bg-gray-800 rounded-2xl p-6 border border-gray-700 shadow-xl">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Send className="w-5 h-5 text-blue-400" />
            Как подключиться?
          </h2>
          <div className="space-y-4 text-gray-300">
            <p>1. Скачайте приложение <strong>V2Ray Tun</strong> (для iOS/Android) или <strong>v2rayN</strong> (для Windows).</p>
            <p>2. Скопируйте ваш VPN ключ выше.</p>
            <p>3. Откройте приложение и добавьте конфигурацию из буфера обмена.</p>
            <p>4. Нажмите кнопку подключения.</p>
            <p className="text-sm text-gray-400 mt-4">
              Для управления подпиской, оплаты и приглашения друзей используйте нашего Telegram бота: <a href="https://t.me/dzen17_bot" target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">@dzen17_bot</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
