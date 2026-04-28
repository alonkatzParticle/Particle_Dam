import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ApiContext } from './lib/ApiContext'
import { AppLayout } from './components/AppLayout'
import LibraryPage from './pages/LibraryPage'
import UploadPage from './pages/UploadPage'
import TaggingQueuePage from './pages/TaggingQueuePage'
import UploadQueuePage from './pages/UploadQueuePage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ONE shared AppLayout — sidebar never remounts on tab switch */}
        <Route element={<AppLayout />}>
          {/* Raw Files — Asset Library backend (port 3001) */}
          <Route path="/raw/library" element={<LibraryPage />} />
          <Route path="/raw/tagging" element={<TaggingQueuePage />} />
          <Route path="/raw/upload"  element={<UploadPage />} />

          {/* Final Assets — Ad Library backend */}
          <Route path="/ads/library" element={<ApiContext.Provider value="/api/ads"><LibraryPage /></ApiContext.Provider>} />
          <Route path="/ads/tagging" element={<ApiContext.Provider value="/api/ads"><TaggingQueuePage /></ApiContext.Provider>} />

          {/* Brand Kit — Graphic assets, 3D models, etc. */}
          <Route path="/brand/library" element={<ApiContext.Provider value="/api/brand"><LibraryPage /></ApiContext.Provider>} />

          {/* Upload approval queue */}
          <Route path="/uploads" element={<UploadQueuePage />} />

          {/* Redirects */}
          <Route path="/library" element={<Navigate to="/raw/library" replace />} />
          <Route index         element={<Navigate to="/raw/library" replace />} />
          <Route path="*"      element={<Navigate to="/raw/library" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
