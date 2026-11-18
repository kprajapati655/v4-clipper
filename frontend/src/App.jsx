import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import Dashboard from './pages/Dashboard';
import Editor from './pages/Editor';
import { Sparkles, Video } from 'lucide-react';
import './App.css';

function App() {
  return (
    <Router>
      <div className="app-container">
        {/* Navigation Bar */}
        <nav className="navbar">
          <div className="container nav-content">
            <Link to="/" className="logo">
              <span className="logo-symbol">V4</span>
              <span className="logo-text">Clipper</span>
            </Link>

            <div className="nav-links">
              <Link to="/" className="nav-link">Home</Link>
              <Link to="/dashboard" className="nav-link">Dashboard</Link>
              <Link to="/dashboard" className="btn-pill btn-primary btn-nav">
                <Sparkles size={14} />
                <span>New Short</span>
              </Link>
            </div>
          </div>
        </nav>

        {/* Main Content Area */}
        <main>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/editor/:projectId" element={<Editor />} />
          </Routes>
        </main>

        {/* Professional Footer */}
        <footer className="footer">
          <div className="container footer-content">
            <div className="footer-brand">
              <div className="footer-logo">V4 Clipper</div>
              <p>Professional Open-Source AI Video Clipping Platform. 100% Free.</p>
            </div>
            <div className="footer-bottom">
              <p>Built from ideas, driven by ambition, and made to turn vision into reality.</p>
            </div>
          </div>
        </footer>
      </div>
    </Router>
  );
}

export default App;
