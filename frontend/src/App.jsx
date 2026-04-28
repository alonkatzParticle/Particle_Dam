import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { ApiContext } from './lib/ApiContext'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { AppLayout } from './components/AppLayout'
import LibraryPage      from './pages/LibraryPage'
import UploadPage       from './pages/UploadPage'
import TaggingQueuePage from './pages/TaggingQueuePage'
import UploadQueuePage  from './pages/UploadQueuePage'
import LoginPage        from './pages/LoginPage'
import PendingPage      from './pages/PendingPage'
import AdminUsersPage   from './pages/AdminUsersPage'

// ── Auth guard: wraps all protected routes ────────────────────────────────
function AuthGuard({ children }) {
  const { user } = useAuth()
  const location = useLocation()

  if (user === undefined) {
    // Still checking /auth/me
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: 'var(--background)',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          border: '3px solid var(--sidebar-border)',
          borderTopColor: 'var(--primary)',
          animation: 'spin 0.7s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  if (user.role === 'pending') return <Navigate to="/pending" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/login"   element={<LoginPage />} />
          <Route path="/pending" element={<PendingPage />} />

          {/* Protected routes — wrapped in AppLayout */}
          <Route element={<AuthGuard><AppLayout /></AuthGuard>}>
            {/* Raw Files */}
            <Route path="/raw/library" element={<LibraryPage />} />
            <Route path="/raw/tagging" element={<TaggingQueuePage />} />
            <Route path="/raw/upload"  element={<UploadPage />} />

            {/* Final Assets */}
            <Route path="/ads/library" element={<ApiContext.Provider value="/api/ads"><LibraryPage /></ApiContext.Provider>} />
            <Route path="/ads/tagging" element={<ApiContext.Provider value="/api/ads"><TaggingQueuePage /></ApiContext.Provider>} />

            {/* Brand Kit */}
            <Route path="/brand/library" element={<ApiContext.Provider value="/api/brand"><LibraryPage /></ApiContext.Provider>} />

            {/* Upload approval queue */}
            <Route path="/uploads" element={<UploadQueuePage />} />

            {/* Admin */}
            <Route path="/admin/users" element={<AdminUsersPage />} />

            {/* Redirects */}
            <Route path="/library" element={<Navigate to="/raw/library" replace />} />
            <Route index           element={<Navigate to="/raw/library" replace />} />
            <Route path="*"        element={<Navigate to="/raw/library" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
