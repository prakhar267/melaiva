import { useEffect, useMemo, useRef, useState } from "react";
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
  Handshake,
  IndianRupee,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  MessageSquareText,
  Plus,
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
import { BookingMessages } from "../components/BookingMessages.jsx";
import { targetScrollLeftForControl } from "../components/bookingMessages.js";

function categoryLabel(value) {
  return categories.find((category) => category.id === value)?.name || value?.replaceAll("_", " ") || "Service";
}

function formatDate(value) {
  if (!value) return "To be confirmed";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? "To be confirmed" : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function hasStructuredAwardTerms(offer) {
  if (offer?.structuredTermsProvided === false) return false;
  return typeof offer?.cancellationTerms === "string" && offer.cancellationTerms.trim().length > 0
    && typeof offer?.deliveryPlan === "string" && offer.deliveryPlan.trim().length > 0
    && typeof offer?.gstIncluded === "boolean"
    && Number.isInteger(Number(offer?.gstRate))
    && ["included", "fixed_fee", "not_applicable"].includes(offer?.travelPolicy);
}

function awardGstSummary(offer) {
  if (!hasStructuredAwardTerms(offer)) return "Not provided";
  const rate = Number(offer.gstRate);
  if (rate === 0) return "Not applicable (0%)";
  return `${rate}% GST ${offer.gstIncluded ? "included" : "additional"}`;
}

function awardTravelSummary(offer) {
  if (!hasStructuredAwardTerms(offer)) return "Not provided";
  if (offer.travelPolicy === "included") return "Included in quoted amount";
  if (offer.travelPolicy === "not_applicable") return "Not applicable";
  return Number.isInteger(Number(offer.travelFee)) && Number(offer.travelFee) > 0
    ? `${formatCurrency(offer.travelFee)} fixed fee`
    : "Fixed fee not provided";
}

function VendorAwardTermList({ items, emptyLabel = "Not provided", tone = "included", formatItem = (item) => item }) {
  if (!Array.isArray(items)) return <p className="offer-term-empty">{emptyLabel}</p>;
  if (!items.length) return <p className="offer-term-empty">{tone === "excluded" ? "No exclusions declared" : emptyLabel}</p>;
  return <ul className={`offer-term-list offer-term-list--${tone}`}>{items.map((item, index) => <li key={`${typeof item === "string" ? item : item?.name || "item"}-${index}`}>{tone === "excluded" ? <CircleAlert size={13} /> : <Check size={13} />}<span>{formatItem(item)}</span></li>)}</ul>;
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
    biddingEndsAt: auction.biddingEndsAt,
    notes: auction.requirements,
    directInvite: Boolean(auction.directInvite),
    directInviteStatus: auction.directInviteStatus || null,
    demo: false,
  };
}

function directInviteLabel(status) {
  if (status === "responded") return "Direct invite · offer sent";
  if (status === "unavailable") return "Direct invite unavailable";
  return "Direct invitation";
}

function createAddOn() {
  return {
    id: globalThis.crypto?.randomUUID?.() || `add-on-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: "",
    amount: "",
  };
}

function VendorWorkspaceNav({ active, setActive, opportunityCount, offerCount, awardCount, conversationCount, restricted = false }) {
  const navRef = useRef(null);
  const buttonRefs = useRef(new Map());
  const allItems = [
    ["opportunities", BriefcaseBusiness, "Opportunities", opportunityCount],
    ["offers", FileText, "My offers", offerCount],
    ["awards", Handshake, "Award handoffs", awardCount],
    ["messages", MessageSquareText, "Messages", conversationCount],
    ["profile", Store, "Business profile"],
  ];
  const items = restricted ? allItems.filter(([id]) => ["awards", "messages"].includes(id)) : allItems;
  useEffect(() => {
    let frame = null;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    function revealActive(behavior = "auto") {
      const nav = navRef.current;
      const button = buttonRefs.current.get(active);
      if (!nav || !button) return;
      const navRect = nav.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const left = targetScrollLeftForControl({
        scrollLeft: nav.scrollLeft,
        clientWidth: nav.clientWidth,
        itemOffsetLeft: nav.scrollLeft + buttonRect.left - navRect.left,
        itemOffsetWidth: buttonRect.width,
        maxScrollLeft: nav.scrollWidth - nav.clientWidth,
      });
      if (Math.abs(left - nav.scrollLeft) < 1) return;
      nav.scrollTo({ left, behavior });
    }

    function scheduleReveal() {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => revealActive("auto"));
    }

    revealActive(reducedMotion ? "auto" : "smooth");
    window.addEventListener("resize", scheduleReveal);
    document.fonts?.addEventListener?.("loadingdone", scheduleReveal);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleReveal);
      document.fonts?.removeEventListener?.("loadingdone", scheduleReveal);
    };
  }, [active, awardCount, conversationCount, offerCount, opportunityCount, restricted]);
  return (
    <nav className="vendor-workspace-nav" aria-label="Vendor workspace" ref={navRef}>
      {items.map(([id, Icon, label, count]) => (
        <button ref={(node) => { if (node) buttonRefs.current.set(id, node); else buttonRefs.current.delete(id); }} className={active === id ? "is-active" : ""} type="button" key={id} onClick={() => setActive(id)} aria-pressed={active === id}>
          <Icon size={17} />{label}{Number(count) > 0 && <span>{count}</span>}
        </button>
      ))}
    </nav>
  );
}

function BidForm({ opportunity, onClose, notify, onOpenAuth, onSubmitted }) {
  const [form, setForm] = useState({
    amount: "185000",
    proposal: "",
    deliverables: "",
    exclusions: "",
    noExclusions: false,
    gstTreatment: "included",
    gstRate: "18",
    travelPolicy: "included",
    travelFee: "",
    addOns: [],
    cancellationTerms: "",
    deliveryPlan: "",
    validUntil: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  function update(key, value) { setForm((current) => ({ ...current, [key]: value })); setError(""); }
  function addAddOn() { setForm((current) => ({ ...current, addOns: [...current.addOns, createAddOn()] })); setError(""); }
  function updateAddOn(id, key, value) { setForm((current) => ({ ...current, addOns: current.addOns.map((item) => item.id === id ? { ...item, [key]: value } : item) })); setError(""); }
  function removeAddOn(id) { setForm((current) => ({ ...current, addOns: current.addOns.filter((item) => item.id !== id) })); setError(""); }

  async function submit(event) {
    event.preventDefault();
    const deliverables = form.deliverables.split("\n").map((item) => item.trim()).filter(Boolean);
    const exclusions = form.noExclusions ? [] : form.exclusions.split("\n").map((item) => item.trim()).filter(Boolean);
    const amount = Number(form.amount);
    const gstRate = Number(form.gstRate);
    const addOns = form.addOns
      .filter((item) => item.name.trim() || item.amount !== "")
      .map((item) => ({ name: item.name.trim(), amount: Number(item.amount) }));
    const travelFee = form.travelPolicy === "fixed_fee" ? Number(form.travelFee) : undefined;
    if (!Number.isInteger(amount) || amount < 10000 || amount > 1_000_000_000) return setError("Enter a whole-rupee offer amount from ₹10,000 to ₹1,00,00,00,000.");
    if (form.proposal.trim().length < 40) return setError("Explain your approach in at least 40 characters.");
    if (!deliverables.length || deliverables.some((item) => item.length < 2)) return setError("Add at least one clear deliverable, one per line.");
    if (deliverables.length > 30 || deliverables.some((item) => item.length > 200)) return setError("Use no more than 30 inclusions, with up to 200 characters per line.");
    if (!form.noExclusions && (!exclusions.length || exclusions.some((item) => item.length < 2))) return setError("State at least one exclusion or confirm that there are no exclusions.");
    if (exclusions.length > 30 || exclusions.some((item) => item.length > 200)) return setError("Use no more than 30 exclusions, with up to 200 characters per line.");
    if (form.gstRate.trim() === "" || !Number.isInteger(gstRate) || gstRate < 0 || gstRate > 28) return setError("Enter a GST rate from 0% to 28%. Use 0% when GST does not apply.");
    if (form.travelPolicy === "fixed_fee" && (!Number.isInteger(travelFee) || travelFee <= 0 || travelFee > 1_000_000_000)) return setError("Enter a positive whole-rupee travel fee up to ₹1,00,00,00,000.");
    if (addOns.some((item) => item.name.length < 2 || !Number.isInteger(item.amount) || item.amount <= 0 || item.amount > 1_000_000_000)) return setError("Complete each add-on with a clear name and positive whole-rupee price, or remove the row.");
    if (new Set(addOns.map((item) => item.name.toLowerCase())).size !== addOns.length) return setError("Give every add-on a unique name.");
    if (addOns.reduce((sum, item) => sum + item.amount, 0) > 1_000_000_000) return setError("Keep the combined add-on value at or below ₹1,00,00,00,000.");
    if (form.cancellationTerms.trim().length < 20) return setError("Explain the cancellation terms in at least 20 characters.");
    if (form.deliveryPlan.trim().length < 20) return setError("Explain the delivery plan in at least 20 characters.");
    if (form.validUntil) {
      const validityTimestamp = new Date(`${form.validUntil}T23:59:59`).getTime();
      if (validityTimestamp < Date.now()) return setError("Choose a future validity date.");
      if (opportunity.biddingEndsAt && validityTimestamp <= new Date(opportunity.biddingEndsAt).getTime()) return setError("Choose a validity date after the offer window closes.");
    }

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
          amount,
          currency: "INR",
          proposal: form.proposal.trim(),
          deliverables,
          exclusions,
          gstIncluded: form.gstTreatment === "included",
          gstRate,
          travelPolicy: form.travelPolicy,
          ...(travelFee ? { travelFee } : {}),
          addOns,
          cancellationTerms: form.cancellationTerms.trim(),
          deliveryPlan: form.deliveryPlan.trim(),
          validUntil: form.validUntil || undefined,
        }),
      });
      if (response.status === 401) { onOpenAuth(); throw Object.assign(new Error("Sign in with your approved vendor account to send this offer."), { code: "SIGN_IN" }); }
      await readApiResponse(response, "The offer could not be sent.");
      setSaved(true);
      onSubmitted?.();
      notify({ title: "Offer sent", message: "The proposal stays sealed until the offer window closes, then the couple can compare it privately." });
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
      <section className="bid-form__section" aria-labelledby={`offer-scope-${opportunity.id}`}>
        <div className="bid-form__section-heading"><span>01</span><div><h4 id={`offer-scope-${opportunity.id}`}>Scope and quoted amount</h4><p>Separate what is included from what the couple still needs to arrange.</p></div></div>
        <div className="form-grid"><label className="field"><span>Quoted amount</span><div className="input-wrap"><IndianRupee size={16} /><input value={form.amount} type="number" min="10000" max="1000000000" step="1000" onChange={(event) => update("amount", event.target.value)} required /></div><small className="field-hint">{formatCurrency(Number(form.amount || 0))}, before any additional GST, travel or add-ons stated below.</small></label><label className="field"><span>Valid until <small>Optional</small></span><input type="date" min={new Date().toISOString().slice(0, 10)} value={form.validUntil} onChange={(event) => update("validUntil", event.target.value)} /><small className="field-hint">Leave blank only when the quote has no stated expiry.</small></label></div>
        <label className="field"><span>Your approach</span><textarea rows="4" minLength="40" maxLength="8000" value={form.proposal} onChange={(event) => update("proposal", event.target.value)} placeholder="Explain why your team and approach fit this celebration…" required /></label>
        <div className="form-grid"><label className="field"><span>Inclusions <small>One per line</small></span><textarea rows="5" value={form.deliverables} onChange={(event) => update("deliverables", event.target.value)} placeholder={"Two lead photographers\n10-minute film\nPrivate online gallery"} required /></label><div className="field"><span id={`offer-exclusions-${opportunity.id}`}>Exclusions <small>One per line</small></span><textarea rows="5" aria-labelledby={`offer-exclusions-${opportunity.id}`} value={form.exclusions} onChange={(event) => update("exclusions", event.target.value)} placeholder={"Travel outside Delhi NCR\nPhysical album"} disabled={form.noExclusions} required={!form.noExclusions} /><label className="bid-inline-check"><input type="checkbox" checked={form.noExclusions} onChange={(event) => update("noExclusions", event.target.checked)} /><span><Check size={13} /></span><strong>No exclusions beyond the inclusions listed</strong></label></div></div>
      </section>

      <section className="bid-form__section" aria-labelledby={`offer-costs-${opportunity.id}`}>
        <div className="bid-form__section-heading"><span>02</span><div><h4 id={`offer-costs-${opportunity.id}`}>Taxes, travel and add-ons</h4><p>Make every possible addition to the quoted amount visible now.</p></div></div>
        <div className="form-grid">
          <label className="field"><span>GST treatment</span><div className="input-wrap input-wrap--select"><select value={form.gstTreatment} onChange={(event) => update("gstTreatment", event.target.value)}><option value="included">Included in quoted amount</option><option value="excluded">Added to quoted amount</option></select><ChevronDown size={15} /></div></label>
          <label className="field"><span>GST rate</span><div className="input-wrap"><input type="number" min="0" max="28" step="1" value={form.gstRate} onChange={(event) => update("gstRate", event.target.value)} required /><span className="input-suffix">%</span></div><small className="field-hint">Use 0% when GST does not apply.</small></label>
          <label className="field"><span>Travel policy</span><div className="input-wrap input-wrap--select"><select value={form.travelPolicy} onChange={(event) => update("travelPolicy", event.target.value)}><option value="included">Included in quoted amount</option><option value="fixed_fee">Additional fixed fee</option><option value="not_applicable">Not applicable</option></select><ChevronDown size={15} /></div></label>
          {form.travelPolicy === "fixed_fee" ? <label className="field"><span>Fixed travel fee</span><div className="input-wrap"><IndianRupee size={16} /><input type="number" min="1" max="1000000000" step="1000" value={form.travelFee} onChange={(event) => update("travelFee", event.target.value)} required /></div></label> : <div className="bid-form__policy-note"><ShieldCheck size={16} /><span>{form.travelPolicy === "included" ? "Travel is covered by the quoted amount." : "No travel charge applies to this offer."}</span></div>}
        </div>
        <div className="bid-add-ons">
          <div className="bid-add-ons__heading"><div><strong>Optional priced add-ons</strong><small>Only list extras the couple may choose later.</small></div><button className="text-button" type="button" onClick={addAddOn} disabled={form.addOns.length >= 20}><Plus size={14} /> {form.addOns.length >= 20 ? "20 item limit" : "Add item"}</button></div>
          {form.addOns.length ? <div className="bid-add-ons__list">{form.addOns.map((item) => <div className="bid-add-on" key={item.id}><label className="field"><span>Add-on name</span><input value={item.name} maxLength="120" onChange={(event) => updateAddOn(item.id, "name", event.target.value)} placeholder="Premium printed album" /></label><label className="field"><span>Price</span><div className="input-wrap"><IndianRupee size={16} /><input type="number" min="1" max="1000000000" step="500" value={item.amount} onChange={(event) => updateAddOn(item.id, "amount", event.target.value)} /></div></label><button className="icon-button icon-button--small" type="button" onClick={() => removeAddOn(item.id)} aria-label={`Remove ${item.name || "add-on"}`}><X size={16} /></button></div>)}</div> : <p className="bid-add-ons__empty">No optional add-ons added. The quoted scope remains the complete offer.</p>}
        </div>
      </section>

      <section className="bid-form__section" aria-labelledby={`offer-terms-${opportunity.id}`}>
        <div className="bid-form__section-heading"><span>03</span><div><h4 id={`offer-terms-${opportunity.id}`}>Delivery and cancellation</h4><p>Give the couple enough detail to compare timing and risk, not only price.</p></div></div>
        <div className="form-grid"><label className="field"><span>Delivery plan</span><textarea rows="5" minLength="20" maxLength="3000" value={form.deliveryPlan} onChange={(event) => update("deliveryPlan", event.target.value)} placeholder="Share the key stages, handoffs and final delivery timing…" required /></label><label className="field"><span>Cancellation terms</span><textarea rows="5" minLength="20" maxLength="3000" value={form.cancellationTerms} onChange={(event) => update("cancellationTerms", event.target.value)} placeholder="Explain cancellation windows, retained amounts and rescheduling treatment…" required /></label></div>
      </section>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="bid-form__actions"><p><ShieldCheck size={15} /> {opportunity.demo ? "Preview data stays in this page." : "Your offer stays sealed."}</p><button className="button button--primary" disabled={loading} type="submit">{loading ? <span className="button-loader" aria-hidden="true" /> : <Send size={16} />}{loading ? "Sending…" : opportunity.demo ? "Complete example" : "Send sealed offer"}</button></div>
    </form>
  );
}

function OpportunityCard({ opportunity, notify, onOpenAuth, onSubmitted }) {
  const [open, setOpen] = useState(false);
  const [bidding, setBidding] = useState(false);
  const alreadyResponded = opportunity.directInviteStatus === "responded";
  const inviteUnavailable = opportunity.directInviteStatus === "unavailable";
  const directInviteActive = opportunity.directInvite && opportunity.directInviteStatus !== "unavailable";
  return (
    <article className={`opportunity-card ${opportunity.directInvite ? "opportunity-card--direct" : ""} ${open ? "is-open" : ""}`}>
      <div className="opportunity-card__summary">
        <div className={`opportunity-match ${opportunity.demo ? "opportunity-match--demo" : opportunity.directInvite ? "opportunity-match--direct" : ""}`}>{opportunity.demo ? <><Sparkles size={20} /><small>example</small></> : opportunity.directInvite ? <><Sparkles size={20} /><small>for you</small></> : <><BriefcaseBusiness size={20} /><small>live brief</small></>}</div>
        <div className="opportunity-card__title"><div><span className={`status-pill ${opportunity.directInvite ? "status-pill--direct" : opportunity.demo ? "" : "status-pill--teal"}`}><span /> {opportunity.demo ? "Example opportunity" : opportunity.directInvite ? directInviteLabel(opportunity.directInviteStatus) : "Accepting offers"}</span><small>{opportunity.demo ? opportunity.id : opportunity.reference}</small></div><h3>{opportunity.service}</h3><div className="opportunity-facts"><span><MapPin size={14} /> {opportunity.city}</span><span><CalendarDays size={14} /> {opportunity.date}</span><span><Users size={14} /> {opportunity.guests} guests</span></div></div>
        <div className="opportunity-card__budget"><small>Stated range</small><strong>{opportunity.budget}</strong><span><Clock3 size={13} /> {opportunity.closes}</span></div>
        <button className="button button--small button--outline" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>{open ? "Hide brief" : "View brief"}<ChevronDown size={16} /></button>
      </div>
      {open && <div className="opportunity-card__detail"><div className="brief-detail"><h4>{opportunity.demo ? "Example couple brief" : "Couple’s brief"}</h4><p>{opportunity.notes}</p><div>{directInviteActive && <span className="direct-invite-signal"><Sparkles size={14} /> Sent directly to your business</span>}<span><Check size={14} /> Scope shared</span><span><Check size={14} /> Working range shared</span><span><ShieldCheck size={14} /> Contact private</span></div></div>{bidding ? <BidForm opportunity={opportunity} onClose={() => setBidding(false)} notify={notify} onOpenAuth={onOpenAuth} onSubmitted={onSubmitted} /> : <div className="opportunity-card__cta"><div><BadgeIndianRupee size={20} /><p><strong>{opportunity.demo ? "Want to try the offer flow?" : inviteUnavailable ? "This invitation is no longer available" : directInviteActive ? "Your business was invited directly" : "Good fit for your business?"}</strong><span>{opportunity.demo ? "Preview the form without sending anything." : inviteUnavailable ? "Contact support if your partner approval has since been restored." : alreadyResponded ? "Your sealed offer has already been sent for this request." : directInviteActive ? "Review the brief and respond before the offer window closes." : "Send a complete offer before the window closes."}</span></p></div><button className="button button--primary" type="button" disabled={alreadyResponded || inviteUnavailable} onClick={() => setBidding(true)}>{inviteUnavailable ? "Invite unavailable" : alreadyResponded ? "Offer sent" : opportunity.demo ? "Preview offer" : "Build offer"} {!alreadyResponded && !inviteUnavailable && <ArrowRight size={16} />}</button></div>}</div>}
    </article>
  );
}

function VendorOffers({ offers, demo }) {
  if (!offers.length) return <div className="vendor-empty"><span><FileText size={28} /></span><h2>{demo ? "Example offers are not live" : "No submitted offers yet"}</h2><p>{demo ? "The live service is unavailable, so this preview does not invent proposal history." : "Open a suitable opportunity and send a complete proposal. It will appear here after submission."}</p></div>;
  return (
    <div className="vendor-tab-panel"><div className="vendor-panel-heading"><div><h2>My offers</h2><p>{demo ? "Example proposal history." : "Live proposals sent from this approved business."}</p></div></div><div className="vendor-offer-table"><div className="vendor-offer-table__head"><span>Request</span><span>Offer</span><span>Status</span><span>Updated</span></div>{offers.map((offer) => <div key={offer.id}><span><strong>{offer.auction?.title || offer.auctionId?.slice(0, 8).toUpperCase()}</strong><small>{offer.auction?.city || "Celebration brief"}</small></span><strong>{formatCurrency(offer.amount)}</strong><span className={`status-pill ${offer.status === "accepted" ? "status-pill--teal" : ""}`}><span /> {offer.status}</span><span>{formatDate(offer.updatedAt || offer.createdAt)}</span></div>)}</div></div>
  );
}

function VendorAwards({ awards, demo, loading, error, onRetry, onMessage }) {
  if (!demo && loading) return <div className="vendor-tab-panel"><div className="vendor-empty" role="status" aria-live="polite"><span><LoaderCircle className="spin-icon" size={28} /></span><h2>Loading award handoffs</h2><p>Retrieving the read-only records for work awarded to this business.</p></div></div>;
  if (!demo && error) return <div className="vendor-tab-panel"><div className="vendor-empty" role="alert"><span><CircleAlert size={28} /></span><h2>Award handoffs could not be loaded</h2><p>{error} Retrying will not change any workspace data.</p><button className="button button--outline" type="button" onClick={onRetry}><RefreshCw size={15} /> Retry awards</button></div></div>;
  if (!awards.length) return <div className="vendor-empty" role="status"><span><Handshake size={28} /></span><h2>{demo ? "Example awards are not live" : "No awarded work yet"}</h2><p>{demo ? "The live service is unavailable, so this preview does not invent award records." : "When a couple awards one of your offers, the frozen scope and contract-pending handoff will appear here."}</p></div>;
  return (
    <div className="vendor-tab-panel">
      <div className="vendor-panel-heading"><div><h2>Award handoffs</h2><p>Read-only scope records shared with the couple after an offer is awarded.</p></div></div>
      <div className="vendor-award-list">
        {awards.map((award) => {
          const snapshot = award.snapshot || {};
          const request = snapshot.request || {};
          const offer = snapshot.offer || {};
          const structured = hasStructuredAwardTerms(offer);
          const exclusions = structured && Array.isArray(offer.exclusions) ? offer.exclusions : null;
          const addOns = structured && Array.isArray(offer.addOns) ? offer.addOns : null;
          const proposal = typeof offer.proposal === "string" && offer.proposal.trim() ? offer.proposal : "Not provided";
          return (
            <article className="vendor-award-card" aria-labelledby={`vendor-award-${award.id}`} key={award.id}>
              <div className="vendor-award-card__top"><span className="card-icon card-icon--teal"><Handshake size={18} /></span><div><small>Award reference {String(award.id).slice(0, 8).toUpperCase()}</small><h3 id={`vendor-award-${award.id}`}>{request.title || "Celebration request"}</h3><p>{[formatDate(request.eventDate), request.city].filter(Boolean).join(" · ")}</p></div><span className="status-pill status-pill--direct"><span /> Contract pending</span></div>
              {!structured && <div className="offer-legacy-note vendor-award-card__legacy"><CircleAlert size={16} /><span>This legacy offer did not capture every normalized commercial term. Missing details remain explicitly marked “Not provided.”</span></div>}
              <dl><div><dt>Accepted amount</dt><dd>{formatCurrency(offer.amount)}</dd></div><div><dt>GST</dt><dd>{awardGstSummary(offer)}</dd></div><div><dt>Travel</dt><dd>{awardTravelSummary(offer)}</dd></div><div><dt>Valid until</dt><dd>{offer.validUntil ? formatDate(offer.validUntil) : "Not provided"}</dd></div><div><dt>Awarded</dt><dd>{formatDate(award.awardedAt)}</dd></div><div><dt>Service</dt><dd>{Array.isArray(request.categories) && request.categories.length ? request.categories.map(categoryLabel).join(" · ") : "Not provided"}</dd></div></dl>
              <section className="vendor-award-card__proposal"><h4>Accepted proposal</h4><p>{proposal}</p></section>
              <div className="vendor-award-card__scope"><section className="offer-term-card"><h4>Accepted inclusions</h4><VendorAwardTermList items={Array.isArray(offer.deliverables) ? offer.deliverables : null} /></section><section className="offer-term-card"><h4>Accepted exclusions</h4><VendorAwardTermList items={exclusions} tone="excluded" /></section></div>
              <div className="vendor-award-card__terms"><section className="offer-term-card"><h4>Priced add-ons</h4><VendorAwardTermList items={addOns} emptyLabel={structured ? "No priced add-ons" : "Not provided"} formatItem={(item) => `${item?.name || "Unnamed add-on"} · ${Number.isFinite(Number(item?.amount)) ? formatCurrency(item.amount) : "Price not provided"}`} /></section><section className="offer-term-card"><h4>Delivery plan</h4><p>{structured ? offer.deliveryPlan : "Not provided"}</p></section><section className="offer-term-card"><h4>Cancellation terms</h4><p>{structured ? offer.cancellationTerms : "Not provided"}</p></section></div>
              <div className="vendor-award-card__next"><ShieldCheck size={17} /><p><strong>Arrange and review a written contract outside Melaiva.</strong><span>Before any signature or payment, agree it directly with the couple and confirm it mirrors every frozen term above. Melaiva does not provide signing or payment in this workspace.</span></p><button className="button button--small button--outline" type="button" onClick={() => onMessage?.(award.id)}><MessageSquareText size={14} /> Message couple</button></div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function VendorEmpty({ type }) {
  const Icon = type === "profile" ? Store : MessageSquareText;
  return <div className="vendor-empty"><span><Icon size={28} /></span><h2>{type === "profile" ? "Your business profile" : "Live conversations are unavailable in preview"}</h2><p>{type === "profile" ? "Complete onboarding to manage portfolio details, service areas and starting budgets here." : "Sign in to read messages connected to awarded work. No example conversations are fabricated."}</p>{type === "profile" && <Link className="button button--primary" to="/vendor/onboarding">Complete profile</Link>}</div>;
}

function VendorAccessState({ icon: Icon, eyebrow, title, message, children }) {
  return <div className="shell vendor-access-state"><div className="vendor-empty"><span><Icon size={29} /></span><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{message}</p><div className="vendor-access-state__actions">{children}</div></div></div>;
}

export function VendorPage({ notify, onOpenAuth, authRevision = 0 }) {
  const [active, setActive] = useState("opportunities");
  const [mode, setMode] = useState("loading");
  const [profile, setProfile] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  const [offers, setOffers] = useState([]);
  const [awards, setAwards] = useState([]);
  const [awardsLoading, setAwardsLoading] = useState(false);
  const [awardsError, setAwardsError] = useState("");
  const [awardsRefreshKey, setAwardsRefreshKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [messageBookingId, setMessageBookingId] = useState(null);
  const [messageFocusRequest, setMessageFocusRequest] = useState(null);
  const messageFocusSequence = useRef(0);

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
        if (!nextVendor) { if (!controller.signal.aborted) { setProfile({ user: nextUser, vendor: nextVendor }); setMode("not-vendor"); } return; }
        if (nextVendor.status !== "approved") {
          if (!controller.signal.aborted) {
            setProfile({ user: nextUser, vendor: nextVendor });
            if (["suspended", "rejected"].includes(nextVendor.status)) {
              setAwardsLoading(true);
              setAwardsError("");
              setActive("messages");
              setMode("restricted");
            } else {
              setMode("pending");
            }
          }
          return;
        }
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
        setAwardsLoading(true);
        setAwardsError("");
        setMode("live");
      } catch (error) {
        if (error?.name === "AbortError" || controller.signal.aborted) return;
        setMode("demo");
      }
    }
    load();
    return () => controller.abort();
  }, [authRevision, refreshKey]);

  useEffect(() => {
    if (!["live", "restricted"].includes(mode)) {
      setAwards([]);
      setAwardsError("");
      setAwardsLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    async function loadAwards() {
      setAwardsLoading(true); setAwardsError("");
      try {
        const response = await fetch("/api/v1/bookings?limit=50", { credentials: "include", signal: controller.signal });
        const payload = await readApiResponse(response, "Your award handoffs could not be loaded.");
        if (!Array.isArray(payload.data)) throw new Error("Your award handoffs could not be loaded.");
        if (!controller.signal.aborted) setAwards(payload.data.filter((award) => award.audienceRole === "vendor" || award.audienceRole === "admin"));
      } catch (error) {
        if (error?.name === "AbortError" || controller.signal.aborted) return;
        setAwards([]); setAwardsError(error.message || "Your award handoffs could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setAwardsLoading(false);
      }
    }
    loadAwards();
    return () => controller.abort();
  }, [awardsRefreshKey, mode, profile?.vendor?.id, profile?.vendor?.status]);

  const exampleData = useMemo(() => exampleOpportunities.map((opportunity) => ({ ...opportunity, reference: opportunity.id, demo: true })), []);
  const visibleOpportunities = mode === "demo"
    ? exampleData
    : [...opportunities].sort((first, second) => Number(second.directInvite) - Number(first.directInvite));

  if (mode === "loading") return <div className="vendor-page page-surface"><VendorAccessState icon={LoaderCircle} eyebrow="Loading partner workspace" title="Checking your business profile" message="Retrieving approval status, live opportunities and submitted offers." /></div>;
  if (mode === "guest") return <div className="vendor-page page-surface"><VendorAccessState icon={LockKeyhole} eyebrow="Private partner workspace" title="Sign in to see live opportunities" message="Only approved vendor accounts can read private briefs and submit offers."><button className="button button--primary" type="button" onClick={onOpenAuth}>Sign in</button><Link className="button button--outline" to="/vendor/onboarding">Apply to join</Link></VendorAccessState></div>;
  if (mode === "not-vendor") return <div className="vendor-page page-surface"><VendorAccessState icon={Store} eyebrow="Partner application" title="Introduce your business first" message="Complete the partner application before accessing private opportunities or sending proposals."><Link className="button button--primary" to="/vendor/onboarding">Start application</Link><Link className="button button--outline" to="/dashboard">Open couple workspace</Link></VendorAccessState></div>;
  if (mode === "pending") return <div className="vendor-page page-surface"><VendorAccessState icon={ShieldCheck} eyebrow="Application status" title={`Your application is ${profile.vendor.status}.`} message="Private briefs remain locked until the partner review is complete. Submission does not guarantee approval."><Link className="button button--outline" to="/marketplace">View public marketplace</Link></VendorAccessState></div>;

  const restricted = mode === "restricted";
  const businessName = ["live", "restricted"].includes(mode) ? profile.vendor.businessName : "Example partner studio";
  const initials = businessName.split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase();
  const underReview = offers.filter((offer) => ["submitted", "shortlisted"].includes(offer.status)).length;

  return (
    <div className="vendor-page page-surface">
      <section className="vendor-top"><div className="shell vendor-top__inner"><div className="vendor-business"><span>{initials}</span><div><small>{mode === "demo" ? "Preview vendor workspace" : restricted ? "Restricted partner workspace" : "Approved partner workspace"}</small><strong>{businessName}</strong></div>{mode === "live" && <BadgeCheck size={18} />}</div><div className="vendor-top__actions"><Link className="text-link" to="/marketplace">View marketplace <ArrowRight size={15} /></Link><button className="icon-button" type="button" aria-label="Vendor notifications"><Sparkles size={18} /></button></div></div></section>
      <div className="shell vendor-shell">
        {mode === "demo" && <div className="demo-catalog-note vendor-preview-note"><CircleAlert size={16} /><p><strong>Preview workspace</strong> The live partner service could not be reached. Examples below never submit to real request IDs.</p><button className="text-button" type="button" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={14} /> Retry</button></div>}
        {restricted
          ? <div className="demo-catalog-note vendor-preview-note" role="status"><ShieldCheck size={16} /><p><strong>Account access is restricted.</strong> New opportunities and new messages are paused. Prior award records and conversation history remain available for reference; contact Melaiva support for help.</p></div>
          : <><div className="vendor-welcome"><div><div className="eyebrow">{mode === "demo" ? "Partner workspace preview" : "Partner workspace"}</div><h1>Good opportunities, clearly briefed.</h1><p>{mode === "demo" ? "Explore a clearly labelled example without changing live marketplace data." : "Focus on celebrations that fit your dates, services and working range."}</p></div>{mode === "demo" && <div className="vendor-demo-note"><ShieldCheck size={16} /><span>Example workspace data</span></div>}</div><div className="vendor-metrics"><div><span className="card-icon"><BriefcaseBusiness size={18} /></span><p><small>{mode === "demo" ? "Example matches" : "Open opportunities"}</small><strong>{visibleOpportunities.length}</strong><em>{mode === "demo" ? "Preview" : "Live"}</em></p></div><div><span className="card-icon card-icon--teal"><FileCheck2 size={18} /></span><p><small>Offers under review</small><strong>{mode === "demo" ? "—" : underReview}</strong><em>{mode === "demo" ? "No live data" : "Live"}</em></p></div><div><span className="card-icon card-icon--marigold"><TrendingUp size={18} /></span><p><small>Profile status</small><strong>{mode === "demo" ? "Preview" : "Approved"}</strong><em>{mode === "demo" ? "Example" : "Verified"}</em></p></div><div><span className="card-icon card-icon--rose"><Star size={18} /></span><p><small>Review quality</small><strong>—</strong><em>No rating yet</em></p></div></div></>}
        <VendorWorkspaceNav active={active} setActive={setActive} opportunityCount={visibleOpportunities.length} offerCount={mode === "demo" ? 0 : offers.length} awardCount={mode === "demo" ? 0 : awards.length} conversationCount={mode === "demo" ? 0 : awards.length} restricted={restricted} />
        {!restricted && active === "opportunities" && <div className="vendor-tab-panel"><div className="vendor-panel-heading"><div><h2>{mode === "demo" ? "Example opportunities" : "Open opportunities"}</h2><p>{mode === "demo" ? "Static examples for evaluating the workflow." : "Private briefs available to your approved business."}</p></div></div>{visibleOpportunities.length ? <div className="opportunity-list">{visibleOpportunities.map((opportunity) => <OpportunityCard opportunity={opportunity} notify={notify} onOpenAuth={onOpenAuth} onSubmitted={() => setRefreshKey((value) => value + 1)} key={opportunity.id} />)}</div> : <div className="vendor-empty"><span><BriefcaseBusiness size={28} /></span><h2>No suitable live briefs right now</h2><p>New approved requests will appear here when they match your partner account.</p></div>}</div>}
        {!restricted && active === "offers" && <VendorOffers offers={mode === "demo" ? [] : offers} demo={mode === "demo"} />}
        {active === "awards" && <VendorAwards awards={mode === "demo" ? [] : awards} demo={mode === "demo"} loading={awardsLoading} error={awardsError} onRetry={() => setAwardsRefreshKey((value) => value + 1)} onMessage={(bookingId) => { setMessageBookingId(bookingId); messageFocusSequence.current += 1; setMessageFocusRequest(messageFocusSequence.current); setActive("messages"); }} />}
        {active === "messages" && (["live", "restricted"].includes(mode) ? <BookingMessages audience="vendor" preferredBookingId={messageBookingId} focusRequest={messageFocusRequest} onFocusRequestHandled={() => setMessageFocusRequest(null)} onViewScope={() => setActive("awards")} emptyActionLabel={restricted ? "View award handoffs" : "View opportunities"} onEmptyAction={() => setActive(restricted ? "awards" : "opportunities")} /> : <VendorEmpty type="messages" />)}
        {!restricted && active === "profile" && <VendorEmpty type="profile" />}
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
