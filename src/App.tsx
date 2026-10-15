import React, { useEffect, useState } from 'react';
import { AssessmentProvider, useAssessment } from './context/AssessmentContext';
import { isTeamIdentityComplete } from './utils/teamIdentity';
import { Navbar } from './components/layout/Navbar';
import { HomeView } from './components/views/HomeView';
import { TrackSelectionView } from './components/views/TrackSelectionView';
import { TeamIdentityView } from './components/views/TeamIdentityView';
import { MissionsHubView } from './components/views/MissionsHubView';
import { MissionDetailView } from './components/views/MissionDetailView';
import { PracticeQuestionsView } from './components/views/PracticeQuestionsView';
import { PresentationView } from './components/views/PresentationView';
import { ReflectionView } from './components/views/ReflectionView';
import { ResultsEvaluationView } from './components/views/ResultsEvaluationView';
import { TeacherDashboardView } from './components/views/TeacherDashboardView';
import { TeacherLoginModal } from './components/modals/TeacherLoginModal';
import { GroupIdEntryModal } from './components/modals/GroupIdEntryModal';
import { soundManager } from './utils/sound';

function MainApp() {
  const {
    isTeacherLoggedIn,
    hasTimeExpired,
    hasVerifiedGroupToken,
    activeSubmission,
    cloudStatus,
    sessionDeletedNotice,
    dismissSessionDeletedNotice,
  } = useAssessment();
  const [currentView, setCurrentView] = useState<string>('beranda');
  const [activeMissionNumber, setActiveMissionNumber] = useState<1 | 2 | 3 | 4>(1);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [isGroupIdModalOpen, setIsGroupIdModalOpen] = useState(false);
  const [identityValidationAttempt, setIdentityValidationAttempt] = useState(0);

  // Halaman yang hanya boleh dibuka siswa yang sudah memverifikasi ID Kelompok.
  const STUDENT_SESSION_VIEWS = ['pintu', 'identitas', 'misi', 'misi-detail', 'presentasi', 'refleksi'];
  // Halaman kelanjutan misi: identitas kelompok wajib lengkap lebih dulu.
  const IDENTITY_REQUIRED_VIEWS = ['misi', 'misi-detail', 'presentasi', 'refleksi'];

  useEffect(() => {
    if (
      !isTeacherLoggedIn &&
      (cloudStatus === 'online' || sessionDeletedNotice) &&
      !hasVerifiedGroupToken &&
      STUDENT_SESSION_VIEWS.includes(currentView)
    ) {
      // Sesi dihapus guru atau ID belum diverifikasi: kembali ke beranda dan minta ID Kelompok.
      setCurrentView('beranda');
      setIsGroupIdModalOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudStatus, currentView, hasVerifiedGroupToken, isTeacherLoggedIn, sessionDeletedNotice]);

  // Penjaga terakhir: apa pun jalur masuknya (menu, tombol, sinkronisasi dari perangkat lain),
  // siswa tidak bisa berada di halaman misi bila identitas kelompok belum lengkap.
  // Setelah waktu habis / dikirim, halaman presentasi dan refleksi tetap bisa dibuka.
  useEffect(() => {
    if (isTeacherLoggedIn || !hasVerifiedGroupToken) return;
    if (!IDENTITY_REQUIRED_VIEWS.includes(currentView)) return;
    const isFinished = hasTimeExpired || activeSubmission.status !== 'in_progress';
    if (['presentasi', 'refleksi'].includes(currentView) && isFinished) return;
    if (!isTeamIdentityComplete(activeSubmission.team)) {
      setCurrentView('identitas');
      setIdentityValidationAttempt((attempt) => attempt + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, activeSubmission.team, activeSubmission.status, hasTimeExpired, hasVerifiedGroupToken, isTeacherLoggedIn]);

  // Pemberitahuan sesi dihapus hilang sendiri begitu siswa memverifikasi ID untuk sesi baru.
  useEffect(() => {
    if (hasVerifiedGroupToken && sessionDeletedNotice) dismissSessionDeletedNotice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasVerifiedGroupToken, sessionDeletedNotice]);

  const returnToIncompleteIdentity = () => {
    setCurrentView('identitas');
    setIdentityValidationAttempt((attempt) => attempt + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleNavigate = (view: string, identityValidated = false) => {
    soundManager.playClick();
    if (view === 'dashboard-guru' && !isTeacherLoggedIn) {
      setIsLoginModalOpen(true);
      return;
    }

    // Section A2: Guard student missions behind verified Group ID
    if (['pintu', 'identitas', 'misi', 'misi-detail'].includes(view) && !hasVerifiedGroupToken) {
      setIsGroupIdModalOpen(true);
      return;
    }
    // Presentasi & refleksi adalah kelanjutan misi: siswa juga harus sudah memverifikasi ID Kelompok.
    // (Guru tetap bisa membukanya untuk melihat/menilai tanpa ID.)
    if (['presentasi', 'refleksi'].includes(view) && !isTeacherLoggedIn && !hasVerifiedGroupToken) {
      setIsGroupIdModalOpen(true);
      return;
    }

    if (
      ['misi', 'misi-detail'].includes(view) &&
      !identityValidated &&
      !isTeamIdentityComplete(activeSubmission.team)
    ) {
      returnToIncompleteIdentity();
      return;
    }
    // Sebelum misi selesai/dikirim, presentasi & refleksi juga menunggu identitas lengkap.
    const sessionFinished = hasTimeExpired || activeSubmission.status !== 'in_progress';
    if (
      ['presentasi', 'refleksi'].includes(view) &&
      !isTeacherLoggedIn &&
      !sessionFinished &&
      !identityValidated &&
      !isTeamIdentityComplete(activeSubmission.team)
    ) {
      returnToIncompleteIdentity();
      return;
    }

    setCurrentView(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectMission = (missionNum: 1 | 2 | 3 | 4) => {
    soundManager.playClick();
    if (!hasVerifiedGroupToken) {
      setIsGroupIdModalOpen(true);
      return;
    }
    if (!isTeamIdentityComplete(activeSubmission.team)) {
      returnToIncompleteIdentity();
      return;
    }
    setActiveMissionNumber(missionNum);
    setCurrentView('misi-detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF8F5] text-[#2D231E]">
      {/* Navbar with 3-Zone Top Bar Contract */}
      <Navbar
        currentView={currentView}
        onNavigate={handleNavigate}
        onOpenTeacherLogin={() => setIsLoginModalOpen(true)}
      />

      {sessionDeletedNotice && (
        <div role="alert" className="w-full max-w-4xl mx-auto px-4 sm:px-6 pt-4">
          <div className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
            <span>
              Sesi kelompok ini telah dihapus oleh guru. Progres lama tidak dipulihkan. Masukkan ID Kelompok untuk memulai sesi baru.
            </span>
            <button
              type="button"
              onClick={dismissSessionDeletedNotice}
              className="shrink-0 font-bold underline cursor-pointer"
            >
              Tutup
            </button>
          </div>
        </div>
      )}

      {/* Main View Area */}
      <main className="flex-1 pb-16">
        {currentView === 'beranda' && <HomeView onNavigate={handleNavigate} />}
        {currentView === 'pintu' && <TrackSelectionView onNavigate={handleNavigate} />}
        {currentView === 'identitas' && (
          <TeamIdentityView
            onNavigate={handleNavigate}
            validationAttempt={identityValidationAttempt}
          />
        )}
        {currentView === 'misi' && (
          <MissionsHubView
            onNavigate={handleNavigate}
            onSelectMission={handleSelectMission}
          />
        )}
        {currentView === 'misi-detail' && (
          <MissionDetailView
            missionNumber={activeMissionNumber}
            onNavigate={handleNavigate}
            onSelectMission={handleSelectMission}
          />
        )}
        {currentView === 'latihan' && (
          <PracticeQuestionsView onNavigate={handleNavigate} />
        )}
        {currentView === 'presentasi' && <PresentationView onNavigate={handleNavigate} />}
        {currentView === 'refleksi' && <ReflectionView onNavigate={handleNavigate} />}
        {currentView === 'evaluasi' && <ResultsEvaluationView onNavigate={handleNavigate} />}
        {currentView === 'dashboard-guru' && (
          <TeacherDashboardView onNavigate={handleNavigate} />
        )}
      </main>

      {/* Clean Educational Footer */}
      <footer className="border-t border-[#EAE3D9] bg-white py-8 text-xs text-[#6D5A50]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded bg-[#95634F] text-[#FFE082] flex items-center justify-center font-bold text-xs">
              KPK
            </div>
            <div>
              <span className="font-bold text-[#3E2723]">Ruang Misi KPK</span>
              <span className="text-[#8C7A70] ml-2">· Asesmen Formatif Matematika Kelas V SD/MI</span>
            </div>
          </div>

          <div className="text-center sm:text-right text-[#8C7A70]">
            Problem Based Learning (PBL) · Teaching at the Right Level (TaRL) · 4 Tahap Polya · 25 Menit Investigasi
          </div>
        </div>
      </footer>

      {/* Teacher Login Modal */}
      <TeacherLoginModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
        onSuccess={() => {
          setIsLoginModalOpen(false);
          setCurrentView('dashboard-guru');
        }}
      />

      {/* Section A2: Group ID Entry Modal */}
      <GroupIdEntryModal
        isOpen={isGroupIdModalOpen}
        onClose={() => setIsGroupIdModalOpen(false)}
        onSuccess={() => {
          setIsGroupIdModalOpen(false);
          setCurrentView('identitas');
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <AssessmentProvider>
      <MainApp />
    </AssessmentProvider>
  );
}
