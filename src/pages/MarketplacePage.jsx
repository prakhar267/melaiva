import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  ChevronDown,
  CircleAlert,
  Grid2X2,
  Heart,
  List,
  MapPin,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Users,
  X,
} from "lucide-react";
import { categories, cities, vendors as seededVendors } from "../data.js";
import { SaveButton } from "../components/Shell.jsx";
import {
  marketplaceEmptyStateCopy,
  marketplaceRequestHref,
  marketplaceVendorRequestHref,
} from "../components/requestCoverage.js";

function normalizeVendor(vendor) {
  return {
    id: vendor.slug || vendor.id,
    slug: vendor.slug || null,
    name: vendor.businessName || vendor.name,
    category: vendor.category || vendor.categories?.[0] || "venues",
    categoryLabel: categories.find((item) => item.id === (vendor.category || vendor.categories?.[0]))?.name || vendor.categoryLabel || "Wedding partner",
    city: vendor.city,
    price: vendor.minBudget || vendor.price || 0,
    priceLabel: vendor.minBudget ? `from ₹${new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(vendor.minBudget)}` : vendor.priceLabel || "Pricing on brief",
    rating: Number(vendor.rating || 0),
    reviews: Number(vendor.reviewCount || vendor.reviews || 0),
    response: vendor.response || "Usually replies today",
    verified: Boolean(vendor.verified),
    tags: vendor.tags || vendor.serviceAreas?.slice(0, 3) || ["Custom proposal", "Consultation"],
    tone: vendor.tone || ["marigold", "rose", "teal", "aubergine"][String(vendor.id || "x").length % 4],
    initials: vendor.initials || (vendor.businessName || vendor.name || "MP").split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase(),
    availability: vendor.availability || "Accepting new enquiries",
  };
}

function FilterPanel({ draft, setDraft, onApply, onClear, mobile, onClose }) {
  return (
    <div className={`filter-panel ${mobile ? "filter-panel--mobile" : ""}`}>
      <div className="filter-panel__heading">
        <div><SlidersHorizontal size={18} /><h2>Filters</h2></div>
        {mobile && <button className="icon-button" onClick={onClose} aria-label="Close filters"><X size={20} /></button>}
      </div>
      <label className="field">
        <span>Service</span>
        <div className="input-wrap input-wrap--select">
          <select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))}>
            <option value="">All services</option>
            {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
          </select><ChevronDown size={16} />
        </div>
      </label>
      <label className="field">
        <span>City or destination</span>
        <div className="input-wrap input-wrap--select">
          <select value={draft.city} onChange={(event) => setDraft((current) => ({ ...current, city: event.target.value }))}>
            <option value="">Anywhere in India</option>
            {cities.map((city) => <option key={city}>{city}</option>)}
          </select><ChevronDown size={16} />
        </div>
      </label>
      <fieldset className="filter-group">
        <legend>Starting budget</legend>
        {["", "100000", "300000", "700000"].map((value, index) => {
          const labels = ["Any budget", "Under ₹1L", "Under ₹3L", "Under ₹7L"];
          return (
            <label className="radio-row" key={labels[index]}>
              <input type="radio" name={mobile ? "mobile-budget" : "desktop-budget"} value={value} checked={draft.max === value} onChange={(event) => setDraft((current) => ({ ...current, max: event.target.value }))} />
              <span>{labels[index]}</span>
            </label>
          );
        })}
      </fieldset>
      <label className="check-row">
        <input type="checkbox" checked={draft.verified} onChange={(event) => setDraft((current) => ({ ...current, verified: event.target.checked }))} />
        <span className="custom-check"><Check size={13} /></span>
        <span><strong>Marketplace reviewed only</strong><small>Business disclosure and work reviewed</small></span>
      </label>
      <div className="filter-panel__actions">
        <button className="button button--primary button--wide" onClick={onApply}>Show matches</button>
        <button className="text-button" onClick={onClear}>Clear all</button>
      </div>
      <div className="filter-help"><Sparkles size={16} /><p>Not sure what fits? <Link to="/planner">Ask the planning copilot.</Link></p></div>
    </div>
  );
}

function VendorCard({ vendor, saved, onSave, onCompare, compared, view, demo, requestHref }) {
  return (
    <article className={`vendor-card ${view === "list" ? "vendor-card--list" : ""}`}>
      <div className={`vendor-card__visual tone--${vendor.tone}`}>
        <span className="vendor-card__monogram">{vendor.initials}</span>
        <span className="vendor-card__category">{vendor.categoryLabel}</span>
        <SaveButton saved={saved} onClick={onSave} label={vendor.name} />
        {demo ? <span className="verified-badge verified-badge--demo"><Sparkles size={14} /> Example listing</span> : vendor.verified && <span className="verified-badge"><BadgeCheck size={15} /> Marketplace reviewed</span>}
      </div>
      <div className="vendor-card__body">
        <div className="vendor-card__title">
          <div><h3>{vendor.name}</h3><p><MapPin size={14} /> {vendor.city}</p></div>
          <div className="rating"><Star size={15} fill="currentColor" /><strong>{vendor.rating || "New"}</strong><span>({vendor.reviews})</span></div>
        </div>
        <div className="vendor-tags">{vendor.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        <p className="vendor-card__availability"><span /> {vendor.availability}</p>
        <div className="vendor-card__footer">
          <div><small>Typical starting price</small><strong>{vendor.priceLabel}</strong></div>
          <div className="vendor-card__actions">
            <label className="compare-check"><input type="checkbox" checked={compared} onChange={onCompare} /><span>Compare</span></label>
            <Link className="button button--outline button--small" to={requestHref}>{demo ? "Try example brief" : "Create brief"}</Link>
          </div>
        </div>
      </div>
    </article>
  );
}

function VendorSkeleton() {
  return <div className="vendor-card vendor-card--skeleton" aria-hidden="true"><div /><section><span /><span /><span /><span /></section></div>;
}

export function MarketplacePage({ notify }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const current = {
    category: searchParams.get("category") || "",
    city: searchParams.get("city") || "",
    search: searchParams.get("search") || "",
    max: searchParams.get("max") || "",
    verified: searchParams.get("verified") !== "false",
    date: searchParams.get("date") || "",
    guests: searchParams.get("guests") || "",
  };
  const [draft, setDraft] = useState(current);
  const [query, setQuery] = useState(current.search);
  const [vendors, setVendors] = useState([]);
  const [baseInventoryAvailable, setBaseInventoryAvailable] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [demoData, setDemoData] = useState(false);
  const [saved, setSaved] = useState(new Set());
  const [compared, setCompared] = useState(new Set());
  const [view, setView] = useState("grid");
  const [sort, setSort] = useState("recommended");
  const [mobileFilters, setMobileFilters] = useState(false);

  const paramKey = searchParams.toString();
  useEffect(() => {
    const next = {
      category: searchParams.get("category") || "",
      city: searchParams.get("city") || "",
      search: searchParams.get("search") || "",
      max: searchParams.get("max") || "",
      verified: searchParams.get("verified") !== "false",
    };
    setDraft(next);
    setQuery(next.search);
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setBaseInventoryAvailable(null);
      setError("");
      const normalizedSearch = next.search.trim();
      try {
        const baseApiParams = new URLSearchParams();
        if (next.category) baseApiParams.set("category", next.category);
        if (next.city) baseApiParams.set("city", next.city);
        baseApiParams.set("limit", normalizedSearch ? "1" : "48");
        const resultApiParams = new URLSearchParams(baseApiParams);
        resultApiParams.set("limit", "48");
        if (normalizedSearch) resultApiParams.set("search", normalizedSearch);

        async function fetchCatalog(apiParams) {
          const response = await fetch(`/api/v1/catalog/vendors?${apiParams}`, { signal: controller.signal, credentials: "include" });
          if (!response.ok) throw new Error("Catalog unavailable");
          return response.json();
        }

        let basePayload;
        let payload;
        if (normalizedSearch) {
          [basePayload, payload] = await Promise.all([
            fetchCatalog(baseApiParams),
            fetchCatalog(resultApiParams),
          ]);
        } else {
          payload = await fetchCatalog(resultApiParams);
          basePayload = payload;
        }
        const baseData = Array.isArray(basePayload.data) ? basePayload.data : [];
        const resultData = Array.isArray(payload.data) ? payload.data : [];
        setBaseInventoryAvailable(baseData.length > 0);
        setVendors(resultData.map(normalizeVendor));
        setDemoData(payload.meta?.source === "demo");
      } catch (requestError) {
        if (requestError.name === "AbortError" || controller.signal.aborted) return;
        let baseFallback = seededVendors.map(normalizeVendor);
        if (next.category) baseFallback = baseFallback.filter((vendor) => vendor.category === next.category);
        if (next.city) baseFallback = baseFallback.filter((vendor) => vendor.city === next.city);
        let fallback = [...baseFallback];
        if (normalizedSearch) fallback = fallback.filter((vendor) => `${vendor.name} ${vendor.categoryLabel} ${vendor.city}`.toLowerCase().includes(normalizedSearch.toLowerCase()));
        setBaseInventoryAvailable(baseFallback.length > 0);
        setVendors(fallback);
        setDemoData(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [paramKey]);

  const visibleVendors = useMemo(() => {
    let list = [...vendors];
    if (current.verified) list = list.filter((vendor) => vendor.verified);
    if (current.max) list = list.filter((vendor) => vendor.price <= Number(current.max));
    if (sort === "rating") list.sort((a, b) => b.rating - a.rating);
    if (sort === "price") list.sort((a, b) => a.price - b.price);
    return list;
  }, [vendors, current.max, current.verified, sort]);

  function applyFilters() {
    const params = new URLSearchParams();
    Object.entries(draft).forEach(([key, value]) => {
      if (key === "verified") {
        if (!value) params.set(key, "false");
      } else if (value) params.set(key, value);
    });
    if (current.date) params.set("date", current.date);
    if (current.guests) params.set("guests", current.guests);
    if (query.trim()) params.set("search", query.trim());
    setSearchParams(params);
    setMobileFilters(false);
  }

  function clearFilters() {
    const empty = { category: "", city: "", search: "", max: "", verified: true };
    const params = new URLSearchParams();
    if (current.date) params.set("date", current.date);
    if (current.guests) params.set("guests", current.guests);
    setDraft(empty); setQuery(""); setSearchParams(params); setMobileFilters(false);
  }

  function toggleSet(setter, id, title) {
    setter((currentSet) => {
      const next = new Set(currentSet);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    if (title) notify({ title, message: "You can keep comparing partners during this visit." });
  }

  const requestHref = marketplaceRequestHref(current);
  const requestScope = [categories.find((category) => category.id === current.category)?.name, current.city]
    .filter(Boolean)
    .join(" in ");
  const emptyState = marketplaceEmptyStateCopy({
    baseInventoryAvailable,
    preview: demoData,
    scope: requestScope,
  });
  const canCheckScopedCoverage = categories.some((category) => category.id === current.category) && cities.includes(current.city);
  const requestActionLabel = emptyState.kind === "preview" || !canCheckScopedCoverage
    ? "Open request builder"
    : "Check category & city coverage";

  return (
    <div className="marketplace-page page-surface">
      <section className="marketplace-hero">
        <div className="shell">
          <div className="eyebrow">Built for clearer selection</div>
          <h1>Find your celebration team</h1>
          <p>Explore thoughtful professionals, then share one brief to receive clear, comparable offers.</p>
          <form className="marketplace-search" onSubmit={(event) => { event.preventDefault(); applyFilters(); }}>
            <Search size={20} />
            <input value={query} onChange={(event) => { setQuery(event.target.value); setDraft((state) => ({ ...state, search: event.target.value })); }} placeholder="Search a service, vendor or city" aria-label="Search vendors" />
            <button className="button button--primary" type="submit">Search</button>
          </form>
          <div className="category-pills" aria-label="Browse by category">
            <button className={!current.category ? "is-active" : ""} onClick={() => { const params = new URLSearchParams(searchParams); params.delete("category"); setSearchParams(params); }}>All services</button>
            {categories.map((category) => <button key={category.id} className={current.category === category.id ? "is-active" : ""} onClick={() => { const params = new URLSearchParams(searchParams); params.set("category", category.id); setSearchParams(params); }}>{category.name}</button>)}
          </div>
        </div>
      </section>

      <section className="shell marketplace-layout">
        <aside className="marketplace-sidebar">
          <FilterPanel draft={draft} setDraft={setDraft} onApply={applyFilters} onClear={clearFilters} />
        </aside>
        <div className="marketplace-results">
          <div className="results-toolbar">
            <div>
              <button className="button button--outline filter-mobile-button" onClick={() => setMobileFilters(true)}><SlidersHorizontal size={17} /> Filters</button>
              <p><strong>{loading ? "Finding" : visibleVendors.length}</strong> {loading ? "great matches…" : demoData ? "example listings match your search" : "partners match your search"}</p>
            </div>
            <div className="results-toolbar__controls">
              <label className="sort-select">Sort by <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="recommended">Recommended</option><option value="rating">Top rated</option><option value="price">Starting price</option></select><ChevronDown size={14} /></label>
              <div className="view-toggle" aria-label="Results layout">
                <button className={view === "grid" ? "is-active" : ""} onClick={() => setView("grid")} aria-label="Grid view"><Grid2X2 size={17} /></button>
                <button className={view === "list" ? "is-active" : ""} onClick={() => setView("list")} aria-label="List view"><List size={18} /></button>
              </div>
            </div>
          </div>

          {demoData && <div className="demo-catalog-note"><Sparkles size={16} /><p><strong>Preview catalog</strong> These clearly marked example listings demonstrate the experience while live partner records are unavailable.</p></div>}

          {compared.size > 0 && (
            <div className="compare-bar">
              <div><span className="compare-bar__icons"><Heart size={16} /></span><p><strong>{compared.size} partner{compared.size > 1 ? "s" : ""} selected</strong><small>Select up to 3 to compare</small></p></div>
              <button className="button button--small button--primary" disabled={compared.size < 2} onClick={() => notify({ title: "Comparison ready", message: "We’ve lined up inclusions, pricing and reviews side by side." })}>Compare now</button>
            </div>
          )}

          {error && <div className="inline-alert inline-alert--error"><CircleAlert size={18} /><p>{error}</p><button onClick={() => window.location.reload()}>Try again</button></div>}
          {loading ? (
            <div className={`vendor-grid vendor-grid--${view}`} aria-label="Loading vendors">{Array.from({ length: 6 }).map((_, index) => <VendorSkeleton key={index} />)}</div>
          ) : visibleVendors.length ? (
            <div className={`vendor-grid vendor-grid--${view}`}>
              {visibleVendors.map((vendor) => (
                <VendorCard
                  key={vendor.id}
                  vendor={vendor}
                  demo={demoData}
                  requestHref={marketplaceVendorRequestHref(vendor, current, { demo: demoData })}
                  view={view}
                  saved={saved.has(vendor.id)}
                  compared={compared.has(vendor.id)}
                  onSave={() => toggleSet(setSaved, vendor.id, saved.has(vendor.id) ? "Removed from saved" : "Partner saved")}
                  onCompare={() => {
                    if (!compared.has(vendor.id) && compared.size >= 3) return notify({ type: "warning", title: "Choose up to three", message: "Remove one partner before adding another." });
                    toggleSet(setCompared, vendor.id);
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <span><Search size={26} /></span>
              <h2>{emptyState.title}</h2>
              <p>{emptyState.message}</p>
              <div className="empty-state__actions">
                {emptyState.kind === "inventory" ? (
                  <>
                    <Link className="button button--primary" to={requestHref}>{requestActionLabel} <ArrowRight size={16} /></Link>
                    <button className="button button--outline" type="button" onClick={clearFilters}>Clear filters</button>
                  </>
                ) : (
                  <>
                    <button className="button button--primary" type="button" onClick={clearFilters}>Clear filters</button>
                    <Link className="button button--outline" to={requestHref}>{requestActionLabel} <ArrowRight size={16} /></Link>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <div className={`mobile-filter-sheet ${mobileFilters ? "is-open" : ""}`} aria-hidden={!mobileFilters}>
        <button className="mobile-filter-sheet__veil" onClick={() => setMobileFilters(false)} tabIndex={mobileFilters ? 0 : -1} aria-label="Close filters" />
        <div className="mobile-filter-sheet__content">
          <FilterPanel draft={draft} setDraft={setDraft} onApply={applyFilters} onClear={clearFilters} mobile onClose={() => setMobileFilters(false)} />
        </div>
      </div>
    </div>
  );
}
