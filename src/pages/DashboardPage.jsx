import { useEffect, useRef, useState } from "react";
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
  Users,
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

function LiveOffers({ auction, bids, loading, error, decidingId, onDecision }) {
  if (!auction) return null;
  if (loading) return <div className="dashboard-card dashboard-empty dashboard-empty--compact"><span><LoaderCircle className="spin-icon" size={27} /></span><h2>Loading offers</h2><p>Retrieving the proposals connected to this brief.</p></div>;
  if (error) return <div className="dashboard-card dashboard-empty dashboard-empty--compact"><span><CircleAlert size={27} /></span><h2>Offers could not be loaded</h2><p>{error}</p></div>;
  if (!bids.length) return <div className="dashboard-card dashboard-empty dashboard-empty--compact"><span><FileText size={27} /></span><h2>No offers yet</h2><p>Approved partners can respond until {formatDate(auction.biddingEndsAt)}. You will see complete proposals here.</p></div>;

  return (
    <section className="dashboard-card live-offers-card">
      <div className="dashboard-card__heading"><div><span className="card-icon card-icon--marigold"><FileText size={18} /></span><div><h2>Offers for {auction.title}</h2><p>{bids.length} complete proposal{bids.length === 1 ? "" : "s"}</p></div></div><span className="trust-note"><LockKeyhole size={14} /> Private comparison</span></div>
      <div className="live-offer-list">
        {bids.map((bid) => {
          const businessName = bid.vendor?.businessName || "Approved partner";
          const busy = decidingId === bid.id;
          return (
            <article className="live-offer" key={bid.id}>
              <div className="live-offer__top"><span className="offer-logo">{businessName.split(" ").map((word) => word[0]).join("").slice(0, 2)}</span><div><strong>{businessName}</strong><small>{bid.vendor?.verified ? "Melaiva verified" : "Partner proposal"}</small></div><div><small>Total offer</small><strong>{formatCurrency(bid.amount)}</strong></div><span className={`status-pill status-pill--${bid.status === "accepted" ? "teal" : "neutral"}`}><span /> {bid.status}</span></div>
              <p>{bid.proposal}</p>
              <ul>{bid.deliverables.map((item) => <li key={item}><Check size={14} /> {item}</li>)}</ul>
              {bid.validUntil && <small className="live-offer__validity">Valid until {formatDate(bid.validUntil)}</small>}
              {auction.status === "open" && ["submitted", "shortlisted"].includes(bid.status) && (
                <div className="live-offer__actions">
                  <button className="button button--small button--outline" type="button" disabled={busy} onClick={() => onDecision(bid.id, bid.status === "shortlisted" ? "reject" : "shortlist")}>{bid.status === "shortlisted" ? "Decline" : "Shortlist"}</button>
                  <button className="button button--small button--primary" type="button" disabled={busy} onClick={() => onDecision(bid.id, "accept")}>{busy ? "Saving…" : "Accept offer"}</button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function LiveDashboard({ user, auctions, selectedAuction, onSelect, bids, bidsLoading, bidsError, decidingId, onDecision, active, setActive }) {
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
            {active === "offers" && <><RequestSelector auctions={auctions} selectedId={selectedAuction?.id} onSelect={onSelect} /><LiveOffers auction={selectedAuction} bids={bids} loading={bidsLoading} error={bidsError} decidingId={decidingId} onDecision={onDecision} /></>}
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
  const [bidsLoading, setBidsLoading] = useState(false);
  const [bidsError, setBidsError] = useState("");
  const [decidingId, setDecidingId] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const bidAcceptanceKeys = useRef(new Map());

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
        if (!nextUser || !["couple", "admin"].includes(nextUser.role)) {
          if (!controller.signal.aborted) { setUser(nextUser || null); setMode("wrong-role"); }
          return;
        }
        const auctionResponse = await fetch("/api/v1/auctions?mine=true&limit=50", { credentials: "include", signal: controller.signal });
        const auctionPayload = await readApiResponse(auctionResponse, "Your celebration requests are temporarily unavailable.");
        const nextAuctions = Array.isArray(auctionPayload.data) ? auctionPayload.data : [];
        if (controller.signal.aborted) return;
        setUser(nextUser);
        setAuctions(nextAuctions);
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

  useEffect(() => {
    if (mode !== "live" || !selectedId) { setBids([]); return undefined; }
    const controller = new AbortController();
    async function loadBids() {
      setBidsLoading(true); setBidsError("");
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
  }, [mode, selectedId]);

  const selectedAuction = auctions.find((auction) => auction.id === selectedId) || null;

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

  async function decideOnBid(bidId, action) {
    if (action === "accept" && !window.confirm("Accept this offer? This awards the request and closes the other open offers.")) return;
    setDecidingId(bidId);
    try {
      const headers = { "Content-Type": "application/json" };
      if (action === "accept") headers["Idempotency-Key"] = acceptanceKeyFor(selectedId, bidId);
      const response = await fetch(`/api/v1/auctions/${selectedId}/bids/${bidId}`, {
        method: "PATCH",
        headers,
        credentials: "include",
        body: JSON.stringify({ action }),
      });
      await readApiResponse(response, "The offer decision could not be saved.");
      setBids((current) => current.map((bid) => {
        if (action === "accept") return { ...bid, status: bid.id === bidId ? "accepted" : ["submitted", "shortlisted"].includes(bid.status) ? "rejected" : bid.status };
        if (bid.id !== bidId) return bid;
        return { ...bid, status: action === "shortlist" ? "shortlisted" : "rejected" };
      }));
      if (action === "accept") setAuctions((current) => current.map((auction) => auction.id === selectedId ? { ...auction, status: "awarded" } : auction));
      notify({ title: action === "accept" ? "Offer accepted" : action === "shortlist" ? "Offer shortlisted" : "Offer removed from shortlist", message: "Your live planning space is up to date." });
    } catch (error) {
      notify({ type: "error", title: "Decision not saved", message: error.message || "Please refresh and try again." });
    } finally {
      setDecidingId(null);
    }
  }

  function toggleTask(id) {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, done: !task.done, priority: !task.done ? "Done" : "This week" } : task));
    notify({ title: "Example task updated", message: "This change applies only to the preview workspace." });
  }

  if (mode === "loading") return <div className="dashboard-page page-surface"><AccountState icon={LoaderCircle} eyebrow="Loading your workspace" title="Gathering your plans" message="Checking your account, requests and offers." /></div>;
  if (mode === "guest") return <div className="dashboard-page page-surface"><AccountState icon={LockKeyhole} eyebrow="Private planning space" title="Sign in to see your live plan" message="Your requests, offers and decisions are available only from your secure account."><button className="button button--primary" type="button" onClick={onOpenAuth}>Sign in</button><Link className="button button--outline" to="/request">Create a brief first</Link></AccountState></div>;
  if (mode === "wrong-role") return <div className="dashboard-page page-surface"><AccountState icon={ShieldCheck} eyebrow="Account workspace" title="This is the couple planning space" message="Vendor accounts manage matched opportunities and proposals from the partner workspace."><Link className="button button--primary" to="/vendor">Open vendor workspace</Link></AccountState></div>;

  if (mode === "live") {
    return <div className="dashboard-page page-surface"><LiveDashboard user={user} auctions={auctions} selectedAuction={selectedAuction} onSelect={setSelectedId} bids={bids} bidsLoading={bidsLoading} bidsError={bidsError} decidingId={decidingId} onDecision={decideOnBid} active={active} setActive={setActive} /></div>;
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
