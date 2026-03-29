import React, { useState } from 'react';
import { Shield, Mail, ArrowLeft } from 'lucide-react';
import axios from 'axios';
import { Link } from 'react-router-dom';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setMessage('');
    try {
      const res = await axios.post('/api/auth/forgot-password', { email });
      setStatus('success');
      setMessage(res.data.message);
    } catch (err: any) {
      setStatus('error');
      setMessage(err.response?.data?.error || 'Ошибка при отправке');
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
        <h1 className="text-2xl font-bold text-white text-center mb-2">Восстановление пароля</h1>
        <p className="text-gray-400 text-center mb-8 text-sm">Введите ваш Email для получения ссылки</p>
        
        {status === 'error' && <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded-lg mb-6 text-sm">{message}</div>}
        {status === 'success' && <div className="bg-green-500/10 border border-green-500/50 text-green-400 p-3 rounded-lg mb-6 text-sm">{message}</div>}
        
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

          <button 
            type="submit" 
            disabled={status === 'loading'}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {status === 'loading' ? 'Отправка...' : 'Отправить ссылку'}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-gray-700 text-center">
          <Link to="/" className="text-gray-500 hover:text-gray-300 transition-colors text-sm flex items-center justify-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Вернуться ко входу
          </Link>
        </div>
      </div>
    </div>
  );
}
