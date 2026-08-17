import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck2,
  CalendarDays,
  Check,
  ChevronDown,
  BadgeIndianRupee,
  ClipboardCheck,
  Download,
  Lightbulb,
  MapPin,
  RefreshCw,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { cities, formatCurrency } from "../data.js";
import { readApiResponse } from "../api.js";
import { createPlannerRequestHandoff, PLANNER_HANDOFF_STATE_KEY } from "../components/plannerHandoff.js";

const ceremonies = ["Engagement", "Haldi", "Mehendi", "Sangeet", "Wedding", "Reception"];
const priorities = ["Guest experience", "Food", "Design & decor", "Photography", "Entertainment", "Low-waste choices"];
const styles = ["Contemporary Indian", "Heritage & regal", "Garden romance", "Minimal & modern", "Coastal ease", "Intimate at home"];

function futureDateValue(days) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function createFallbackPlan(form) {
  const budget = Number(form.budget || 2500000);
  const categories = [
    ["Venue & stay", 0.31, "Protect dates and room inventory first"],
    ["Food & beverage", 0.24, "Guest count is the biggest variable"],
    ["Decor & production", 0.15, "Prioritise one defining visual moment"],
    ["Photo & film", 0.1, "Book based on storytelling style"],
    ["Beauty & attire services", 0.07, "Include trials and logistics"],
    ["Music & entertainment", 0.06, "Confirm licensing and sound limits"],
    ["Contingency", 0.07, "Hold until the final six weeks"],
  ];
  return {
    summary: `A ${form.style.toLowerCase()} celebration in ${form.city} for about ${form.guestCount} guests, shaped around ${form.priorities.slice(0, 2).join(" and ").toLowerCase() || "a balanced guest experience"}.`,
    budget: categories.map(([name, share, note]) => ({ category: name, amount: Math.round(budget * share), percentage: Math.round(share * 100), note })),
    milestones: [
      { timing: "This week", title: "Align the non-negotiables", detail: "Confirm city, guest-count range and the two priorities you will protect." },
      { timing: "Next 2 weeks", title: "Brief venues and anchor partners", detail: "Send one complete brief and compare dates, inclusions and cancellation terms." },
      { timing: "Within 6 weeks", title: "Lock the creative team", detail: "Choose photo, decor and entertainment once the venue constraints are clear." },
      { timing: "Final 8 weeks", title: "Move from choices to operations", detail: "Freeze guest logistics, run sheets, payment milestones and one rain plan." },
    ],
    recommendations: [
      "Keep a 7% contingency outside vendor quotes until final guest counts are known.",
      `For ${form.city}, ask every venue to state power backup, sound limits and wet-weather capacity in writing.`,
      "Compare proposals by deliverables and payment terms—not the headline total alone.",
    ],
    risks: [
      "A wide guest-count range can move catering and venue costs materially.",
      "Popular dates may require temporary holds before every creative detail is decided.",
    ],
    source: "preview",
  };
}

function normalizeGeneratedPlan(plan, source) {
  const ownerLabels = { couple: "You", family: "Family", planner: "Planner", vendor: "Vendor" };
  return {
    ...plan,
    budget: (plan.budget || []).map((item) => ({
      ...item,
      note: item.note || `${Math.round(Number(item.percentage || 0))}% starting allocation`,
    })),
    milestones: (plan.milestones || []).map((item) => ({
      ...item,
      timing: item.timing || (item.dueDate ? new Date(`${item.dueDate}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Next step"),
      detail: item.detail || (item.owner ? `Suggested owner: ${ownerLabels[item.owner] || item.owner}` : "Review this step against your celebration constraints."),
    })),
    recommendations: Array.isArray(plan.recommendations) ? plan.recommendations : [],
    risks: Array.isArray(plan.risks) ? plan.risks : [],
    source,
  };
}

function PlannerForm({ onSubmit, loading }) {
  const [form, setForm] = useState({
    eventDate: futureDateValue(180),
    city: "",
    guestCount: "250",
    budget: "2500000",
    style: "Contemporary Indian",
    ceremonies: ["Sangeet", "Wedding", "Reception"],
    priorities: ["Guest experience", "Food"],
    constraints: "",
  });
  const [errors, setErrors] = useState({});
  const [handoffError, setHandoffError] = useState("");

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
    setHandoffError("");
  }

  function toggle(key, value) {
    setForm((current) => {
      const list = current[key];
      return { ...current, [key]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value] };
    });
  }

  function submit(event) {
    event.preventDefault();
    const nextErrors = {};
    if (!form.eventDate) nextErrors.eventDate = "Choose an approximate date.";
    else if (form.eventDate <= futureDateValue(0)) nextErrors.eventDate = "Choose a future celebration date.";
    if (!form.city) nextErrors.city = "Choose a celebration city.";
    if (!/^\d+$/.test(form.guestCount.trim()) || !Number.isInteger(Number(form.guestCount))) nextErrors.guestCount = "Enter guests as a whole number.";
    else if (Number(form.guestCount) < 20) nextErrors.guestCount = "Enter at least 20 guests.";
    else if (Number(form.guestCount) > 5000) nextErrors.guestCount = "Keep the estimate to 5,000 guests or fewer.";
    if (!form.budget || Number(form.budget) < 100000) nextErrors.budget = "Enter a realistic working budget.";
    if (!form.ceremonies.length) nextErrors.ceremonies = "Choose at least one event.";
    if (Object.keys(nextErrors).length) return setErrors(nextErrors);
    const requestHandoff = createPlannerRequestHandoff(form);
    if (!requestHandoff) {
      setHandoffError("Review the planning details before creating the blueprint.");
      return;
    }
    setHandoffError("");
    onSubmit(form, requestHandoff);
  }

  return (
    <form className="planner-form" onSubmit={submit} noValidate>
      <div className="planner-form__heading">
        <span>01</span><div><h2>Tell us the shape of it</h2><p>Approximate answers are absolutely fine.</p></div>
      </div>
      <div className="form-grid">
        <label className={`field ${errors.eventDate ? "field--error" : ""}`}>
          <span>Celebration date</span><div className="input-wrap"><CalendarDays size={17} /><input type="date" value={form.eventDate} onChange={(event) => update("eventDate", event.target.value)} /></div>
          {errors.eventDate && <small className="field-error">{errors.eventDate}</small>}
        </label>
        <label className={`field ${errors.city ? "field--error" : ""}`}>
          <span>City or destination</span><div className="input-wrap input-wrap--select"><MapPin size={17} /><select value={form.city} onChange={(event) => update("city", event.target.value)}><option value="">Choose a city</option>{cities.map((city) => <option key={city}>{city}</option>)}</select><ChevronDown size={15} /></div>
          {errors.city && <small className="field-error">{errors.city}</small>}
        </label>
        <label className={`field ${errors.guestCount ? "field--error" : ""}`}>
          <span>Estimated guests</span><div className="input-wrap"><input type="number" inputMode="numeric" min="20" max="5000" value={form.guestCount} onChange={(event) => update("guestCount", event.target.value)} /></div>
          {errors.guestCount && <small className="field-error">{errors.guestCount}</small>}
        </label>
        <label className={`field ${errors.budget ? "field--error" : ""}`}>
          <span>Working budget</span><div className="input-wrap"><BadgeIndianRupee size={17} /><input type="number" inputMode="numeric" min="100000" step="50000" value={form.budget} onChange={(event) => update("budget", event.target.value)} /></div>
          {errors.budget ? <small className="field-error">{errors.budget}</small> : <small className="field-hint">{formatCurrency(Number(form.budget || 0))}</small>}
        </label>
      </div>
      <label className="field">
        <span>Overall feel</span><div className="input-wrap input-wrap--select"><select value={form.style} onChange={(event) => update("style", event.target.value)}>{styles.map((style) => <option key={style}>{style}</option>)}</select><ChevronDown size={15} /></div>
      </label>
      <fieldset className={`choice-fieldset ${errors.ceremonies ? "field--error" : ""}`}>
        <legend>Which events are you planning?</legend>
        <div className="choice-chips">{ceremonies.map((item) => <label key={item} className={form.ceremonies.includes(item) ? "is-selected" : ""}><input type="checkbox" checked={form.ceremonies.includes(item)} onChange={() => toggle("ceremonies", item)} /><span>{item}</span><Check size={14} /></label>)}</div>
        {errors.ceremonies && <small className="field-error">{errors.ceremonies}</small>}
      </fieldset>
      <fieldset className="choice-fieldset">
        <legend>What should the plan protect most?</legend>
        <div className="choice-chips">{priorities.map((item) => <label key={item} className={form.priorities.includes(item) ? "is-selected" : ""}><input type="checkbox" checked={form.priorities.includes(item)} onChange={() => toggle("priorities", item)} /><span>{item}</span><Check size={14} /></label>)}</div>
      </fieldset>
      <label className="field">
        <span>Anything we should work around? <small>Optional</small></span>
        <textarea value={form.constraints} onChange={(event) => update("constraints", event.target.value)} maxLength={1000} rows="3" placeholder="Accessibility needs, travel constraints, venue already booked…" />
      </label>
      <button className="button button--primary button--wide button--large" type="submit" disabled={loading}>
        {loading ? <span className="button-loader" /> : <WandSparkles size={18} />}
        {loading ? "Building your first plan…" : "Create my planning blueprint"}
      </button>
      {handoffError && <p className="form-error" role="alert">{handoffError}</p>}
      <p className="planner-form__privacy"><Sparkles size={14} /> Used to build this plan. If you continue, planning details prefill a request you can review before publishing.</p>
    </form>
  );
}

function PlanLoading() {
  return <div className="plan-loading" aria-live="polite"><span className="plan-loading__orb"><Sparkles /></span><h2>Turning the details into decisions</h2><p>Balancing timing, budget and the moments you want to protect.</p><div className="plan-loading__bars"><span /><span /><span /></div></div>;
}

function PlanResult({ plan, onReset, onStartRequest, notify }) {
  const maxAmount = Math.max(...plan.budget.map((item) => Number(item.amount || 0)), 1);
  return (
    <div className="plan-result">
      <div className="plan-result__top">
        <div><span className="status-pill status-pill--teal"><span /> Blueprint ready</span><h2>Your first clear plan</h2></div>
        <div className="plan-result__actions"><button className="icon-button" onClick={onReset} aria-label="Start over"><RefreshCw size={17} /></button><button className="button button--small button--outline" onClick={() => { window.print(); notify({ title: "Print view opened", message: "Choose Save as PDF to keep your blueprint." }); }}><Download size={16} /> Save</button></div>
      </div>
      {plan.source === "preview" && <div className="preview-note"><Lightbulb size={17} /><p><strong>Preview plan</strong> Live AI was unavailable, so this blueprint uses transparent planning assumptions. Sign in and regenerate for a tailored AI plan.</p></div>}
      <p className="plan-summary">{plan.summary}</p>
      <section className="plan-section">
        <div className="plan-section__heading"><BadgeIndianRupee size={19} /><div><h3>Working budget shape</h3><p>A starting allocation, not a quote.</p></div></div>
        <div className="budget-allocation">
          {plan.budget.map((item) => (
            <div className="budget-allocation__row" key={item.category || item.name}>
              <div><strong>{item.category || item.name}</strong><span>{item.percentage || Math.round((item.amount / plan.budget.reduce((sum, entry) => sum + Number(entry.amount || 0), 0)) * 100)}%</span></div>
              <div className="budget-allocation__bar"><span style={{ width: `${Math.max(6, (Number(item.amount) / maxAmount) * 100)}%` }} /></div>
              <div><strong>{formatCurrency(Number(item.amount || 0))}</strong><small>{item.note}</small></div>
            </div>
          ))}
        </div>
      </section>
      <section className="plan-section">
        <div className="plan-section__heading"><CalendarCheck2 size={19} /><div><h3>What to do, in order</h3><p>A sequence that keeps choices connected.</p></div></div>
        <ol className="milestone-list">
          {plan.milestones.map((item, index) => <li key={`${item.timing}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><div><small>{item.timing}</small><strong>{item.title}</strong><p>{item.detail}</p></div></li>)}
        </ol>
      </section>
      <section className="plan-advice-grid">
        <div className="plan-advice"><div><Lightbulb size={18} /><h3>Smart moves</h3></div><ul>{plan.recommendations.map((item) => <li key={item}><Check size={15} />{item}</li>)}</ul></div>
        <div className="plan-advice plan-advice--risk"><div><AlertTriangle size={18} /><h3>Watch early</h3></div><ul>{plan.risks.map((item) => <li key={item}><span />{item}</li>)}</ul></div>
      </section>
      <div className="plan-result__cta"><div><ClipboardCheck size={22} /><p><strong>Ready to turn the plan into real offers?</strong><span>We’ll carry your planning details into a reviewable vendor brief.</span></p></div><button className="button button--primary" type="button" onClick={onStartRequest}>Start a request <ArrowRight size={17} /></button></div>
    </div>
  );
}

export function PlannerPage({ notify }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState(null);
  const [requestHandoff, setRequestHandoff] = useState(null);
  const [error, setError] = useState("");

  async function generate(form, requestHandoffForForm) {
    setLoading(true); setError(""); setPlan(null);
    setRequestHandoff(requestHandoffForForm);
    const payload = {
      eventDate: form.eventDate,
      city: form.city,
      guestCount: Number(form.guestCount),
      budget: Number(form.budget),
      currency: "INR",
      style: form.style,
      ceremonies: form.ceremonies,
      priorities: form.priorities,
      constraints: form.constraints || undefined,
    };
    try {
      const response = await fetch("/api/v1/planner/generate", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(payload) });
      const result = await readApiResponse(response, "AI plan unavailable");
      const source = result.meta?.degraded ? "preview" : result.meta?.source || "ai";
      setPlan(normalizeGeneratedPlan(result.data, source));
      notify({ title: "Your blueprint is ready", message: "Review the budget shape and first milestones below." });
    } catch {
      setPlan(createFallbackPlan(form));
      notify({ type: "warning", title: "Preview plan created", message: "Live AI was unavailable, so we used transparent planning assumptions." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="planner-page page-surface">
      <section className="planner-hero">
        <div className="shell planner-hero__inner">
          <div><div className="eyebrow eyebrow--light"><Sparkles size={14} /> Melaiva planning copilot</div><h1>A thoughtful first plan,<br /><em>made around you.</em></h1></div>
          <p>Not a generic checklist. A practical starting point shaped by your celebration, budget, city and priorities.</p>
        </div>
      </section>
      <section className="shell planner-layout">
        <div className="planner-form-card"><PlannerForm onSubmit={generate} loading={loading} />{error && <p className="form-error" role="alert">{error}</p>}</div>
        <aside className="planner-output" aria-live="polite">
          {loading ? <PlanLoading /> : plan ? <PlanResult plan={plan} onReset={() => { setPlan(null); setRequestHandoff(null); }} onStartRequest={() => navigate("/request", { state: requestHandoff ? { [PLANNER_HANDOFF_STATE_KEY]: requestHandoff } : undefined })} notify={notify} /> : (
            <div className="planner-empty"><span><WandSparkles size={28} /></span><h2>Your blueprint will appear here</h2><p>You’ll get a sensible budget shape, a sequence of decisions and a few risks worth handling early.</p><ul><li><Check size={15} /> City-aware planning assumptions</li><li><Check size={15} /> Clear budget categories</li><li><Check size={15} /> No pressure to book</li></ul></div>
          )}
        </aside>
      </section>
    </div>
  );
}
