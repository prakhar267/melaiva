import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/Shell.jsx";
import { HomePage } from "./pages/HomePage.jsx";
import { MarketplacePage } from "./pages/MarketplacePage.jsx";
import { PlannerPage } from "./pages/PlannerPage.jsx";
import { RequestPage } from "./pages/RequestPage.jsx";
import { DashboardPage } from "./pages/DashboardPage.jsx";
import { VendorOnboardingPage, VendorPage } from "./pages/VendorPage.jsx";
import { AuthPage, LegalPage, NotFoundPage } from "./pages/MiscPages.jsx";

function MelaivaApp() {
  const [toast, setToast] = useState(null);
  const [openAuth, setOpenAuth] = useState(false);
  const [authRevision, setAuthRevision] = useState(0);
  const toastTimer = useRef(null);

  const dismissToast = useCallback(() => {
    setToast(null);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  const notify = useCallback((nextToast) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(nextToast);
    toastTimer.current = window.setTimeout(() => setToast(null), 5200);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  return (
    <AppShell toast={toast} dismissToast={dismissToast} openAuth={openAuth} setOpenAuth={setOpenAuth} notify={notify} authRevision={authRevision} onAuthenticated={() => setAuthRevision((value) => value + 1)}>
      <Routes>
        <Route path="/" element={<HomePage notify={notify} />} />
        <Route path="/marketplace" element={<MarketplacePage notify={notify} />} />
        <Route path="/planner" element={<PlannerPage notify={notify} />} />
        <Route path="/request" element={<RequestPage notify={notify} onOpenAuth={() => setOpenAuth(true)} />} />
        <Route path="/dashboard" element={<DashboardPage notify={notify} onOpenAuth={() => setOpenAuth(true)} authRevision={authRevision} />} />
        <Route path="/vendor" element={<VendorPage notify={notify} onOpenAuth={() => setOpenAuth(true)} authRevision={authRevision} />} />
        <Route path="/vendor/onboarding" element={<VendorOnboardingPage notify={notify} onOpenAuth={() => setOpenAuth(true)} />} />
        <Route path="/auth" element={<AuthPage notify={notify} onAuthenticated={() => setAuthRevision((value) => value + 1)} />} />
        <Route path="/privacy" element={<LegalPage type="privacy" />} />
        <Route path="/terms" element={<LegalPage type="terms" />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  return <BrowserRouter><MelaivaApp /></BrowserRouter>;
}
