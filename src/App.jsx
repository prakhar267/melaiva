import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/Shell.jsx";
import { HomePage } from "./pages/HomePage.jsx";
import { MarketplacePage } from "./pages/MarketplacePage.jsx";
import { PlannerPage } from "./pages/PlannerPage.jsx";
import { RequestPage } from "./pages/RequestPage.jsx";
import { DashboardPage } from "./pages/DashboardPage.jsx";
import { VendorOnboardingPage, VendorPage } from "./pages/VendorPage.jsx";
import { AuthPage, LegalPage, NotFoundPage } from "./pages/MiscPages.jsx";

const AdminVendorsPage = lazy(() => import("./pages/AdminVendorsPage.jsx")
  .then((module) => ({ default: module.AdminVendorsPage })));

function AdminRouteFallback() {
  return <div className="admin-page page-surface"><div className="shell admin-route-loading" role="status">Loading secure operations…</div></div>;
}

class AdminRouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="admin-page page-surface">
        <div className="shell admin-access-state">
          <section className="admin-access-card">
            <div className="eyebrow">Staff workspace</div>
            <h1>Operations could not be loaded</h1>
            <p>The secure workspace asset may have changed during a release. Reload to request the current version.</p>
            <div className="admin-access-card__actions">
              <button className="button button--primary" type="button" onClick={() => window.location.reload()}>Reload operations</button>
            </div>
          </section>
        </div>
      </div>
    );
  }
}

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
        <Route path="/admin/vendors" element={<AdminRouteErrorBoundary key={authRevision}><Suspense fallback={<AdminRouteFallback />}><AdminVendorsPage notify={notify} onOpenAuth={() => setOpenAuth(true)} authRevision={authRevision} /></Suspense></AdminRouteErrorBoundary>} />
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
