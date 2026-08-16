import { useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Heart,
  LockKeyhole,
  Menu,
  Sparkles,
  X,
} from "lucide-react";
import { derivePasswordVerifier, normalizeAuthEmail, passwordKdf } from "../security/passwordVerifier.js";

const navItems = [
  { to: "/marketplace", label: "Find vendors" },
  { to: "/planner", label: "AI planner" },
  { to: "/request", label: "Get offers" },
  { to: "/dashboard", label: "My plan" },
];

export function Brand({ inverse = false }) {
  return (
    <Link className={`brand ${inverse ? "brand--inverse" : ""}`} to="/" aria-label="Melaiva home">
      <span className="brand__mark" aria-hidden="true">
        <Sparkles size={17} strokeWidth={1.8} />
      </span>
      <span>Melaiva</span>
    </Link>
  );
}

export function ToastRegion({ toast, onDismiss }) {
  if (!toast) return <div className="toast-region" aria-live="polite" />;
  return (
    <div className="toast-region" aria-live="polite">
      <div className={`toast toast--${toast.type || "success"}`} role="status">
        <span className="toast__icon" aria-hidden="true"><Check size={16} /></span>
        <div>
          <strong>{toast.title}</strong>
          {toast.message && <p>{toast.message}</p>}
        </div>
        <button className="icon-button icon-button--small" onClick={onDismiss} aria-label="Dismiss notification">
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

export function AuthPanel({ compact = false, onSuccess, initialMode = "login" }) {
  const [mode, setMode] = useState(initialMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const headingId = useId();

  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    setLoading(true);
    try {
      const email = normalizeAuthEmail(form.get("email"));
      const passwordVerifier = await derivePasswordVerifier(email, String(form.get("password") || ""));
      const requestBody = {
        email,
        passwordVerifier,
        passwordKdf,
        ...(mode === "register" ? { name: String(form.get("name") || "").trim() } : {}),
      };
      const response = await fetch(`/api/v1/auth/${mode === "login" ? "login" : "register"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const detail = Array.isArray(payload.error?.details)
          ? payload.error.details.map((item) => item.message || item).join(" ")
          : payload.error?.details?.message;
        throw new Error(detail || payload.error?.message || "We couldn't complete that just yet.");
      }
      onSuccess?.(mode);
    } catch (requestError) {
      const isNetworkError = String(requestError?.message || "").toLowerCase().includes("fetch");
      setError(isNetworkError ? "We couldn’t reach Melaiva. Check your connection and try again." : requestError?.message || "Please check your details and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`auth-panel ${compact ? "auth-panel--compact" : ""}`} aria-labelledby={headingId}>
      <div className="eyebrow"><LockKeyhole size={14} /> Your planning space</div>
      <h1 id={headingId}>{mode === "login" ? "Welcome back" : "Start planning beautifully"}</h1>
      <p className="auth-panel__intro">
        {mode === "login"
          ? "Your briefs, offers and decisions are right where you left them."
          : "Create one calm place for every vendor, offer and next step."}
      </p>
      <div className="segmented" aria-label="Authentication mode">
        <button className={mode === "login" ? "is-active" : ""} onClick={() => setMode("login")} type="button">Sign in</button>
        <button className={mode === "register" ? "is-active" : ""} onClick={() => setMode("register")} type="button">Create account</button>
      </div>
      <form className="form-stack" onSubmit={submit}>
        {mode === "register" && (
          <label className="field">
            <span>Your name</span>
            <input name="name" autoComplete="name" placeholder="Aarav Mehta" required />
          </label>
        )}
        <label className="field">
          <span>Email address</span>
          <input name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={12}
            pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{12,}"
            title="Use at least 12 characters with uppercase, lowercase and a number."
            placeholder="At least 12 characters"
            required
          />
          {mode === "register" && <small className="field-hint">12+ characters with uppercase, lowercase and a number.</small>}
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button--primary button--wide" disabled={loading} type="submit">
          {loading ? <span className="button-loader" aria-hidden="true" /> : null}
          {loading ? "One moment…" : mode === "login" ? "Sign in" : "Create my account"}
          {!loading && <ArrowRight size={17} />}
        </button>
      </form>
      <p className="auth-panel__legal">By continuing, you agree to our <Link to="/terms">terms</Link> and <Link to="/privacy">privacy policy</Link>.</p>
    </div>
  );
}

export function AuthModal({ open, onClose, notify }) {
  const dialogRef = useRef(null);
  const firstInputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    document.body.classList.add("modal-open");
    const timer = window.setTimeout(() => {
      firstInputRef.current = dialogRef.current?.querySelector("input");
      firstInputRef.current?.focus();
    }, 30);
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("modal-open");
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-card auth-modal" role="dialog" aria-modal="true" aria-label="Sign in to Melaiva" ref={dialogRef}>
        <button className="icon-button modal-card__close" onClick={onClose} aria-label="Close sign in">
          <X size={20} />
        </button>
        <AuthPanel
          compact
          onSuccess={(mode) => {
            onClose();
            notify({ title: mode === "login" ? "You’re signed in" : "Your account is ready", message: "Welcome to your Melaiva planning space." });
          }}
        />
      </div>
    </div>
  );
}

function Header({ onOpenAuth }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const drawerRef = useRef(null);
  const menuButtonRef = useRef(null);

  useEffect(() => setDrawerOpen(false), [location.pathname]);
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const previous = document.activeElement;
    document.body.classList.add("modal-open");
    const timer = window.setTimeout(() => drawerRef.current?.querySelector('button[aria-label="Close menu"]')?.focus(), 30);
    function onKeyDown(event) {
      if (event.key === "Escape") setDrawerOpen(false);
      if (event.key !== "Tab") return;
      const focusable = drawerRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("modal-open");
      (menuButtonRef.current || previous)?.focus?.();
    };
  }, [drawerOpen]);

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div className="announcement">
        <span>Planning a 2027 celebration?</span>
        <Link to="/request">Request early offers <ArrowRight size={13} /></Link>
      </div>
      <header className="site-header">
        <div className="shell site-header__inner">
          <Brand />
          <nav className="desktop-nav" aria-label="Main navigation">
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? "is-active" : ""}>{item.label}</NavLink>
            ))}
          </nav>
          <div className="site-header__actions">
            <NavLink className="vendor-link" to="/vendor">For vendors</NavLink>
            <button className="button button--small button--outline header-login" onClick={onOpenAuth}>Sign in</button>
            <button ref={menuButtonRef} className="icon-button menu-button" onClick={() => setDrawerOpen(true)} aria-label="Open menu" aria-expanded={drawerOpen}>
              <Menu size={22} />
            </button>
          </div>
        </div>
      </header>
      <div className={`mobile-drawer ${drawerOpen ? "is-open" : ""}`} aria-hidden={!drawerOpen}>
        <button className="mobile-drawer__veil" onClick={() => setDrawerOpen(false)} aria-label="Close menu" tabIndex={drawerOpen ? 0 : -1} />
        <aside ref={drawerRef} className="mobile-drawer__panel" role="dialog" aria-modal="true" aria-label="Mobile navigation">
          <div className="mobile-drawer__top">
            <Brand />
            <button className="icon-button" onClick={() => setDrawerOpen(false)} aria-label="Close menu"><X size={21} /></button>
          </div>
          <nav>
            {navItems.map((item, index) => (
              <NavLink key={item.to} to={item.to} tabIndex={drawerOpen ? 0 : -1}>
                <span>0{index + 1}</span>{item.label}<ArrowRight size={18} />
              </NavLink>
            ))}
            <NavLink to="/vendor" tabIndex={drawerOpen ? 0 : -1}><span>05</span>For vendors<ArrowRight size={18} /></NavLink>
          </nav>
          <div className="mobile-drawer__footer">
            <button className="button button--primary button--wide" onClick={() => { setDrawerOpen(false); onOpenAuth(); }} tabIndex={drawerOpen ? 0 : -1}>Sign in or join</button>
            <p>Plan with clarity. Celebrate with heart.</p>
          </div>
        </aside>
      </div>
    </>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="shell site-footer__main">
        <div className="site-footer__brand">
          <Brand inverse />
          <p>A clearer way to discover, compare and choose celebration professionals across India.</p>
        </div>
        <div className="footer-column">
          <h2>Plan</h2>
          <Link to="/marketplace">Find vendors</Link>
          <Link to="/planner">AI planner</Link>
          <Link to="/request">Request offers</Link>
          <Link to="/dashboard">Planning dashboard</Link>
        </div>
        <div className="footer-column">
          <h2>Partners</h2>
          <Link to="/vendor">Vendor workspace</Link>
          <Link to="/vendor/onboarding">Join Melaiva</Link>
          <Link to="/#contact">Partner support</Link>
        </div>
        <div className="footer-column">
          <h2>Company</h2>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/#contact">Contact Melaiva</Link>
        </div>
      </div>
      <div className="shell site-footer__bottom">
        <p>© {new Date().getFullYear()} Melaiva. Made for celebrations across India.</p>
        <p className="trust-note"><LockKeyhole size={14} /> Secure briefs · Sealed offers · No spam</p>
      </div>
    </footer>
  );
}

export function AppShell({ children, toast, dismissToast, openAuth, setOpenAuth, notify }) {
  const location = useLocation();
  useEffect(() => {
    const titles = {
      "/": "Melaiva — A clearer celebration marketplace",
      "/marketplace": "Find celebration professionals | Melaiva",
      "/planner": "AI celebration planner | Melaiva",
      "/request": "Request sealed offers | Melaiva",
      "/dashboard": "My planning space | Melaiva",
      "/vendor": "Partner workspace | Melaiva",
      "/vendor/onboarding": "Join the partner network | Melaiva",
      "/auth": "Sign in | Melaiva",
      "/privacy": "Privacy policy | Melaiva",
      "/terms": "Terms of service | Melaiva",
    };
    document.title = titles[location.pathname] || "Melaiva — Celebration planning, made clearer";
    if (location.hash) {
      window.requestAnimationFrame(() => document.querySelector(location.hash)?.scrollIntoView({ block: "start" }));
    } else {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [location.pathname, location.hash]);

  return (
    <>
      <Header onOpenAuth={() => setOpenAuth(true)} />
      <main id="main-content">{children}</main>
      <Footer />
      <AuthModal open={openAuth} onClose={() => setOpenAuth(false)} notify={notify} />
      <ToastRegion toast={toast} onDismiss={dismissToast} />
    </>
  );
}

export function SelectField({ label, icon: Icon, className = "", ...props }) {
  return (
    <label className={`search-field ${className}`}>
      {Icon && <Icon size={19} aria-hidden="true" />}
      <span>
        <small>{label}</small>
        <select {...props} />
      </span>
      <ChevronDown size={16} aria-hidden="true" />
    </label>
  );
}

export function SaveButton({ saved, onClick, label }) {
  return (
    <button className={`save-button ${saved ? "is-saved" : ""}`} onClick={onClick} aria-label={`${saved ? "Remove" : "Save"} ${label}`} aria-pressed={saved}>
      <Heart size={18} fill={saved ? "currentColor" : "none"} />
    </button>
  );
}
