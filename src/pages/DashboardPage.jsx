import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  BadgeIndianRupee,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  FileText,
  Handshake,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  MessageSquareText,
  MoreHorizontal,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  ScrollText,
  Users,
  X,
} from "lucide-react";
import { dashboardTasks, formatCurrency, sampleOffers } from "../data.js";
import { createIdempotencyKey, readApiResponse } from "../api.js";

const budgetRows = [
  { name: "Venue & stay", allocated: 900000, committed: 710000, tone: "aubergine" },
  { name: "Food & beverage", allocated: 650000, committed: 380000, tone: "marigold" },
  { name: "Decor & production", allocated: 450000, committed: 175000, tone: "teal" },
  { name: "Photo & film", allocated: 240000, committed: 0, tone: "rose" },
];

function formatDate(value, options = {}) {
  if (!value) return "Date to be confirmed";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return "Date to be confirmed";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", ...options });
}

function categoryName(value) {
  const labels = {
    venues: "Venues",
    photography: "Photography",
    decor: "Decor & florals",
    catering: "Catering",
    beauty: "Beauty",
    music: "Music & entertainment",
  };
  return labels[value] || value?.replaceAll("_", " ") || "Service";
}

function preferredVendorStatusLabel(status) {
  if (status === "responded") return "Offer received";
  if (status === "unavailable") return "Partner unavailable";
  if (status === "invited") return "Invitation sent";
  return "Preferred partner";
}

function hasStructuredTerms(bid) {
  if (bid?.structuredTermsProvided === false) return false;
  return typeof bid?.cancellationTerms === "string" && bid.cancellationTerms.trim().length > 0
    && typeof bid?.deliveryPlan === "string" && bid.deliveryPlan.trim().length > 0
    && typeof bid?.gstIncluded === "boolean"
    && Number.isInteger(Number(bid?.gstRate))
    && ["included", "fixed_fee", "not_applicable"].includes(bid?.travelPolicy);
}

function gstSummary(bid) {
  if (!hasStructuredTerms(bid)) return "Not provided";
  const rate = Number(bid.gstRate);
  if (rate === 0) return "Not applicable (0%)";
  return `${rate}% GST ${bid.gstIncluded ? "included" : "additional"}`;
}

function travelSummary(bid) {
  if (!hasStructuredTerms(bid)) return "Not provided";
  if (bid.travelPolicy === "included") return "Included in quoted amount";
  if (bid.travelPolicy === "not_applicable") return "Not applicable";
  return Number.isInteger(Number(bid.travelFee)) && Number(bid.travelFee) > 0
    ? `${formatCurrency(bid.travelFee)} fixed fee`
    : "Fixed fee not provided";
}

function OfferTermList({ items, emptyLabel = "Not provided", tone = "included", formatItem = (item) => item }) {
  if (!Array.isArray(items)) return <p className="offer-term-empty">{emptyLabel}</p>;
  if (!items.length) return <p className="offer-term-empty">{tone === "excluded" ? "No exclusions declared" : emptyLabel}</p>;
  return <ul className={`offer-term-list offer-term-list--${tone}`}>{items.map((item, index) => <li key={`${typeof item === "string" ? item : item?.name || "item"}-${index}`}>{tone === "excluded" ? <CircleAlert size={13} /> : <Check size={13} />}<span>{formatItem(item)}</span></li>)}</ul>;
}

function PreferredVendorSummary({ vendor }) {
  if (!vendor) return null;
  const businessName = vendor.businessName || "Preferred partner";
  const initials = businessName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const status = preferredVendorStatusLabel(vendor.inviteStatus);
  return (
    <div className="dashboard-preferred-vendor">
      <span className="dashboard-preferred-vendor__monogram">{initials}</span>
      <div><small>Preferred partner</small><strong>{businessName}</strong><span>{[categoryName(vendor.category), vendor.city].filter(Boolean).join(" · ")}</span></div>
      {vendor.verified && <span className="dashboard-preferred-vendor__verified"><ShieldCheck size={14} /> Melaiva verified</span>}
      <span className={`status-pill ${vendor.inviteStatus === "responded" ? "status-pill--teal" : vendor.inviteStatus === "unavailable" ? "status-pill--neutral" : "status-pill--direct"}`}><span /> {status}</span>
    </div>
  );
}

function DashboardNav({ active, setActive, offersCount = 0, tasksCount = 0 }) {
  const items = [
    ["overview", LayoutDashboard, "Overview"],
    ["offers", FileText, "Offers", offersCount],
    ["tasks", ClipboardCheck, "Tasks", tasksCount],
    ["messages", MessageSquareText, "Messages"],
  ];
  return (
    <nav className="dashboard-nav" aria-label="Celebration dashboard">
      {items.map(([id, Icon, label, badge]) => (
        <button key={id} className={active === id ? "is-active" : ""} onClick={() => setActive(id)} aria-pressed={active === id}>
          <Icon size={17} /><span>{label}</span>{Number(badge) > 0 && <small>{badge}</small>}
        </button>
      ))}
    </nav>
  );
}

function BudgetCard() {
  const total = 2500000;
  const committed = budgetRows.reduce((sum, row) => sum + row.committed, 0);
  return (
    <section className="dashboard-card dashboard-budget">
      <div className="dashboard-card__heading"><div><span className="card-icon"><BadgeIndianRupee size={18} /></span><div><h2>Budget pulse</h2><p>Example planning figures</p></div></div><button className="text-button" type="button">View details <ArrowRight size={14} /></button></div>
      <div className="budget-summary"><div><small>Working budget</small><strong>{formatCurrency(total)}</strong></div><div><small>Committed</small><strong>{formatCurrency(committed)}</strong></div><div><small>Still flexible</small><strong>{formatCurrency(total - committed)}</strong></div></div>
      <div className="budget-master-bar"><span style={{ width: `${(committed / total) * 100}%` }} /><i style={{ left: `${(committed / total) * 100}%` }} /></div>
      <div className="budget-rows">{budgetRows.map((row) => <div className="budget-row" key={row.name}><div><span className={`budget-dot tone-bg--${row.tone}`} /><strong>{row.name}</strong></div><div className="budget-row__bar"><span className={`tone-bg--${row.tone}`} style={{ width: `${(row.committed / row.allocated) * 100}%` }} /></div><p><strong>{formatCurrency(row.committed)}</strong><span>of {formatCurrency(row.allocated)}</span></p></div>)}</div>
    </section>
  );
}

function TasksCard({ tasks, toggleTask, full = false }) {
  const visible = full ? tasks : tasks.slice(0, 4);
  return (
    <section className={`dashboard-card task-card ${full ? "dashboard-card--full" : ""}`}>
      <div className="dashboard-card__heading"><div><span className="card-icon card-icon--teal"><ClipboardCheck size={18} /></span><div><h2>Next decisions</h2><p>{tasks.filter((task) => !task.done).length} open tasks</p></div></div><button className="icon-button icon-button--small" type="button" aria-label="Task actions"><MoreHorizontal size={18} /></button></div>
      <div className="dashboard-task-list">{visible.map((task) => <label className={task.done ? "is-done" : ""} key={task.id}><input type="checkbox" checked={task.done} onChange={() => toggleTask(task.id)} /><span className="task-checkbox"><Check size={14} /></span><div><strong>{task.title}</strong><small>{task.meta}</small></div><em>{task.priority}</em></label>)}</div>
      <button className="add-task-button" type="button"><Plus size={15} /> Add a task</button>
    </section>
  );
}

function OffersCard({ full = false, notify }) {
  const [expanded, setExpanded] = useState(full ? 0 : -1);
  return (
    <section className={`dashboard-card offers-card ${full ? "dashboard-card--full" : ""}`}>
      <div className="dashboard-card__heading"><div><span className="card-icon card-icon--marigold"><FileText size={18} /></span><div><h2>{full ? "Sealed venue offers" : "Fresh offers"}</h2><p>Example comparison · closes Friday</p></div></div>{!full && <button className="text-button" type="button">Compare all <ArrowRight size={14} /></button>}</div>
      <div className="dashboard-offers">{sampleOffers.map((offer, index) => <article className={`dashboard-offer ${expanded === index ? "is-expanded" : ""}`} key={offer.vendor}>
        <button className="dashboard-offer__main" type="button" onClick={() => setExpanded(expanded === index ? -1 : index)} aria-expanded={expanded === index}>
          <span className="offer-logo">{offer.vendor.split(" ").map((word) => word[0]).join("").slice(0, 2)}</span>
          <span><strong>{offer.vendor}</strong><small><Star size={12} fill="currentColor" /> {index === 0 ? "4.9 · 86 reviews" : index === 1 ? "4.8 · 64 reviews" : "4.7 · 52 reviews"}</small></span>
          <span><small>Total offer</small><strong>{offer.total}</strong></span>
          <span className="offer-fit"><strong>{offer.fit}%</strong><small>brief fit</small></span>
          <ChevronDown size={17} />
        </button>
        {expanded === index && <div className="dashboard-offer__detail"><div><small>Standout</small><strong>{offer.highlight}</strong></div><div><small>Included</small><strong>{offer.inclusions} key items</strong></div><div><small>Position</small><strong>{offer.delta}</strong></div><button className="button button--small button--primary" type="button" onClick={() => notify({ title: "Example offer opened", message: "A live account shows the full proposal and terms here." })}>Review example</button></div>}
      </article>)}</div>
    </section>
  );
}

function Overview({ tasks, toggleTask, notify }) {
  return <div className="dashboard-grid"><BudgetCard /><div className="dashboard-side-stack"><TasksCard tasks={tasks} toggleTask={toggleTask} /><OffersCard notify={notify} /></div><section className="dashboard-card dashboard-guidance"><div className="guidance-icon"><Sparkles size={22} /></div><div><div className="eyebrow">Example planner note</div><h2>Close the venue choice before expanding decor.</h2><p>This preview shows how connected planning guidance will appear after you create a live request.</p></div><button className="button button--outline" type="button" onClick={() => notify({ title: "Example guidance", message: "Live reasoning will be grounded in your own brief and offers." })}>See context <ArrowRight size={16} /></button></section></div>;
}

function MessagesEmpty() {
  return <div className="dashboard-card dashboard-empty"><span><MessageSquareText size={27} /></span><h2>Your conversations will live here</h2><p>Once you choose to connect with a partner, messages and shared files stay organised by service.</p><Link className="button button--primary" to="/marketplace">Find a partner</Link></div>;
}

function AccountState({ icon: Icon, eyebrow, title, message, children }) {
  return (
    <div className="shell dashboard-account-state">
      <div className="dashboard-card dashboard-empty">
        <span><Icon size={28} /></span><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{message}</p><div className="dashboard-account-state__actions">{children}</div>
      </div>
    </div>
  );
}

function RequestSelector({ auctions, selectedId, onSelect }) {
  return (
    <section className="live-request-list" aria-label="Your celebration requests">
      <div className="live-section-heading"><div><div className="eyebrow">Your requests</div><h2>Briefs in motion</h2></div><Link className="button button--small button--outline" to="/request"><Plus size={15} /> New request</Link></div>
      <div className="live-request-list__items">
        {auctions.map((auction) => (
          <button type="button" key={auction.id} className={`live-request-card ${selectedId === auction.id ? "is-selected" : ""}`} onClick={() => onSelect(auction.id)} aria-pressed={selectedId === auction.id}>
            <span className={`status-pill status-pill--${auction.status === "open" ? "teal" : "neutral"}`}><span /> {auction.status}</span>
            <strong>{auction.title}</strong>
            {auction.preferredVendor && <small className="live-request-card__preferred"><Sparkles size={13} /> Preferred · {auction.preferredVendor.businessName}</small>}
            <small><MapPin size={13} /> {auction.city} · {formatDate(auction.eventDate)}</small>
            <span>{auction.bidCount} offer{auction.bidCount === 1 ? "" : "s"} received <ArrowRight size={14} /></span>
          </button>
        ))}
      </div>
    </section>
  );
}

function LiveRequestSummary({ auction }) {
  if (!auction) return null;
  return (
    <section className="dashboard-card live-request-summary">
      <div className="dashboard-card__heading"><div><span className="card-icon"><CalendarDays size={18} /></span><div><h2>{auction.title}</h2><p>Reference {auction.id.slice(0, 8).toUpperCase()}</p></div></div><span className={`status-pill status-pill--${auction.status === "open" ? "teal" : "neutral"}`}><span /> {auction.status}</span></div>
      <div className="live-request-summary__facts">
        <div><small>Celebration</small><strong>{formatDate(auction.eventDate)}</strong></div>
        <div><small>Destination</small><strong>{auction.city}</strong></div>
        <div><small>Guest estimate</small><strong>{auction.guestCount.toLocaleString("en-IN")}</strong></div>
        <div><small>Working range</small><strong>{formatCurrency(auction.budgetMin)} – {formatCurrency(auction.budgetMax)}</strong></div>
      </div>
      <PreferredVendorSummary vendor={auction.preferredVendor} />
      <div className="live-request-summary__services"><small>Services requested</small><div>{auction.categories.map((category) => <span key={category}>{categoryName(category)}</span>)}</div></div>
      <div className="live-request-summary__brief"><small>Your brief</small><p>{auction.requirements}</p></div>
      <p className="live-request-summary__close"><Clock3 size={15} /> Offer window {auction.status === "open" ? `closes ${formatDate(auction.biddingEndsAt, { hour: "numeric", minute: "2-digit" })}` : `is ${auction.status}`}.</p>
    </section>
  );
}

function SealedOffersState({ auction, closing, onRequestClose }) {
  const offerCount = Number(auction.bidCount || 0);
  const hasOffers = offerCount > 0;
  return (
    <section className="dashboard-card sealed-offers-state" aria-labelledby="sealed-offers-title">
      <span className="sealed-offers-state__icon"><LockKeyhole size={28} /></span>
      <div className="eyebrow">Private until you are ready</div>
      <h2 id="sealed-offers-title">{hasOffers ? `${offerCount} sealed offer${offerCount === 1 ? " is" : "s are"} waiting` : "Your offer window is open"}</h2>
      <p>
        {hasOffers
          ? "Partner names, pricing and proposals stay hidden from everyone else until you close the window and compare them together."
          : "Approved partners can still respond. Their names, pricing and proposals remain private until this window closes."}
      </p>
      <dl className="sealed-offers-state__facts">
        <div><dt>Offers received</dt><dd>{offerCount}</dd></div>
        <div><dt>Scheduled close</dt><dd>{formatDate(auction.biddingEndsAt, { hour: "numeric", minute: "2-digit" })}</dd></div>
      </dl>
      <button className={`button ${hasOffers ? "button--primary" : "button--outline"}`} type="button" aria-haspopup="dialog" disabled={closing} onClick={() => onRequestClose(auction.id)}>
        {closing ? <span className="button-loader" aria-hidden="true" /> : <FileText size={17} />}
        {closing ? "Closing securely…" : hasOffers ? `Close window and compare ${offerCount}` : "Close offer window early"}
      </button>
      <small><ShieldCheck size={14} /> Closing stops new proposals and cannot be undone.</small>
    </section>
  );
}

function CloseOfferWindowDialog({ auction, open, closing, onClose, onConfirm }) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const closingRef = useRef(closing);
  const titleId = useId();
  const offerCount = Number(auction?.bidCount || 0);

  useEffect(() => {
    onCloseRef.current = onClose;
    closingRef.current = closing;
    if (closing) dialogRef.current?.focus();
  }, [closing, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    document.body.classList.add("modal-open");
    const timer = window.setTimeout(() => dialogRef.current?.querySelector('[data-dialog-initial-focus="true"]')?.focus(), 30);
    function onKeyDown(event) {
      if (event.key === "Escape" && !closingRef.current) onCloseRef.current();
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (document.activeElement === dialogRef.current) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
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
      if (previous?.isConnected) previous.focus?.();
      else (document.querySelector('[data-offers-focus-target="true"]') || document.getElementById("main-content"))?.focus?.();
    };
  }, [open]);

  if (!open || !auction) return null;
  const hasOffers = offerCount > 0;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !closing && onClose()}>
      <section className="modal-card close-offer-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} tabIndex="-1">
        <button className="icon-button modal-card__close" type="button" onClick={onClose} disabled={closing} aria-label="Keep offer window open" data-dialog-initial-focus="true"><X size={20} /></button>
        <span className={`close-offer-dialog__icon ${hasOffers ? "" : "close-offer-dialog__icon--warning"}`}><LockKeyhole size={26} /></span>
        <div className="eyebrow">Final window decision</div>
        <h2 id={titleId}>{hasOffers ? `Reveal ${offerCount} sealed offer${offerCount === 1 ? "" : "s"}?` : "Close without any offers?"}</h2>
        <p>
          {hasOffers
            ? "Closing now stops new proposals and reveals every partner, price and scope together for a private comparison."
            : "No offers have arrived yet. Closing now stops every new proposal and leaves this request without options to compare."}
        </p>
        <dl>
          <div><dt>Request</dt><dd>{auction.title}</dd></div>
          <div><dt>Scheduled close</dt><dd>{formatDate(auction.biddingEndsAt, { hour: "numeric", minute: "2-digit" })}</dd></div>
        </dl>
        <div className="close-offer-dialog__warning"><CircleAlert size={17} /><span>This window cannot be reopened after you close it.</span></div>
        <div className="close-offer-dialog__actions">
          <button className="button button--outline" type="button" onClick={onClose} disabled={closing}>Keep window open</button>
          <button className="button button--primary" type="button" onClick={onConfirm} disabled={closing}>{closing ? <span className="button-loader" aria-hidden="true" /> : <FileText size={17} />}{closing ? "Closing securely…" : hasOffers ? "Close and compare" : "Close without offers"}</button>
        </div>
      </section>
    </div>
  );
}

function AwardOfferDialog({ auction, bid, open, busy, onClose, onConfirm }) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  const titleId = useId();
  const descriptionId = useId();
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
    if (busy) dialogRef.current?.focus();
  }, [busy, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    setAcknowledged(false);
    const previous = document.activeElement;
    document.body.classList.add("modal-open");
    const timer = window.setTimeout(() => {
      dialogRef.current?.focus({ preventScroll: true });
      if (dialogRef.current) dialogRef.current.scrollTop = 0;
    }, 30);
    function onKeyDown(event) {
      if (event.key === "Escape" && !busyRef.current) onCloseRef.current();
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (document.activeElement === dialogRef.current) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
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
      if (previous?.isConnected) previous.focus?.();
      else (document.querySelector('[data-offers-focus-target="true"]') || document.getElementById("main-content"))?.focus?.();
    };
  }, [bid?.id, open]);

  if (!open || !auction || !bid) return null;
  const businessName = bid.vendor?.businessName || "Approved partner";
  const structured = hasStructuredTerms(bid);
  const exclusions = structured && Array.isArray(bid.exclusions) ? bid.exclusions : null;
  const addOns = structured && Array.isArray(bid.addOns) ? bid.addOns : null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section className="modal-card award-offer-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} ref={dialogRef} tabIndex="-1">
        <button className="icon-button modal-card__close" type="button" onClick={onClose} disabled={busy} aria-label="Keep comparing offers"><X size={20} /></button>
        <span className="award-offer-dialog__icon"><ShieldCheck size={26} /></span>
        <div className="eyebrow">Final award decision</div>
        <h2 id={titleId}>Award this request to {businessName}?</h2>
        <p id={descriptionId}>Review the quoted amount and commercial terms once more. Awarding closes every other open offer and cannot be undone.</p>
        {!structured && <div className="offer-legacy-note offer-legacy-note--dialog"><CircleAlert size={17} /><span>This legacy offer does not contain every normalized commercial term. Missing details are shown as “Not provided.”</span></div>}
        <dl className="award-offer-dialog__summary">
          <div><dt>Quoted amount</dt><dd>{formatCurrency(bid.amount)}</dd></div>
          <div><dt>GST</dt><dd>{gstSummary(bid)}</dd></div>
          <div><dt>Travel</dt><dd>{travelSummary(bid)}</dd></div>
          <div><dt>Valid until</dt><dd>{bid.validUntil ? formatDate(bid.validUntil) : "Not provided"}</dd></div>
        </dl>
        <div className="award-offer-dialog__exclusions"><strong>Exclusions to review</strong><OfferTermList items={exclusions} tone="excluded" emptyLabel="Not provided" /></div>
        <div className="award-offer-dialog__details">
          <section><strong>Priced add-ons</strong><OfferTermList items={addOns} emptyLabel={structured ? "No priced add-ons" : "Not provided"} formatItem={(item) => `${item?.name || "Unnamed add-on"} · ${Number.isFinite(Number(item?.amount)) ? formatCurrency(item.amount) : "Price not provided"}`} /></section>
          <section><strong>Delivery plan</strong><p>{structured ? bid.deliveryPlan : "Not provided"}</p></section>
          <section><strong>Cancellation terms</strong><p>{structured ? bid.cancellationTerms : "Not provided"}</p></section>
        </div>
        <div className="award-offer-dialog__warning"><CircleAlert size={17} /><span>This action awards the request, rejects the remaining open offers and cannot be reversed.</span></div>
        <label className="award-offer-dialog__acknowledgement"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={busy} /><span><Check size={14} /></span><strong>I have reviewed the quoted amount, additions, exclusions and validity.</strong></label>
        <div className="award-offer-dialog__actions">
          <button className="button button--outline" type="button" onClick={onClose} disabled={busy}>Keep comparing</button>
          <button className="button button--primary" type="button" onClick={onConfirm} disabled={busy || !acknowledged}>{busy ? <span className="button-loader" aria-hidden="true" /> : <ShieldCheck size={17} />}{busy ? "Awarding securely…" : "Confirm award"}</button>
        </div>
      </section>
    </div>
  );
}

function AwardHandoff({ award }) {
  if (!award) return null;
  const snapshot = award.snapshot || {};
  const request = snapshot.request || {};
  const offer = snapshot.offer || {};
  const vendor = snapshot.vendor || {};
  const structured = hasStructuredTerms(offer);
  const businessName = vendor.businessName || "Selected partner";
  const exclusions = structured && Array.isArray(offer.exclusions) ? offer.exclusions : null;
  const addOns = structured && Array.isArray(offer.addOns) ? offer.addOns : null;
  return (
    <section className="dashboard-card award-handoff" aria-labelledby={`award-handoff-${award.id}`}>
      <span className="sr-only" role="status" aria-live="polite">Award record loaded. The accepted scope for {businessName} is available below.</span>
      <div className="award-handoff__hero">
        <span className="award-handoff__icon"><Handshake size={28} /></span>
        <div>
          <div className="eyebrow">Offer awarded</div>
          <h2 id={`award-handoff-${award.id}`}>Your accepted scope is saved.</h2>
          <p>Melaiva froze the offer you awarded to <strong>{businessName}</strong>. You and the partner must arrange and review a written contract outside Melaiva before any signature or payment.</p>
        </div>
        <span className="status-pill status-pill--direct"><span /> Contract pending</span>
      </div>
      <ol className="award-handoff__steps" aria-label="Award handoff progress">
        <li className="is-complete"><span><Check size={15} /></span><div><small>Complete</small><strong>Award recorded</strong><p>Scope saved {award.awardedAt ? formatDate(award.awardedAt, { hour: "numeric", minute: "2-digit" }) : "securely"}.</p></div></li>
        <li className="is-current" aria-current="step"><span>2</span><div><small>Next</small><strong>Arrange and review a contract outside Melaiva</strong><p>Agree it directly with the partner and confirm it matches the frozen scope, exclusions and commercial terms below.</p></div></li>
        <li><span>3</span><div><small>Not yet enabled</small><strong>Booking confirmation</strong><p>Melaiva does not yet collect signatures or payments in this workspace.</p></div></li>
      </ol>
      {!structured && <div className="offer-legacy-note award-handoff__legacy"><CircleAlert size={16} /><span>This legacy offer did not capture every normalized commercial term. Missing details remain explicitly marked “Not provided.”</span></div>}
      <dl className="award-handoff__summary">
        <div><dt>Accepted amount</dt><dd>{formatCurrency(offer.amount)}</dd></div>
        <div><dt>GST</dt><dd>{gstSummary(offer)}</dd></div>
        <div><dt>Travel</dt><dd>{travelSummary(offer)}</dd></div>
        <div><dt>Valid until</dt><dd>{offer.validUntil ? formatDate(offer.validUntil) : "Not provided"}</dd></div>
      </dl>
      <div className="award-handoff__scope">
        <section className="offer-term-card"><h3>Accepted inclusions</h3><OfferTermList items={Array.isArray(offer.deliverables) ? offer.deliverables : null} /></section>
        <section className="offer-term-card"><h3>Accepted exclusions</h3><OfferTermList items={exclusions} tone="excluded" /></section>
      </div>
      <div className="award-handoff__terms">
        <section className="offer-term-card"><h3>Priced add-ons</h3><OfferTermList items={addOns} emptyLabel={structured ? "No priced add-ons" : "Not provided"} formatItem={(item) => `${item?.name || "Unnamed add-on"} · ${Number.isFinite(Number(item?.amount)) ? formatCurrency(item.amount) : "Price not provided"}`} /></section>
        <section className="offer-term-card"><h3>Delivery plan</h3><p>{structured ? offer.deliveryPlan : "Not provided"}</p></section>
        <section className="offer-term-card"><h3>Cancellation terms</h3><p>{structured ? offer.cancellationTerms : "Not provided"}</p></section>
      </div>
      <div className="award-handoff__record"><ScrollText size={16} /><p><strong>Immutable decision record</strong><span>Reference {String(award.id).slice(0, 8).toUpperCase()} · {request.title || "Celebration request"}</span></p><small>This record is not a signed contract, invoice or proof of payment.</small></div>
    </section>
  );
}

function LiveOffers({ auction, bids, loading, error, decidingId, closing, award, awardLoading, awardError, onRetryAward, onDecision, onRequestClose, onRequestAward }) {
  if (!auction) return null;
  return (
    <div className="live-offers-focus" role="region" aria-label={`Offers for ${auction.title}`} aria-busy={loading || awardLoading} data-offers-focus-target="true" tabIndex="-1">
      {auction.status === "awarded" && (awardLoading ? (
        <div className="dashboard-card dashboard-empty dashboard-empty--compact award-handoff-state" role="status" aria-live="polite"><span><LoaderCircle className="spin-icon" size={27} /></span><h2>Loading your award record</h2><p>Retrieving the frozen scope and contract-pending handoff.</p></div>
      ) : awardError ? (
        <div className="dashboard-card dashboard-empty dashboard-empty--compact award-handoff-state" role="alert"><span><CircleAlert size={27} /></span><h2>Award record could not be loaded</h2><p>{awardError}</p><button className="button button--outline" type="button" onClick={onRetryAward}><RefreshCw size={15} /> Retry</button></div>
      ) : <AwardHandoff award={award} />)}
      {auction.status === "open" ? (
        <SealedOffersState auction={auction} closing={closing} onRequestClose={onRequestClose} />
      ) : loading ? (
        <div className="dashboard-card dashboard-empty dashboard-empty--compact"><span><LoaderCircle className="spin-icon" size={27} /></span><h2>Loading offers</h2><p>Retrieving the proposals connected to this brief.</p></div>
      ) : error ? (
        <div className="dashboard-card dashboard-empty dashboard-empty--compact"><span><CircleAlert size={27} /></span><h2>Offers could not be loaded</h2><p>{error}</p></div>
      ) : !bids.length ? (
        <div className="dashboard-card dashboard-empty dashboard-empty--compact"><span><FileText size={27} /></span><h2>No offers were received</h2><p>This request closed without a proposal. Create a revised brief or contact Melaiva support before making a vendor decision.</p><Link className="button button--primary" to="/request">Create a new brief</Link></div>
      ) : (
        <section className={`dashboard-card live-offers-card ${auction.status === "awarded" ? "live-offers-card--awarded" : ""}`}>
          <div className="dashboard-card__heading"><div><span className="card-icon card-icon--marigold"><FileText size={18} /></span><div><h2>{auction.status === "awarded" ? "Decision record" : "Offers"} for {auction.title}</h2><p>{bids.length} proposal{bids.length === 1 ? "" : "s"} received</p></div></div><span className="trust-note">{auction.status === "awarded" ? <><ShieldCheck size={14} /> Award complete</> : <><LockKeyhole size={14} /> Private comparison</>}</span></div>
          <div className="live-offer-list">
            {bids.map((bid) => {
              const businessName = bid.vendor?.businessName || "Approved partner";
              const busy = decidingId === `${auction.id}:${bid.id}`;
              const structured = hasStructuredTerms(bid);
              const exclusions = structured && Array.isArray(bid.exclusions) ? bid.exclusions : null;
              const addOns = structured && Array.isArray(bid.addOns) ? bid.addOns : null;
              return (
                <article className="live-offer" key={bid.id}>
                  <div className="live-offer__top"><span className="offer-logo">{businessName.split(" ").map((word) => word[0]).join("").slice(0, 2)}</span><div><strong>{businessName}</strong><small>{bid.vendor?.verified ? "Melaiva verified" : "Partner proposal"}</small></div><div><small>Quoted amount</small><strong>{formatCurrency(bid.amount)}</strong></div><span className={`status-pill status-pill--${bid.status === "accepted" ? "teal" : "neutral"}`}><span /> {bid.status}</span></div>
                  <p className="live-offer__proposal">{bid.proposal}</p>
                  {!structured && <div className="offer-legacy-note"><CircleAlert size={16} /><span>Legacy offer · normalized commercial terms were not collected. Missing details are marked “Not provided.”</span></div>}
                  <div className="live-offer__scope-grid">
                    <section className="offer-term-card"><h3>Inclusions</h3><OfferTermList items={Array.isArray(bid.deliverables) ? bid.deliverables : null} /></section>
                    <section className="offer-term-card"><h3>Exclusions</h3><OfferTermList items={exclusions} tone="excluded" /></section>
                  </div>
                  <dl className="live-offer__commercial-grid">
                    <div><dt>GST</dt><dd>{gstSummary(bid)}</dd></div>
                    <div><dt>Travel</dt><dd>{travelSummary(bid)}</dd></div>
                    <div><dt>Validity</dt><dd>{bid.validUntil ? formatDate(bid.validUntil) : "Not provided"}</dd></div>
                  </dl>
                  <div className="live-offer__terms-grid">
                    <section className="offer-term-card"><h3>Priced add-ons</h3><OfferTermList items={addOns} emptyLabel={structured ? "No priced add-ons" : "Not provided"} formatItem={(item) => `${item?.name || "Unnamed add-on"} · ${Number.isFinite(Number(item?.amount)) ? formatCurrency(item.amount) : "Price not provided"}`} /></section>
                    <section className="offer-term-card"><h3>Delivery plan</h3><p>{structured ? bid.deliveryPlan : "Not provided"}</p></section>
                    <section className="offer-term-card"><h3>Cancellation terms</h3><p>{structured ? bid.cancellationTerms : "Not provided"}</p></section>
                  </div>
                  {auction.status === "closed" && ["submitted", "shortlisted"].includes(bid.status) && (
                    <div className="live-offer__actions">
                      <button className="button button--small button--outline" type="button" disabled={busy} onClick={() => onDecision(bid.id, bid.status === "shortlisted" ? "reject" : "shortlist")}>{bid.status === "shortlisted" ? "Decline" : "Shortlist"}</button>
                      <button className="button button--small button--primary" type="button" disabled={busy} onClick={() => onRequestAward(bid)}><ShieldCheck size={15} /> Review and award</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function LiveDashboard({ user, auctions, selectedAuction, onSelect, bids, bidsLoading, bidsError, decidingId, closingOfferWindow, award, awardLoading, awardError, onRetryAward, onDecision, onRequestClose, onRequestAward, active, setActive }) {
  const totalOffers = auctions.reduce((sum, auction) => sum + Number(auction.bidCount || 0), 0);
  return (
    <>
      <section className="dashboard-topbar">
        <div className="shell dashboard-topbar__inner"><div className="dashboard-profile"><span>{user.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><div><small>Planning space</small><strong>{user.name}</strong></div></div>{selectedAuction ? <div className="dashboard-event"><div><CalendarDays size={15} /><span><small>Celebration</small><strong>{formatDate(selectedAuction.eventDate)}</strong></span></div><div><MapPin size={15} /><span><small>Destination</small><strong>{selectedAuction.city}</strong></span></div><div><Users size={15} /><span><small>Guests</small><strong>{selectedAuction.guestCount.toLocaleString("en-IN")}</strong></span></div></div> : <div />}<button className="icon-button dashboard-bell" type="button" aria-label="Notifications"><Bell size={19} /></button></div>
      </section>
      <div className="shell dashboard-shell">
        <div className="dashboard-welcome"><div><div className="eyebrow">Live planning space</div><h1>Good to see you, {user.name.split(" ")[0]}.</h1><p>{auctions.length ? `${auctions.length} active or past request${auctions.length === 1 ? "" : "s"}, with ${totalOffers} offer${totalOffers === 1 ? "" : "s"} received.` : "Your first brief will bring the planning space to life."}</p></div><Link className="button button--primary" to="/request"><Plus size={17} /> New request</Link></div>
        {auctions.length ? (
          <>
            <DashboardNav active={active} setActive={setActive} offersCount={totalOffers} />
            {active === "overview" && <div className="live-dashboard-grid"><RequestSelector auctions={auctions} selectedId={selectedAuction?.id} onSelect={onSelect} /><LiveRequestSummary auction={selectedAuction} /></div>}
            {active === "offers" && <><RequestSelector auctions={auctions} selectedId={selectedAuction?.id} onSelect={onSelect} /><LiveOffers auction={selectedAuction} bids={bids} loading={bidsLoading} error={bidsError} decidingId={decidingId} closing={closingOfferWindow} award={award} awardLoading={awardLoading} awardError={awardError} onRetryAward={onRetryAward} onDecision={onDecision} onRequestClose={onRequestClose} onRequestAward={onRequestAward} /></>}
            {active === "tasks" && <div className="dashboard-card dashboard-empty"><span><ClipboardCheck size={27} /></span><h2>No task list yet</h2><p>Request and offer decisions are live. Personal task management is the next workspace module.</p></div>}
            {active === "messages" && <MessagesEmpty />}
          </>
        ) : (
          <div className="dashboard-card dashboard-empty"><span><Sparkles size={28} /></span><h2>Start with one thoughtful brief</h2><p>Share the date, city, scope and range once. Your requests and real offers will appear here.</p><Link className="button button--primary" to="/request">Create my first request</Link></div>
        )}
      </div>
    </>
  );
}

export function DashboardPage({ notify, onOpenAuth }) {
  const [active, setActive] = useState("overview");
  const [tasks, setTasks] = useState(dashboardTasks);
  const [mode, setMode] = useState("loading");
  const [user, setUser] = useState(null);
  const [auctions, setAuctions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [bids, setBids] = useState([]);
  const [bidsAuctionId, setBidsAuctionId] = useState(null);
  const [bidsLoading, setBidsLoading] = useState(false);
  const [bidsError, setBidsError] = useState("");
  const [decidingId, setDecidingId] = useState(null);
  const [awardDialog, setAwardDialog] = useState(null);
  const [closeDialogAuctionId, setCloseDialogAuctionId] = useState(null);
  const [closingOfferWindow, setClosingOfferWindow] = useState(false);
  const [award, setAward] = useState(null);
  const [awardAuctionId, setAwardAuctionId] = useState(null);
  const [awardLoading, setAwardLoading] = useState(false);
  const [awardError, setAwardError] = useState("");
  const [awardRefreshKey, setAwardRefreshKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const bidAcceptanceKeys = useRef(new Map());
  const selectedIdRef = useRef(selectedId);
  const bidsAuctionIdRef = useRef(bidsAuctionId);
  selectedIdRef.current = selectedId;
  bidsAuctionIdRef.current = bidsAuctionId;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setMode("loading");
      try {
        const meResponse = await fetch("/api/v1/auth/me", { credentials: "include", signal: controller.signal });
        if (meResponse.status === 401) {
          if (!controller.signal.aborted) setMode("guest");
          return;
        }
        const mePayload = await readApiResponse(meResponse, "Your planning space is temporarily unavailable.");
        const nextUser = mePayload.data?.user;
        if (!nextUser) {
          if (!controller.signal.aborted) { setUser(nextUser || null); setMode("wrong-role"); }
          return;
        }
        const auctionResponse = await fetch("/api/v1/auctions?mine=true&limit=50", { credentials: "include", signal: controller.signal });
        const auctionPayload = await readApiResponse(auctionResponse, "Your celebration requests are temporarily unavailable.");
        const nextAuctions = Array.isArray(auctionPayload.data) ? auctionPayload.data : [];
        if (controller.signal.aborted) return;
        setUser(nextUser);
        setAuctions(nextAuctions);
        setBids([]);
        setBidsAuctionId(null);
        setBidsError("");
        setAward(null);
        setAwardAuctionId(null);
        setAwardError("");
        setSelectedId((current) => nextAuctions.some((auction) => auction.id === current) ? current : nextAuctions[0]?.id || null);
        setMode("live");
      } catch (error) {
        if (error?.name === "AbortError" || controller.signal.aborted) return;
        setMode("demo");
      }
    }
    load();
    return () => controller.abort();
  }, [refreshKey]);

  const selectedAuction = auctions.find((auction) => auction.id === selectedId) || null;

  useEffect(() => {
    if (mode !== "live" || !selectedId || selectedAuction?.status === "open" || Number(selectedAuction?.bidCount || 0) === 0) {
      setBids([]);
      setBidsAuctionId(selectedId || null);
      setBidsError("");
      setBidsLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    async function loadBids() {
      setBids([]); setBidsAuctionId(selectedId); setBidsLoading(true); setBidsError("");
      try {
        const response = await fetch(`/api/v1/auctions/${selectedId}/bids`, { credentials: "include", signal: controller.signal });
        const payload = await readApiResponse(response, "Offers could not be loaded.");
        if (!controller.signal.aborted) setBids(Array.isArray(payload.data) ? payload.data : []);
      } catch (error) {
        if (error?.name === "AbortError" || controller.signal.aborted) return;
        setBids([]); setBidsError(error.message || "Offers could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setBidsLoading(false);
      }
    }
    loadBids();
    return () => controller.abort();
  }, [mode, selectedAuction?.bidCount, selectedAuction?.status, selectedId]);

  useEffect(() => {
    if (mode !== "live" || !selectedId || selectedAuction?.status !== "awarded") {
      setAward(null);
      setAwardAuctionId(selectedId || null);
      setAwardError("");
      setAwardLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    async function loadAward() {
      setAward(null); setAwardAuctionId(selectedId); setAwardLoading(true); setAwardError("");
      try {
        const response = await fetch(`/api/v1/auctions/${selectedId}/award`, { credentials: "include", signal: controller.signal });
        const payload = await readApiResponse(response, "The award record could not be loaded.");
        if (!controller.signal.aborted) setAward(payload.data || null);
      } catch (error) {
        if (error?.name === "AbortError" || controller.signal.aborted) return;
        setAward(null); setAwardError(error.message || "The award record could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setAwardLoading(false);
      }
    }
    loadAward();
    return () => controller.abort();
  }, [awardRefreshKey, mode, selectedAuction?.status, selectedId]);

  function acceptanceKeyFor(auctionId, bidId) {
    const scope = `${auctionId}:${bidId}`;
    if (bidAcceptanceKeys.current.has(scope)) return bidAcceptanceKeys.current.get(scope);
    const storageKey = `melaiva:bid-accept:${scope}`;
    let key;
    try { key = globalThis.sessionStorage?.getItem(storageKey) || undefined; } catch { key = undefined; }
    if (!key) {
      key = createIdempotencyKey("bid-accept");
      try { globalThis.sessionStorage?.setItem(storageKey, key); } catch { /* In-memory reuse still protects retries in this task. */ }
    }
    bidAcceptanceKeys.current.set(scope, key);
    return key;
  }

  async function decideOnBid(bidId, action, targetAuctionId = selectedId) {
    if (!targetAuctionId || bidsAuctionId !== targetAuctionId) return;
    const auctionId = targetAuctionId;
    const decisionKey = `${auctionId}:${bidId}`;
    setDecidingId(decisionKey);
    try {
      const headers = { "Content-Type": "application/json" };
      if (action === "accept") headers["Idempotency-Key"] = acceptanceKeyFor(auctionId, bidId);
      const response = await fetch(`/api/v1/auctions/${auctionId}/bids/${bidId}`, {
        method: "PATCH",
        headers,
        credentials: "include",
        body: JSON.stringify({ action }),
      });
      await readApiResponse(response, "The offer decision could not be saved.");
      if (selectedIdRef.current === auctionId && bidsAuctionIdRef.current === auctionId) {
        setBids((current) => current.map((bid) => {
          if (action === "accept") return { ...bid, status: bid.id === bidId ? "accepted" : ["submitted", "shortlisted"].includes(bid.status) ? "rejected" : bid.status };
          if (bid.id !== bidId) return bid;
          return { ...bid, status: action === "shortlist" ? "shortlisted" : "rejected" };
        }));
      }
      if (action === "accept") setAuctions((current) => current.map((auction) => auction.id === auctionId ? { ...auction, status: "awarded" } : auction));
      if (action === "accept") setAwardDialog(null);
      notify({ title: action === "accept" ? "Award recorded" : action === "shortlist" ? "Offer shortlisted" : "Offer removed from shortlist", message: action === "accept" ? "The accepted scope is frozen. Arrange and review the written contract outside Melaiva next." : "Your live planning space is up to date." });
    } catch (error) {
      notify({ type: "error", title: "Decision not saved", message: error.message || "Please refresh and try again." });
    } finally {
      setDecidingId((current) => current === decisionKey ? null : current);
    }
  }

  async function closeOfferWindow() {
    const auction = auctions.find((item) => item.id === closeDialogAuctionId);
    if (!auction || auction.status !== "open" || closingOfferWindow) return;
    setClosingOfferWindow(true);
    try {
      const response = await fetch(`/api/v1/auctions/${auction.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "closed" }),
      });
      const payload = await readApiResponse(response, "The offer window could not be closed.");
      const bidCount = Number(payload.data?.bidCount ?? auction.bidCount ?? 0);
      setBidsLoading(bidCount > 0);
      setBidsAuctionId(auction.id);
      setAuctions((current) => current.map((item) => item.id === auction.id ? { ...item, status: "closed", bidCount } : item));
      setCloseDialogAuctionId(null);
      setBidsError("");
      notify({
        title: bidCount ? "Offers ready to compare" : "Offer window closed",
        message: bidCount ? `${bidCount} sealed offer${bidCount === 1 ? " is" : "s are"} now visible only in your planning space.` : "No new proposals can be submitted to this request.",
      });
    } catch (error) {
      notify({ type: "error", title: "Window still open", message: error.message || "Please refresh and try again." });
    } finally {
      setClosingOfferWindow(false);
    }
  }

  function toggleTask(id) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, done: !task.done, priority: !task.done ? "Done" : "This week" } : task));
    notify({ title: "Example task updated", message: "This change applies only to the preview workspace." });
  }

  if (mode === "loading") return <div className="dashboard-page page-surface"><AccountState icon={LoaderCircle} eyebrow="Loading your workspace" title="Gathering your plans" message="Checking your account, requests and offers." /></div>;
  if (mode === "guest") return <div className="dashboard-page page-surface"><AccountState icon={LockKeyhole} eyebrow="Private planning space" title="Sign in to see your live plan" message="Your requests, offers and decisions are available only from your secure account."><button className="button button--primary" type="button" onClick={onOpenAuth}>Sign in</button><Link className="button button--outline" to="/request">Create a brief first</Link></AccountState></div>;
  if (mode === "wrong-role") return <div className="dashboard-page page-surface"><AccountState icon={ShieldCheck} eyebrow="Account workspace" title="Your planning profile could not be loaded" message="Refresh the page or sign in again before opening private requests and offers."><button className="button button--primary" type="button" onClick={() => setRefreshKey((value) => value + 1)}>Retry</button></AccountState></div>;

  if (mode === "live") {
    const dialogAuction = auctions.find((auction) => auction.id === closeDialogAuctionId) || null;
    const visibleBids = bidsAuctionId === selectedId ? bids : [];
    const visibleBidsLoading = selectedAuction?.status !== "open" && (bidsAuctionId !== selectedId || bidsLoading);
    const awardAuction = awardDialog ? auctions.find((auction) => auction.id === awardDialog.auctionId) || null : null;
    const awardBid = awardDialog && bidsAuctionId === awardDialog.auctionId ? bids.find((bid) => bid.id === awardDialog.bidId) || null : null;
    const awardBusy = Boolean(awardDialog && decidingId === `${awardDialog.auctionId}:${awardDialog.bidId}`);
    const visibleAward = awardAuctionId === selectedId ? award : null;
    const visibleAwardLoading = selectedAuction?.status === "awarded" && (awardAuctionId !== selectedId || awardLoading);
    return <div className="dashboard-page page-surface"><LiveDashboard user={user} auctions={auctions} selectedAuction={selectedAuction} onSelect={setSelectedId} bids={visibleBids} bidsLoading={visibleBidsLoading} bidsError={bidsAuctionId === selectedId ? bidsError : ""} decidingId={decidingId} closingOfferWindow={closingOfferWindow} award={visibleAward} awardLoading={visibleAwardLoading} awardError={awardAuctionId === selectedId ? awardError : ""} onRetryAward={() => setAwardRefreshKey((value) => value + 1)} onDecision={decideOnBid} onRequestClose={setCloseDialogAuctionId} onRequestAward={(bid) => selectedAuction && setAwardDialog({ auctionId: selectedAuction.id, bidId: bid.id })} active={active} setActive={setActive} /><CloseOfferWindowDialog auction={dialogAuction} open={Boolean(dialogAuction)} closing={closingOfferWindow} onClose={() => !closingOfferWindow && setCloseDialogAuctionId(null)} onConfirm={closeOfferWindow} /><AwardOfferDialog auction={awardAuction} bid={awardBid} open={Boolean(awardAuction && awardBid)} busy={awardBusy} onClose={() => !awardBusy && setAwardDialog(null)} onConfirm={() => awardDialog && decideOnBid(awardDialog.bidId, "accept", awardDialog.auctionId)} /></div>;
  }

  return (
    <div className="dashboard-page page-surface">
      <section className="dashboard-topbar">
        <div className="shell dashboard-topbar__inner"><div className="dashboard-profile"><span>AM</span><div><small>Preview planning space</small><strong>Ananya & Mihir</strong></div></div><div className="dashboard-event"><div><CalendarDays size={15} /><span><small>Example celebration</small><strong>18 February 2027</strong></span></div><div><MapPin size={15} /><span><small>Destination</small><strong>Jaipur</strong></span></div><div><Users size={15} /><span><small>Guests</small><strong>~320</strong></span></div></div><button className="icon-button dashboard-bell" type="button" aria-label="Preview notifications"><Bell size={19} /></button></div>
      </section>
      <div className="shell dashboard-shell">
        <div className="demo-catalog-note dashboard-preview-note"><CircleAlert size={16} /><p><strong>Preview workspace</strong> The live account service could not be reached, so every name, amount and offer below is clearly illustrative.</p><button className="text-button" type="button" onClick={() => setRefreshKey((value) => value + 1)}><RefreshCw size={14} /> Retry</button></div>
        <div className="dashboard-welcome"><div><div className="eyebrow">Demo planning space</div><h1>See how a clear plan feels.</h1><p>Explore example tasks, budgets and offers without mistaking them for live account data.</p></div><Link className="button button--primary" to="/request"><Plus size={17} /> New request</Link></div>
        <DashboardNav active={active} setActive={setActive} offersCount={3} tasksCount={3} />
        {active === "overview" && <Overview tasks={tasks} toggleTask={toggleTask} notify={notify} />}
        {active === "offers" && <OffersCard full notify={notify} />}
        {active === "tasks" && <TasksCard full tasks={tasks} toggleTask={toggleTask} />}
        {active === "messages" && <MessagesEmpty />}
        <p className="demo-disclaimer"><ShieldCheck size={14} /> This dashboard uses labelled example data only because the live account service is unavailable.</p>
      </div>
    </div>
  );
}
