import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  BadgeIndianRupee,
  Clock3,
  FileCheck2,
  MapPin,
  PartyPopper,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { categories, cities, formatCurrency, vendors } from "../data.js";
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

function CelebrationStep({ data, update, errors }) {
  return (
    <div className="wizard-panel">
      <div className="wizard-panel__heading"><span>01</span><div><div className="eyebrow">The essentials</div><h2>Tell us about the celebration</h2><p>Approximate details are enough to find the right first matches.</p></div></div>
      <div className="form-grid">
        <label className="field field--span-2"><span>Give this request a name</span><input value={data.title} onChange={(event) => update("title", event.target.value)} placeholder="Aarav & Meera — Jaipur celebration" /><FieldError>{errors.title}</FieldError></label>
        <label className="field"><span>Celebration type</span><div className="input-wrap input-wrap--select"><select value={data.eventType} onChange={(event) => update("eventType", event.target.value)}>{eventTypes.map((type) => <option key={type}>{type}</option>)}</select><ChevronDown size={15} /></div></label>
        <label className="field"><span>Primary date</span><div className="input-wrap"><CalendarDays size={17} /><input type="date" value={data.eventDate} onChange={(event) => update("eventDate", event.target.value)} /></div><FieldError>{errors.eventDate}</FieldError></label>
        <label className="field"><span>City or destination</span><div className="input-wrap input-wrap--select"><MapPin size={17} /><select value={data.city} onChange={(event) => update("city", event.target.value)}><option value="">Choose a city</option>{cities.map((city) => <option key={city}>{city}</option>)}</select><ChevronDown size={15} /></div><FieldError>{errors.city}</FieldError></label>
        <label className="field"><span>Estimated guests</span><div className="input-wrap"><Users size={17} /><input type="number" min="20" max="5000" inputMode="numeric" value={data.guestCount} onChange={(event) => update("guestCount", event.target.value)} /></div><FieldError>{errors.guestCount}</FieldError></label>
      </div>
    </div>
  );
}

function ServicesStep({ data, toggle, errors, selectedVendor }) {
  return (
    <div className="wizard-panel">
      <div className="wizard-panel__heading"><span>02</span><div><div className="eyebrow">The team</div><h2>What do you need help finding?</h2><p>Choose one or several. Each category receives only the relevant part of your brief.</p></div></div>
      {selectedVendor && <div className="selected-vendor-note"><div className={`vendor-card__monogram tone--${selectedVendor.tone}`}>{selectedVendor.initials}</div><p><strong>{selectedVendor.name} is included</strong><span>Your request will be routed to this partner first, subject to availability.</span></p><CheckCircle2 size={20} /></div>}
      <div className="service-choice-grid">
        {categories.map((category) => {
          const selected = data.categories.includes(category.id);
          return <label className={selected ? "is-selected" : ""} key={category.id}><input type="checkbox" checked={selected} onChange={() => toggle(category.id)} /><span className="service-choice__check"><Check size={15} /></span><div><strong>{category.name}</strong><small>{category.short}</small></div></label>;
        })}
      </div>
      <FieldError>{errors.categories}</FieldError>
      <div className="wizard-assurance"><ShieldCheck size={18} /><p><strong>Relevant, not relentless.</strong> We limit each request to suitable partners so you receive fewer, more considered offers.</p></div>
    </div>
  );
}

function BudgetStep({ data, update, errors }) {
  return (
    <div className="wizard-panel">
      <div className="wizard-panel__heading"><span>03</span><div><div className="eyebrow">Useful context</div><h2>Set a range, then add the nuance</h2><p>A realistic range helps partners build an offer that can actually work.</p></div></div>
      <div className="form-grid">
        <label className="field"><span>Budget from</span><div className="input-wrap"><BadgeIndianRupee size={17} /><input type="number" inputMode="numeric" min="10000" step="10000" value={data.budgetMin} onChange={(event) => update("budgetMin", event.target.value)} /></div><small className="field-hint">{formatCurrency(Number(data.budgetMin || 0))}</small><FieldError>{errors.budgetMin}</FieldError></label>
        <label className="field"><span>Budget up to</span><div className="input-wrap"><BadgeIndianRupee size={17} /><input type="number" inputMode="numeric" min="10000" step="10000" value={data.budgetMax} onChange={(event) => update("budgetMax", event.target.value)} /></div><small className="field-hint">{formatCurrency(Number(data.budgetMax || 0))}</small><FieldError>{errors.budgetMax}</FieldError></label>
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
          <div><dt>Services</dt><dd>{data.categories.map((id) => categories.find((item) => item.id === id)?.name).join(", ")}</dd></div>
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
  const selectedVendor = vendors.find((vendor) => vendor.id === vendorParam);
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
  const [data, setData] = useState({
    title: "",
    eventType: "Wedding",
    eventDate: defaultEventDate,
    city: selectedVendor?.city || "",
    guestCount: "250",
    categories: categoryParam && categories.some((item) => item.id === categoryParam) ? [categoryParam] : [],
    budgetMin: "200000",
    budgetMax: "500000",
    biddingEndsAt: defaultEnd,
    requirements: "",
  });

  function update(key, value) {
    if (key === "requirements" && value.length > 1500) return;
    setData((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  }
  function toggleCategory(id) {
    setData((current) => ({ ...current, categories: current.categories.includes(id) ? current.categories.filter((item) => item !== id) : [...current.categories, id] }));
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
    if (targetStep === 2 && !data.categories.length) next.categories = "Choose at least one service.";
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
    if (!validate(step)) return;
    setStep((current) => Math.min(4, current + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit() {
    setSubmitting(true);
    const payload = {
      title: data.title.trim(), eventType: data.eventType.toLowerCase().replaceAll(" ", "_"), eventDate: data.eventDate, city: data.city,
      guestCount: Number(data.guestCount), budgetMin: Number(data.budgetMin), budgetMax: Number(data.budgetMax), currency: "INR",
      categories: data.categories, requirements: `${data.requirements}${selectedVendor ? `\nPreferred partner: ${selectedVendor.name}` : ""}`,
      biddingEndsAt: new Date(data.biddingEndsAt).toISOString(),
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
          {step === 1 && <CelebrationStep data={data} update={update} errors={errors} />}
          {step === 2 && <ServicesStep data={data} toggle={toggleCategory} errors={errors} selectedVendor={selectedVendor} />}
          {step === 3 && <BudgetStep data={data} update={update} errors={errors} />}
          {step === 4 && <ReviewStep data={data} selectedVendor={selectedVendor} />}
          <div className="wizard-actions">
            {step > 1 ? <button className="button button--ghost" onClick={() => setStep((current) => current - 1)}><ArrowLeft size={17} /> Back</button> : <Link className="button button--ghost" to="/marketplace"><ArrowLeft size={17} /> Marketplace</Link>}
            {step < 4 ? <button className="button button--primary" onClick={next}>Continue <ArrowRight size={17} /></button> : <button className="button button--primary" onClick={submit} disabled={submitting}>{submitting ? <span className="button-loader" /> : <Send size={17} />}{submitting ? "Publishing…" : "Publish sealed request"}</button>}
          </div>
        </div>
        <aside className="request-aside">
          <div className="request-aside__sticky"><Sparkles size={20} /><h2>What happens next?</h2><ol><li><span>1</span><p><strong>We check the brief</strong>Clear scope means useful offers.</p></li><li><span>2</span><p><strong>Suitable partners respond</strong>Each offer stays sealed and private.</p></li><li><span>3</span><p><strong>You compare calmly</strong>See price, inclusions, terms and fit.</p></li></ol><p className="request-aside__note"><ShieldCheck size={16} /> Publishing a request is free and carries no booking obligation.</p></div>
        </aside>
      </div>
    </div>
  );
}
