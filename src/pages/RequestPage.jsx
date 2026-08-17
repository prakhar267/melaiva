import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  BadgeIndianRupee,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  MapPin,
  LoaderCircle,
  PartyPopper,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { categories, cities, formatCurrency } from "../data.js";
import { createIdempotencyKey, isServiceUnavailable, readApiResponse } from "../api.js";
import { plannerHandoffToRequestPrefill, readPlannerRequestHandoff } from "../components/plannerHandoff.js";
import { normalizeEligibleVendorCount, requestCoverageCopy, requestPrefillFromSearch } from "../components/requestCoverage.js";
import {
  clearPendingRequestSubmission,
  markPendingRequestSubmissionRejected,
  pendingSubmissionBelongsToUser,
  readPendingRequestSubmission,
  rejectedRequestEditStep,
  requestDraftFromPayload,
  requestPreferredVendorInitials,
  validateRequestDraft,
  writePendingRequestSubmission,
} from "../components/requestSubmission.js";

const eventTypes = ["Wedding", "Engagement", "Reception", "Anniversary", "Family celebration", "Other"];

function Stepper({ step }) {
  const items = ["Celebration", "Services", "Budget & brief", "Review"];
  return (
    <ol className="wizard-stepper" aria-label="Request progress">
      {items.map((item, index) => {
        const number = index + 1;
        return <li className={step === number ? "is-current" : step > number ? "is-complete" : ""} aria-current={step === number ? "step" : undefined} key={item}><span>{step > number ? <Check size={15} /> : number}</span><small>{item}</small></li>;
      })}
    </ol>
  );
}

function FieldError({ children }) {
  return children ? <small className="field-error" role="alert">{children}</small> : null;
}

function normalizePreferredVendor(vendor) {
  const vendorCategories = [...new Set([vendor.category, ...(vendor.categories || [])].filter(Boolean))];
  const name = vendor.businessName || "Selected partner";
  return {
    id: vendor.id,
    slug: vendor.slug,
    name,
    categories: vendorCategories,
    serviceAreas: [...new Set([vendor.city, ...(vendor.serviceAreas || [])].filter(Boolean))],
    categoryLabel: categories.find((item) => item.id === vendorCategories[0])?.name || "Wedding partner",
    city: vendor.city || "",
    initials: requestPreferredVendorInitials(name),
    tone: ["marigold", "rose", "teal", "aubergine"][String(vendor.id || vendor.slug || "x").length % 4],
  };
}

function preferredVendorSnapshot(vendor) {
  if (!vendor) return null;
  return {
    id: vendor.id,
    slug: vendor.slug,
    name: vendor.name,
    categoryLabel: vendor.categoryLabel,
    city: vendor.city,
    initials: vendor.initials,
    tone: vendor.tone,
  };
}

async function loadRequestIdentity({ signal } = {}) {
  const response = await fetch("/api/v1/auth/me", { credentials: "include", signal });
  if (response.status === 401) return { status: "guest", userId: null, vendorId: null };
  const payload = await readApiResponse(response, "Your account could not be verified safely.");
  const userId = payload.data?.user?.id;
  if (!userId) throw new Error("The account response was incomplete.");
  return { status: "ready", userId, vendorId: payload.data?.vendor?.id || null };
}

function PreferredVendorContext({ resolution, vendorSlug, onContinueWithout, onRetry, locked = false, rejected = false }) {
  if (resolution.status === "none") return null;

  if (resolution.status === "resolved") {
    const vendor = resolution.vendor;
    return (
      <div className="preferred-vendor-context" aria-live="polite">
        <div className={`preferred-vendor-context__monogram tone--${vendor.tone}`}>{vendor.initials}</div>
        <div className="preferred-vendor-context__copy">
          <small>Preferred partner</small>
          <strong>{vendor.name}</strong>
          <span>{[vendor.categoryLabel, vendor.city].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="preferred-vendor-context__actions">
          <div className="preferred-vendor-context__status"><CheckCircle2 size={16} /><span>{rejected ? "Preserved in this rejected draft" : locked ? "Included in the exact publish retry" : "Will receive a direct invitation"}</span></div>
          {!locked && <button className="text-button" type="button" onClick={onContinueWithout}>Continue without this partner</button>}
        </div>
      </div>
    );
  }

  if (resolution.status === "skipped") {
    return (
      <div className="preferred-vendor-context preferred-vendor-context--skipped" aria-live="polite">
        <Sparkles size={19} />
        <div className="preferred-vendor-context__copy"><small>Open matching</small><strong>Continuing without a specific partner</strong><span>No preferred vendor will be attached to this request.</span></div>
        <button className="text-button" type="button" onClick={onRetry}>Restore partner</button>
      </div>
    );
  }

  const loading = resolution.status === "loading";
  const incompatible = resolution.status === "incompatible";
  return (
    <div className={`preferred-vendor-context preferred-vendor-context--${loading ? "loading" : "unavailable"}`} role={loading ? "status" : "alert"} aria-live="polite">
      {loading ? <LoaderCircle className="spin-icon" size={20} /> : <CircleAlert size={20} />}
      <div className="preferred-vendor-context__copy">
        <small>{loading ? "Confirming preferred partner" : incompatible ? "Partner does not match this brief" : "Preferred partner unavailable"}</small>
        <strong>{loading ? "Checking the live partner record…" : incompatible ? "Align the brief or continue with open matching" : "We could not safely attach this partner"}</strong>
        <span>{loading ? `Verifying ${vendorSlug} before this request can continue.` : resolution.message}</span>
      </div>
      <div className="preferred-vendor-context__actions">
        {!loading && !incompatible && <button className="button button--small button--outline" type="button" onClick={onRetry}>Try again</button>}
        <button className="text-button" type="button" onClick={onContinueWithout}>Continue without this partner</button>
      </div>
    </div>
  );
}

function PlannerHandoffContext({ handoff, onRemove }) {
  if (!handoff) return null;
  const eventCount = handoff.ceremonies.length;
  return (
    <div className="planner-handoff-context" role="status" aria-live="polite">
      <span className="planner-handoff-context__icon"><ClipboardCheck size={20} /></span>
      <div className="planner-handoff-context__copy">
        <small>Started from your blueprint</small>
        <strong>{handoff.city} · {handoff.guestCount.toLocaleString("en-IN")} guests · {eventCount} event{eventCount === 1 ? "" : "s"}</strong>
        <span>Your date, destination and planning notes are ready to review. Choose one service and set its separate budget before publishing.</span>
      </div>
      <button className="text-button" type="button" onClick={onRemove}>Dismiss blueprint note</button>
    </div>
  );
}

function CelebrationStep({ data, update, errors, selectedVendor }) {
  const cityOptions = [...new Set([...cities, data.city, selectedVendor?.city].filter(Boolean))];
  return (
    <div className="wizard-panel">
      <div className="wizard-panel__heading"><span>01</span><div><div className="eyebrow">The essentials</div><h2>Tell us about the celebration</h2><p>Approximate details are enough to find the right first matches.</p></div></div>
      <div className="form-grid">
        <label className="field field--span-2"><span>Give this request a name</span><input value={data.title} onChange={(event) => update("title", event.target.value)} placeholder="Aarav & Meera — Jaipur celebration" maxLength="120" /><FieldError>{errors.title}</FieldError></label>
        <label className="field"><span>Celebration type</span><div className="input-wrap input-wrap--select"><select value={data.eventType} onChange={(event) => update("eventType", event.target.value)}><option value="">Choose a celebration type</option>{eventTypes.map((type) => <option key={type}>{type}</option>)}</select><ChevronDown size={15} /></div><FieldError>{errors.eventType}</FieldError></label>
        <label className="field"><span>Primary date</span><div className="input-wrap"><CalendarDays size={17} /><input type="date" value={data.eventDate} onChange={(event) => update("eventDate", event.target.value)} /></div><FieldError>{errors.eventDate}</FieldError></label>
        <label className="field"><span>City or destination</span><div className="input-wrap input-wrap--select"><MapPin size={17} /><select value={data.city} onChange={(event) => update("city", event.target.value)}><option value="">Choose a city</option>{cityOptions.map((city) => <option key={city}>{city}</option>)}</select><ChevronDown size={15} /></div><FieldError>{errors.city}</FieldError></label>
        <label className="field"><span>Estimated guests</span><div className="input-wrap"><Users size={17} /><input type="number" min="20" max="5000" inputMode="numeric" value={data.guestCount} onChange={(event) => update("guestCount", event.target.value)} /></div><FieldError>{errors.guestCount}</FieldError></label>
      </div>
    </div>
  );
}

function ServicesStep({ data, select, errors }) {
  return (
    <div className="wizard-panel">
      <div className="wizard-panel__heading"><span>02</span><div><div className="eyebrow">One comparable pool</div><h2 id="service-choice-title">Which service should this request cover?</h2><p id="service-choice-help">Choose one service. Separate requests keep every offer focused on the same scope, budget and decision.</p></div></div>
      <fieldset className="service-choice-fieldset" aria-labelledby="service-choice-title" aria-describedby="service-choice-help">
        <legend>Choose one service for this request</legend>
        <div className="service-choice-grid">
          {categories.map((category) => {
            const selected = data.categories[0] === category.id;
            return <label className={selected ? "is-selected" : ""} key={category.id}><input type="radio" name="service-category" value={category.id} checked={selected} onChange={() => select(category.id)} /><span className="service-choice__check" aria-hidden="true"><Check size={15} /></span><div><strong>{category.name}</strong><small>{category.short}</small></div></label>;
          })}
        </div>
      </fieldset>
      <FieldError>{errors.categories}</FieldError>
      <div className="wizard-assurance"><ShieldCheck size={18} /><p><strong>Comparable by design.</strong> Need another service? Create a separate request so one award never closes an unrelated offer.</p></div>
    </div>
  );
}

function BudgetStep({ data, update, errors }) {
  const selectedCategory = categories.find((category) => category.id === data.categories[0]);
  const categoryLabel = selectedCategory?.name || "this service";
  return (
    <div className="wizard-panel">
      <div className="wizard-panel__heading"><span>03</span><div><div className="eyebrow">Useful context</div><h2>Set the working range for {categoryLabel}</h2><p>A service-specific range helps partners build an offer that can actually work.</p></div></div>
      <div className="form-grid">
        <label className="field"><span>{categoryLabel} budget from</span><div className="input-wrap"><BadgeIndianRupee size={17} /><input type="number" inputMode="numeric" min="10000" step="10000" value={data.budgetMin} onChange={(event) => update("budgetMin", event.target.value)} /></div><small className="field-hint">{formatCurrency(Number(data.budgetMin || 0))}</small><FieldError>{errors.budgetMin}</FieldError></label>
        <label className="field"><span>{categoryLabel} budget up to</span><div className="input-wrap"><BadgeIndianRupee size={17} /><input type="number" inputMode="numeric" min="10000" step="10000" value={data.budgetMax} onChange={(event) => update("budgetMax", event.target.value)} /></div><small className="field-hint">{formatCurrency(Number(data.budgetMax || 0))}</small><FieldError>{errors.budgetMax}</FieldError></label>
        <label className="field field--span-2"><span>Offer window closes</span><div className="input-wrap"><Clock3 size={17} /><input type="datetime-local" value={data.biddingEndsAt} onChange={(event) => update("biddingEndsAt", event.target.value)} /></div><small className="field-hint">Partners will not see anyone else’s offer.</small><FieldError>{errors.biddingEndsAt}</FieldError></label>
        <label className="field field--span-2"><span>Describe what a great fit looks like</span><textarea rows="6" value={data.requirements} onChange={(event) => update("requirements", event.target.value)} placeholder="Share the events, overall feel, must-have deliverables, venue constraints and anything you definitely do or don’t want…" /><div className="field-counter"><FieldError>{errors.requirements}</FieldError><span>{data.requirements.length} / 1,500</span></div></label>
      </div>
      <div className="brief-prompts"><span>Helpful details:</span><button type="button" onClick={() => update("requirements", `${data.requirements}${data.requirements ? "\n" : ""}Events and timings: `)}>Events & timings</button><button type="button" onClick={() => update("requirements", `${data.requirements}${data.requirements ? "\n" : ""}Must-have inclusions: `)}>Must-have inclusions</button><button type="button" onClick={() => update("requirements", `${data.requirements}${data.requirements ? "\n" : ""}Style references: `)}>Style references</button></div>
    </div>
  );
}

function RequestCoverageStatus({ coverage }) {
  if (coverage.status === "idle") return null;
  if (coverage.status === "loading") {
    return <div className="request-coverage request-coverage--loading" role="status"><LoaderCircle className="spin-icon" size={19} /><p><strong>Checking live partner coverage</strong><span>Confirming the approved response pool for this service and city.</span></p></div>;
  }
  const copy = requestCoverageCopy(coverage.status === "ready" ? coverage.count : null);
  const Icon = copy.tone === "ready" ? Users : CircleAlert;
  return (
    <div className={`request-coverage request-coverage--${copy.tone}`} role="status" aria-live="polite">
      <Icon size={19} />
      <p><strong>{coverage.status === "error" ? "Live coverage could not be confirmed" : copy.title}</strong><span>{copy.message}</span></p>
    </div>
  );
}

function ReviewStep({ data, selectedVendor, coverage, statusLabel = "Draft", responseWindowEnded = false, rejected = false }) {
  const reviewState = rejected ? "rejected" : responseWindowEnded ? "ended" : "ready";
  return (
    <div className="wizard-panel">
      <div className="wizard-panel__heading"><span>04</span><div><div className="eyebrow">{reviewState === "rejected" ? "Protected rejected draft" : reviewState === "ended" ? "Response window ended" : "Ready when you are"}</div><h2>{reviewState === "rejected" ? "Edit before publishing again" : reviewState === "ended" ? "Review the exact saved publish" : "Review your request"}</h2><p>{reviewState === "rejected" ? "The server did not publish this exact attempt. Unlock it to correct the brief and use a new secure key; this rejected key will never be retried." : reviewState === "ended" ? "No partner can respond now. Retrying only confirms whether the original publish succeeded; it does not reopen or extend the response window." : "Eligible partners can receive the brief below. Your contact details stay private until you choose to connect."}</p></div></div>
      <div className="review-card">
        <div className="review-card__header"><div><small>{data.eventType}</small><h3>{data.title}</h3><p><MapPin size={14} /> {data.city}<span /> <CalendarDays size={14} /> {new Date(`${data.eventDate}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}<span /> <Users size={14} /> {data.guestCount} guests</p></div><span className="status-pill"><span /> {statusLabel}</span></div>
        <dl className="review-details">
          <div><dt>Service</dt><dd>{categories.find((item) => item.id === data.categories[0])?.name || "Not selected"}</dd></div>
          <div><dt>Working range</dt><dd>{formatCurrency(Number(data.budgetMin))} – {formatCurrency(Number(data.budgetMax))}</dd></div>
          <div><dt>Offer window</dt><dd>Until {new Date(data.biddingEndsAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</dd></div>
          {selectedVendor && <div><dt>Requested partner</dt><dd>{selectedVendor.name}</dd></div>}
        </dl>
        <div className="review-brief"><h4>The brief</h4><p>{data.requirements}</p></div>
      </div>
      <div className="review-assurances"><div><ShieldCheck size={18} /><span><strong>Private by design</strong>Your phone and email are never shown publicly.</span></div><div><FileCheck2 size={18} /><span><strong>Comparable offers</strong>Partners answer against the same scope.</span></div><div><Sparkles size={18} /><span><strong>No obligation</strong>Review every offer before deciding.</span></div></div>
      {rejected
        ? <div className="request-coverage request-coverage--warning" role="status"><CircleAlert size={19} /><p><strong>This key will not be retried</strong><span>Unlock the protected draft to correct it. A later publish will use a new secure submission key and a newly reviewed response window.</span></p></div>
        : responseWindowEnded
        ? <div className="request-coverage request-coverage--warning" role="status"><Clock3 size={19} /><p><strong>No new response is possible</strong><span>The recorded offer window has ended. Use the exact retry only to recover the original result, then check the dashboard for any offers that arrived before closing.</span></p></div>
        : <RequestCoverageStatus coverage={coverage} />}
    </div>
  );
}

function SuccessState({ result }) {
  const coverage = requestCoverageCopy(result.eligibleVendorCount, result.replayed ? "replay" : "success");
  const Icon = coverage.tone === "ready" ? PartyPopper : CircleAlert;
  return (
    <div className={`request-success request-success--${coverage.tone}`}>
      <span className="request-success__icon"><Icon size={34} /></span>
      <div className="eyebrow">{result.replayed ? "Original publish confirmed" : coverage.tone === "ready" ? "Request is live" : "Brief saved and open"}</div>
      <h1>{coverage.title}</h1>
      <p>{coverage.message}</p>
      <div className="request-success__reference"><small>Reference</small><strong>{result.reference}</strong></div>
      <div className="request-success__actions"><Link className="button button--primary" to="/dashboard">Open my dashboard <ArrowRight size={17} /></Link><Link className="button button--outline" to="/marketplace">Keep exploring</Link></div>
    </div>
  );
}

function RecoveryAccessState({ status, onOpenAuth, onRetry }) {
  const checking = status === "checking";
  const signIn = status === "signin";
  const mismatch = status === "mismatch";
  return (
    <div className="request-page page-surface">
      <div className="shell request-recovery-state">
        <section className="wizard-card request-recovery-state__card" role={checking ? "status" : "alert"}>
          <span className="request-recovery-state__icon">{checking ? <LoaderCircle className="spin-icon" size={28} /> : <ShieldCheck size={28} />}</span>
          <div className="eyebrow">Protected publish recovery</div>
          <h1>{checking ? "Checking the account for this saved publish" : signIn ? "Sign in to recover this publish" : mismatch ? "This publish belongs to another account" : "Account verification is unavailable"}</h1>
          <p>{checking
            ? "The saved brief stays hidden until its original account is confirmed."
            : signIn
              ? "Sign in with the account that started this publish. Its exact brief and submission key remain preserved in this tab."
              : mismatch
                ? "The saved brief will not be shown or submitted from the current account. Sign back into the account that started it, or use a fresh tab for a different request."
                : "Melaiva could not safely confirm who owns the saved publish. Nothing will be submitted until the check succeeds."}</p>
          {!checking && <div className="request-recovery-state__actions">
            {(signIn || mismatch) && <button className="button button--primary" type="button" onClick={onOpenAuth}>{mismatch ? "Switch account" : "Sign in to continue"}</button>}
            <button className="button button--outline" type="button" onClick={onRetry}>Check account again</button>
            <Link className="button button--ghost" to="/">Return home</Link>
          </div>}
        </section>
      </div>
    </div>
  );
}

export function RequestPage({ notify, onOpenAuth, authRevision = 0 }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const vendorParam = params.get("vendor");
  const defaultEnd = useMemo(() => {
    const date = new Date(Date.now() + 72 * 60 * 60 * 1000);
    date.setMinutes(0, 0, 0);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }, []);
  const defaultEventDate = useMemo(() => {
    const date = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }, []);
  const initialPlannerHandoff = useMemo(() => readPlannerRequestHandoff(location.state), [location.state]);
  const plannerPrefill = useMemo(() => plannerHandoffToRequestPrefill(initialPlannerHandoff), [initialPlannerHandoff]);
  const marketplacePrefill = useMemo(() => requestPrefillFromSearch(params, {
    categoryIds: categories.map((category) => category.id),
    cityNames: cities,
  }), [params]);
  const submissionStorage = useMemo(() => {
    try { return globalThis.sessionStorage || null; } catch { return null; }
  }, []);
  const recoveredSubmission = useMemo(() => readPendingRequestSubmission(submissionStorage), [submissionStorage]);
  const [pendingSubmission, setPendingSubmission] = useState(recoveredSubmission);
  const recoveryLocked = Boolean(pendingSubmission);
  const plannerHandoffSignature = useMemo(() => initialPlannerHandoff ? JSON.stringify(initialPlannerHandoff) : "", [initialPlannerHandoff]);
  const [step, setStep] = useState(pendingSubmission ? 4 : 1);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [submissionUnconfirmed, setSubmissionUnconfirmed] = useState(pendingSubmission?.state === "pending");
  const [submissionRejected, setSubmissionRejected] = useState(pendingSubmission?.state === "rejected" ? pendingSubmission.rejectionMessage : "");
  const [idempotencyKey, setIdempotencyKey] = useState(() => pendingSubmission?.key || createIdempotencyKey("request"));
  const [dismissedVendorParam, setDismissedVendorParam] = useState(null);
  const [vendorRetryKey, setVendorRetryKey] = useState(0);
  const [vendorResolution, setVendorResolution] = useState(() => ({ status: !recoveryLocked && vendorParam ? "loading" : "none", vendor: null, message: "" }));
  const [activePlannerHandoff, setActivePlannerHandoff] = useState(recoveryLocked ? null : initialPlannerHandoff);
  const [identityRefreshKey, setIdentityRefreshKey] = useState(0);
  const [requestIdentity, setRequestIdentity] = useState({ status: "loading", userId: null, vendorId: null, revision: -1, refreshKey: -1 });
  const touchedFields = useRef({ city: false, categories: false });
  const requestHeadingRef = useRef(null);
  const plannerFocusAppliedRef = useRef(false);
  const lastLocationKeyRef = useRef(location.key);
  const appliedHandoffSignatureRef = useRef(plannerHandoffSignature);
  const focusAfterDismissRef = useRef(false);
  const lockedSubmissionRef = useRef(pendingSubmission || null);
  const [handoffAnnouncement, setHandoffAnnouncement] = useState("");
  const [coverage, setCoverage] = useState({ status: "idle", count: null });
  const [recoveryClock, setRecoveryClock] = useState(() => Date.now());
  const [data, setData] = useState({
    title: "",
    eventType: "Wedding",
    eventDate: defaultEventDate,
    city: "",
    guestCount: "250",
    categories: [],
    budgetMin: "200000",
    budgetMax: "500000",
    biddingEndsAt: defaultEnd,
    requirements: "",
    ...marketplacePrefill,
    ...(plannerPrefill || {}),
    ...(pendingSubmission?.draft || {}),
  });

  useEffect(() => {
    const onFocus = () => setIdentityRefreshKey((value) => value + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    if (!recoveryLocked) return undefined;
    setRecoveryClock(Date.now());
    const timer = window.setInterval(() => setRecoveryClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [recoveryLocked]);

  useEffect(() => {
    const controller = new AbortController();
    const revision = authRevision;
    const refreshKey = identityRefreshKey;
    setRequestIdentity({ status: "loading", userId: null, vendorId: null, revision, refreshKey });
    loadRequestIdentity({ signal: controller.signal })
      .then((identity) => {
        if (!controller.signal.aborted) setRequestIdentity({ ...identity, revision, refreshKey });
      })
      .catch((error) => {
        if (error?.name !== "AbortError" && !controller.signal.aborted) {
          setRequestIdentity({ status: "error", userId: null, vendorId: null, revision, refreshKey });
        }
      });
    return () => controller.abort();
  }, [authRevision, identityRefreshKey]);

  useEffect(() => {
    if (activePlannerHandoff && !plannerFocusAppliedRef.current) {
      plannerFocusAppliedRef.current = true;
      requestHeadingRef.current?.focus({ preventScroll: true });
      return;
    }
    if (!activePlannerHandoff && focusAfterDismissRef.current) {
      focusAfterDismissRef.current = false;
      requestHeadingRef.current?.focus({ preventScroll: true });
    }
  }, [activePlannerHandoff]);

  useEffect(() => {
    if (recoveryLocked) return;
    if (lastLocationKeyRef.current === location.key) return;
    lastLocationKeyRef.current = location.key;
    setActivePlannerHandoff(initialPlannerHandoff);
    if (!plannerPrefill) return;
    plannerFocusAppliedRef.current = false;
    setHandoffAnnouncement("");
    if (appliedHandoffSignatureRef.current === plannerHandoffSignature) return;
    appliedHandoffSignatureRef.current = plannerHandoffSignature;
    touchedFields.current.city = false;
    setData((current) => ({ ...current, ...plannerPrefill }));
    setErrors((current) => ({ ...current, eventDate: "", city: "", guestCount: "", requirements: "" }));
  }, [initialPlannerHandoff, location.key, plannerHandoffSignature, plannerPrefill, recoveryLocked]);

  useEffect(() => {
    if (recoveryLocked) {
      setVendorResolution({ status: "none", vendor: null, message: "" });
      return undefined;
    }
    if (!vendorParam) {
      setVendorResolution({ status: "none", vendor: null, message: "" });
      return undefined;
    }
    if (dismissedVendorParam === vendorParam) {
      setVendorResolution({ status: "skipped", vendor: null, message: "" });
      return undefined;
    }

    const controller = new AbortController();
    async function resolveVendor() {
      setVendorResolution({ status: "loading", vendor: null, message: "" });
      try {
        const response = await fetch(`/api/v1/catalog/vendors/${encodeURIComponent(vendorParam)}`, { credentials: "include", signal: controller.signal });
        const payload = await readApiResponse(response, "The selected partner could not be checked.");
        if (payload.meta?.source === "demo" || !payload.data?.id || payload.data?.slug?.toLowerCase() !== vendorParam.toLowerCase()) {
          if (!controller.signal.aborted) {
            setVendorResolution({ status: "unavailable", vendor: null, message: "The live catalog could not confirm this exact partner. Try again or explicitly continue with open matching." });
          }
          return;
        }
        const vendor = normalizePreferredVendor(payload.data);
        if (controller.signal.aborted) return;
        setVendorResolution({ status: "resolved", vendor, message: "" });
        const compatibleCategory = vendor.categories.find((id) => categories.some((item) => item.id === id));
        setData((current) => ({
          ...current,
          city: !touchedFields.current.city && !current.city && vendor.city ? vendor.city : current.city,
          categories: !touchedFields.current.categories && !current.categories.length && compatibleCategory ? [compatibleCategory] : current.categories,
        }));
      } catch (requestError) {
        if (requestError?.name === "AbortError" || controller.signal.aborted) return;
        const message = requestError?.status === 404
          ? "This partner is no longer available in the public catalog. Choose open matching or return to the marketplace."
          : "We could not verify the live partner record. Nothing will be substituted unless you choose to continue without this partner.";
        setVendorResolution({ status: "unavailable", vendor: null, message });
      }
    }
    resolveVendor();
    return () => controller.abort();
  }, [authRevision, dismissedVendorParam, recoveryLocked, vendorParam, vendorRetryKey]);

  const identityCurrent = requestIdentity.revision === authRevision
    && requestIdentity.refreshKey === identityRefreshKey;
  const recoveryAccess = !recoveryLocked
    ? "none"
    : !identityCurrent || requestIdentity.status === "loading"
      ? "checking"
      : requestIdentity.status === "guest"
        ? "signin"
        : requestIdentity.status === "error"
          ? "error"
          : pendingSubmissionBelongsToUser(pendingSubmission, requestIdentity.userId)
            ? "ready"
            : "mismatch";
  const recoveryReady = recoveryAccess === "ready";
  const resultAccess = !result
    ? "none"
    : !identityCurrent || requestIdentity.status === "loading"
      ? "checking"
      : requestIdentity.status === "guest"
        ? "signin"
        : requestIdentity.status === "error"
          ? "error"
          : requestIdentity.userId === result.ownerUserId
            ? "ready"
            : "mismatch";
  const recoveryResponseWindowEnded = recoveryLocked
    && Date.parse(pendingSubmission?.payload?.biddingEndsAt) <= recoveryClock;
  const coverageCategory = data.categories[0] || "";
  useEffect(() => {
    if (recoveryLocked && (!recoveryReady || recoveryResponseWindowEnded)) {
      setCoverage({ status: "idle", count: null });
      return undefined;
    }
    if (!coverageCategory || !data.city) {
      setCoverage({ status: "idle", count: null });
      return undefined;
    }
    const controller = new AbortController();
    async function loadCoverage() {
      setCoverage({ status: "loading", count: null });
      try {
        const query = new URLSearchParams({ category: coverageCategory, city: data.city });
        const response = await fetch(`/api/v1/catalog/coverage?${query}`, { credentials: "include", signal: controller.signal });
        const payload = await readApiResponse(response, "Live partner coverage could not be confirmed.");
        const count = normalizeEligibleVendorCount(payload.data?.eligibleVendorCount);
        if (count === null) throw new Error("Coverage response was incomplete");
        if (!controller.signal.aborted) setCoverage({ status: "ready", count });
      } catch (requestError) {
        if (requestError?.name !== "AbortError" && !controller.signal.aborted) setCoverage({ status: "error", count: null });
      }
    }
    loadCoverage();
    return () => controller.abort();
  }, [authRevision, coverageCategory, data.city, recoveryLocked, recoveryReady, recoveryResponseWindowEnded]);

  const resolvedVendor = vendorResolution.status === "resolved" ? vendorResolution.vendor : null;
  const vendorMismatch = useMemo(() => {
    if (!resolvedVendor) return "";
    if (identityCurrent && requestIdentity.status === "ready" && requestIdentity.vendorId === resolvedVendor.id) {
      return "You cannot directly invite the partner profile owned by this account.";
    }
    const normalize = (value) => String(value || "").trim().toLowerCase();
    const categoryMatches = data.categories.some((category) => resolvedVendor.categories.map(normalize).includes(normalize(category)));
    const cityMatches = resolvedVendor.serviceAreas.map(normalize).includes(normalize(data.city));
    if (!categoryMatches && !cityMatches) return "The chosen service and city are outside this partner’s approved profile.";
    if (!categoryMatches) return "The chosen service does not match this partner’s approved categories.";
    if (!cityMatches) return "This city is outside the partner’s approved service areas.";
    return "";
  }, [data.categories, data.city, identityCurrent, requestIdentity.status, requestIdentity.vendorId, resolvedVendor]);
  const recoveredVendor = pendingSubmission?.preferredVendor || null;
  const displayedVendorResolution = recoveryLocked && recoveredVendor
    ? { status: "resolved", vendor: recoveredVendor, message: "" }
    : vendorMismatch
    ? { status: "incompatible", vendor: resolvedVendor, message: `${vendorMismatch} Update the brief or explicitly continue without this partner.` }
    : vendorResolution;
  const selectedVendor = recoveryLocked ? recoveredVendor : resolvedVendor && !vendorMismatch ? resolvedVendor : null;
  const vendorBlocking = !recoveryLocked && Boolean(vendorParam) && (["loading", "unavailable"].includes(vendorResolution.status) || Boolean(vendorMismatch));

  useEffect(() => {
    if (!result || resultAccess !== "ready" || !pendingSubmissionBelongsToUser(pendingSubmission, result.ownerUserId)) return;
    lockedSubmissionRef.current = null;
    clearPendingRequestSubmission(submissionStorage);
    setPendingSubmission(null);
  }, [pendingSubmission, result, resultAccess, submissionStorage]);

  function removePlannerHandoff() {
    focusAfterDismissRef.current = true;
    setActivePlannerHandoff(null);
    setHandoffAnnouncement("Blueprint note dismissed. The imported values remain in this draft for you to review or edit.");
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
  }

  function update(key, value) {
    if (key === "requirements" && value.length > 1500) return;
    if (key === "city") touchedFields.current.city = true;
    setData((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }
  function selectCategory(id) {
    touchedFields.current.categories = true;
    setData((current) => ({ ...current, categories: [id] }));
    setErrors((current) => ({ ...current, categories: "" }));
  }
  function unlockRejectedSubmission() {
    if (!submissionRejected) return;
    const preferredVendorSlug = pendingSubmission?.preferredVendor?.slug || "";
    const validation = validateRequestDraft(data);
    const editStep = rejectedRequestEditStep(data, { responseWindowEnded: recoveryResponseWindowEnded });
    lockedSubmissionRef.current = null;
    setPendingSubmission(null);
    setSubmissionRejected("");
    setSubmissionUnconfirmed(false);
    setIdempotencyKey(createIdempotencyKey("request"));
    setErrors(validation.errors);
    setStep(editStep);
    clearPendingRequestSubmission(submissionStorage);
    navigate({ pathname: "/request", search: preferredVendorSlug ? `?vendor=${encodeURIComponent(preferredVendorSlug)}` : "" }, { replace: true, state: null });
    window.scrollTo({ top: 0, behavior: "smooth" });
    notify({ type: "success", title: "Protected review unlocked", message: editStep === 3 ? "Update the highlighted window or brief details before publishing with a new secure key." : "Review this draft from the highlighted step before publishing with a new secure key." });
  }
  function validate(targetStep) {
    const next = validateRequestDraft(data).errorsByStep[targetStep] || {};
    setErrors(next);
    return !Object.keys(next).length;
  }
  function next() {
    if (vendorBlocking) return;
    if (!validate(step)) return;
    setStep((current) => Math.min(4, current + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit() {
    if (vendorBlocking && !lockedSubmissionRef.current) return;
    const priorSubmission = lockedSubmissionRef.current;
    if (!priorSubmission) {
      const validation = validateRequestDraft(data);
      if (validation.firstInvalidStep) {
        setErrors(validation.errors);
        setStep(validation.firstInvalidStep);
        window.scrollTo({ top: 0, behavior: "smooth" });
        notify({ type: "warning", title: "Review the highlighted details", message: "Nothing was submitted. Correct this brief before publishing it with a secure key." });
        return;
      }
    }
    setSubmitting(true);
    const currentPayload = {
      title: data.title.trim(), eventType: data.eventType.toLowerCase().replaceAll(" ", "_"), eventDate: data.eventDate, city: data.city,
      guestCount: Number(data.guestCount), budgetMin: Number(data.budgetMin), budgetMax: Number(data.budgetMax), currency: "INR",
      categories: data.categories, requirements: data.requirements,
      biddingEndsAt: new Date(data.biddingEndsAt).toISOString(),
      ...(selectedVendor?.id ? { preferredVendorId: selectedVendor.id } : {}),
    };
    let publishPrepared = false;
    try {
      const freshIdentity = await loadRequestIdentity();
      setRequestIdentity({ ...freshIdentity, revision: authRevision, refreshKey: identityRefreshKey });
      if (freshIdentity.status === "guest") {
        onOpenAuth();
        notify({ type: "warning", title: "Sign in to publish", message: "Your editable brief will stay on this page while you sign in." });
        return;
      }

      if (priorSubmission && !pendingSubmissionBelongsToUser(priorSubmission, freshIdentity.userId)) {
        notify({ type: "error", title: "Publish belongs to another account", message: "Nothing was submitted. Sign back into the account that started this saved publish." });
        return;
      }
      if (!priorSubmission && currentPayload.preferredVendorId && currentPayload.preferredVendorId === freshIdentity.vendorId) {
        notify({ type: "error", title: "Choose a different partner", message: "Nothing was submitted. This account cannot directly invite its own partner profile; continue with open matching instead." });
        return;
      }
      const candidateSubmission = priorSubmission || {
        key: idempotencyKey,
        ownerUserId: freshIdentity.userId,
        payload: currentPayload,
        preferredVendor: preferredVendorSnapshot(selectedVendor),
        createdAt: new Date().toISOString(),
      };
      const payload = candidateSubmission.payload;
      const persisted = writePendingRequestSubmission(submissionStorage, candidateSubmission);
      if (!persisted) {
        const safeWindowExpired = priorSubmission
          && Date.parse(priorSubmission.createdAt) <= Date.now() - 24 * 60 * 60 * 1_000;
        notify({
          type: "error",
          title: safeWindowExpired ? "Safe retry window ended" : "Secure retry protection unavailable",
          message: safeWindowExpired
            ? "Nothing was submitted. Check your dashboard for the original request before starting another brief."
            : "Nothing was submitted because this tab could not durably preserve the exact key and brief. Check browser storage and try again.",
        });
        return;
      }
      const protectedSubmission = {
        ...candidateSubmission,
        draft: candidateSubmission.draft || requestDraftFromPayload(payload),
        state: "pending",
        rejectionMessage: null,
      };
      lockedSubmissionRef.current = protectedSubmission;
      setPendingSubmission(protectedSubmission);
      if (protectedSubmission.draft) setData(protectedSubmission.draft);
      setStep(4);
      setActivePlannerHandoff(null);
      setSubmissionRejected("");
      publishPrepared = true;
      const response = await fetch("/api/v1/auctions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": candidateSubmission.key,
          "X-Melaiva-Expected-User-Id": candidateSubmission.ownerUserId,
        },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        if (!priorSubmission) {
          lockedSubmissionRef.current = null;
          setPendingSubmission(null);
          clearPendingRequestSubmission(submissionStorage);
          setSubmissionUnconfirmed(false);
        }
        setRequestIdentity({ status: "guest", userId: null, vendorId: null, revision: authRevision, refreshKey: identityRefreshKey });
        onOpenAuth();
        throw new Error("SIGN_IN");
      }
      const body = await readApiResponse(response, "Could not publish request");
      const eligibleVendorCount = normalizeEligibleVendorCount(body.data?.eligibleVendorCount);
      const replayed = Boolean(body.meta?.replayed);
      const coverageCopy = requestCoverageCopy(eligibleVendorCount, replayed ? "replay" : "success");
      setSubmissionUnconfirmed(false);
      const confirmedResult = {
        reference: body.data?.id || body.data?.reference || `MLV-${Date.now().toString().slice(-6)}`,
        eligibleVendorCount,
        replayed,
        coverageCheckedAt: body.data?.coverageCheckedAt || null,
        biddingEndsAt: body.data?.biddingEndsAt || null,
        ownerUserId: candidateSubmission.ownerUserId,
      };
      let confirmationIdentity;
      try {
        confirmationIdentity = await loadRequestIdentity();
        setRequestIdentity({ ...confirmationIdentity, revision: authRevision, refreshKey: identityRefreshKey });
      } catch {
        confirmationIdentity = { status: "error", userId: null, vendorId: null };
        setRequestIdentity({ ...confirmationIdentity, revision: authRevision, refreshKey: identityRefreshKey });
      }
      setResult(confirmedResult);
      if (confirmationIdentity.status === "ready" && confirmationIdentity.userId === confirmedResult.ownerUserId) {
        notify({
          type: coverageCopy.tone === "warning" ? "warning" : "success",
          title: replayed ? "Original publish confirmed" : coverageCopy.tone === "ready" ? "Your request is live" : "Your brief is saved",
          message: coverageCopy.title,
        });
      } else {
        notify({ type: "warning", title: "Request saved securely", message: "Switch back to the account that published it to view the private confirmation." });
      }
    } catch (requestError) {
      if (requestError.message === "SIGN_IN") {
        notify({ type: "warning", title: "Sign in again to confirm", message: "This tab will keep any previously unconfirmed publish protected while you sign in." });
      } else if (requestError?.code === "account_changed" && publishPrepared) {
        setSubmissionUnconfirmed(true);
        setIdentityRefreshKey((value) => value + 1);
        notify({ type: "error", title: "Account changed before publish", message: "Nothing was submitted from the new account. The original account’s exact publish remains protected in this tab." });
      } else if (isServiceUnavailable(requestError) && publishPrepared) {
        const protectedSubmission = lockedSubmissionRef.current;
        if (protectedSubmission?.draft) {
          setData(protectedSubmission.draft);
          setStep(4);
          setActivePlannerHandoff(null);
        }
        setSubmissionUnconfirmed(true);
        notify({ type: "warning", title: "Publish result unconfirmed", message: "This tab preserved the exact brief and secure submission key. Retry here to confirm the result without creating a duplicate." });
      } else if (isServiceUnavailable(requestError)) {
        notify({ type: "error", title: "Account check unavailable", message: "Nothing was submitted because your account could not be confirmed safely. Try again when the connection recovers." });
      } else {
        const rejectionMessage = requestError.message || "This publish was definitively rejected.";
        const protectedSubmission = lockedSubmissionRef.current;
        const rejectionPersisted = markPendingRequestSubmissionRejected(
          submissionStorage,
          protectedSubmission,
          rejectionMessage,
        );
        if (rejectionPersisted && protectedSubmission) {
          const rejectedSubmission = { ...protectedSubmission, state: "rejected", rejectionMessage };
          lockedSubmissionRef.current = rejectedSubmission;
          setPendingSubmission(rejectedSubmission);
          setSubmissionUnconfirmed(false);
          setSubmissionRejected(rejectionMessage);
          notify({ type: "error", title: "Request not published", message: "The server definitively rejected this publish. Unlock the protected review before editing or trying a new key." });
        } else {
          setSubmissionUnconfirmed(true);
          setSubmissionRejected("");
          notify({ type: "warning", title: "Protected state could not be updated", message: "The exact original publish remains preserved and locked. Retry it here before editing so the server can confirm the same result." });
        }
      }
    } finally { setSubmitting(false); }
  }

  if ((result && resultAccess !== "ready") || (recoveryLocked && !recoveryReady)) {
    return <RecoveryAccessState status={result ? resultAccess : recoveryAccess} onOpenAuth={onOpenAuth} onRetry={() => setIdentityRefreshKey((value) => value + 1)} />;
  }
  if (result) return <div className="request-page page-surface"><div className="shell"><SuccessState result={result} /></div></div>;

  return (
    <div className="request-page page-surface">
      <section className="request-header"><div className="shell"><div><div className="eyebrow">Sealed offer request</div><h1 ref={requestHeadingRef} tabIndex={-1}>One good brief. Better conversations.</h1><span className="sr-only" role="status" aria-live="polite">{handoffAnnouncement}</span></div><p>Share the context once, then compare thoughtful offers without exposing your details or anyone else’s price.</p></div></section>
      <div className="shell request-layout">
        <div className="wizard-card">
          <Stepper step={step} />
          {!recoveryLocked && <PlannerHandoffContext handoff={activePlannerHandoff} onRemove={removePlannerHandoff} />}
          <PreferredVendorContext
            resolution={displayedVendorResolution}
            vendorSlug={vendorParam}
            onContinueWithout={() => setDismissedVendorParam(vendorParam)}
            onRetry={() => { setDismissedVendorParam(null); setVendorRetryKey((value) => value + 1); }}
            locked={recoveryLocked}
            rejected={Boolean(submissionRejected)}
          />
          {step === 1 && <CelebrationStep data={data} update={update} errors={errors} selectedVendor={selectedVendor} />}
          {step === 2 && <ServicesStep data={data} select={selectCategory} errors={errors} />}
          {step === 3 && <BudgetStep data={data} update={update} errors={errors} />}
          {step === 4 && <ReviewStep
            data={data}
            selectedVendor={selectedVendor}
            coverage={coverage}
            statusLabel={submissionRejected ? "Protected draft" : submissionUnconfirmed ? "Confirmation pending" : submitting ? "Publishing" : "Draft"}
            responseWindowEnded={recoveryResponseWindowEnded}
            rejected={Boolean(submissionRejected)}
          />}
          {submissionUnconfirmed && <div className="submission-unconfirmed" role="alert"><CircleAlert size={18} /><p><strong>Exact publish preserved in this tab</strong><span>The first attempt may have succeeded. This review is locked to the same brief and secure submission key until retry confirms the result.</span></p></div>}
          {submissionRejected && <div className="submission-unconfirmed submission-unconfirmed--rejected" role="alert"><CircleAlert size={18} /><p><strong>This publish was definitively rejected</strong><span>{submissionRejected} The protected draft remains visible only to its original account until you explicitly unlock it.</span></p><button className="text-button" type="button" onClick={unlockRejectedSubmission}>Unlock and edit</button></div>}
          <div className="wizard-actions">
            {step > 1 ? <button className="button button--ghost" onClick={() => setStep((current) => current - 1)} disabled={recoveryLocked || submitting}><ArrowLeft size={17} /> Back</button> : <Link className="button button--ghost" to="/marketplace"><ArrowLeft size={17} /> Marketplace</Link>}
            {step < 4 ? <button className="button button--primary" onClick={next} disabled={vendorBlocking || submitting}>{vendorResolution.status === "loading" ? "Confirming partner…" : "Continue"} {!vendorBlocking && <ArrowRight size={17} />}</button> : <button className="button button--primary" onClick={submit} disabled={submitting || Boolean(submissionRejected) || (vendorBlocking && !submissionUnconfirmed)}>{submitting ? <span className="button-loader" /> : <Send size={17} />}{submitting ? "Publishing…" : submissionRejected ? "Unlock draft to continue" : submissionUnconfirmed ? "Retry exact publish" : coverage.status === "ready" && coverage.count === 0 ? "Save open request" : "Publish sealed request"}</button>}
          </div>
        </div>
        <aside className="request-aside">
          <div className="request-aside__sticky"><Sparkles size={20} /><h2>{submissionRejected ? "What unlock does" : recoveryResponseWindowEnded ? "What recovery does" : "What happens next?"}</h2><ol>{submissionRejected ? <><li><span>1</span><p><strong>Keeps this attempt stopped</strong>The rejected key will never be submitted again.</p></li><li><span>2</span><p><strong>Returns you to the brief</strong>Correct the window or other highlighted details.</p></li><li><span>3</span><p><strong>Uses a new secure key</strong>Only your later, reviewed publish creates a new attempt.</p></li></> : recoveryResponseWindowEnded ? <><li><span>1</span><p><strong>Confirm the original result</strong>The same key checks whether this brief was already saved.</p></li><li><span>2</span><p><strong>The window stays ended</strong>No new partner can respond and recovery does not extend it.</p></li><li><span>3</span><p><strong>Check your dashboard</strong>Any offer received before the deadline remains sealed there.</p></li></> : <><li><span>1</span><p><strong>We check live coverage</strong>You see how many reviewed partners currently match.</p></li><li><span>2</span><p><strong>Eligible partners can respond</strong>Availability and a response are never guaranteed.</p></li><li><span>3</span><p><strong>You compare calmly</strong>Every received offer stays sealed and private.</p></li></>}</ol><p className="request-aside__note"><ShieldCheck size={16} /> {submissionRejected ? "Unlocking preserves the draft; it does not publish or replay the rejected attempt." : recoveryResponseWindowEnded ? "Recovery confirms the original publish; it never reopens a response window." : "Saving or publishing a request is free and carries no booking obligation."}</p></div>
        </aside>
      </div>
    </div>
  );
}
