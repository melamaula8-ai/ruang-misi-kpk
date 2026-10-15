import React, { useState } from 'react';
import { X, ShieldCheck, Lock, User, AlertCircle } from 'lucide-react';
import { useAssessment } from '../../context/AssessmentContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const TeacherLoginModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const { loginTeacher, customLogoUrl } = useAssessment();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await loginTeacher(username, password);
    if (success) {
      setError('');
      setUsername('');
      setPassword('');
      onSuccess();
      onClose();
    } else {
      setError('Login gagal. Periksa username dan kata sandi, serta pastikan login guru sudah dikonfigurasi di Netlify.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 sm:p-8 space-y-6 shadow-2xl border border-[#EAE3D9] relative animate-in fade-in duration-200">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#8C7A70] hover:text-[#3E2723] p-1.5 rounded-lg hover:bg-neutral-100 transition-colors"
          aria-label="Tutup login"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="space-y-2 text-center">
          <div className="w-16 h-16 rounded-2xl overflow-hidden bg-white mx-auto mb-1 border-2 border-[#FFE082] shadow-sm flex items-center justify-center p-1">
            <img
              src={customLogoUrl || '/app_logo.jpg'}
              alt="Logo Ruang Misi KPK"
              className="w-full h-full object-contain"
            />
          </div>
          <h2 className="text-xl font-bold text-[#3E2723]">Portal Guru & Evaluator</h2>
          <p className="text-xs text-[#6D5A50]">
            Masuk untuk mengakses dashboard pemeriksaan, pengelolaan bank soal, dan publikasi asesmen.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-[#3E2723] block">
              Nama Pengguna (Username)
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-[#8C7A70] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Masukkan username pendidik..."
                className="w-full pl-9 pr-3.5 py-2.5 bg-[#FAF8F5] border border-[#D8CFC8] rounded-xl text-xs font-medium text-[#2D231E] focus:outline-none focus:ring-2 focus:ring-[#FF913D]"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-[#3E2723] block">
              Kata Sandi (Password)
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-[#8C7A70] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Masukkan kata sandi..."
                className="w-full pl-9 pr-3.5 py-2.5 bg-[#FAF8F5] border border-[#D8CFC8] rounded-xl text-xs font-medium text-[#2D231E] focus:outline-none focus:ring-2 focus:ring-[#FF913D]"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-2.5 bg-[#FF913D] hover:bg-[#F2822B] text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            Masuk ke Dashboard Guru
          </button>
        </form>
      </div>
    </div>
  );
};
