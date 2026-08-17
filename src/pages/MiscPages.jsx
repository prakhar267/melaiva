import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, FileQuestion, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { AuthPanel } from "../components/Shell.jsx";
import { readApiResponse } from "../api.js";

export function AuthPage({ notify, onAuthenticated }) {
  const navigate = useNavigate();
  return (
    <div className="auth-page page-surface">
      <div className="shell auth-page__layout">
        <section className="auth-page__story">
          <div className="eyebrow eyebrow--light"><Sparkles size={14} /> Your calm planning space</div>
          <h2>Keep every choice, offer and next step connected.</h2>
          <p>Return to one clear view of the celebration—from your first brief to the last confirmed detail.</p>
          <ul><li><ShieldCheck size={17} /> Private contact details</li><li><LockKeyhole size={17} /> Secure account sessions</li><li><Sparkles size={17} /> Plans grounded in your brief</li></ul>
        </section>
        <section className="auth-page__panel">
          <AuthPanel onSuccess={async (mode, user) => {
            onAuthenticated?.(mode, user);
            notify({ title: mode === "login" ? "Welcome back" : "Your account is ready", message: "Opening your planning space now." });
            try {
              const response = await fetch("/api/v1/auth/me", { credentials: "include" });
              const payload = await readApiResponse(response, "Your account destination could not be loaded.");
              navigate(payload.data?.user?.role === "admin" ? "/admin/vendors" : payload.data?.vendor ? "/vendor" : "/dashboard");
            } catch {
              navigate(user?.role === "admin" ? "/admin/vendors" : "/dashboard");
            }
          }} />
        </section>
      </div>
    </div>
  );
}

const privacySections = [
  ["Information you give us", "We collect the details you enter when you create an account, build a celebration brief, request an offer, exchange post-award messages or apply to join the vendor network. This can include names, email addresses, phone numbers, dates, locations, guest estimates, budgets, planning preferences, public portfolio and reference links, a business-registration disclosure and the text you choose to send."],
  ["How we use information", "We use this information to operate Melaiva, match briefs with suitable partners, conduct accountable partner review, produce requested planning assistance, secure accounts, provide support, improve service quality and meet legal obligations. We do not sell personal information."],
  ["Vendor application evidence", "Authorised operations staff may open the public work, review or reference links submitted with a vendor application and inspect its business-registration disclosure. Links and registration references stay out of the public catalog unless they are separately part of an approved public profile. Do not submit private client contact details, signed links, Aadhaar, PAN, passport, voter ID, driving-licence, bank-account or payment-card information."],
  ["When information is shared", "Relevant brief details may be shared with eligible partners so they can prepare an offer. After an award, text messages are visible to that request’s owner, the winning partner and authorised Melaiva administrators for support and safety. Messages do not automatically reveal the customer’s account name, email address or phone number. We may also use vetted infrastructure providers that process information on our instructions."],
  ["AI-assisted planning", "When you request an AI-generated plan, the details needed for that request may be sent to an AI service provider. Avoid entering sensitive personal information that is not necessary for planning. Generated guidance can be incomplete and should be reviewed before financial or contractual decisions."],
  ["Storage and security", "We apply technical and organisational safeguards appropriate to the nature of the information. No internet service can promise absolute security. Award messages are stored as plain-text coordination records, so do not send payment details or sensitive information that is not needed. We retain information only as long as needed for the purposes described here, legitimate business records, dispute handling and applicable law."],
  ["Your choices", "You may ask to access, correct or delete eligible personal information, or object to certain uses. Some records may need to be retained for security, dispute handling or legal compliance. Marketing messages include a way to opt out."],
  ["Contact", "For privacy questions or requests, email privacy@melaiva.com. We may need to verify your identity before completing a request."],
];

const termsSections = [
  ["Using Melaiva", "You must provide accurate information, keep account credentials secure and use the service lawfully. You may not scrape the service, interfere with security, impersonate another person, send spam or misuse private briefs and contact information."],
  ["Marketplace role", "Melaiva helps couples and celebration professionals discover one another, exchange structured briefs and compare offers. Unless a booking explicitly states otherwise, vendors are independent businesses. They—not Melaiva—are responsible for their services, licences, taxes, promises and contractual performance."],
  ["Offers and bookings", "An offer is not a confirmed booking until the couple and vendor complete the required acceptance, contract and payment steps. Review scope, exclusions, taxes, payment schedules, cancellation terms and dates carefully. Sealed offers must not be manipulated or shared to pressure another participant."],
  ["Award messages", "Post-award messages help the request owner and winning partner coordinate next steps. They are not a contract, signature, invoice, proof of payment or booking confirmation. Do not use messages for spam, harassment, unlawful content or payment-card details; account restrictions can pause new messages while prior records remain available for support and dispute handling."],
  ["AI and planning guidance", "Plans, budget allocations, recommendations and other generated outputs are informational starting points. They can contain errors or outdated assumptions and are not legal, tax, financial or professional advice. Verify important details with qualified professionals and written vendor terms."],
  ["Content and reviews", "You retain rights in content you submit and give Melaiva permission to host, process and display it as needed to provide the service. Submitted content must be truthful, lawful and yours to share. We may moderate or remove content that violates these terms or creates safety and trust risks."],
  ["Availability and liability", "We work to keep the service reliable, but features may change or be interrupted. To the extent permitted by law, Melaiva is not responsible for indirect losses, vendor performance or decisions made solely from generated guidance. Rights that cannot legally be excluded remain unaffected."],
  ["Ending use and changes", "You may stop using Melaiva at any time. We may restrict accounts that create risk or violate these terms. Material changes will be communicated through the service or account contact details where reasonably required."],
  ["Contact", "Questions about these terms can be sent to legal@melaiva.com."],
];

export function LegalPage({ type }) {
  const privacy = type === "privacy";
  const sections = privacy ? privacySections : termsSections;
  return (
    <div className="legal-page page-surface">
      <header className="legal-header"><div className="shell"><Link className="back-link" to="/"><ArrowLeft size={15} /> Back to Melaiva</Link><div className="eyebrow">Trust & transparency</div><h1>{privacy ? "Privacy policy" : "Terms of service"}</h1><p>Effective 17 August 2026 · Plain-language product policy</p></div></header>
      <div className="shell legal-layout"><aside><nav aria-label={`${privacy ? "Privacy" : "Terms"} sections`}>{sections.map(([title], index) => <a href={`#section-${index}`} key={title}><span>{String(index + 1).padStart(2, "0")}</span>{title}</a>)}</nav></aside><article><div className="legal-intro"><ShieldCheck size={22} /><p>{privacy ? "This policy explains the information Melaiva handles and the choices available to you." : "These terms set the ground rules for using Melaiva as a couple, guest or celebration professional."}</p></div>{sections.map(([title, content], index) => <section id={`section-${index}`} key={title}><span>{String(index + 1).padStart(2, "0")}</span><div><h2>{title}</h2><p>{content}</p></div></section>)}</article></div>
    </div>
  );
}

export function NotFoundPage() {
  return <div className="not-found page-surface"><span><FileQuestion size={31} /></span><div className="eyebrow">404 · This page wandered off</div><h1>Let’s get you back to the celebration.</h1><p>The link may have changed, or the page may no longer be available.</p><div><Link className="button button--primary" to="/">Go home <ArrowRight size={17} /></Link><Link className="button button--outline" to="/marketplace">Explore partners</Link></div></div>;
}
