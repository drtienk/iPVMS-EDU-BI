import { Routes, Route, Navigate } from 'react-router-dom';
import { RefreshProvider } from './contexts/RefreshContext';
import { Header } from './components/Header';
import { Page0 } from './pages/Page0';
import { Page1 } from './pages/Page1';
import { Page2 } from './pages/Page2';
import { Page3 } from './pages/Page3';
import { Page4 } from './pages/Page4';
import { Page5 } from './pages/Page5';

function App() {
  return (
    <RefreshProvider>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Navigate to="/page0" replace />} />
          <Route path="/page0" element={<Page0 />} />
          <Route path="/page1" element={<Page1 />} />
          <Route path="/page2" element={<Page2 />} />
          <Route path="/page3" element={<Page3 />} />
          <Route path="/page4" element={<Page4 />} />
          <Route path="/page5" element={<Page5 />} />
          <Route path="*" element={<Navigate to="/page0" replace />} />
        </Routes>
      </main>
    </RefreshProvider>
  );
}

export default App;
