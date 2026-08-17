import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
  Landmark,
  Link2,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  MessageSquareText,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { categories, cities, formatCurrency, opportunities as exampleOpportunities } from "../data.js";
import { createIdempotencyKey, isServiceUnavailable, readApiResponse } from "../api.js";
import { BookingMessages } from "../components/BookingMessages.jsx";
import { formatUnreadMessageCount, targetScrollLeftForControl } from "../components/bookingMessages.js";
import { useBookingInbox } from "../components/useBookingInbox.js";
import {
  buildVendorEvidence,
  buildVendorEvidenceSubmissionPayload,
  canCompleteVendorEvidence,
  evidenceFocusIndexAfterRemoval,
  evidenceFocusNeedsScroll,
  normalizeInformationRequest,
  normalizeVendorEffectiveStatus,
  normalizeVendorEvidenceContext,
  prefillVendorEvidence,
  shouldPreflightVendorEvidenceSubmission,
  shouldClearVendorEvidencePrivateDraft,
  VENDOR_REGISTRATION_OPTIONS,
  validateVendorApplication,
  validateVendorEvidence,
  vendorEvidenceCompletionEligibility,
  vendorEvidenceConflictState,
  vendorEvidenceContextRefreshDecision,
  vendorEvidenceExplicitReloadPlan,
  vendorEvidencePreflightIdentityMatches,
  vendorEvidencePreflightMatches,
  vendorEvidenceFieldRequested,
  vendorEvidenceServerFieldErrors,
} from "../components/vendorOnboarding.js";
import {
  checkVendorApplicationEvidenceCompatibility,
  VENDOR_APPLICATION_EVIDENCE_HEADERS,
} from "../components/vendorApplicationCompatibility.js";

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

function VendorWorkspaceNav({ active, setActive, opportunityCount, offerCount, awardCount, unreadMessageCount, restricted = false }) {
  const navRef = useRef(null);
  const buttonRefs = useRef(new Map());
  const allItems = [
    ["opportunities", BriefcaseBusiness, "Opportunities", opportunityCount],
    ["offers", FileText, "My offers", offerCount],
    ["awards", Handshake, "Award handoffs", awardCount],
    ["messages", MessageSquareText, "Messages", unreadMessageCount],
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
  }, [active, awardCount, offerCount, opportunityCount, restricted, unreadMessageCount]);
  return (
    <nav className="vendor-workspace-nav" aria-label="Vendor workspace" ref={navRef}>
      {items.map(([id, Icon, label, badge]) => {
        const count = Number(badge);
        const isUnreadBadge = id === "messages";
        return (
          <button ref={(node) => { if (node) buttonRefs.current.set(id, node); else buttonRefs.current.delete(id); }} className={active === id ? "is-active" : ""} type="button" key={id} onClick={() => setActive(id)} aria-pressed={active === id} aria-label={isUnreadBadge && count > 0 ? `${label}, ${count} unread message${count === 1 ? "" : "s"}` : undefined}>
            <Icon size={17} />{label}{count > 0 && <span className={isUnreadBadge ? "workspace-unread-badge" : ""} aria-hidden={isUnreadBadge || undefined}>{isUnreadBadge ? formatUnreadMessageCount(count) : count}</span>}
          </button>
        );
      })}
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

function VendorAccessState({ icon: Icon, eyebrow, title, message, details, tone = "default", children }) {
  return <div className={`shell vendor-access-state vendor-access-state--${tone}`}><div className="vendor-empty"><span><Icon size={29} /></span><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{message}</p>{details}<div className="vendor-access-state__actions">{children}</div></div></div>;
}

const OWNER_INFORMATION_FIELD_LABELS = Object.freeze({
  portfolio: "Portfolio or work samples",
  references: "Public reviews or references",
  registration: "Business-registration disclosure",
});

function VendorApplicationStatus({ vendor }) {
  const effectiveStatus = normalizeVendorEffectiveStatus(vendor?.effectiveStatus);
  const evidenceComplete = Number(vendor?.evidenceRevision) >= 1 || vendor?.evidenceComplete === true;
  if (effectiveStatus === "needs_information") {
    const request = normalizeInformationRequest(vendor?.currentInformationRequest);
    if (!request) {
      return <VendorAccessState icon={ShieldAlert} eyebrow="Application status unavailable" title="We cannot safely open this evidence request" message="The service did not return a complete information-request record. No application data can be changed until the latest status is available."><button className="button button--primary" type="button" onClick={() => window.location.reload()}><RefreshCw size={16} /> Refresh status</button><Link className="button button--outline" to="/marketplace">View public marketplace</Link></VendorAccessState>;
    }
    const details = (
      <section className="vendor-information-request" aria-labelledby="vendor-information-request-heading">
        <div><FileCheck2 size={18} /><div><h2 id="vendor-information-request-heading">What the partner team needs updated</h2><p>Request {request.revision} · based on evidence revision {request.evidenceRevision || "none"}{request.requestedAt ? ` · ${formatDate(request.requestedAt)}` : ""}</p></div></div>
        <ul>{request.requestedFields.map((field) => <li key={field}><Check size={14} />{OWNER_INFORMATION_FIELD_LABELS[field]}</li>)}</ul>
        <blockquote>{request.applicantMessage}</blockquote>
      </section>
    );
    return <VendorAccessState icon={CircleAlert} tone="information" eyebrow="Action needed" title="Update your review evidence" message="Marketplace access remains locked while this request is open. Review the instructions, update the relevant evidence, and submit one complete new snapshot." details={details}><Link className="button button--primary" to="/vendor/onboarding?mode=evidence">Revise review evidence <ArrowRight size={16} /></Link><Link className="button button--outline" to="/marketplace">View public marketplace</Link></VendorAccessState>;
  }
  if (effectiveStatus === "pending") {
    const needsInitialEvidence = !evidenceComplete;
    return <VendorAccessState icon={needsInitialEvidence ? FileCheck2 : ShieldCheck} eyebrow="Application status" title={needsInitialEvidence ? "Complete your review evidence" : "Your application is in review"} message={needsInitialEvidence ? (vendor?.evidenceRequired === false ? "This earlier application has no structured evidence snapshot. Add public work, reference and business evidence before an accountable review." : "Structured evidence is still required before this application can be approved.") : `Evidence revision ${vendor.evidenceRevision} is with the partner team. Submission does not guarantee approval.`}>{canCompleteVendorEvidence(effectiveStatus, evidenceComplete) && <Link className="button button--primary" to="/vendor/onboarding?mode=evidence">Complete review evidence</Link>}<Link className="button button--outline" to="/marketplace">View public marketplace</Link></VendorAccessState>;
  }
  if (effectiveStatus === "rejected") {
    return <VendorAccessState icon={ShieldAlert} tone="rejected" eyebrow="Application decision" title="Your application was declined" message="This business is not eligible for private briefs or offers. If the partner team needs corrected evidence later, a new information request will appear here."><Link className="button button--primary" to="/marketplace">View public marketplace</Link><Link className="button button--outline" to="/">Return home</Link></VendorAccessState>;
  }
  return <VendorAccessState icon={ShieldAlert} eyebrow="Application status unavailable" title="We cannot safely show this application state" message="Refresh after the secure service upgrade. No application data can be changed while the state is unknown."><button className="button button--primary" type="button" onClick={() => window.location.reload()}><RefreshCw size={16} /> Refresh status</button><Link className="button button--outline" to="/marketplace">View public marketplace</Link></VendorAccessState>;
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
  const bookingInbox = useBookingInbox({ audience: "vendor", enabled: ["live", "restricted"].includes(mode) });
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
        const vendorContext = normalizeVendorEvidenceContext(nextVendor);
        const normalizedVendor = {
          ...nextVendor,
          effectiveStatus: vendorContext.effectiveStatus,
          reviewRevision: vendorContext.reviewRevision,
          evidenceRevision: vendorContext.evidenceRevision,
          evidenceComplete: vendorContext.evidenceRevision >= 1,
          currentInformationRequest: vendorContext.currentInformationRequest,
        };
        if (vendorContext.effectiveStatus !== "approved") {
          if (!controller.signal.aborted) {
            setProfile({ user: nextUser, vendor: normalizedVendor });
            if (vendorContext.effectiveStatus === "suspended") {
              setAwardsLoading(true);
              setAwardsError("");
              setActive("messages");
              setMode("restricted");
            } else {
              setMode("application");
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
        setProfile({ user: nextUser, vendor: normalizedVendor });
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
  if (mode === "application") return <div className="vendor-page page-surface"><VendorApplicationStatus vendor={profile.vendor} /></div>;

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
          ? <><div className="demo-catalog-note vendor-preview-note" role="status"><ShieldCheck size={16} /><p><strong>Account access is restricted.</strong> New opportunities and new messages are paused. Prior award records and conversation history remain available for reference; contact Melaiva support for help.</p></div>{canCompleteVendorEvidence(profile?.vendor?.status, profile?.vendor?.evidenceComplete) && <div className="demo-catalog-note vendor-preview-note" role="status"><FileCheck2 size={16} /><p><strong>Structured evidence is missing.</strong> {profile?.vendor?.evidenceRequired === false ? "This legacy application can add public work, reference and business-registration evidence before a future re-review." : "This application still requires public work, reference and business-registration evidence before it can be approved."}</p><Link className="text-button" to="/vendor/onboarding?mode=evidence">Complete evidence <ArrowRight size={14} /></Link></div>}</>
          : <><div className="vendor-welcome"><div><div className="eyebrow">{mode === "demo" ? "Partner workspace preview" : "Partner workspace"}</div><h1>Good opportunities, clearly briefed.</h1><p>{mode === "demo" ? "Explore a clearly labelled example without changing live marketplace data." : "Focus on celebrations that fit your dates, services and working range."}</p></div>{mode === "demo" && <div className="vendor-demo-note"><ShieldCheck size={16} /><span>Example workspace data</span></div>}</div><div className="vendor-metrics"><div><span className="card-icon"><BriefcaseBusiness size={18} /></span><p><small>{mode === "demo" ? "Example matches" : "Open opportunities"}</small><strong>{visibleOpportunities.length}</strong><em>{mode === "demo" ? "Preview" : "Live"}</em></p></div><div><span className="card-icon card-icon--teal"><FileCheck2 size={18} /></span><p><small>Offers under review</small><strong>{mode === "demo" ? "—" : underReview}</strong><em>{mode === "demo" ? "No live data" : "Live"}</em></p></div><div><span className="card-icon card-icon--marigold"><TrendingUp size={18} /></span><p><small>Profile status</small><strong>{mode === "demo" ? "Preview" : "Approved"}</strong><em>{mode === "demo" ? "Example" : "Reviewed"}</em></p></div><div><span className="card-icon card-icon--rose"><Star size={18} /></span><p><small>Review quality</small><strong>—</strong><em>No rating yet</em></p></div></div></>}
        <VendorWorkspaceNav active={active} setActive={setActive} opportunityCount={visibleOpportunities.length} offerCount={mode === "demo" ? 0 : offers.length} awardCount={mode === "demo" ? 0 : awards.length} unreadMessageCount={mode === "demo" ? 0 : bookingInbox.unreadMessageCount} restricted={restricted} />
        {!restricted && active === "opportunities" && <div className="vendor-tab-panel"><div className="vendor-panel-heading"><div><h2>{mode === "demo" ? "Example opportunities" : "Open opportunities"}</h2><p>{mode === "demo" ? "Static examples for evaluating the workflow." : "Private briefs available to your approved business."}</p></div></div>{visibleOpportunities.length ? <div className="opportunity-list">{visibleOpportunities.map((opportunity) => <OpportunityCard opportunity={opportunity} notify={notify} onOpenAuth={onOpenAuth} onSubmitted={() => setRefreshKey((value) => value + 1)} key={opportunity.id} />)}</div> : <div className="vendor-empty"><span><BriefcaseBusiness size={28} /></span><h2>No suitable live briefs right now</h2><p>New approved requests will appear here when they match your partner account.</p></div>}</div>}
        {!restricted && active === "offers" && <VendorOffers offers={mode === "demo" ? [] : offers} demo={mode === "demo"} />}
        {active === "awards" && <VendorAwards awards={mode === "demo" ? [] : awards} demo={mode === "demo"} loading={awardsLoading} error={awardsError} onRetry={() => setAwardsRefreshKey((value) => value + 1)} onMessage={(bookingId) => { setMessageBookingId(bookingId); messageFocusSequence.current += 1; setMessageFocusRequest(messageFocusSequence.current); setActive("messages"); }} />}
        {active === "messages" && (["live", "restricted"].includes(mode) ? <BookingMessages audience="vendor" preferredBookingId={messageBookingId} focusRequest={messageFocusRequest} onFocusRequestHandled={() => setMessageFocusRequest(null)} onViewScope={() => setActive("awards")} emptyActionLabel={restricted ? "View award handoffs" : "View opportunities"} onEmptyAction={() => setActive(restricted ? "awards" : "opportunities")} inbox={bookingInbox} /> : <VendorEmpty type="messages" />)}
        {!restricted && active === "profile" && <VendorEmpty type="profile" />}
      </div>
    </div>
  );
}

function OnboardingHero({ evidenceOnly = false, revisionMode = false }) {
  return (
    <section className="onboarding-hero">
      <div className="shell">
        <div><Link className="back-link" to="/vendor"><ArrowLeft size={15} /> Vendor workspace</Link><div className="eyebrow eyebrow--light">Melaiva partner network</div><h1>{revisionMode ? <>Revise your evidence.<br /><em>Keep review moving.</em></> : evidenceOnly ? <>Complete your record.<br /><em>Make review accountable.</em></> : <>Bring your best work.<br /><em>Meet better-fit briefs.</em></>}</h1></div>
        <p>{revisionMode ? "Start from your latest complete snapshot, follow the partner team’s request, and submit one new immutable revision. Your business profile remains unchanged." : evidenceOnly ? "Attach the structured public work and business evidence missing from your earlier application. Your existing profile remains unchanged." : "Apply with the public work and business evidence our partner team needs to make an accountable marketplace decision."}</p>
      </div>
    </section>
  );
}

function OnboardingGate({ icon: Icon, spinning = false, eyebrow, title, message, children }) {
  const headingRef = useRef(null);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, [title]);
  return (
    <div className="onboarding-page page-surface">
      <OnboardingHero evidenceOnly />
      <section className="shell onboarding-gate">
        <div className="onboarding-success onboarding-gate__card" role="status" aria-live="polite">
          <span><Icon className={spinning ? "spin-icon" : undefined} size={32} /></span>
          <div className="eyebrow">{eyebrow}</div>
          <h2 ref={headingRef} tabIndex="-1">{title}</h2>
          <p>{message}</p>
          {children && <div className="onboarding-gate__actions">{children}</div>}
        </div>
      </section>
    </div>
  );
}

function OnboardingSuccess({ evidenceOnly = false, success }) {
  const headingRef = useRef(null);
  useEffect(() => { headingRef.current?.focus(); }, []);
  const revision = Number(success?.evidenceRevision);
  const revised = evidenceOnly && success?.revised === true;
  return <div className="onboarding-success" role="status" aria-live="polite"><span><CheckCircle2 size={32} /></span><div className="eyebrow">{revised ? "Revision submitted" : evidenceOnly ? "Evidence attached" : "Application received"}</div><h1 ref={headingRef} tabIndex="-1">{revised ? `Evidence revision ${revision} is submitted.` : evidenceOnly && Number.isInteger(revision) ? `Evidence revision ${revision} is submitted.` : evidenceOnly ? "Your review record is now complete." : "Thank you for introducing your work."}</h1><p>{revised && success?.hadPreviousEvidence ? "The complete snapshot is now with the partner team. The previous immutable evidence revision remains in the review record." : revised ? "The complete snapshot has closed the information request and returned your application to review." : evidenceOnly ? "The complete snapshot is now available for an accountable review. Your existing application decision is unchanged until the partner team records a new one." : "Our partner team will review the submitted profile and evidence before deciding marketplace eligibility."}</p><Link className="button button--primary" to="/vendor">Check application status <ArrowRight size={17} /></Link></div>;
}

function OnboardingError({ id, children }) {
  return children ? <small className="field-error" id={id} role="alert">{children}</small> : null;
}

function createVendorOnboardingForm() {
  return {
    businessName: "",
    legalName: "",
    category: "",
    city: "",
    serviceAreas: "",
    description: "",
    minBudget: "",
    maxBudget: "",
    phone: "",
    websiteUrl: "",
    instagramHandle: "",
    portfolioUrls: [""],
    referenceUrls: [""],
    registrationType: "",
    registrationReference: "",
    attested: false,
  };
}

async function readVendorEvidenceCompletionAccess({ signal } = {}) {
  const response = await fetch("/api/v1/vendors/onboarding/evidence", { cache: "no-store", credentials: "include", signal });
  if (response.status === 401) return { state: "guest", vendorStatus: null, context: null };
  if (response.status === 403) return { state: "status_unavailable", vendorStatus: null, context: null };
  if (response.status === 404) return { state: "no_application", vendorStatus: null, context: null };
  const payload = await readApiResponse(response, "Application eligibility could not be checked.");
  const context = normalizeVendorEvidenceContext(payload);
  if (!context.vendorId) return { state: "status_unavailable", vendorStatus: null, context: null };
  const contextContractValid = Number.isInteger(context.reviewRevision)
    && Number.isInteger(context.informationRequestRevision)
    && context.evidenceConsistent !== false;
  return {
    state: contextContractValid ? vendorEvidenceCompletionEligibility(context) : "status_unavailable",
    vendorStatus: context.effectiveStatus,
    context,
  };
}

function EvidenceUrlFields({ id, label, description, values, minimum, maximum, errors, requested = false, disabled = false, onChange, onAdd, onRemove }) {
  const groupErrorId = `${id}-error`;
  return (
    <div className={`onboarding-evidence-links ${requested ? "is-requested" : ""}`}>
      <div className="onboarding-evidence-links__heading">
        <div><strong>{label}{requested && <span className="onboarding-requested-badge">Update requested</span>}</strong><p>{description}</p></div>
        <small>{minimum === 1 ? "At least 1" : `At least ${minimum}`} · Up to {maximum}</small>
      </div>
      <div className="onboarding-evidence-links__list">
        {values.map((value, index) => (
          <div className="onboarding-evidence-link" key={`${id}-${index}`}>
            <label className="field">
              <span>{label.replace(/s$/u, "")} {index + 1}{index >= minimum ? <small>Optional</small> : null}</span>
              <div className="input-wrap"><Link2 size={16} /><input type="url" inputMode="url" value={value} onChange={(event) => onChange(index, event.target.value)} placeholder="https://" maxLength="500" data-evidence-field={id} data-evidence-index={index} data-evidence-focus={`${id}:${index}`} aria-invalid={Boolean(errors[`${id}.${index}`] || errors[id])} aria-describedby={[errors[`${id}.${index}`] ? `${id}-${index}-error` : "", errors[id] ? groupErrorId : ""].filter(Boolean).join(" ") || undefined} required={index < minimum} disabled={disabled} /></div>
              <OnboardingError id={`${id}-${index}-error`}>{errors[`${id}.${index}`]}</OnboardingError>
            </label>
            {values.length > minimum && <button className="icon-button icon-button--small" type="button" data-evidence-focus={`${id}:remove:${index}`} onClick={() => onRemove(index)} aria-label={`Remove ${label.toLowerCase().replace(/s$/u, "")} ${index + 1}`} disabled={disabled}><X size={16} /></button>}
          </div>
        ))}
      </div>
      {values.length < maximum && <button className="text-button onboarding-evidence-links__add" type="button" data-evidence-add={id} data-evidence-focus={`${id}:add`} onClick={onAdd} disabled={disabled}><Plus size={14} /> Add another</button>}
      <OnboardingError id={groupErrorId}>{errors[id]}</OnboardingError>
    </div>
  );
}

export function VendorOnboardingPage({ notify, onOpenAuth, authRevision = 0 }) {
  const [searchParams] = useSearchParams();
  const evidenceOnly = searchParams.get("mode") === "evidence";
  const [form, setForm] = useState(createVendorOnboardingForm);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(null);
  const [compatibility, setCompatibility] = useState("checking");
  const [compatibilityRetryKey, setCompatibilityRetryKey] = useState(0);
  const [evidenceAccess, setEvidenceAccess] = useState(evidenceOnly ? "checking" : "eligible");
  const [evidenceVendorStatus, setEvidenceVendorStatus] = useState(null);
  const [evidenceContext, setEvidenceContext] = useState(null);
  const [evidenceConflict, setEvidenceConflict] = useState(null);
  const [submissionUnconfirmed, setSubmissionUnconfirmed] = useState(false);
  const [evidenceAccessRetryKey, setEvidenceAccessRetryKey] = useState(0);
  const [evidenceIdentityPending, setEvidenceIdentityPending] = useState(evidenceOnly);
  const [evidenceAccessErrorMessage, setEvidenceAccessErrorMessage] = useState("");
  const submissionKeyRef = useRef(null);
  const formRef = useRef(null);
  const formInitializedRef = useRef(false);
  const dirtyRef = useRef(false);
  const loadedVendorIdRef = useRef(null);
  const evidenceReadSequenceRef = useRef(0);
  const evidenceContextRef = useRef(null);
  const evidenceModeRef = useRef(evidenceOnly);
  const evidenceAuthRevisionRef = useRef(authRevision);
  const submissionGenerationRef = useRef(0);
  const activeMutationRef = useRef(null);
  const submissionLockRef = useRef(false);
  const evidenceFocusRestoreRef = useRef(null);
  const evidenceFocusRestoreFrameRef = useRef(null);

  function cancelScheduledEvidenceFocus() {
    if (evidenceFocusRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(evidenceFocusRestoreFrameRef.current);
      evidenceFocusRestoreFrameRef.current = null;
    }
  }

  function clearPrivateEvidenceDraft() {
    submissionGenerationRef.current += 1;
    activeMutationRef.current = null;
    submissionLockRef.current = false;
    cancelScheduledEvidenceFocus();
    evidenceFocusRestoreRef.current = null;
    submissionKeyRef.current = null;
    formInitializedRef.current = false;
    dirtyRef.current = false;
    loadedVendorIdRef.current = null;
    evidenceContextRef.current = null;
    setForm(createVendorOnboardingForm());
    setErrors({});
    setSubmitError("");
    setLoading(false);
    setSuccess(null);
    setEvidenceContext(null);
    setEvidenceConflict(null);
    setSubmissionUnconfirmed(false);
    setEvidenceAccessErrorMessage("");
  }

  function captureEvidenceFocus() {
    const activeElement = document.activeElement;
    if (formRef.current?.contains(activeElement)) {
      evidenceFocusRestoreRef.current = activeElement?.getAttribute?.("data-evidence-focus") || null;
    }
  }

  function scheduleEvidenceFocus(focusDescriptor) {
    cancelScheduledEvidenceFocus();
    if (!focusDescriptor) return;
    const focusGeneration = submissionGenerationRef.current;
    evidenceFocusRestoreFrameRef.current = window.requestAnimationFrame(() => {
      evidenceFocusRestoreFrameRef.current = null;
      if (focusGeneration !== submissionGenerationRef.current || !evidenceModeRef.current) return;
      const controls = [...(formRef.current?.querySelectorAll("[data-evidence-focus]") || [])]
        .filter((element) => !element.disabled && element.getAttribute("aria-hidden") !== "true");
      const target = controls.find((element) => element.getAttribute("data-evidence-focus") === focusDescriptor)
        || controls[0];
      if (!target) return;
      target.focus({ preventScroll: true });
      const viewportHeight = window.visualViewport?.height || window.innerHeight;
      if (evidenceFocusNeedsScroll(target.getBoundingClientRect(), viewportHeight)) {
        target.scrollIntoView({ block: "center", inline: "nearest" });
      }
    });
  }

  function restoreEvidenceFocus() {
    const focusDescriptor = evidenceFocusRestoreRef.current;
    evidenceFocusRestoreRef.current = null;
    scheduleEvidenceFocus(focusDescriptor);
  }

  useEffect(() => () => cancelScheduledEvidenceFocus(), []);

  useEffect(() => {
    const controller = new AbortController();
    setCompatibility("checking");
    async function checkCompatibility() {
      try {
        const compatible = await checkVendorApplicationEvidenceCompatibility({ signal: controller.signal });
        if (!controller.signal.aborted) setCompatibility(compatible ? "ready" : "upgrade");
      } catch (error) {
        if (error?.name !== "AbortError" && !controller.signal.aborted) setCompatibility("error");
      }
    }
    checkCompatibility();
    return () => controller.abort();
  }, [compatibilityRetryKey]);

  useEffect(() => {
    if (!evidenceOnly) return undefined;
    const revalidateFocusedAccount = () => {
      captureEvidenceFocus();
      evidenceReadSequenceRef.current += 1;
      submissionGenerationRef.current += 1;
      const mutationInFlight = Boolean(activeMutationRef.current);
      submissionLockRef.current = mutationInFlight;
      if (mutationInFlight) {
        setSubmissionUnconfirmed(true);
        setSubmitError("We are rechecking this account before confirming the in-flight submission. The unchanged form and secure submission key are preserved for a safe retry.");
      }
      setLoading(mutationInFlight);
      setEvidenceIdentityPending(true);
      setEvidenceAccess("checking");
      setEvidenceAccessRetryKey((value) => value + 1);
    };
    window.addEventListener("focus", revalidateFocusedAccount);
    return () => window.removeEventListener("focus", revalidateFocusedAccount);
  }, [evidenceOnly]);

  useEffect(() => {
    const readSequence = ++evidenceReadSequenceRef.current;
    const wasEvidenceOnly = evidenceModeRef.current;
    const identityChanged = evidenceAuthRevisionRef.current !== authRevision;
    const modeChanged = wasEvidenceOnly !== evidenceOnly;
    evidenceModeRef.current = evidenceOnly;
    if (evidenceOnly && (identityChanged || modeChanged)) setEvidenceIdentityPending(true);
    if (shouldClearVendorEvidencePrivateDraft({
      evidenceOnly,
      wasEvidenceOnly,
      identityChanged,
    })) clearPrivateEvidenceDraft();
    evidenceAuthRevisionRef.current = authRevision;
    if (!evidenceOnly) {
      setEvidenceIdentityPending(false);
      setEvidenceAccess("eligible");
      setEvidenceVendorStatus(null);
      evidenceContextRef.current = null;
      setEvidenceContext(null);
      return undefined;
    }
    if (compatibility !== "ready") {
      setEvidenceIdentityPending(false);
      setEvidenceAccess("checking");
      setEvidenceVendorStatus(null);
      if (!dirtyRef.current) {
        evidenceContextRef.current = null;
        setEvidenceContext(null);
      }
      return undefined;
    }
    const controller = new AbortController();
    setEvidenceAccessErrorMessage("");
    setEvidenceIdentityPending(true);
    setEvidenceAccess("checking");
    setEvidenceVendorStatus(null);
    async function checkEvidenceAccess() {
      try {
        const result = await readVendorEvidenceCompletionAccess({ signal: controller.signal });
        if (!controller.signal.aborted && readSequence === evidenceReadSequenceRef.current) {
          const boundVendorId = loadedVendorIdRef.current || evidenceContextRef.current?.vendorId || null;
          const incomingVendorId = result.context?.vendorId || null;
          if (shouldClearVendorEvidencePrivateDraft({
            evidenceOnly,
            accessResolved: true,
            incomingContext: result.context,
          }) || (boundVendorId && incomingVendorId !== boundVendorId)) {
            clearPrivateEvidenceDraft();
            setEvidenceAccess(result.state);
            setEvidenceVendorStatus(result.vendorStatus);
            if (result.context) {
              evidenceContextRef.current = result.context;
              setEvidenceContext(result.context);
              if (["eligible", "revision"].includes(result.state)) {
                setForm((current) => ({ ...current, ...prefillVendorEvidence(result.context) }));
                formInitializedRef.current = true;
                loadedVendorIdRef.current = result.context.vendorId;
              }
            }
            setEvidenceIdentityPending(false);
            return;
          }
          if (activeMutationRef.current) {
            setEvidenceAccess("checking");
            setEvidenceIdentityPending(true);
            return;
          }
          const refreshDecision = vendorEvidenceContextRefreshDecision({
            currentContext: evidenceContextRef.current,
            incomingContext: result.context,
            dirty: dirtyRef.current,
            formInitialized: formInitializedRef.current,
            loadedVendorId: loadedVendorIdRef.current,
          });
          if (refreshDecision.conflict) {
            setEvidenceAccess(result.state);
            setEvidenceVendorStatus(result.vendorStatus);
            setEvidenceConflict({ kind: "application_changed", latest: result });
            setSubmitError("");
            setEvidenceIdentityPending(false);
            if (["eligible", "revision"].includes(result.state)) restoreEvidenceFocus();
            else evidenceFocusRestoreRef.current = null;
            return;
          }
          setEvidenceAccess(result.state);
          setEvidenceVendorStatus(result.vendorStatus);
          evidenceContextRef.current = result.context;
          setEvidenceContext(result.context);
          if (refreshDecision.shouldResetForm) {
            setForm((current) => ({ ...current, ...prefillVendorEvidence(result.context) }));
            formInitializedRef.current = true;
            dirtyRef.current = false;
            submissionKeyRef.current = null;
            setSubmissionUnconfirmed(false);
            setEvidenceConflict(null);
            setErrors({});
            setSubmitError("");
          }
          if (result.context?.vendorId) loadedVendorIdRef.current = result.context.vendorId;
          setEvidenceIdentityPending(false);
          if (["eligible", "revision"].includes(result.state)) restoreEvidenceFocus();
          else evidenceFocusRestoreRef.current = null;
        }
      } catch (error) {
        if (error?.name !== "AbortError" && !controller.signal.aborted && readSequence === evidenceReadSequenceRef.current) {
          setEvidenceAccess("error");
          setEvidenceIdentityPending(false);
          evidenceFocusRestoreRef.current = null;
        }
      }
    }
    checkEvidenceAccess();
    return () => controller.abort();
  }, [authRevision, compatibility, evidenceAccessRetryKey, evidenceOnly]);

  function markFormChanged() {
    if (submissionLockRef.current) return false;
    dirtyRef.current = true;
    submissionKeyRef.current = null;
    setSubmissionUnconfirmed(false);
    return true;
  }

  function update(key, value) {
    if (!markFormChanged()) return;
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
    setSubmitError("");
  }
  function updateEvidenceUrl(key, index, value) {
    if (!markFormChanged()) return;
    setForm((current) => ({ ...current, [key]: current[key].map((item, itemIndex) => itemIndex === index ? value : item) }));
    setErrors((current) => ({ ...current, [key]: "", [`${key}.${index}`]: "" }));
    setSubmitError("");
  }
  function addEvidenceUrl(key) {
    if (!markFormChanged()) return;
    const nextIndex = form[key].length;
    setForm((current) => ({ ...current, [key]: [...current[key], ""] }));
    setErrors((current) => ({ ...current, [key]: "" }));
    setSubmitError("");
    window.requestAnimationFrame(() => formRef.current
      ?.querySelector(`[data-evidence-field="${key}"][data-evidence-index="${nextIndex}"]`)
      ?.focus());
  }
  function removeEvidenceUrl(key, index) {
    if (!markFormChanged()) return;
    const nextIndex = evidenceFocusIndexAfterRemoval(form[key].length, index);
    setForm((current) => ({ ...current, [key]: current[key].filter((_, itemIndex) => itemIndex !== index) }));
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([errorKey]) => !errorKey.startsWith(`${key}.`))));
    setSubmitError("");
    window.requestAnimationFrame(() => {
      const target = nextIndex === null
        ? formRef.current?.querySelector(`[data-evidence-add="${key}"]`)
        : formRef.current?.querySelector(`[data-evidence-field="${key}"][data-evidence-index="${nextIndex}"]`);
      target?.focus();
    });
  }

  async function reloadLatestEvidence() {
    const readSequence = ++evidenceReadSequenceRef.current;
    // Discard is an immediate user decision, not a side effect of a later read.
    // Clear first so focus/auth revalidation cannot cancel the discard intent.
    clearPrivateEvidenceDraft();
    setEvidenceIdentityPending(true);
    setEvidenceAccess("checking");
    setLoading(true);
    try {
      const result = await readVendorEvidenceCompletionAccess();
      if (readSequence !== evidenceReadSequenceRef.current) return;
      const reloadPlan = vendorEvidenceExplicitReloadPlan(result);
      setEvidenceAccess(result.state);
      setEvidenceVendorStatus(result.vendorStatus);
      if (result.context) {
        evidenceContextRef.current = result.context;
        setEvidenceContext(result.context);
      }
      if (reloadPlan.shouldPrefill && result.context) {
        loadedVendorIdRef.current = reloadPlan.vendorId;
        setForm((current) => ({ ...current, ...prefillVendorEvidence(result.context) }));
        formInitializedRef.current = true;
      }
      setEvidenceIdentityPending(false);
      if (result.state === "guest") onOpenAuth();
    } catch (error) {
      if (readSequence === evidenceReadSequenceRef.current) {
        setEvidenceAccess("error");
        setEvidenceIdentityPending(false);
        setEvidenceAccessErrorMessage("The latest evidence request could not be loaded. The entries you discarded remain cleared; retry the account check to load the current record.");
      }
    } finally {
      if (readSequence === evidenceReadSequenceRef.current) setLoading(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (submissionLockRef.current) return;
    const submissionGeneration = submissionGenerationRef.current;
    const submissionIsCurrent = () => submissionGenerationRef.current === submissionGeneration;
    const retryingUnconfirmedSubmission = submissionUnconfirmed;
    if (compatibility !== "ready") {
      setSubmitError(compatibility === "upgrade"
        ? "Applications are temporarily paused during a service upgrade. Nothing was submitted."
        : "Secure submission compatibility has not been confirmed. Nothing was submitted.");
      return;
    }
    if (evidenceOnly && !["eligible", "revision"].includes(evidenceAccess)) {
      setSubmitError("This account is not currently eligible to submit evidence. Nothing was submitted.");
      return;
    }
    if (evidenceOnly && evidenceConflict) {
      setSubmitError("Load the latest application version before submitting. Your current edits remain in this form until you choose to replace them.");
      return;
    }
    const serviceAreas = form.serviceAreas.split(",").map((item) => item.trim()).filter(Boolean);
    const next = evidenceOnly ? {} : validateVendorApplication({ ...form, serviceAreas });
    Object.assign(next, validateVendorEvidence(form));
    if (Object.keys(next).length) {
      setErrors(next);
      window.requestAnimationFrame(() => formRef.current?.querySelector('[aria-invalid="true"]')?.focus());
      return;
    }
    const evidence = buildVendorEvidence(form);
    const applicationPayload = {
      businessName: form.businessName.trim(),
      legalName: form.legalName.trim(),
      category: form.category,
      categories: [form.category],
      city: form.city,
      serviceAreas,
      description: form.description.trim(),
      minBudget: Number(form.minBudget),
      maxBudget: Number(form.maxBudget),
      currency: "INR",
      phone: form.phone.trim(),
      websiteUrl: form.websiteUrl.trim() || undefined,
      instagramHandle: form.instagramHandle.trim() || undefined,
      evidence,
    };
    const expectedContext = evidenceContext;
    const payload = evidenceOnly ? buildVendorEvidenceSubmissionPayload(form, expectedContext) : applicationPayload;
    if (evidenceOnly && !payload) {
      setSubmitError("The application version needed for a safe update is unavailable. Refresh the latest evidence request before submitting.");
      return;
    }
    if (evidenceOnly) captureEvidenceFocus();
    submissionLockRef.current = true;
    setLoading(true); setSubmitError(""); setErrors({});
    let submissionStarted = false;
    let compatibilityConfirmed = false;
    let mutationToken = null;
    let postDispatchAccess = null;
    let postDispatchIdentityVerified = false;
    const clearForDifferentEvidenceIdentity = (accessResult) => {
      clearPrivateEvidenceDraft();
      setEvidenceAccess(accessResult?.state || "error");
      setEvidenceVendorStatus(accessResult?.vendorStatus || null);
      if (accessResult?.context) {
        evidenceContextRef.current = accessResult.context;
        setEvidenceContext(accessResult.context);
        if (["eligible", "revision"].includes(accessResult.state)) {
          setForm((current) => ({ ...current, ...prefillVendorEvidence(accessResult.context) }));
          formInitializedRef.current = true;
          loadedVendorIdRef.current = accessResult.context.vendorId;
        }
      }
      setEvidenceIdentityPending(false);
      if (accessResult?.state === "guest") onOpenAuth();
    };
    const verifyPostDispatchEvidenceIdentity = async () => {
      let latest = null;
      try {
        latest = await readVendorEvidenceCompletionAccess();
      } catch {
        if (submissionIsCurrent()) {
          setEvidenceAccess("error");
          setEvidenceIdentityPending(false);
          setSubmissionUnconfirmed(true);
          setSubmitError("We could not verify the current account after this submission attempt. Your unchanged entries and secure submission key remain hidden for a safe retry.");
        }
        return null;
      }
      if (!submissionIsCurrent()) return null;
      if (!vendorEvidencePreflightIdentityMatches(expectedContext, latest)) {
        clearForDifferentEvidenceIdentity(latest);
        return null;
      }
      setEvidenceAccess(latest.state);
      setEvidenceVendorStatus(latest.vendorStatus);
      setEvidenceIdentityPending(false);
      return latest;
    };
    try {
      const compatible = await checkVendorApplicationEvidenceCompatibility();
      if (!submissionIsCurrent()) return;
      if (!compatible) {
        setCompatibility("upgrade");
        setSubmitError(retryingUnconfirmedSubmission
          ? "The secure service is still unavailable, so the earlier submission remains unconfirmed. Your unchanged form and secure submission key are preserved."
          : "Applications are temporarily paused during a service upgrade. Your entries remain in this form and nothing was submitted.");
        return;
      }
      compatibilityConfirmed = true;
      setCompatibility("ready");
      if (shouldPreflightVendorEvidenceSubmission({ evidenceOnly, submissionUnconfirmed: retryingUnconfirmedSubmission })) {
        const accessResult = await readVendorEvidenceCompletionAccess();
        if (!submissionIsCurrent()) return;
        if (!vendorEvidencePreflightIdentityMatches(expectedContext, accessResult)) {
          clearForDifferentEvidenceIdentity(accessResult);
          return;
        }
        if (!vendorEvidencePreflightMatches({
          expectedContext,
          accessResult,
          submissionUnconfirmed: retryingUnconfirmedSubmission,
        })) {
          setEvidenceAccess(accessResult.state);
          setEvidenceVendorStatus(accessResult.vendorStatus);
          setEvidenceConflict({ kind: "application_changed", latest: accessResult });
          setSubmitError("The application or information request changed before submission. Your edits are preserved and nothing was submitted.");
          scheduleEvidenceFocus("load-latest");
          return;
        }
      }
      const submissionKey = submissionKeyRef.current || createIdempotencyKey("vendor-onboarding");
      submissionKeyRef.current = submissionKey;
      submissionStarted = true;
      mutationToken = {};
      activeMutationRef.current = mutationToken;
      if (evidenceOnly) setEvidenceIdentityPending(true);
      const response = await fetch(evidenceOnly ? "/api/v1/vendors/onboarding/evidence" : "/api/v1/vendors/onboarding", { method: evidenceOnly ? "PUT" : "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": submissionKey, ...(evidenceOnly ? VENDOR_APPLICATION_EVIDENCE_HEADERS : {}) }, credentials: "include", body: JSON.stringify(payload) });
      if (!submissionIsCurrent()) return;
      if (evidenceOnly) {
        postDispatchAccess = await verifyPostDispatchEvidenceIdentity();
        if (!postDispatchAccess || !submissionIsCurrent()) return;
        postDispatchIdentityVerified = true;
      }
      if (response.status === 401) { onOpenAuth(); throw Object.assign(new Error("Sign in or create an account, then submit this form again."), { code: "SIGN_IN" }); }
      const responsePayload = await readApiResponse(response, "The application could not be submitted.");
      if (!submissionIsCurrent()) return;
      const responseData = responsePayload?.data || responsePayload || {};
      if (evidenceOnly) {
        const evidenceRevision = Number(responseData.evidenceSummary?.revision);
        if (!Number.isInteger(evidenceRevision) || evidenceRevision < 1) {
          throw Object.assign(new Error("The service accepted the request but did not return the saved evidence revision."), { code: "CONFIRMATION_MISSING" });
        }
        const revised = expectedContext?.effectiveStatus === "needs_information";
        setSuccess({ evidenceRevision, revised, hadPreviousEvidence: Number(expectedContext?.evidenceRevision) >= 1 });
        notify({ title: revised ? `Evidence revision ${evidenceRevision} submitted` : `Evidence revision ${evidenceRevision} attached`, message: "The complete snapshot is ready for the partner team to review." });
      } else {
        setSuccess({ application: true });
        notify({ title: "Application received", message: "The partner team will review your profile and evidence." });
      }
    } catch (requestError) {
      if (!submissionIsCurrent()) return;
      if (evidenceOnly && submissionStarted && !postDispatchIdentityVerified) {
        postDispatchAccess = await verifyPostDispatchEvidenceIdentity();
        if (!postDispatchAccess || !submissionIsCurrent()) return;
        postDispatchIdentityVerified = true;
      }
      if (!submissionStarted) {
        if (!compatibilityConfirmed) {
          setCompatibility("error");
          setSubmitError("Secure submission compatibility could not be confirmed. Your entries remain in this form and nothing was submitted.");
        } else if (evidenceOnly) {
          setEvidenceAccess("error");
          setEvidenceIdentityPending(false);
          if (retryingUnconfirmedSubmission) {
            setSubmissionUnconfirmed(true);
            setSubmitError("We still could not verify the account for the earlier submission. Your unchanged form and secure submission key remain hidden for another safe retry.");
          } else {
            setSubmitError("Application eligibility could not be confirmed. Your entries remain hidden in this tab and nothing was submitted.");
          }
        } else {
          setSubmitError("The application could not be prepared. Your entries remain in this form and nothing was submitted.");
        }
      } else if (requestError.code === "SIGN_IN") setSubmitError(requestError.message);
      else if (evidenceOnly && requestError.code === "client_upgrade_required") {
        setCompatibility("upgrade");
        setSubmissionUnconfirmed(false);
        setSubmitError(requestError.message);
      }
      else if (evidenceOnly && vendorEvidenceConflictState(requestError)) {
        setEvidenceConflict({ kind: vendorEvidenceConflictState(requestError), latest: postDispatchAccess });
        setSubmissionUnconfirmed(false);
        setSubmitError("The application changed while you were submitting. Your edits are preserved; load the latest application version before trying again.");
        scheduleEvidenceFocus("load-latest");
      } else if (evidenceOnly && Object.keys(vendorEvidenceServerFieldErrors(requestError.details)).length) {
        const serverErrors = vendorEvidenceServerFieldErrors(requestError.details);
        setErrors(serverErrors);
        setSubmissionUnconfirmed(false);
        setSubmitError("Review the highlighted evidence fields. Your entries remain in this form.");
        window.requestAnimationFrame(() => formRef.current?.querySelector('[aria-invalid="true"]')?.focus());
      } else if (requestError.code === "CONFIRMATION_MISSING") {
        setSubmissionUnconfirmed(true);
        setSubmitError("The service accepted this request, but the saved revision could not be confirmed. Keep this form unchanged and check your application status before retrying.");
        restoreEvidenceFocus();
      } else if (isServiceUnavailable(requestError)) {
        setSubmissionUnconfirmed(true);
        setSubmitError("We could not confirm whether the service saved this request. Keep the form unchanged; retrying will reuse the same secure submission key, or check your application status first.");
        restoreEvidenceFocus();
      } else {
        setSubmissionUnconfirmed(false);
        setSubmitError(requestError.message || "The application could not be submitted. Please review the fields and try again.");
        if (evidenceOnly) restoreEvidenceFocus();
      }
    } finally {
      const mutationSettled = Boolean(mutationToken) && activeMutationRef.current === mutationToken;
      if (mutationSettled) {
        activeMutationRef.current = null;
        submissionLockRef.current = false;
      }
      if (!submissionIsCurrent() && evidenceOnly && mutationSettled) {
        setLoading(false);
        setEvidenceIdentityPending(true);
        setEvidenceAccess("checking");
        setEvidenceAccessRetryKey((value) => value + 1);
      }
      if (submissionIsCurrent()) {
        submissionLockRef.current = false;
        setLoading(false);
      }
    }
  }

  const revisionMode = evidenceOnly && evidenceAccess === "revision";
  const informationRequest = evidenceContext?.currentInformationRequest;
  const nextEvidenceRevision = evidenceOnly && Number.isInteger(evidenceContext?.evidenceRevision)
    ? evidenceContext.evidenceRevision + 1
    : null;
  const evidenceModeTransitionPending = evidenceModeRef.current !== evidenceOnly;
  const evidenceAuthTransitionPending = evidenceOnly && evidenceAuthRevisionRef.current !== authRevision;
  if (evidenceModeTransitionPending) return <OnboardingGate icon={LoaderCircle} spinning eyebrow="Private application record" title="Switching application form" message="Private entries remain hidden while the form mode changes." />;
  if (evidenceAuthTransitionPending) return <OnboardingGate icon={LoaderCircle} spinning eyebrow="Private application record" title="Rechecking account identity" message="Private evidence remains hidden until the current account is verified." />;
  if (evidenceOnly && compatibility === "checking") return <OnboardingGate icon={LoaderCircle} spinning eyebrow="Secure evidence update" title="Checking secure submission support" message="Confirming the current service can safely accept this evidence form before loading any application details." />;
  if (evidenceOnly && compatibility === "upgrade") return <OnboardingGate icon={ShieldAlert} eyebrow="Evidence updates temporarily paused" title="Refresh after the secure service upgrade" message="This version cannot safely send the current evidence snapshot. Nothing has been submitted."><button className="button button--primary" type="button" onClick={() => setCompatibilityRetryKey((value) => value + 1)}><RefreshCw size={16} /> Check again</button><Link className="button button--outline" to="/vendor">Return to vendor workspace</Link></OnboardingGate>;
  if (evidenceOnly && compatibility === "error") return <OnboardingGate icon={CircleAlert} eyebrow="Secure check unavailable" title="Evidence updates cannot be opened right now" message="The current submission contract could not be confirmed. Nothing has been submitted."><button className="button button--primary" type="button" onClick={() => setCompatibilityRetryKey((value) => value + 1)}><RefreshCw size={16} /> Try again</button><Link className="button button--outline" to="/vendor">Return to vendor workspace</Link></OnboardingGate>;
  if (evidenceOnly && evidenceIdentityPending) return <OnboardingGate icon={LoaderCircle} spinning eyebrow="Private application record" title="Rechecking account identity" message="Private evidence remains hidden until the current account is verified." />;
  if (evidenceOnly && evidenceAccess === "checking") return <OnboardingGate icon={LoaderCircle} spinning eyebrow="Private application record" title="Checking evidence eligibility" message="Confirming this signed-in application can add a structured evidence snapshot." />;
  if (evidenceOnly && evidenceAccess === "guest") return <OnboardingGate icon={LockKeyhole} eyebrow="Private application record" title="Sign in to complete application evidence" message="Evidence can be attached only to your own pending or declined partner application. Private evidence from an unverified session is cleared and nothing was submitted."><button className="button button--primary" type="button" onClick={onOpenAuth}>Sign in</button><Link className="button button--outline" to="/vendor">Return to vendor workspace</Link></OnboardingGate>;
  if (evidenceOnly && evidenceAccess === "no_application") return <OnboardingGate icon={Store} eyebrow="No partner application found" title="Start a partner application first" message="This account has no vendor application that can receive an evidence snapshot."><Link className="button button--primary" to="/vendor/onboarding">Start application</Link><Link className="button button--outline" to="/vendor">Return to vendor workspace</Link></OnboardingGate>;
  if (evidenceOnly && evidenceAccess === "status_unavailable") return <OnboardingGate icon={ShieldAlert} eyebrow="Evidence update unavailable" title="This application cannot add evidence in its current state" message={`Evidence updates are available for an incomplete application or an open information request. This application is ${evidenceVendorStatus || "in an unknown review state"}; private entries are hidden whenever its identity or review state cannot be verified, and nothing was submitted.`}><Link className="button button--primary" to="/vendor">Open vendor workspace</Link></OnboardingGate>;
  if (evidenceOnly && evidenceAccess === "error") return <OnboardingGate icon={CircleAlert} eyebrow="Eligibility check unavailable" title="This application could not be checked" message={evidenceAccessErrorMessage || (submissionUnconfirmed ? "The earlier submission remains unconfirmed. Its unchanged private entries and secure submission key stay hidden in this tab until this account can be verified for a safe retry." : "No evidence was submitted. Private entries remain hidden in this tab while the read-only account check is unavailable.")}><button className="button button--primary" type="button" onClick={() => setEvidenceAccessRetryKey((value) => value + 1)}><RefreshCw size={16} /> Try again</button><Link className="button button--outline" to="/vendor">Return to vendor workspace</Link></OnboardingGate>;
  if (success) return <div className="onboarding-page page-surface"><div className="shell"><OnboardingSuccess evidenceOnly={evidenceOnly} success={success} /></div></div>;
  if (evidenceOnly && evidenceAccess === "complete") return <OnboardingGate icon={FileCheck2} eyebrow="Evidence already submitted" title="No evidence update is currently open" message="Your latest structured evidence is already with the partner team. Another revision can be submitted only when the partner team opens a specific information request."><Link className="button button--primary" to="/vendor">Check application status</Link></OnboardingGate>;
  return (
    <div className="onboarding-page page-surface">
      <OnboardingHero evidenceOnly={evidenceOnly} revisionMode={revisionMode} />
      <section className="shell onboarding-layout">
        <form className="onboarding-form" onSubmit={submit} noValidate ref={formRef} aria-busy={loading}>
          {compatibility !== "ready" && (
            <div className={`onboarding-compatibility onboarding-compatibility--${compatibility}`} role={compatibility === "checking" ? "status" : "alert"} aria-live="polite">
              {compatibility === "checking" ? <LoaderCircle className="spin-icon" size={18} /> : <ShieldAlert size={18} />}
              <p>
                <strong>{compatibility === "checking" ? "Checking secure submission support" : compatibility === "upgrade" ? "Applications are temporarily paused during an upgrade" : "Secure submission check unavailable"}</strong>
                <span>{compatibility === "checking" ? "Confirming this service supports the current evidence form before anything can be sent." : "You can keep this form open. Your entries remain here, submission is disabled and nothing has been sent."}</span>
              </p>
              {compatibility !== "checking" && <button className="text-button" type="button" onClick={() => setCompatibilityRetryKey((value) => value + 1)}><RefreshCw size={14} /> Check again</button>}
            </div>
          )}
          {revisionMode && informationRequest && (
            <section className="onboarding-information-request" aria-labelledby="onboarding-information-request-heading">
              <div className="onboarding-information-request__top"><span><CircleAlert size={19} /></span><div><div className="eyebrow">Partner team request</div><h2 id="onboarding-information-request-heading">Revise the requested evidence areas</h2><p>Application version {evidenceContext.reviewRevision} · request {informationRequest.revision} · current evidence revision {evidenceContext.evidenceRevision}</p></div></div>
              <ul>{informationRequest.requestedFields.map((field) => <li key={field}><Check size={14} />{OWNER_INFORMATION_FIELD_LABELS[field]}</li>)}</ul>
              <blockquote>{informationRequest.applicantMessage}</blockquote>
              <p className="onboarding-information-request__snapshot"><ShieldCheck size={15} /> {evidenceContext.evidenceRevision > 0 ? `The form is prefilled with evidence revision ${evidenceContext.evidenceRevision}. Submit every section to create revision ${nextEvidenceRevision}; earlier revisions stay immutable.` : `No earlier structured snapshot exists. Complete every section to create evidence revision ${nextEvidenceRevision} and close this request.`}</p>
            </section>
          )}
          {evidenceConflict && (
            <div className="onboarding-conflict" role="alert">
              <CircleAlert size={19} />
              <p><strong>Application version changed</strong><span>Your edits are still here and were not replaced. {Number.isInteger(evidenceConflict.latest?.context?.reviewRevision) && Number.isInteger(evidenceConflict.latest?.context?.informationRequestRevision) ? `The service now reports Application version ${evidenceConflict.latest.context.reviewRevision}, Evidence revision ${evidenceConflict.latest.context.evidenceRevision}, and information-request revision ${evidenceConflict.latest.context.informationRequestRevision}. ` : ""}Load the latest application and evidence snapshot before submitting again.</span></p>
              <button className="button button--outline button--small" type="button" data-evidence-focus="load-latest" onClick={reloadLatestEvidence} disabled={loading}>Discard my edits and load latest</button>
            </div>
          )}
          {!evidenceOnly && <section className="onboarding-form__section" aria-labelledby="onboarding-business-heading">
            <div className="onboarding-form__heading"><span><Store size={20} /></span><div><h2 id="onboarding-business-heading">Introduce your business</h2><p>Every field without an “optional” label is required for partner review.</p></div></div>
            <div className="form-grid">
              <label className="field"><span>Business name</span><input value={form.businessName} onChange={(event) => update("businessName", event.target.value)} placeholder="The Wedding Journal" maxLength="140" aria-invalid={Boolean(errors.businessName)} aria-describedby={errors.businessName ? "businessName-error" : undefined} required disabled={loading} /><OnboardingError id="businessName-error">{errors.businessName}</OnboardingError></label>
              <label className="field"><span>Registered or proprietor name</span><input value={form.legalName} onChange={(event) => update("legalName", event.target.value)} placeholder="Journal Studios Private Limited" maxLength="180" aria-invalid={Boolean(errors.legalName)} aria-describedby={errors.legalName ? "legalName-error" : undefined} required disabled={loading} /><OnboardingError id="legalName-error">{errors.legalName}</OnboardingError></label>
              <label className="field"><span>Primary service</span><div className="input-wrap input-wrap--select"><select value={form.category} onChange={(event) => update("category", event.target.value)} aria-invalid={Boolean(errors.category)} aria-describedby={errors.category ? "category-error" : undefined} required disabled={loading}><option value="">Choose a category</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select><ChevronDown size={15} /></div><OnboardingError id="category-error">{errors.category}</OnboardingError></label>
              <label className="field"><span>Home city</span><div className="input-wrap input-wrap--select"><select value={form.city} onChange={(event) => update("city", event.target.value)} aria-invalid={Boolean(errors.city)} aria-describedby={errors.city ? "city-error" : undefined} required disabled={loading}><option value="">Choose a city</option>{cities.map((city) => <option key={city}>{city}</option>)}</select><ChevronDown size={15} /></div><OnboardingError id="city-error">{errors.city}</OnboardingError></label>
              <label className="field field--span-2"><span>Service areas</span><input value={form.serviceAreas} onChange={(event) => update("serviceAreas", event.target.value)} placeholder="Delhi NCR, Jaipur, Chandigarh" aria-invalid={Boolean(errors.serviceAreas)} aria-describedby={errors.serviceAreas ? "serviceAreas-hint serviceAreas-error" : "serviceAreas-hint"} required disabled={loading} /><small className="field-hint" id="serviceAreas-hint">Separate cities with commas.</small><OnboardingError id="serviceAreas-error">{errors.serviceAreas}</OnboardingError></label>
              <label className="field"><span>Typical project from</span><div className="input-wrap"><IndianRupee size={16} /><input type="number" min="1000" step="1" value={form.minBudget} onChange={(event) => update("minBudget", event.target.value)} aria-invalid={Boolean(errors.minBudget)} aria-describedby={errors.minBudget ? "minBudget-error" : undefined} required disabled={loading} /></div><OnboardingError id="minBudget-error">{errors.minBudget}</OnboardingError></label>
              <label className="field"><span>Typical project up to</span><div className="input-wrap"><IndianRupee size={16} /><input type="number" min="1000" step="1" value={form.maxBudget} onChange={(event) => update("maxBudget", event.target.value)} aria-invalid={Boolean(errors.maxBudget)} aria-describedby={errors.maxBudget ? "maxBudget-error" : undefined} required disabled={loading} /></div><OnboardingError id="maxBudget-error">{errors.maxBudget}</OnboardingError></label>
              <label className="field field--span-2"><span>About your approach</span><textarea rows="6" minLength="80" maxLength="3000" value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Describe your point of view, strongest services, team and the celebrations you do best…" aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? "description-error" : undefined} required disabled={loading} /><div className="field-counter"><OnboardingError id="description-error">{errors.description}</OnboardingError><span>{form.description.length} / 3,000</span></div></label>
              <label className="field"><span>Contact number</span><input type="tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} placeholder="+91 98765 43210" maxLength="24" aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? "phone-error" : undefined} required disabled={loading} /><OnboardingError id="phone-error">{errors.phone}</OnboardingError></label>
              <label className="field"><span>Website <small>Optional</small></span><input type="url" value={form.websiteUrl} onChange={(event) => update("websiteUrl", event.target.value)} placeholder="https://yourstudio.com" maxLength="300" aria-invalid={Boolean(errors.websiteUrl)} aria-describedby={errors.websiteUrl ? "websiteUrl-error" : undefined} disabled={loading} /><OnboardingError id="websiteUrl-error">{errors.websiteUrl}</OnboardingError></label>
              <label className="field field--span-2"><span>Instagram handle <small>Optional</small></span><input value={form.instagramHandle} onChange={(event) => update("instagramHandle", event.target.value)} placeholder="@yourstudio" maxLength="31" aria-invalid={Boolean(errors.instagramHandle)} aria-describedby={errors.instagramHandle ? "instagramHandle-error" : undefined} disabled={loading} /><OnboardingError id="instagramHandle-error">{errors.instagramHandle}</OnboardingError></label>
            </div>
          </section>}

          <section className="onboarding-form__section onboarding-form__section--evidence" aria-labelledby="onboarding-evidence-heading">
            <div className="onboarding-form__heading"><span><FileCheck2 size={20} /></span><div><h2 id="onboarding-evidence-heading">{revisionMode ? `Evidence revision ${nextEvidenceRevision}` : evidenceOnly ? "Complete review evidence" : "Evidence for partner review"}</h2><p>We store each complete submission as an immutable application snapshot. Staff open links manually; Melaiva does not copy or embed their contents.</p></div></div>
            <EvidenceUrlFields id="portfolioUrls" label="Portfolio links" description="Link directly to representative work that you are authorised to share." values={form.portfolioUrls} minimum={1} maximum={5} errors={errors} requested={vendorEvidenceFieldRequested("portfolio", informationRequest)} disabled={loading} onChange={(index, value) => updateEvidenceUrl("portfolioUrls", index, value)} onAdd={() => addEvidenceUrl("portfolioUrls")} onRemove={(index) => removeEvidenceUrl("portfolioUrls", index)} />
            <EvidenceUrlFields id="referenceUrls" label="Public review or reference links" description="Use a public client review, published testimonial or business listing—not private contact details." values={form.referenceUrls} minimum={1} maximum={3} errors={errors} requested={vendorEvidenceFieldRequested("references", informationRequest)} disabled={loading} onChange={(index, value) => updateEvidenceUrl("referenceUrls", index, value)} onAdd={() => addEvidenceUrl("referenceUrls")} onRemove={(index) => removeEvidenceUrl("referenceUrls", index)} />
            <div className={`form-grid onboarding-registration ${vendorEvidenceFieldRequested("registration", informationRequest) ? "is-requested" : ""}`}>
              {vendorEvidenceFieldRequested("registration", informationRequest) && <div className="onboarding-requested-heading field--span-2"><Landmark size={15} /><strong>Business-registration update requested</strong></div>}
              <label className="field"><span>Business registration</span><div className="input-wrap input-wrap--select"><Landmark size={16} /><select value={form.registrationType} onChange={(event) => { update("registrationType", event.target.value); update("registrationReference", ""); }} data-evidence-focus="registration-type" aria-invalid={Boolean(errors.registrationType)} aria-describedby={errors.registrationType ? "registrationType-error" : undefined} required disabled={loading}><option value="">Choose available evidence</option>{VENDOR_REGISTRATION_OPTIONS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select><ChevronDown size={15} /></div><OnboardingError id="registrationType-error">{errors.registrationType}</OnboardingError></label>
              {form.registrationType && form.registrationType !== "not_registered" ? (
                <label className="field"><span>Registration reference</span><input value={form.registrationReference} onChange={(event) => update("registrationReference", event.target.value.toUpperCase())} placeholder={form.registrationType === "udyam" ? "UDYAM-RJ-12-1234567" : form.registrationType === "cin" ? "L12345RJ2020PLC123456" : "27AAPFU0939F1ZV"} maxLength="24" autoCapitalize="characters" autoComplete="off" data-evidence-focus="registration-reference" aria-invalid={Boolean(errors.registrationReference)} aria-describedby={errors.registrationReference ? "registrationReference-error" : undefined} required disabled={loading} /><OnboardingError id="registrationReference-error">{errors.registrationReference}</OnboardingError></label>
              ) : form.registrationType === "not_registered" ? (
                <div className="onboarding-registration__declaration" role="note"><CircleAlert size={17} /><p><strong>Declaration only</strong><span>No government business-registration record will be supplied. The partner team must complete suitable alternative checks before approval.</span></p></div>
              ) : null}
              <p className="onboarding-registration__guard field--span-2"><ShieldAlert size={16} /><span>Do not enter Aadhaar, PAN, passport, voter ID, driving-licence, bank-account or payment-card details. This form accepts only the selected public business-registration reference.</span></p>
            </div>
            <label className="onboarding-evidence-attestation">
              <input type="checkbox" checked={form.attested} onChange={(event) => update("attested", event.target.checked)} data-evidence-focus="attestation" aria-invalid={Boolean(errors.attested)} aria-describedby={errors.attested ? "attested-error" : undefined} required disabled={loading} />
              <span><Check size={14} /></span>
              <strong>I confirm these links are public, accurate, safe for authorised staff to open, and mine to submit for partner review.</strong>
            </label>
            <OnboardingError id="attested-error">{errors.attested}</OnboardingError>
          </section>

          {submitError && <p className="form-error onboarding-submit-error" role="alert">{submitError}</p>}
          {submissionUnconfirmed && <p className="onboarding-unconfirmed" role="note"><ShieldAlert size={15} /><span><strong>Keep the form unchanged to retry safely.</strong> The same idempotency key will be reused. You can also <Link to="/vendor">check application status</Link> first.</span></p>}
          <button className="button button--primary button--large button--wide" disabled={loading || compatibility !== "ready" || Boolean(evidenceConflict)} data-evidence-focus="submit" type="submit">{loading || compatibility === "checking" ? <span className="button-loader" aria-hidden="true" /> : compatibility === "ready" ? <Send size={17} /> : <ShieldAlert size={17} />}{loading ? "Submitting…" : compatibility === "checking" ? "Checking secure submission…" : compatibility === "upgrade" ? "Submission paused during upgrade" : compatibility === "error" ? "Secure submission unavailable" : submissionUnconfirmed ? "Retry same secure submission" : revisionMode ? `Submit complete evidence revision ${nextEvidenceRevision}` : evidenceOnly ? "Attach evidence to application" : "Submit evidence for review"}</button>
          <p className="onboarding-form__privacy"><ShieldCheck size={14} /> {revisionMode ? evidenceContext.evidenceRevision > 0 ? `This creates private evidence revision ${nextEvidenceRevision}; revision ${evidenceContext.evidenceRevision} remains immutable and your business profile stays unchanged.` : `This creates private evidence revision ${nextEvidenceRevision}; your existing business profile stays unchanged.` : evidenceOnly ? "Your existing business profile stays unchanged; this adds one private evidence snapshot for authorised review." : "Business details and evidence stay private to authorised operations staff unless a later approval publishes the business profile."}</p>
        </form>
        <aside className="onboarding-aside">
          <div className="onboarding-aside__card"><Sparkles size={22} /><h2>Built for serious opportunities</h2><ul><li><Check size={15} /><span><strong>Structured briefs</strong>See dates, scope and working range before investing time.</span></li><li><Check size={15} /><span><strong>Sealed offers</strong>Compete on fit and value without seeing another price.</span></li><li><Check size={15} /><span><strong>Accountable review</strong>Every marketplace decision carries an internal reason and immutable history.</span></li></ul></div>
          <div className="onboarding-aside__note"><ShieldCheck size={18} /><p><strong>Marketplace review is human-led.</strong> Submission does not guarantee acceptance and is not KYC, legal certification or a guarantee of performance.</p></div>
        </aside>
      </section>
    </div>
  );
}
