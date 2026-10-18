import { BrowserRouter, Routes, Route, NavLink, Link } from 'react-router-dom';
import CreateLink from './pages/CreateLink';
import PayPage from './pages/PayPage';
import Dashboard from './pages/Dashboard';

function NotFound() {
  return (
    <div className="max-w-md mx-auto text-center py-12">
      <h2 className="text-xl font-bold text-gray-900 mb-2">Page not found</h2>
      <Link to="/dashboard" className="text-green-600 hover:underline">Go to dashboard</Link>
    </div>
  );
}

const navClass = ({ isActive }) =>
  `px-2 py-1 rounded ${isActive ? 'text-green-700 font-semibold' : 'text-gray-600 hover:text-gray-900'}`;

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-100">
        <nav className="bg-white shadow-sm">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
            <Link to="/dashboard" className="text-xl font-bold text-green-600">PayLink</Link>
            <div className="flex gap-2">
              <NavLink to="/dashboard" className={navClass}>Dashboard</NavLink>
              <NavLink to="/create" className={navClass}>Create Link</NavLink>
            </div>
          </div>
        </nav>

        <main className="max-w-4xl mx-auto px-4 py-8">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/create" element={<CreateLink />} />
            <Route path="/pay/:slug" element={<PayPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
