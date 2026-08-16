import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  BadgeIndianRupee,
  CircleAlert,
  Clock3,
  FileCheck2,
  FileText,
  IndianRupee,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { categories, cities, formatCurrency, opportunities as exampleOpportunities } from "../data.js";
import { isServiceUnavailable, readApiResponse } from "../api.js";

function categoryLabel(value) {
  return categories.find((category) => category.id === value)?.name || value?.replaceAll("_", " ") || "Service";
}

function formatDate(value) {
  if (!value) return "To be confirmed";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? "To be confirmed" : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function closingLabel(value) {
  const milliseconds = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "Offer window closed";
  const hours = Math.ceil(milliseconds / 3_600_000);
  if (hours < 24) return `Closes in ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.ceil(hours / 24);
  return `Closes in ${days} day${days === 1 ? "" : "s"}`;
}

function toOpportunity(auction) {
  return {
    id: auction.id,
    reference: auction.id.slice(0, 8).toUpperCase(),
    service: auction.categories.map(categoryLabel).join(" · "),
    city: auction.city,
    date: formatDate(auction.eventDate),
    guests: auction.guestCount,
    budget: `${formatCurrency(auction.budgetMin)}–${formatCurrency(auction.budgetMax)}`,
    closes: closingLabel(auction.biddingEndsAt),
    notes: auction.requirements,
    demo: false,
  };
}

function VendorWorkspaceNav({ active, setActive, opportunityCount, offerCount }) {
  const items = [
    ["opportunities", BriefcaseBusiness, "Opportunities", opportunityCount],
    ["offers", FileText, "My offers", offerCount],
    ["messages", MessageSquareText, "Messages"],
    ["profile", Store, "Business profile"],
  ];
  return (
    <nav className="vendor-workspace-nav" aria-label="Vendor workspace">
      {items.map(([id, Icon, label, count]) => (
        <button className={active === id ? "is-active" : ""} type="button" key={id} onClick={() => setActive(id)} aria-pressed={active === id}>
          <Icon size={17} />{label}{Number(count) > 0 && <span>{count}</span>}
        </button>
      ))}
    </nav>
  );
}

function BidForm({ opportunity, onClose, notify, onOpenAuth, onSubmitted }) {
  const [form, setForm] = useState({ amount: "185000", proposal: "", deliverables: "", validUntil: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  function update(key, value) { setForm((current) => ({ ...current, [key]: value })); setError(""); }

  async function submit(event) {
    event.preventDefault();
    const deliverables = form.deliverables.split("\n").map((item) => item.trim()).filter(Boolean);
    if (Number(form.amount) < 10000) return setError("Enter a realistic offer amount of at least ₹10,000.");
    if (form.proposal.trim().length < 40) return setError("Explain your approach in at least 40 characters.");
    if (!deliverables.length || deliverables.some((item) => item.length < 2)) return setError("Add at least one clear deliverable, one per line.");
    if (form.validUntil && new Date(`${form.validUntil}T23:59:59`).getTime() < Date.now()) return setError("Choose a future validity date.");

    if (opportunity.demo) {
      setSaved(true);
      notify({ type: "warning", title: "Example draft complete", message: "This preview was not submitted to a live request." });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/v1/auctions/${opportunity.id}/bids`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          amount: Number(form.amount),
          currency: "INR",
          proposal: form.proposal.trim(),
          deliverables,
          validUntil: form.validUntil || undefined,
        }),
      });
      if (response.status === 401) { onOpenAuth(); throw Object.assign(new Error("Sign in with your approved vendor account to send this offer."), { code: "SIGN_IN" }); }
      await readApiResponse(response, "The offer could not be sent.");
      setSaved(true);
      onSubmitted?.();
      notify({ title: "Offer sent", message: "The couple can now review the complete proposal in their planning space." });
    } catch (requestError) {
      if (requestError.code === "SIGN_IN") setError(requestError.message);
      else if (isServiceUnavailable(requestError)) setError("The live service is unavailable. Your form is still open and nothing was submitted.");
      else setError(requestError.message || "The offer could not be sent. Please review the details and try again.");
    } finally {
      setLoading(false);
    }
  }

  if (saved) return <div className="bid-success"><CheckCircle2 size={25} /><div><strong>{opportunity.demo ? "Example offer complete" : "Offer sent successfully"}</strong><p>{opportunity.demo ? "No live request was changed." : "You can revisit it from My offers."}</p></div><button className="button button--small button--outline" type="button" onClick={onClose}>Close</button></div>;
  return (
    <form className="bid-form" onSubmit={submit} noValidate>
      <div className="bid-form__top"><div><div className="eyebrow">{opportunity.demo ? "Example offer preview" : `Offer for ${opportunity.reference}`}</div><h3>Build a clear, complete offer</h3></div><button className="icon-button icon-button--small" onClick={onClose} type="button" aria-label="Close offer form"><X size={18} /></button></div>
      {opportunity.demo && <div className="demo-catalog-note"><Sparkles size={15} /><p><strong>Preview only</strong> Completing this form will never call the live bidding API.</p></div>}
      <div className="form-grid"><label className="field"><span>Total offer</span><div className="input-wrap"><IndianRupee size={16} /><input value={form.amount} type="number" min="10000" step="5000" onChange={(event) => update("amount", event.target.value)} required /></div><small className="field-hint">{formatCurrency(Number(form.amount || 0))}</small></label><label className="field"><span>Valid until <small>Optional</small></span><input type="date" min={new Date().toISOString().slice(0, 10)} value={form.validUntil} onChange={(event) => update("validUntil", event.target.value)} /></label></div>
      <label className="field"><span>Your approach</span><textarea rows="4" minLength="40" value={form.proposal} onChange={(event) => update("proposal", event.target.value)} placeholder="Explain why your team and approach fit this celebration…" required /></label>
      <label className="field"><span>Deliverables <small>One per line</small></span><textarea rows="4" value={form.deliverables} onChange={(event) => update("deliverables", event.target.value)} placeholder={"Two lead photographers\n10-minute film\nPrivate online gallery"} required /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="bid-form__actions"><p><ShieldCheck size={15} /> {opportunity.demo ? "Preview data stays in this page." : "Your offer stays sealed."}</p><button className="button button--primary" disabled={loading} type="submit">{loading ? <span className="button-loader" aria-hidden="true" /> : <Send size={16} />}{loading ? "Sending…" : opportunity.demo ? "Complete example" : "Send sealed offer"}</button></div>
    </form>
  );
}

function OpportunityCard({ opportunity, notify, onOpenAuth, onSubmitted }) {
  const [open, setOpen] = useState(false);
  const [bidding, setBidding] = useState(false);
  return (
    <article className={`opportunity-card ${open ? "is-open" : ""}`}>
      <div className="opportunity-card__summary">
        <div className={`opportunity-match ${opportunity.demo ? "opportunity-match--demo" : ""}`}>{opportunity.demo ? <><Sparkles size={20} /><small>example</small></> : <><BriefcaseBusiness size={20} /><small>live brief</small></>}</div>
        <div className="opportunity-card__title"><div><span className={`status-pill ${opportunity.demo ? "" : "status-pill--teal"}`}><span /> {opportunity.demo ? "Example opportunity" : "Accepting offers"}</span><small>{opportunity.demo ? opportunity.id : opportunity.reference}</small></div><h3>{opportunity.service}</h3><div className="opportunity-facts"><span><MapPin size={14} /> {opportunity.city}</span><span><CalendarDays size={14} /> {opportunity.date}</span><span><Users size={14} /> {opportunity.guests} guests</span></div></div>
        <div className="opportunity-card__budget"><small>Stated range</small><strong>{opportunity.budget}</strong><span><Clock3 size={13} /> {opportunity.closes}</span></div>
        <button className="button button--small button--outline" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>{open ? "Hide brief" : "View brief"}<ChevronDown size={16} /></button>
      </div>
      {open && <div className="opportunity-card__detail"><div className="brief-detail"><h4>{opportunity.demo ? "Example couple brief" : "Couple’s brief"}</h4><p>{opportunity.notes}</p><div><span><Check size={14} /> Scope shared</span><span><Check size={14} /> Working range shared</span><span><ShieldCheck size={14} /> Contact private</span></div></div>{bidding ? <BidForm opportunity={opportunity} onClose={() => setBidding(false)} notify={notify} onOpenAuth={onOpenAuth} onSubmitted={onSubmitted} /> : <div className="opportunity-card__cta"><div><BadgeIndianRupee size={20} /><p><strong>{opportunity.demo ? "Want to try the offer flow?" : "Good fit for your business?"}</strong><span>{opportunity.demo ? "Preview the form without sending anything." : "Send a complete offer before the window closes."}</span></p></div><button className="button button--primary" type="button" onClick={() => setBidding(true)}>{opportunity.demo ? "Preview offer" : "Build offer"} <ArrowRight size={16} /></button></div>}</div>}
    </article>
  );
}

function VendorOffers({ offers, demo }) {
  if (!offers.length) return <div className="vendor-empty"><span><FileText size={28} /></span><h2>{demo ? "Example offers are not live" : "No submitted offers yet"}</h2><p>{demo ? "The live service is unavailable, so this preview does not invent proposal history." : "Open a suitable opportunity and send a complete proposal. It will appear here after submission."}</p></div>;
  return (
    <div className="vendor-tab-panel"><div className="vendor-panel-heading"><div><h2>My offers</h2><p>{demo ? "Example proposal history." : "Live proposals sent from this approved business."}</p></div></div><div className="vendor-offer-table"><div className="vendor-offer-table__head"><span>Request</span><span>Offer</span><span>Status</span><span>Updated</span></div>{offers.map((offer) => <div key={offer.id}><span><strong>{offer.auction?.title || offer.auctionId?.slice(0, 8).toUpperCase()}</strong><small>{offer.auction?.city || "Celebration brief"}</small></span><strong>{formatCurrency(offer.amount)}</strong><span className={`status-pill ${offer.status === "accepted" ? "status-pill--teal" : ""}`}><span /> {offer.status}</span><span>{formatDate(offer.updatedAt || offer.createdAt)}</span></div>)}</div></div>
  );
}

function VendorEmpty({ type }) {
  const Icon = type === "profile" ? Store : MessageSquareText;
  return <div className="vendor-empty"><span><Icon size={28} /></span><h2>{type === "profile" ? "Your business profile" : "No open conversations"}</h2><p>{type === "profile" ? "Complete onboarding to manage portfolio details, service areas and starting budgets here." : "When a couple chooses to connect after reviewing an offer, the conversation will appear here."}</p>{type === "profile" && <Link className="button button--primary" to="/vendor/onboarding">Complete profile</Link>}</div>;
}

function VendorAccessState({ icon: Icon, eyebrow, title, message, children }) {
  return <div className="shell vendor-access-state"><div className="vendor-empty"><span><Icon size={29} /></span><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{message}</p><div className="vendor-access-state__actions">{children}</div></div></div>;
}

export function VendorPage({ notify, onOpenAuth }) {
  const [active, setActive] = useState("opportunities");
  const [mode, setMode] = useState("loading");
  const [profile, setProfile] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  const [offers, setOffers] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setMode("loading");
      try {
        const meResponse = await fetch("/api/v1/auth/me", { credentials: "include", signal: controller.signal });
        if (meResponse.status === 401) { if (!controller.signal.aborted) setMode("guest"); return; }
        const mePayload = await readApiResponse(meResponse, "The partner workspace is temporarily unavailable.");
        const nextUser = mePayload.data?.user;
        const nextVendor = mePayload.data?.vendor;
        if (nextUser?.role !== "vendor" || !nextVendor) { if (!controller.signal.aborted) { setProfile({ user: nextUser, vendor: nextVendor }); setMode("not-vendor"); } return; }
        if (nextVendor.status !== "approved") { if (!controller.signal.aborted) { setProfile({ user: nextUser, vendor: nextVendor }); setMode("pending"); } return; }
        const [auctionResponse, offerResponse] = await Promise.all([
          fetch("/api/v1/auctions?limit=50", { credentials: "include", signal: controller.signal }),
          fetch("/api/v1/bids/mine", { credentials: "include", signal: controller.signal }),
        ]);
        const [auctionPayload, offerPayload] = await Promise.all([
          readApiResponse(auctionResponse, "Live opportunities could not be loaded."),
          readApiResponse(offerResponse, "Your submitted offers could not be loaded."),
        ]);
        if (controller.signal.aborted) return;
        setProfile({ user: nextUser, vendor: nextVendor });
        setOpportunities((Array.isArray(auctionPayload.data) ? auctionPayload.data : []).map(toOpportunity));
        setOffers(Array.isArray(offerPayload.data) ? offerPayload.data : []);
        setMode("live");
      } catch (error) {
        if (error?.name === "AbortError" || controller.signal.aborted) return;
        setMode("demo");
      }
    }
    load();
    return () => controller.abort();
  }, [refreshKey]);

  const exampleData = useMemo(() => exampleOpportunities.map((opportunity) => ({ ...opportunity, reference: opportunity.id, demo: true })), []);
  const visibleOpportunities = mode === "demo" ? exampleData : opportunities;

  if (mode === "loading") return <div className="vendor-page page-surface"><VendorAccessState icon={LoaderCircle} eyebrow="Loading partner workspace" title="Checking your business profile" message="Retrieving approval status, live opportunities and submitted offers." /></div>;
  if (mode === "guest") return <div className="vendor-page page-surface"><VendorAccessState icon={LockKeyhole} eyebrow="Private partner workspace" title="Sign in to see live opportunities" message="Only approved vendor accounts can read private briefs and submit offers."><button className="button button--primary" type="button" onClick={onOpenAuth}>Sign in</button><Link className="button button--outline" to="/vendor/onboarding">Apply to join</Link></VendorAccessState></div>;
  if (mode === "not-vendor") return <div className="vendor-page page-surface"><VendorAccessState icon={Store} eyebrow="Partner application" title="Introduce your business first" message="Complete the partner application before accessing private opportunities or sending proposals."><Link className="button button--primary" to="/vendor/onboarding">Start application</Link><Link className="button button--outline" to="/dashboard">Open couple workspace</Link></VendorAccessState></div>;
  if (mode === "pending") return <div className="vendor-page page-surface"><VendorAccessState icon={ShieldCheck} eyebrow="Application status" title={`Your application is ${profile.vendor.status}.`} message="Private briefs remain locked until the partner review is complete. Submission does not guarantee approval."><Link className="button button--outline" to="/marketplace">View public marketplace</Link></VendorAccessState></div>;

  const businessName = mode === "live" ? profile.vendor.businessName : "Example partner studio";
  const initials = businessName.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase();
  const underReview = offers.filter((offer) => ["submitted", "shortlisted"].includes(offer.status)).length;

  return (
    <div className="vendor-page page-surface">
      <section className="vendor-top"><div className="shell vendor-top__inner"><div className="vendor-business"><span>{initials}</span><div><small>{mode === "demo" ? "Preview vendor workspace" : "Approved partner workspace"}</small><strong>{businessName}</strong></div>{mode === "live" && <BadgeCheck size={18} />}</div><div className="vendor-top__actions"><Link className="text-link" to="/marketplace">View marketplace <ArrowRight size={15} /></Link><button className="icon-button" type="button" aria-label="Vendor notifications"><Sparkles size={18} /></button></div></div></section>
      <div className="shell vendor-shell">
        {mode === "demo" && <div className="demo-catalog-note vendor-preview-note"><CircleAlert size={16} /><p><strong>Preview workspace</strong> The live partner service could not be reached. Examples below never submit to real request IDs.</p><button className="text-button" type="button" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={14} /> Retry</button></div>}
        <div className="vendor-welcome"><div><div className="eyebrow">{mode === "demo" ? "Partner workspace preview" : "Partner workspace"}</div><h1>Good opportunities, clearly briefed.</h1><p>{mode === "demo" ? "Explore a clearly labelled example without changing live marketplace data." : "Focus on celebrations that fit your dates, services and working range."}</p></div>{mode === "demo" && <div className="vendor-demo-note"><ShieldCheck size={16} /><span>Example workspace data</span></div>}</div>
        <div className="vendor-metrics"><div><span className="card-icon"><BriefcaseBusiness size={18} /></span><p><small>{mode === "demo" ? "Example matches" : "Open opportunities"}</small><strong>{visibleOpportunities.length}</strong><em>{mode === "demo" ? "Preview" : "Live"}</em></p></div><div><span className="card-icon card-icon--teal"><FileCheck2 size={18} /></span><p><small>Offers under review</small><strong>{mode === "demo" ? "—" : underReview}</strong><em>{mode === "demo" ? "No live data" : "Live"}</em></p></div><div><span className="card-icon card-icon--marigold"><TrendingUp size={18} /></span><p><small>Profile status</small><strong>{mode === "demo" ? "Preview" : "Approved"}</strong><em>{mode === "demo" ? "Example" : "Verified"}</em></p></div><div><span className="card-icon card-icon--rose"><Star size={18} /></span><p><small>Review quality</small><strong>—</strong><em>No rating yet</em></p></div></div>
        <VendorWorkspaceNav active={active} setActive={setActive} opportunityCount={visibleOpportunities.length} offerCount={mode === "demo" ? 0 : offers.length} />
        {active === "opportunities" && <div className="vendor-tab-panel"><div className="vendor-panel-heading"><div><h2>{mode === "demo" ? "Example opportunities" : "Open opportunities"}</h2><p>{mode === "demo" ? "Static examples for evaluating the workflow." : "Private briefs available to your approved business."}</p></div></div>{visibleOpportunities.length ? <div className="opportunity-list">{visibleOpportunities.map((opportunity) => <OpportunityCard opportunity={opportunity} notify={notify} onOpenAuth={onOpenAuth} onSubmitted={() => setRefreshKey((value) => value + 1)} key={opportunity.id} />)}</div> : <div className="vendor-empty"><span><BriefcaseBusiness size={28} /></span><h2>No suitable live briefs right now</h2><p>New approved requests will appear here when they match your partner account.</p></div>}</div>}
        {active === "offers" && <VendorOffers offers={mode === "demo" ? [] : offers} demo={mode === "demo"} />}
        {active === "messages" && <VendorEmpty type="messages" />}
        {active === "profile" && <VendorEmpty type="profile" />}
      </div>
    </div>
  );
}

function OnboardingSuccess() {
  return <div className="onboarding-success"><span><CheckCircle2 size={32} /></span><div className="eyebrow">Application received</div><h1>Thank you for introducing your work.</h1><p>Our partner team will review the details and follow up about verification and next steps.</p><Link className="button button--primary" to="/vendor">Check application status <ArrowRight size={17} /></Link></div>;
}

function OnboardingError({ children }) {
  return children ? <small className="field-error" role="alert">{children}</small> : null;
}

export function VendorOnboardingPage({ notify, onOpenAuth }) {
  const [form, setForm] = useState({ businessName: "", legalName: "", category: "", city: "", serviceAreas: "", description: "", minBudget: "", maxBudget: "", phone: "", websiteUrl: "", instagramHandle: "" });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  function update(key, value) { setForm((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: "" })); setSubmitError(""); }

  async function submit(event) {
    event.preventDefault();
    const serviceAreas = form.serviceAreas.split(",").map((item) => item.trim()).filter(Boolean);
    const next = {};
    if (form.businessName.trim().length < 2) next.businessName = "Enter your trading name.";
    if (form.legalName.trim().length < 2) next.legalName = "Enter the registered name.";
    if (!form.category) next.category = "Choose a primary category.";
    if (!form.city) next.city = "Choose your home city.";
    if (!serviceAreas.length || serviceAreas.some((area) => area.length < 2)) next.serviceAreas = "Add at least one service area.";
    if (form.description.trim().length < 80) next.description = "Tell us about your work in at least 80 characters.";
    if (form.phone.trim().length < 7) next.phone = "Add a valid contact number.";
    if (Number(form.minBudget) < 1000) next.minBudget = "Enter a typical starting amount.";
    if (Number(form.maxBudget) < Number(form.minBudget)) next.maxBudget = "Maximum must be at least the minimum.";
    if (form.websiteUrl) {
      try {
        const protocol = new URL(form.websiteUrl).protocol;
        if (!['http:', 'https:'].includes(protocol)) next.websiteUrl = "Use a complete http:// or https:// address.";
      } catch { next.websiteUrl = "Use a complete website address."; }
    }
    if (Object.keys(next).length) { setErrors(next); return; }
    setLoading(true); setSubmitError("");
    const payload = { ...form, businessName: form.businessName.trim(), legalName: form.legalName.trim(), description: form.description.trim(), phone: form.phone.trim(), categories: [form.category], serviceAreas, minBudget: Number(form.minBudget), maxBudget: Number(form.maxBudget), currency: "INR", websiteUrl: form.websiteUrl || undefined, instagramHandle: form.instagramHandle || undefined };
    try {
      const response = await fetch("/api/v1/vendors/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload) });
      if (response.status === 401) { onOpenAuth(); throw Object.assign(new Error("Sign in or create an account, then submit this form again."), { code: "SIGN_IN" }); }
      await readApiResponse(response, "The application could not be submitted.");
      setSuccess(true); notify({ title: "Application received", message: "The partner team will review your profile." });
    } catch (requestError) {
      if (requestError.code === "SIGN_IN") setSubmitError(requestError.message);
      else if (isServiceUnavailable(requestError)) setSubmitError("The live service is unavailable. Your form is still open and nothing was stored or submitted.");
      else setSubmitError(requestError.message || "The application could not be submitted. Please review the fields and try again.");
    } finally { setLoading(false); }
  }

  if (success) return <div className="onboarding-page page-surface"><div className="shell"><OnboardingSuccess /></div></div>;
  return <div className="onboarding-page page-surface">
    <section className="onboarding-hero"><div className="shell"><div><Link className="back-link" to="/vendor"><ArrowLeft size={15} /> Vendor workspace</Link><div className="eyebrow eyebrow--light">Melaiva partner network</div><h1>Bring your best work.<br /><em>Meet better-fit briefs.</em></h1></div><p>We’re building a considered network of celebration professionals. Start with the essentials; verification follows after review.</p></div></section>
    <section className="shell onboarding-layout"><form className="onboarding-form" onSubmit={submit} noValidate><div className="onboarding-form__heading"><span><Store size={20} /></span><div><h2>Introduce your business</h2><p>Every field without an “optional” label is required for partner review.</p></div></div>
      <div className="form-grid"><label className="field"><span>Business name</span><input value={form.businessName} onChange={(event) => update("businessName", event.target.value)} placeholder="The Wedding Journal" aria-invalid={Boolean(errors.businessName)} required /><OnboardingError>{errors.businessName}</OnboardingError></label><label className="field"><span>Registered legal name</span><input value={form.legalName} onChange={(event) => update("legalName", event.target.value)} placeholder="Journal Studios Private Limited" aria-invalid={Boolean(errors.legalName)} required /><OnboardingError>{errors.legalName}</OnboardingError></label>
      <label className="field"><span>Primary service</span><div className="input-wrap input-wrap--select"><select value={form.category} onChange={(event) => update("category", event.target.value)} aria-invalid={Boolean(errors.category)} required><option value="">Choose a category</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select><ChevronDown size={15} /></div><OnboardingError>{errors.category}</OnboardingError></label><label className="field"><span>Home city</span><div className="input-wrap input-wrap--select"><select value={form.city} onChange={(event) => update("city", event.target.value)} aria-invalid={Boolean(errors.city)} required><option value="">Choose a city</option>{cities.map((city) => <option key={city}>{city}</option>)}</select><ChevronDown size={15} /></div><OnboardingError>{errors.city}</OnboardingError></label>
      <label className="field field--span-2"><span>Service areas</span><input value={form.serviceAreas} onChange={(event) => update("serviceAreas", event.target.value)} placeholder="Delhi NCR, Jaipur, Chandigarh" aria-invalid={Boolean(errors.serviceAreas)} required /><small className="field-hint">Separate cities with commas.</small><OnboardingError>{errors.serviceAreas}</OnboardingError></label>
      <label className="field"><span>Typical project from</span><div className="input-wrap"><IndianRupee size={16} /><input type="number" min="1000" value={form.minBudget} onChange={(event) => update("minBudget", event.target.value)} aria-invalid={Boolean(errors.minBudget)} required /></div><OnboardingError>{errors.minBudget}</OnboardingError></label><label className="field"><span>Typical project up to</span><div className="input-wrap"><IndianRupee size={16} /><input type="number" min="1000" value={form.maxBudget} onChange={(event) => update("maxBudget", event.target.value)} aria-invalid={Boolean(errors.maxBudget)} required /></div><OnboardingError>{errors.maxBudget}</OnboardingError></label>
      <label className="field field--span-2"><span>About your approach</span><textarea rows="6" minLength="80" maxLength="1000" value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Describe your point of view, strongest services, team and the celebrations you do best…" aria-invalid={Boolean(errors.description)} required /><div className="field-counter"><OnboardingError>{errors.description}</OnboardingError><span>{form.description.length} / 1,000</span></div></label>
      <label className="field"><span>Contact number</span><input type="tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} placeholder="+91 98765 43210" aria-invalid={Boolean(errors.phone)} required /><OnboardingError>{errors.phone}</OnboardingError></label><label className="field"><span>Website <small>Optional</small></span><input type="url" value={form.websiteUrl} onChange={(event) => update("websiteUrl", event.target.value)} placeholder="https://yourstudio.com" aria-invalid={Boolean(errors.websiteUrl)} /><OnboardingError>{errors.websiteUrl}</OnboardingError></label><label className="field field--span-2"><span>Instagram handle <small>Optional</small></span><input value={form.instagramHandle} onChange={(event) => update("instagramHandle", event.target.value)} placeholder="@yourstudio" /></label></div>
      {submitError && <p className="form-error onboarding-submit-error" role="alert">{submitError}</p>}
      <button className="button button--primary button--large button--wide" disabled={loading} type="submit">{loading ? <span className="button-loader" aria-hidden="true" /> : <Send size={17} />}{loading ? "Submitting…" : "Submit for review"}</button><p className="onboarding-form__privacy"><ShieldCheck size={14} /> Your business details are used for partner review and opportunity matching.</p>
    </form><aside className="onboarding-aside"><div className="onboarding-aside__card"><Sparkles size={22} /><h2>Built for serious opportunities</h2><ul><li><Check size={15} /><span><strong>Structured briefs</strong>See dates, scope and working range before investing time.</span></li><li><Check size={15} /><span><strong>Sealed offers</strong>Compete on fit and value without seeing another price.</span></li><li><Check size={15} /><span><strong>Private connection</strong>Contact details unlock only after mutual interest.</span></li></ul></div><div className="onboarding-aside__note"><ShieldCheck size={18} /><p><strong>Verification is human-reviewed.</strong> Submission does not guarantee acceptance. We may request portfolio evidence, identity records and client references.</p></div></aside></section>
  </div>;
}
