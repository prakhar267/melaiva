import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  BadgeIndianRupee,
  Flower2,
  Landmark,
  LockKeyhole,
  MapPin,
  MessageCircleMore,
  Music2,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  UtensilsCrossed,
  WandSparkles,
} from "lucide-react";
import { categories, cities, sampleOffers } from "../data.js";

const categoryIcons = { Landmark, Camera, Flower2, UtensilsCrossed, Sparkles, Music2 };

function HeroSearch() {
  const navigate = useNavigate();
  const [brief, setBrief] = useState({ category: "", city: "", date: "", guests: "" });

  function update(key, value) {
    setBrief((current) => ({ ...current, [key]: value }));
  }

  function submit(event) {
    event.preventDefault();
    const query = new URLSearchParams();
    Object.entries(brief).forEach(([key, value]) => value && query.set(key, value));
    navigate(`/marketplace${query.size ? `?${query}` : ""}`);
  }

  return (
    <form className="hero-search" onSubmit={submit} aria-label="Search celebration professionals">
      <label className="hero-search__field">
        <Search size={20} aria-hidden="true" />
        <span>
          <small>I’m looking for</small>
          <select value={brief.category} onChange={(event) => update("category", event.target.value)} aria-label="Vendor category">
            <option value="">Any trusted vendor</option>
            {categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}
          </select>
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </label>
      <label className="hero-search__field">
        <MapPin size={20} aria-hidden="true" />
        <span>
          <small>Celebration city</small>
          <select value={brief.city} onChange={(event) => update("city", event.target.value)} aria-label="Celebration city">
            <option value="">Across India</option>
            {cities.map((city) => <option key={city}>{city}</option>)}
          </select>
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </label>
      <label className="hero-search__field hero-search__date">
        <CalendarDays size={20} aria-hidden="true" />
        <span>
          <small>Approximate date</small>
          <input value={brief.date} onChange={(event) => update("date", event.target.value)} type="date" aria-label="Approximate event date" />
        </span>
      </label>
      <label className="hero-search__field hero-search__guests">
        <Users size={20} aria-hidden="true" />
        <span>
          <small>Guests</small>
          <input value={brief.guests} onChange={(event) => update("guests", event.target.value)} min="20" max="5000" inputMode="numeric" type="number" placeholder="250" aria-label="Estimated guests" />
        </span>
      </label>
      <button className="button button--marigold hero-search__submit" type="submit">
        Explore <ArrowRight size={18} />
      </button>
    </form>
  );
}

function CategoryCard({ category, index }) {
  const Icon = categoryIcons[category.icon];
  return (
    <Link className={`category-card category-card--${index + 1}`} to={`/marketplace?category=${category.id}`}>
      <span className="category-card__number">0{index + 1}</span>
      <span className="category-card__icon"><Icon size={25} strokeWidth={1.7} /></span>
      <div>
        <h3>{category.name}</h3>
        <p>{category.short}</p>
      </div>
      <span className="category-card__count">Explore this category</span>
      <ArrowRight className="category-card__arrow" size={19} />
    </Link>
  );
}

const faqs = [
  {
    question: "What is a sealed offer?",
    answer: "Vendors respond privately to the same structured brief. They cannot see another vendor’s price, so each offer reflects their honest best fit—not a race to undercut quality.",
  },
  {
    question: "Does Melaiva charge couples?",
    answer: "Browsing, building a brief and comparing offers are free. If a specialist planning service carries a fee, we show it clearly before you choose it.",
  },
  {
    question: "How do you verify vendors?",
    answer: "Marketplace approval records a human review of submitted business disclosures, public work samples and public review or reference links, plus any alternate checks staff document. It is not KYC, legal certification or a guarantee of performance.",
  },
  {
    question: "Can I use Melaiva for just one service?",
    answer: "Absolutely. Request a photographer, venue, makeup artist—or brief several categories and manage them together from your dashboard.",
  },
];

function FaqList() {
  const [open, setOpen] = useState(0);
  return (
    <div className="faq-list">
      {faqs.map((faq, index) => {
        const isOpen = open === index;
        return (
          <div className={`faq-item ${isOpen ? "is-open" : ""}`} key={faq.question}>
            <h3>
              <button aria-expanded={isOpen} onClick={() => setOpen(isOpen ? -1 : index)}>
                <span>{faq.question}</span><ChevronDown size={20} />
              </button>
            </h3>
            <div className="faq-answer" hidden={!isOpen}><p>{faq.answer}</p></div>
          </div>
        );
      })}
    </div>
  );
}

function ContactForm({ notify }) {
  const [form, setForm] = useState({ name: "", email: "", city: "", message: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  function update(key, value) { setForm((current) => ({ ...current, [key]: value })); setError(""); }
  async function submit(event) {
    event.preventDefault();
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/v1/leads", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ ...form, source: "home_contact" }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || "We couldn’t send your note.");
      setSent(true); notify?.({ title: "Your note is with us", message: "The Melaiva team will respond using the email you shared." });
    } catch (requestError) {
      setError(String(requestError?.message || "").toLowerCase().includes("fetch") ? "We couldn’t reach Melaiva. Check your connection and try again." : requestError.message);
    } finally { setLoading(false); }
  }
  return <form className="contact-form" onSubmit={submit}>
    {sent ? <div className="contact-form__success"><Check size={23} /><div><strong>Thank you, {form.name}.</strong><p>Your note was sent successfully.</p></div></div> : <>
      <div className="form-grid"><label className="field"><span>Your name</span><input value={form.name} onChange={(event) => update("name", event.target.value)} required /></label><label className="field"><span>Email address</span><input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} required /></label><label className="field field--span-2"><span>Celebration city <small>Optional</small></span><input value={form.city} onChange={(event) => update("city", event.target.value)} /></label><label className="field field--span-2"><span>How can we help?</span><textarea rows="4" value={form.message} onChange={(event) => update("message", event.target.value)} minLength="10" required /></label></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button--primary" disabled={loading} type="submit">{loading ? <span className="button-loader" /> : null}{loading ? "Sending…" : "Send note"}<ArrowRight size={17} /></button>
    </>}
  </form>;
}

export function HomePage({ notify }) {
  return (
    <>
      <section className="home-hero">
        <img className="home-hero__image" src="/assets/celebration-hero.jpg" alt="A couple reviewing wedding plans with their planner at an evening celebration" />
        <div className="home-hero__shade" aria-hidden="true" />
        <div className="shell home-hero__content">
          <div className="home-hero__copy">
              <div className="eyebrow eyebrow--light"><span /> A clearer celebration marketplace</div>
            <h1>Your celebration.<br /><em>Beautifully considered.</em></h1>
            <p>Share one thoughtful brief. Meet relevant professionals. Compare private offers with clarity, not chaos.</p>
            <div className="hero-trust">
              <span><ShieldCheck size={16} /> Review-led partners</span>
              <span><BadgeIndianRupee size={16} /> Transparent offers</span>
              <span><MessageCircleMore size={16} /> Human support</span>
            </div>
          </div>
          <HeroSearch />
        </div>
      </section>

      <section className="category-section section">
        <div className="shell">
          <div className="section-heading section-heading--split">
            <div>
              <div className="eyebrow">Designed for celebrations across India</div>
              <h2>Begin with what matters most</h2>
            </div>
            <div className="section-heading__side">
              <p>Explore the categories that shape a celebration, with structured briefs and review signals designed to make selection clearer.</p>
              <Link className="text-link" to="/marketplace">Browse all vendors <ArrowRight size={16} /></Link>
            </div>
          </div>
          <div className="category-grid">
            {categories.map((category, index) => <CategoryCard key={category.id} category={category} index={index} />)}
          </div>
        </div>
      </section>

      <section className="clarity-band">
        <div className="shell clarity-band__inner">
          <div className="clarity-band__intro">
            <div className="eyebrow eyebrow--light">The Melaiva difference</div>
            <h2>Less chasing.<br />More choosing.</h2>
          </div>
          <div className="clarity-value">
            <span>01</span><ShieldCheck size={25} />
            <h3>One complete brief</h3>
            <p>Share your dates, scale, style and non-negotiables once.</p>
          </div>
          <div className="clarity-value">
            <span>02</span><MessageCircleMore size={25} />
            <h3>Offers made for you</h3>
            <p>Suitable vendors respond privately with clear inclusions.</p>
          </div>
          <div className="clarity-value">
            <span>03</span><BadgeCheck size={25} />
            <h3>Decide with context</h3>
            <p>Compare fit, price, terms and trusted reviews side by side.</p>
          </div>
        </div>
      </section>

      <section className="offers-section section">
        <div className="shell offers-layout">
          <div className="offers-copy">
            <div className="eyebrow">Sealed offer comparison</div>
            <h2>Know what you’re really comparing</h2>
            <p>Price matters. So do inclusions, flexibility and fit. Melaiva turns different proposals into one calm, readable view.</p>
            <ul className="check-list">
              <li><Check size={17} /> Every vendor answers the same brief</li>
              <li><Check size={17} /> Key exclusions are surfaced early</li>
              <li><Check size={17} /> Your details stay private until you choose</li>
            </ul>
            <Link className="button button--primary" to="/request">Create my brief <ArrowRight size={18} /></Link>
          </div>
          <div className="offer-preview" aria-label="Example vendor offer comparison">
            <div className="offer-preview__top">
              <div><small>Illustrative product preview</small><h3>Example venue request</h3></div>
              <span className="status-pill"><span /> 3 example offers</span>
            </div>
            <div className="offer-preview__labels"><span>Partner</span><span>Offer</span><span>Fit</span></div>
            {sampleOffers.map((offer, index) => (
              <div className={`offer-row ${index === 0 ? "is-best" : ""}`} key={offer.vendor}>
                <div className="offer-row__vendor">
                  <span className="offer-row__index">0{index + 1}</span>
                  <div><strong>{offer.vendor}</strong><small>{offer.highlight}</small></div>
                </div>
                <div><strong>{offer.total}</strong><small>{offer.delta}</small></div>
                <div className="fit-score"><strong>{offer.fit}%</strong><span style={{ "--score": `${offer.fit}%` }} /></div>
              </div>
            ))}
            <div className="offer-preview__footer"><LockKeyhole /> Offers remain private until the request closes.</div>
          </div>
        </div>
      </section>

      <section className="copilot-section section">
        <div className="shell copilot-card">
          <div className="copilot-card__orb"><WandSparkles size={36} /></div>
          <div className="copilot-card__copy">
            <div className="eyebrow eyebrow--light">Melaiva Copilot</div>
            <h2>From “where do we start?” to a plan you can act on.</h2>
            <p>Tell us the celebration you’re imagining. Your copilot turns it into a practical budget, vendor sequence and week-by-week plan—grounded in your city and guest count.</p>
          </div>
          <div className="copilot-card__actions">
            <Link className="button button--ivory" to="/planner">Build my first plan <ArrowRight size={18} /></Link>
            <span><Sparkles size={15} /> Takes about 3 minutes</span>
          </div>
        </div>
      </section>

      <section className="proof-section section">
        <div className="shell">
          <div className="proof-intro"><div className="eyebrow">Trust is a product decision</div><h2>Signals you can inspect, not claims you have to accept.</h2><p>Melaiva is being built around a clear review standard. When evidence is not available, the interface says so.</p></div>
          <div className="proof-stats">
            <div><strong>Business review</strong><span>Registration disclosures and account details reviewed before marketplace approval.</span></div>
            <div><strong>Public evidence</strong><span>Submitted work samples and public references reviewed for service fit.</span></div>
            <div><strong>Written scope</strong><span>Offers separate inclusions, exclusions, terms and total price.</span></div>
            <div><strong>Private by default</strong><span>Direct contact stays protected until there is mutual interest.</span></div>
          </div>
        </div>
      </section>

      <section className="faq-section section">
        <div className="shell faq-layout">
          <div className="faq-copy">
            <div className="eyebrow">Good questions, plainly answered</div>
            <h2>Clarity from the first click</h2>
            <p>Still wondering about something? Our planning concierge is happy to help.</p>
            <a className="text-link" href="#contact">Talk to our team <ArrowRight size={16} /></a>
          </div>
          <FaqList />
        </div>
      </section>

      <section className="contact-section" id="contact">
        <div className="shell contact-layout"><div><div className="eyebrow">Talk to a human</div><h2>Questions before you begin?</h2><p>Tell us what you’re planning or where you’re stuck. This form sends your note securely to the Melaiva team.</p></div><ContactForm notify={notify} /></div>
      </section>

      <section className="vendor-cta-section">
        <div className="shell vendor-cta">
          <div>
            <div className="eyebrow">For celebration professionals</div>
            <h2>Spend time on celebrations that fit.</h2>
            <p>Receive structured, relevant opportunities. Send clear offers. Build trust without paying for empty leads.</p>
          </div>
          <Link className="button button--primary" to="/vendor/onboarding">Join the partner network <ArrowRight size={18} /></Link>
        </div>
      </section>
    </>
  );
}
