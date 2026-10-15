import React, { useState } from 'react';
import { KeyRound, CheckCircle2, AlertCircle, ArrowRight, ShieldCheck, X, Copy } from 'lucide-react';
import { useAssessment } from '../../context/AssessmentContext';
import { soundManager } from '../../utils/sound';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const GroupIdEntryModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const { verifyAndClaimGroupToken, createStudentGroupToken, activeGroupToken } = useAssessment();
  const [tokenInput, setTokenInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [copyMsg, setCopyMsg] = useState('');

  const handleCreateGroupId = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setGeneratedCode('');
    setCopyMsg('');
    setIsCreating(true);

    try {
      const result = await createStudentGroupToken();

      if (result.success && result.code) {
        setGeneratedCode(result.code);
        setSuccessMsg(result.message);
        soundManager.playNextStep();
      } else {
        setErrorMsg(result.message);
        soundManager.playClick();
      }
    } catch (error) {
      console.error('[Ruang Misi KPK] Pembuatan ID gagal:', error);
      setErrorMsg('ID gagal dibuat. Periksa koneksi internet lalu coba lagi.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleCopyGeneratedCode = async () => {
    if (!generatedCode) return;

    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopyMsg('ID berhasil disalin. Bagikan kepada anggota kelompok.');
    } catch {
      setCopyMsg('Salin kode berikut secara manual: ' + generatedCode);
    }
  };

  if (!isOpen) return null;


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const trimmed = tokenInput.trim();
    if (!trimmed) {
      setErrorMsg('Masukkan ID Kelompok dari guru atau buat ID otomatis terlebih dahulu.');
      return;
    }

    setIsSubmitting(true);
    const result = await verifyAndClaimGroupToken(trimmed);
    setIsSubmitting(false);

    if (result.success) {
      soundManager.playNextStep();
      setSuccessMsg(result.message);
      setTimeout(() => {
        setTokenInput('');
          onSuccess();
      }, 1000);
    } else {
      soundManager.playClick();
      setErrorMsg(result.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 space-y-6 shadow-2xl border-2 border-[#EAE3D9] animate-in zoom-in-95">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[#EAE3D9] pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-[#FFE082]/30 border border-[#FFE082] flex items-center justify-center text-[#95634F] shrink-0">
              <KeyRound className="w-6 h-6 text-[#FF913D]" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#95634F] block">
                Akses Asesmen Resmi
              </span>
              <h2 className="text-xl sm:text-2xl font-extrabold text-[#3E2723]">
                Masukkan atau Buat ID Kelompok
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#8C7A70] hover:text-[#3E2723] rounded-xl hover:bg-[#FAF8F5] transition-colors cursor-pointer"
            aria-label="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Informational Guidance */}
        <p className="text-xs text-[#5D4E46] leading-relaxed">
          Setiap kelompok memerlukan <strong>ID Kelompok Unik</strong>. Masukkan ID kelompok unik yang sudah dibuat dan diberikan oleh guru sebelum mulai mengerjakan 4 kasus investigasi matematika KPK.
        </p>

        {activeGroupToken && (
          <div className="p-3 bg-[#FAF8F5] border border-[#EAE3D9] rounded-xl text-xs space-y-1">
            <span className="text-[#8C7A70] block">ID Aktif Saat Ini di Perangkat Ini:</span>
            <div className="flex items-center justify-between">
              <span className="font-mono font-extrabold text-sm text-[#95634F]">
                {activeGroupToken.code}
              </span>
              <button
                type="button"
                onClick={() => {
                  setTokenInput(activeGroupToken.code);
                  setErrorMsg('');
                  setSuccessMsg('');
                }}
                className="text-[11px] font-bold text-[#FF913D] hover:underline cursor-pointer"
              >
                Isi kode ini
              </button>
            </div>
          </div>
        )}

        {generatedCode && (
          <div className="p-4 rounded-2xl border-2 border-[#A8D468] bg-[#F4F9E9] space-y-3">
            <div>
              <span className="block text-xs font-bold text-[#4A671E]">
                ID KELOMPOK BERHASIL DIBUAT
              </span>
              <p className="mt-2 font-mono text-2xl font-extrabold tracking-widest text-[#3E2723] break-words">
                {generatedCode}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopyGeneratedCode}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#4A671E] hover:bg-[#3D5718] text-white text-sm font-bold rounded-xl transition-colors cursor-pointer"
            >
              <Copy className="w-4 h-4" />
              Salin ID Kelompok
            </button>
            {copyMsg && (
              <p className="text-xs text-[#4A671E] font-medium">{copyMsg}</p>
            )}
            <p className="text-xs text-[#5D4E46] leading-relaxed">
              Simpan kode ini dan bagikan kepada anggota kelompok. Anggota perlu memasukkan kode yang sama pada perangkat masing-masing.
            </p>
          </div>
        )}
        {/* Feedback Messages */}
        {errorMsg && (
          <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl font-medium animate-in fade-in">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="flex items-start gap-2.5 p-3.5 bg-[#C5E68A]/40 border border-[#A8D468] text-[#2D231E] text-xs rounded-xl font-bold animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-[#4A671E] shrink-0 mt-0.5" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="group-id-code" className="text-xs font-bold text-[#3E2723] block">
              Kode ID Kelompok <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                id="group-id-code"
                type="text"
                value={tokenInput}
                onChange={(e) => {
                  setTokenInput(e.target.value.toUpperCase());
                  setErrorMsg('');
                }}
                placeholder="Contoh: KPK-4A-82"
                className="w-full px-4 py-3 bg-[#FAF8F5] border-2 border-[#D8CFC8] focus:border-[#FF913D] rounded-xl text-base font-mono font-bold tracking-wider text-[#2D231E] placeholder:text-[#A8988F] placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-[#FF913D]/30 transition-all uppercase"
                autoFocus
                disabled={isSubmitting}
              />
              <ShieldCheck className="w-5 h-5 text-[#95634F] absolute right-3.5 top-3.5 pointer-events-none opacity-40" />
            </div>
            <span className="text-[11px] text-[#8C7A70] block">
              *Gunakan ID yang diberikan guru. Setiap ID hanya untuk satu kelompok.
            </span>

          </div>

          <button
            type="button"
            onClick={handleCreateGroupId}
            disabled={isCreating || isSubmitting}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#FFF3E6] hover:bg-[#FFE5CC] disabled:opacity-50 text-[#8A481C] text-sm font-bold rounded-xl border-2 border-[#FFD0A3] transition-colors cursor-pointer"
          >
            <KeyRound className="w-4 h-4" />
            {isCreating ? 'Membuat ID Kelompok...' : 'Buat ID Kelompok'}
          </button>
          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 bg-[#FAF8F5] hover:bg-neutral-100 text-[#3E2723] text-xs font-bold rounded-xl border border-[#EAE3D9] transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-6 py-2.5 bg-[#FF913D] hover:bg-[#F2822B] disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <span>{isSubmitting ? 'Memverifikasi...' : 'Verifikasi & Lanjut'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
