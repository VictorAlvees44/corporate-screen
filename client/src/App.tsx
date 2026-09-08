import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AdminPage from './pages/Admin/AdminPage'
import PlayerPage from './pages/Player/PlayerPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        {/* O endereço principal é sempre o player: é o único link que cada
            TV precisa receber. */}
        <Route path="/" element={<PlayerPage />} />
        {/* Compatibilidade para TVs que ainda tenham o endereço antigo salvo.
            Não existe mais uma página independente em /player. */}
        <Route path="/player" element={<Navigate to="/" replace />} />
        {/* O editor visual de layouts deixou de ser uma página separada e agora
            vive dentro do painel admin, na aba "Layouts". */}
        <Route path="/designer" element={<Navigate to="/admin" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
