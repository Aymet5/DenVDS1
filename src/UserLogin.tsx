import React, { useState } from 'react';
import { Shield, Mail, Lock, Key, UserPlus, LogIn } from 'lucide-react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';

export default function UserLogin() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';
      const res = await axios.post(endpoint, { email, password });
      localStorage.setItem('user_token', res.data.token);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.error || (isRegister ? 'Ошибка регистрации' : 'Ошибка входа'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="bg-gray-800 p-8 rounded-2xl shadow-2xl w-full max-w-md border border-gray-700">
        <div className="flex justify-center mb-6">
          <div className="bg-blue-500/20 p-4 rounded-full">
            <Shield className="w-12 h-12 text-blue-400" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-white text-center mb-2">
          {isRegister ? 'Регистрация в DzenVDS' : 'Вход в DzenVDS'}
        </h1>
        <p className="text-gray-400 text-center mb-8 text-sm">Управляйте вашим VPN-соединением</p>
        
        {error && <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded-lg mb-6 text-sm">{error}</div>}
        
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-10 pr-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                placeholder="your@email.com"
              />
            </div>
          </div>
          
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium text-gray-400">Пароль</label>
              {!isRegister && (
                <Link to="/forgot-password" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">Забыли пароль?</Link>
              )}
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg pl-10 pr-4 py-3 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (isRegister ? 'Регистрация...' : 'Вход...') : (isRegister ? 'Зарегистрироваться' : 'Войти')}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => {
              setIsRegister(!isRegister);
              setError('');
            }}
            className="text-blue-400 hover:text-blue-300 transition-colors text-sm flex items-center justify-center gap-2 mx-auto"
          >
            {isRegister ? (
              <>
                <LogIn className="w-4 h-4" />
                Уже есть аккаунт? Войти
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                Нет аккаунта? Зарегистрироваться
              </>
            )}
          </button>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-700 text-center">
          <Link to="/admin" className="text-gray-500 hover:text-gray-300 transition-colors text-sm flex items-center justify-center gap-2">
            <Key className="w-4 h-4" />
            Вход для администратора
          </Link>
        </div>
      </div>
    </div>
  );
}
