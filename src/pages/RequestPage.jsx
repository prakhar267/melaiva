import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  BadgeIndianRupee,
  CircleAlert,
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
    initials: name.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase(),
    tone: ["marigold", "rose", "teal", "aubergine"][String(vendor.id || vendor.slug || "x").length % 4],
  };
}

function PreferredVendorContext({ resolution, vendorSlug, onContinueWithout, onRetry }) {
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
          <div className="preferred-vendor-context__status"><CheckCircle2 size={16} /><span>Will receive a direct invitation</span></div>
          <button className="text-button" type="button" onClick={onContinueWithout}>Continue without this partner</button>
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

function CelebrationStep({ data, update, errors, selectedVendor }) {
  const cityOptions = [...new Set([...cities, data.city, selectedVendor?.city].filter(Boolean))];
  return (
    <div className="wizard-panel">
      <div className="wizard-panel__heading"><span>01</span><div><div className="eyebrow">The essentials</div><h2>Tell us about the celebration</h2><p>Approximate details are enough to find the right first matches.</p></div></div>
      <div className="form-grid">
        <label className="field field--span-2"><span>Give this request a name</span><input value={data.title} onChange={(event) => update("title", event.target.value)} placeholder="Aarav & Meera — Jaipur celebration" /><FieldError>{errors.title}</FieldError></label>
        <label className="field"><span>Celebration type</span><div className="input-wrap input-wrap--select"><select value={data.eventType} onChange={(event) => update("eventType", event.target.value)}>{eventTypes.map((type) => <option key={type}>{type}</option>)}</select><ChevronDown size={15} /></div></label>
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

function ReviewStep({ data, selectedVendor }) {
  return (
    <div className="wizard-panel">
      <div className="wizard-panel__heading"><span>04</span><div><div className="eyebrow">Ready when you are</div><h2>Review your request</h2><p>Partners receive the brief below. Your contact details stay private until you choose to connect.</p></div></div>
      <div className="review-card">
        <div className="review-card__header"><div><small>{data.eventType}</small><h3>{data.title}</h3><p><MapPin size={14} /> {data.city}<span /> <CalendarDays size={14} /> {new Date(`${data.eventDate}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}<span /> <Users size={14} /> {data.guestCount} guests</p></div><span className="status-pill"><span /> Draft</span></div>
        <dl className="review-details">
          <div><dt>Service</dt><dd>{categories.find((item) => item.id === data.categories[0])?.name || "Not selected"}</dd></div>
          <div><dt>Working range</dt><dd>{formatCurrency(Number(data.budgetMin))} – {formatCurrency(Number(data.budgetMax))}</dd></div>
          <div><dt>Offer window</dt><dd>Until {new Date(data.biddingEndsAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</dd></div>
          {selectedVendor && <div><dt>Requested partner</dt><dd>{selectedVendor.name}</dd></div>}
        </dl>
        <div className="review-brief"><h4>The brief</h4><p>{data.requirements}</p></div>
      </div>
      <div className="review-assurances"><div><ShieldCheck size={18} /><span><strong>Private by design</strong>Your phone and email are never shown publicly.</span></div><div><FileCheck2 size={18} /><span><strong>Comparable offers</strong>Partners answer against the same scope.</span></div><div><Sparkles size={18} /><span><strong>No obligation</strong>Review every offer before deciding.</span></div></div>
    </div>
  );
}

function SuccessState({ result }) {
  return (
    <div className="request-success">
      <span className="request-success__icon"><PartyPopper size={34} /></span>
      <div className="eyebrow">Request is live</div>
      <h1>Your best-fit partners can now respond.</h1>
      <p>You’ll see each sealed offer in your dashboard. We’ll let you know when there’s something worth reviewing.</p>
      <div className="request-success__reference"><small>Reference</small><strong>{result}</strong></div>
      <div className="request-success__actions"><Link className="button button--primary" to="/dashboard">Open my dashboard <ArrowRight size={17} /></Link><Link className="button button--outline" to="/marketplace">Keep exploring</Link></div>
    </div>
  );
}

export function RequestPage({ notify, onOpenAuth }) {
  const [params] = useSearchParams();
  const categoryParam = params.get("category");
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
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [idempotencyKey] = useState(() => createIdempotencyKey("request"));
  const [dismissedVendorParam, setDismissedVendorParam] = useState(null);
  const [vendorRetryKey, setVendorRetryKey] = useState(0);
  const [vendorResolution, setVendorResolution] = useState(() => ({ status: vendorParam ? "loading" : "none", vendor: null, message: "" }));
  const touchedFields = useRef({ city: false, categories: false });
  const [data, setData] = useState({
    title: "",
    eventType: "Wedding",
    eventDate: defaultEventDate,
    city: "",
    guestCount: "250",
    categories: categoryParam && categories.some((item) => item.id === categoryParam) ? [categoryParam] : [],
    budgetMin: "200000",
    budgetMax: "500000",
    biddingEndsAt: defaultEnd,
    requirements: "",
  });

  useEffect(() => {
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
        const payload = await readApiResponse(response, "The selected partner could not be verified.");
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
  }, [dismissedVendorParam, vendorParam, vendorRetryKey]);

  const resolvedVendor = vendorResolution.status === "resolved" ? vendorResolution.vendor : null;
  const vendorMismatch = useMemo(() => {
    if (!resolvedVendor) return "";
    const normalize = (value) => String(value || "").trim().toLowerCase();
    const categoryMatches = data.categories.some((category) => resolvedVendor.categories.map(normalize).includes(normalize(category)));
    const cityMatches = resolvedVendor.serviceAreas.map(normalize).includes(normalize(data.city));
    if (!categoryMatches && !cityMatches) return "The chosen service and city are outside this partner’s approved profile.";
    if (!categoryMatches) return "The chosen service does not match this partner’s approved categories.";
    if (!cityMatches) return "This city is outside the partner’s approved service areas.";
    return "";
  }, [data.categories, data.city, resolvedVendor]);
  const displayedVendorResolution = vendorMismatch
    ? { status: "incompatible", vendor: resolvedVendor, message: `${vendorMismatch} Update the brief or explicitly continue without this partner.` }
    : vendorResolution;
  const selectedVendor = resolvedVendor && !vendorMismatch ? resolvedVendor : null;
  const vendorBlocking = Boolean(vendorParam) && (["loading", "unavailable"].includes(vendorResolution.status) || Boolean(vendorMismatch));

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
  function validate(targetStep) {
    const next = {};
    if (targetStep === 1) {
      if (data.title.trim().length < 5) next.title = "Add a request name of at least 5 characters.";
      if (!data.eventDate) next.eventDate = "Choose an approximate date.";
      else if (new Date(`${data.eventDate}T23:59:59`).getTime() <= Date.now()) next.eventDate = "Choose a future celebration date.";
      if (!data.city) next.city = "Choose a city.";
      if (Number(data.guestCount) < 20) next.guestCount = "Enter at least 20 guests.";
    }
    if (targetStep === 2 && data.categories.length !== 1) next.categories = "Choose one service for this request.";
    if (targetStep === 3) {
      if (Number(data.budgetMin) < 10000) next.budgetMin = "Enter a starting budget.";
      if (Number(data.budgetMax) <= Number(data.budgetMin)) next.budgetMax = "Maximum must be higher than the minimum.";
      if (!data.biddingEndsAt || new Date(data.biddingEndsAt) <= new Date()) next.biddingEndsAt = "Choose a future closing time.";
      else if (data.eventDate && new Date(data.biddingEndsAt).getTime() >= new Date(`${data.eventDate}T00:00:00`).getTime()) next.biddingEndsAt = "The offer window must close before the celebration date.";
      if (data.requirements.trim().length < 30) next.requirements = "Add at least 30 characters so partners can respond meaningfully.";
    }
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
    if (vendorBlocking) return;
    setSubmitting(true);
    const payload = {
      title: data.title.trim(), eventType: data.eventType.toLowerCase().replaceAll(" ", "_"), eventDate: data.eventDate, city: data.city,
      guestCount: Number(data.guestCount), budgetMin: Number(data.budgetMin), budgetMax: Number(data.budgetMax), currency: "INR",
      categories: data.categories, requirements: data.requirements,
      biddingEndsAt: new Date(data.biddingEndsAt).toISOString(),
      ...(selectedVendor?.id ? { preferredVendorId: selectedVendor.id } : {}),
    };
    try {
      const response = await fetch("/api/v1/auctions", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, credentials: "include", body: JSON.stringify(payload) });
      if (response.status === 401) {
        onOpenAuth();
        throw new Error("SIGN_IN");
      }
      const body = await readApiResponse(response, "Could not publish request");
      setResult(body.data?.id || body.data?.reference || `MLV-${Date.now().toString().slice(-6)}`);
      notify({ title: "Your request is live", message: "Suitable partners can now send sealed offers." });
    } catch (requestError) {
      if (requestError.message === "SIGN_IN") {
        notify({ type: "warning", title: "Sign in to publish", message: "Your brief will stay here while you sign in." });
      } else if (isServiceUnavailable(requestError)) {
        notify({ type: "warning", title: "Live service unavailable", message: "Your brief remains open on this page; nothing was stored or submitted." });
      } else {
        notify({ type: "error", title: "Request not published", message: requestError.message });
      }
    } finally { setSubmitting(false); }
  }

  if (result) return <div className="request-page page-surface"><div className="shell"><SuccessState result={result} /></div></div>;

  return (
    <div className="request-page page-surface">
      <section className="request-header"><div className="shell"><div><div className="eyebrow">Sealed offer request</div><h1>One good brief. Better conversations.</h1></div><p>Share the context once, then compare thoughtful offers without exposing your details or anyone else’s price.</p></div></section>
      <div className="shell request-layout">
        <div className="wizard-card">
          <Stepper step={step} />
          <PreferredVendorContext
            resolution={displayedVendorResolution}
            vendorSlug={vendorParam}
            onContinueWithout={() => setDismissedVendorParam(vendorParam)}
            onRetry={() => { setDismissedVendorParam(null); setVendorRetryKey((value) => value + 1); }}
          />
          {step === 1 && <CelebrationStep data={data} update={update} errors={errors} selectedVendor={selectedVendor} />}
          {step === 2 && <ServicesStep data={data} select={selectCategory} errors={errors} />}
          {step === 3 && <BudgetStep data={data} update={update} errors={errors} />}
          {step === 4 && <ReviewStep data={data} selectedVendor={selectedVendor} />}
          <div className="wizard-actions">
            {step > 1 ? <button className="button button--ghost" onClick={() => setStep((current) => current - 1)}><ArrowLeft size={17} /> Back</button> : <Link className="button button--ghost" to="/marketplace"><ArrowLeft size={17} /> Marketplace</Link>}
            {step < 4 ? <button className="button button--primary" onClick={next} disabled={vendorBlocking}>{vendorResolution.status === "loading" ? "Confirming partner…" : "Continue"} {!vendorBlocking && <ArrowRight size={17} />}</button> : <button className="button button--primary" onClick={submit} disabled={submitting || vendorBlocking}>{submitting ? <span className="button-loader" /> : <Send size={17} />}{submitting ? "Publishing…" : "Publish sealed request"}</button>}
          </div>
        </div>
        <aside className="request-aside">
          <div className="request-aside__sticky"><Sparkles size={20} /><h2>What happens next?</h2><ol><li><span>1</span><p><strong>We check the brief</strong>Clear scope means useful offers.</p></li><li><span>2</span><p><strong>Suitable partners respond</strong>Each offer stays sealed and private.</p></li><li><span>3</span><p><strong>You compare calmly</strong>See price, inclusions, terms and fit.</p></li></ol><p className="request-aside__note"><ShieldCheck size={16} /> Publishing a request is free and carries no booking obligation.</p></div>
        </aside>
      </div>
    </div>
  );
}
