import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  BadgeCheck,
  Ban,
  Building2,
  CalendarDays,
  Check,
  CircleAlert,
  ExternalLink,
  FileCheck2,
  History,
  IndianRupee,
  Landmark,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Store,
  UserRound,
  X,
} from "lucide-react";
import { createIdempotencyKey, readApiResponse } from "../api.js";
import { categories, formatCurrency } from "../data.js";
import {
  ADMIN_VENDOR_STATUSES,
  ADMIN_INFORMATION_REQUEST_FIELDS,
  adjustAdminStatusCounts,
  classifyAdminVendorDecisionFailure,
  adminVendorDecisionAcknowledgement,
  adminVendorEvidenceState,
  adminVendorEvidenceSummaryLabel,
  adminVendorActions,
  adminVendorStatusConfig,
  adminVendorStatusLabel,
  isAdminVendorActionAllowed,
  normalizeAdminStatusCounts,
  normalizeAdminVendorSummary,
  normalizeAdminVendorStatus,
  informationRequestFieldLabel,
  validateAdminInformationRequest,
  validateAdminReviewReason,
} from "../components/adminVendors.js";
import {
  ADMIN_VENDOR_SUMMARY_HEADERS,
  checkVendorApplicationEvidenceCompatibility,
  supportsAdminVendorSummaryContract,
} from "../components/vendorApplicationCompatibility.js";
import { parsePublicWebsiteUrl } from "../security/publicWebsiteUrl.js";

function categoryLabel(value) {
  return categories.find((category) => category.id === value)?.name
    || String(value || "Service").replaceAll("_", " ");
}

function formatDate(value, withTime = false) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

function normalizeVendorDetail(vendor) {
  const revisionValue = vendor?.reviewRevision;
  const revision = revisionValue === null || revisionValue === undefined ? Number.NaN : Number(revisionValue);
  const evidenceReviewedRevision = vendor?.evidenceReviewedRevision === null || vendor?.evidenceReviewedRevision === undefined
    ? Number.NaN
    : Number(vendor.evidenceReviewedRevision);
  const evidenceRevision = Number(vendor?.evidenceSummary?.revision);
  const evidenceSummary = vendor?.evidenceSummary && Number.isInteger(evidenceRevision) && evidenceRevision >= 1
    ? {
        revision: evidenceRevision,
        portfolioUrlCount: Math.max(0, Number(vendor.evidenceSummary.portfolioUrlCount) || 0),
        referenceUrlCount: Math.max(0, Number(vendor.evidenceSummary.referenceUrlCount) || 0),
        registrationType: vendor.evidenceSummary.registrationType || null,
        declarationOnly: Boolean(vendor.evidenceSummary.declarationOnly),
      }
    : null;
  const detailEvidenceRevision = Number(vendor?.evidence?.revision);
  const evidence = vendor?.evidence && Number.isInteger(detailEvidenceRevision) && detailEvidenceRevision >= 1
    ? {
        revision: detailEvidenceRevision,
        portfolioUrls: Array.isArray(vendor.evidence.portfolioUrls) ? vendor.evidence.portfolioUrls : [],
        referenceUrls: Array.isArray(vendor.evidence.referenceUrls) ? vendor.evidence.referenceUrls : [],
        registrationType: vendor.evidence.registrationType || null,
        registrationReference: vendor.evidence.registrationReference || null,
        attested: vendor.evidence.attested === true,
        attestedAt: vendor.evidence.attestedAt || null,
      }
    : null;
  const evidenceHistory = Array.isArray(vendor?.evidenceHistory)
    ? vendor.evidenceHistory.map((item) => {
        const itemRevision = Number(item?.revision);
        if (!Number.isInteger(itemRevision) || itemRevision < 1) return null;
        return {
          revision: itemRevision,
          portfolioUrlCount: Math.max(0, Number(item.portfolioUrlCount) || 0),
          referenceUrlCount: Math.max(0, Number(item.referenceUrlCount) || 0),
          registrationType: item.registrationType || null,
          declarationOnly: Boolean(item.declarationOnly),
          attestedAt: typeof item.attestedAt === "string" ? item.attestedAt : null,
          createdAt: typeof item.createdAt === "string" ? item.createdAt : null,
        };
      }).filter(Boolean).sort((a, b) => b.revision - a.revision)
    : [];
  const requestRevision = vendor?.currentInformationRequest?.revision === null || vendor?.currentInformationRequest?.revision === undefined
    ? Number.NaN
    : Number(vendor.currentInformationRequest.revision);
  const requestEvidenceRevision = vendor?.currentInformationRequest?.evidenceRevision === null || vendor?.currentInformationRequest?.evidenceRevision === undefined
    ? Number.NaN
    : Number(vendor.currentInformationRequest.evidenceRevision);
  const allowedRequestFields = new Set(ADMIN_INFORMATION_REQUEST_FIELDS.map((item) => item.id));
  const requestFieldsValid = Array.isArray(vendor?.currentInformationRequest?.requestedFields)
    && vendor.currentInformationRequest.requestedFields.length >= 1
    && vendor.currentInformationRequest.requestedFields.length <= allowedRequestFields.size
    && vendor.currentInformationRequest.requestedFields.every((field) => allowedRequestFields.has(field))
    && new Set(vendor.currentInformationRequest.requestedFields).size
      === vendor.currentInformationRequest.requestedFields.length;
  const requestFields = requestFieldsValid ? [...vendor.currentInformationRequest.requestedFields] : [];
  const requestMessage = typeof vendor?.currentInformationRequest?.applicantMessage === "string"
    ? vendor.currentInformationRequest.applicantMessage.trim()
    : "";
  const currentInformationRequest = vendor?.currentInformationRequest
    && Number.isInteger(requestRevision)
    && requestRevision >= 1
    && Number.isInteger(requestEvidenceRevision)
    && requestEvidenceRevision >= 0
    && requestFieldsValid
    && requestMessage
    ? {
        revision: requestRevision,
        evidenceRevision: requestEvidenceRevision,
        requestedFields: requestFields,
        applicantMessage: requestMessage,
        requestedAt: typeof vendor.currentInformationRequest.requestedAt === "string" ? vendor.currentInformationRequest.requestedAt : null,
      }
    : null;
  return {
    ...vendor,
    categories: Array.isArray(vendor?.categories) ? vendor.categories : [],
    serviceAreas: Array.isArray(vendor?.serviceAreas) ? vendor.serviceAreas : [],
    owner: vendor?.owner || null,
    status: ADMIN_VENDOR_STATUSES.some((item) => item.id === vendor?.status) ? vendor.status : null,
    revision: Number.isInteger(revision) && revision >= 0 ? revision : null,
    evidenceReviewedRevision: Number.isInteger(evidenceReviewedRevision) && evidenceReviewedRevision >= 0
      ? evidenceReviewedRevision
      : null,
    evidenceRequired: vendor?.evidenceRequired === false ? false : true,
    evidenceSummary,
    evidence,
    evidenceHistory,
    currentInformationRequest,
  };
}

function registrationLabel(type) {
  return {
    gstin: "GSTIN",
    cin: "Corporate identity number (CIN)",
    udyam: "Udyam registration",
    not_registered: "No formal business registration declared",
  }[type] || "Not provided";
}

function normalizeReview(review) {
  return {
    id: review?.id || `${review?.createdAt || "review"}-${review?.revision || "unknown"}`,
    fromStatus: review?.fromStatus ?? review?.from ?? review?.previousStatus ?? null,
    toStatus: review?.toStatus ?? review?.to ?? review?.status ?? null,
    reason: review?.reason ?? review?.note ?? "",
    createdAt: review?.createdAt ?? review?.reviewedAt ?? null,
    revision: review?.statusRevision ?? review?.revision ?? null,
    actor: review?.actor || review?.reviewer || null,
    actorName: review?.actorName || review?.reviewerName || null,
    legacy: Boolean(review?.legacy),
  };
}

function AdminStatus({ status }) {
  return <span className={`admin-status admin-status--${status}`}><span aria-hidden="true" />{adminVendorStatusLabel(status)}</span>;
}

function AdminAccessState({ icon: Icon, eyebrow, title, message, children }) {
  return (
    <div className="admin-page page-surface">
      <div className="shell admin-access-state">
        <section className="admin-access-card">
          <span className="admin-access-card__icon"><Icon size={28} /></span>
          <div className="eyebrow">{eyebrow}</div>
          <h1>{title}</h1>
          <p>{message}</p>
          {children && <div className="admin-access-card__actions">{children}</div>}
        </section>
      </div>
    </div>
  );
}

function QueueSkeleton() {
  return (
    <div className="admin-queue-skeleton" role="status" aria-live="polite">
      <span className="sr-only">Loading vendor applications</span>
      {Array.from({ length: 4 }).map((_, index) => <div key={index}><span /><span /><span /></div>)}
    </div>
  );
}

function DecisionDialog({ decision, busy, blocked = false, unconfirmed = false, error, onClose, onSubmit }) {
  const [reason, setReason] = useState("");
  const [requestedFields, setRequestedFields] = useState([]);
  const [applicantMessage, setApplicantMessage] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [informationErrors, setInformationErrors] = useState({});
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const blockedRef = useRef(blocked);
  const headingId = useId();
  const descriptionId = useId();
  const reasonHintId = useId();
  const requestedFieldsErrorId = useId();
  const applicantMessageHintId = useId();
  onCloseRef.current = onClose;
  blockedRef.current = blocked;

  useEffect(() => {
    const previous = document.activeElement;
    document.body.classList.add("modal-open");
    const timer = window.setTimeout(() => dialogRef.current?.querySelector('[data-dialog-initial="true"]')?.focus(), 30);
    function onKeyDown(event) {
      if (event.key === "Escape" && !blockedRef.current) onCloseRef.current?.();
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("modal-open");
      previous?.focus?.();
    };
  }, []);

  function submit(event) {
    event.preventDefault();
    const nextError = validateAdminReviewReason(reason, decision.vendor);
    const nextInformationErrors = decision.action.targetStatus === "needs_information"
      ? validateAdminInformationRequest({ requestedFields, applicantMessage }, decision.vendor)
      : {};
    setValidationError(nextError);
    setInformationErrors(nextInformationErrors);
    if (nextError || Object.keys(nextInformationErrors).length || !acknowledged) {
      window.requestAnimationFrame(() => dialogRef.current?.querySelector('[aria-invalid="true"]')?.focus());
      return;
    }
    dialogRef.current?.focus();
    onSubmit({
      reason: reason.trim(),
      idempotencyKey: decision.idempotencyKey,
      ...(decision.action.targetStatus === "needs_information"
        ? { requestedFields, applicantMessage: applicantMessage.trim() }
        : {}),
    });
  }

  const informationAction = decision.action.targetStatus === "needs_information";
  const ActionIcon = decision.action.tone === "danger" ? ShieldAlert : decision.action.tone === "neutral" ? RotateCcw : informationAction ? CircleAlert : BadgeCheck;

  return (
    <div className="modal-backdrop" onMouseDown={(event) => !blocked && event.target === event.currentTarget && onClose()}>
      <form
        className={`modal-card admin-decision-dialog admin-decision-dialog--${decision.action.tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        tabIndex="-1"
        ref={dialogRef}
        onSubmit={submit}
        noValidate
      >
        <button className="icon-button modal-card__close" type="button" onClick={onClose} disabled={busy} aria-label={blocked || unconfirmed ? "Close decision draft and review latest application version" : "Close review decision"}><X size={20} /></button>
        <span className="admin-decision-dialog__icon"><ActionIcon size={24} /></span>
        <div className="eyebrow">Partner review decision</div>
        <h2 id={headingId}>{decision.action.title}</h2>
        <p id={descriptionId}>{decision.action.consequence}</p>
        <dl className="admin-decision-dialog__summary">
          <div><dt>Business</dt><dd>{decision.vendor.businessName}</dd></div>
          <div><dt>Status change</dt><dd>{adminVendorStatusLabel(decision.vendor.status)} → {adminVendorStatusLabel(decision.action.targetStatus)}</dd></div>
          <div><dt>Application version</dt><dd>{decision.vendor.revision}</dd></div>
          {decision.vendor.evidence && <div><dt>Evidence revision</dt><dd>{decision.vendor.evidence.revision} · {decision.vendor.evidence.portfolioUrls.length + decision.vendor.evidence.referenceUrls.length} submitted link{decision.vendor.evidence.portfolioUrls.length + decision.vendor.evidence.referenceUrls.length === 1 ? "" : "s"}</dd></div>}
        </dl>
        {informationAction && (
          <section className="admin-information-request-form" aria-labelledby={`${headingId}-information`}>
            <div><h3 id={`${headingId}-information`}>Applicant-visible request</h3><p>Choose the evidence areas to revise, then write safe instructions the applicant can act on. Do not include internal review notes or identifiers.</p></div>
            <fieldset disabled={busy || unconfirmed} aria-describedby={informationErrors.requestedFields ? requestedFieldsErrorId : undefined} aria-invalid={Boolean(informationErrors.requestedFields)}>
              <legend>Evidence areas to update</legend>
              <div>{ADMIN_INFORMATION_REQUEST_FIELDS.map((field) => {
                const checked = requestedFields.includes(field.id);
                return <label key={field.id}><input type="checkbox" checked={checked} onChange={() => { setRequestedFields((current) => checked ? current.filter((item) => item !== field.id) : [...current, field.id]); setInformationErrors((current) => ({ ...current, requestedFields: "" })); }} disabled={busy || unconfirmed} data-dialog-initial={field.id === ADMIN_INFORMATION_REQUEST_FIELDS[0].id ? "true" : undefined} aria-invalid={field.id === ADMIN_INFORMATION_REQUEST_FIELDS[0].id && Boolean(informationErrors.requestedFields)} aria-describedby={field.id === ADMIN_INFORMATION_REQUEST_FIELDS[0].id && informationErrors.requestedFields ? requestedFieldsErrorId : undefined} /><span><Check size={13} /></span><strong>{field.label}</strong></label>;
              })}</div>
              {informationErrors.requestedFields && <small className="field-error" id={requestedFieldsErrorId} role="alert">{informationErrors.requestedFields}</small>}
            </fieldset>
            <label className="field">
              <span>Instructions for the applicant</span>
              <textarea rows="4" minLength="20" maxLength="1000" value={applicantMessage} onChange={(event) => { setApplicantMessage(event.target.value); setInformationErrors((current) => ({ ...current, applicantMessage: "" })); }} aria-invalid={Boolean(informationErrors.applicantMessage)} aria-describedby={applicantMessageHintId} placeholder="Explain what is missing or unclear and what a useful revision should include." disabled={busy || unconfirmed} required />
              <span className="admin-decision-dialog__reason-meta" id={applicantMessageHintId}><small>{informationErrors.applicantMessage || "Visible to this applicant. Never include URLs, identity numbers, registration references or private staff notes."}</small><small>{applicantMessage.length} / 1,000</small></span>
            </label>
          </section>
        )}
        <label className="field admin-decision-dialog__reason">
          <span>{informationAction ? "Private internal reason" : "Internal review reason"}</span>
          <textarea
            rows="5"
            minLength="10"
            maxLength="1000"
            value={reason}
            onChange={(event) => { setReason(event.target.value); setValidationError(""); }}
            aria-invalid={Boolean(validationError)}
            aria-describedby={reasonHintId}
            placeholder={informationAction ? "Record privately why this follow-up is necessary." : "Record the evidence checked and why this status is appropriate."}
            disabled={busy || unconfirmed}
            data-dialog-initial={informationAction ? undefined : "true"}
            required
          />
          <span className="admin-decision-dialog__reason-meta" id={reasonHintId}>
            <small>{validationError || (informationAction ? "Private: never shown to the applicant." : "Visible only to authorised operations staff.")}</small>
            <small>{reason.length} / 1,000</small>
          </span>
        </label>
        <label className="admin-decision-dialog__acknowledgement">
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} disabled={busy || unconfirmed} />
          <span><Check size={14} /></span>
          <strong>{adminVendorDecisionAcknowledgement(decision.action, decision.vendor)}</strong>
        </label>
        {error && <p className={`form-error admin-decision-dialog__error ${blocked ? "is-conflict" : ""}`} role="alert">{blocked && <CircleAlert size={16} />}{error}</p>}
        <div className="admin-decision-dialog__actions">
          <button className="button button--outline" type="button" onClick={onClose} disabled={busy}>{blocked || unconfirmed ? "Close and review latest version" : "Keep reviewing"}</button>
          <button className={`button ${decision.action.tone === "danger" ? "admin-button--danger" : decision.action.tone === "information" ? "admin-button--information" : "button--primary"}`} type="submit" disabled={busy || blocked || !acknowledged}>
            {busy ? <LoaderCircle className="spin-icon" size={17} /> : <ActionIcon size={17} />}
            {busy ? "Saving decision…" : unconfirmed ? "Retry same secure decision" : decision.action.label}
          </button>
        </div>
      </form>
    </div>
  );
}

function ReviewHistory({ reviews, truncated, loading, error, onRetry }) {
  return (
    <section className="admin-review-history" aria-labelledby="admin-review-history-heading">
      <div className="admin-detail-section__heading">
        <span><History size={18} /></span>
        <div><h3 id="admin-review-history-heading">Decision history</h3><p>Immutable staff review records for this application.</p></div>
      </div>
      {loading ? (
        <div className="admin-history-state" role="status"><LoaderCircle className="spin-icon" size={20} /> Loading decision history…</div>
      ) : error ? (
        <div className="admin-history-state admin-history-state--error" role="alert"><CircleAlert size={18} /><span>{error}</span><button className="text-button" type="button" onClick={onRetry}><RefreshCw size={14} /> Retry</button></div>
      ) : reviews.length ? (
        <ol className="admin-history-list">
          {reviews.map((review) => {
            const actorName = review.actor?.name || review.actorName || "Reviewer unavailable";
            return (
              <li key={review.id}>
                <span className="admin-history-list__marker"><Check size={13} /></span>
                <div>
                  <div className="admin-history-list__top">
                    <strong>{review.fromStatus ? `${adminVendorStatusLabel(review.fromStatus)} → ` : ""}{adminVendorStatusLabel(review.toStatus)}</strong>
                    <time dateTime={review.createdAt || undefined}>{formatDate(review.createdAt, true)}</time>
                  </div>
                  {review.reason ? <p>{review.reason}</p> : review.legacy ? <p>Reason not recorded in this legacy review entry.</p> : null}
                  <small>{actorName}{review.revision !== null ? ` · Application version ${review.revision}` : ""}{review.legacy ? " · Legacy record" : ""}</small>
                </div>
              </li>
            );
          })}
        </ol>
      ) : <div className="admin-history-state"><History size={18} /> No staff decisions have been recorded yet.</div>}
      {truncated && <div className="admin-history-state admin-history-state--notice"><CircleAlert size={18} /> Showing the latest 100 decisions. Older immutable records remain retained.</div>}
    </section>
  );
}

function CurrentInformationRequest({ request }) {
  if (!request) return null;
  return (
    <section className="admin-current-information-request" aria-labelledby="admin-current-information-request-heading">
      <div className="admin-detail-section__heading"><span><CircleAlert size={18} /></span><div><h3 id="admin-current-information-request-heading">Current information request</h3><p>Applicant-visible instructions, separate from private decision reasons.</p></div></div>
      <dl>
        <div><dt>Request</dt><dd>{request.revision}</dd></div>
        <div><dt>Based on evidence revision</dt><dd>{request.evidenceRevision || "No prior evidence"}</dd></div>
        <div><dt>Requested</dt><dd>{formatDate(request.requestedAt, true)}</dd></div>
      </dl>
      <div className="admin-current-information-request__fields"><strong>Evidence areas</strong><ul>{request.requestedFields.map((field) => <li key={field}><Check size={13} />{informationRequestFieldLabel(field)}</li>)}</ul></div>
      <div className="admin-current-information-request__message"><strong>Message shown to applicant</strong><blockquote>{request.applicantMessage}</blockquote></div>
    </section>
  );
}

function EvidenceRevisionHistory({ revisions, latestRevision }) {
  return (
    <section className="admin-evidence-revisions" aria-labelledby="admin-evidence-revisions-heading">
      <div className="admin-detail-section__heading"><span><History size={18} /></span><div><h3 id="admin-evidence-revisions-heading">Immutable evidence revisions</h3><p>The latest revision is shown in full above. Earlier revisions retain metadata only in this view.</p></div></div>
      {revisions.length ? <ol>{revisions.map((item) => {
        const latest = item.revision === latestRevision;
        return <li className={latest ? "is-latest" : ""} key={item.revision}><span>{latest ? <Check size={13} /> : item.revision}</span><div><div><strong>Evidence revision {item.revision}</strong><small>{latest ? "Latest complete snapshot" : "Previous immutable snapshot"}</small></div><time dateTime={item.createdAt || item.attestedAt || undefined}>{formatDate(item.createdAt || item.attestedAt, true)}</time><p>{item.portfolioUrlCount} portfolio · {item.referenceUrlCount} reference · {registrationLabel(item.registrationType)}{item.declarationOnly ? " · declaration only" : ""}</p></div></li>;
      })}</ol> : <div className="admin-history-state"><History size={18} /> Evidence revision history metadata is unavailable.</div>}
    </section>
  );
}

function VendorDetail({ vendor, history, historyTruncated, historyLoading, historyError, onRetryHistory, onDecision }) {
  const actions = adminVendorActions(vendor.status);
  const revisionReady = Number.isInteger(vendor.revision);
  const evidenceState = adminVendorEvidenceState(vendor);
  const evidenceBlocksApproval = evidenceState === "required";
  const requestRecordReady = vendor.status !== "needs_information" || Boolean(vendor.currentInformationRequest);
  const evidenceRecordReady = !vendor.evidenceSummary || vendor.evidence?.revision === vendor.evidenceSummary.revision;
  const instagramHandle = String(vendor.instagramHandle || "").replace(/^@/, "");
  const website = parsePublicWebsiteUrl(vendor.websiteUrl);
  const portfolioLinks = (vendor.evidence?.portfolioUrls || []).map(parsePublicWebsiteUrl).filter(Boolean);
  const referenceLinks = (vendor.evidence?.referenceUrls || []).map(parsePublicWebsiteUrl).filter(Boolean);
  const evidenceLinkCount = (vendor.evidence?.portfolioUrls?.length || 0) + (vendor.evidence?.referenceUrls?.length || 0);
  const safeEvidenceLinkCount = portfolioLinks.length + referenceLinks.length;
  return (
    <article className="admin-vendor-detail" id="admin-vendor-detail" aria-labelledby={`admin-vendor-${vendor.id}`}>
      <header className="admin-vendor-detail__header">
        <div className="admin-vendor-detail__identity">
          <span>{String(vendor.businessName || "MV").split(" ").map((word) => word[0]).join("").slice(0, 2).toUpperCase()}</span>
          <div><small>Application {String(vendor.id).slice(0, 8).toUpperCase()}</small><h2 id={`admin-vendor-${vendor.id}`}>{vendor.businessName}</h2><p>{categoryLabel(vendor.category)} · {vendor.city}</p></div>
        </div>
        <div className="admin-vendor-detail__status"><AdminStatus status={vendor.status} /><small>{revisionReady ? `Application version ${vendor.revision}` : "Application version unavailable"}</small></div>
      </header>

      {!revisionReady && <div className="admin-detail-warning" role="alert"><CircleAlert size={18} /><p><strong>This application cannot be changed safely.</strong><span>The server did not return an Application version. Refresh before making a decision.</span></p></div>}
      {!requestRecordReady && <div className="admin-detail-warning" role="alert"><CircleAlert size={18} /><p><strong>This information request cannot be reviewed safely.</strong><span>The server did not return the current applicant-visible request. Refresh before making another decision.</span></p></div>}
      {!evidenceRecordReady && <div className="admin-detail-warning" role="alert"><CircleAlert size={18} /><p><strong>This evidence record cannot be reviewed safely.</strong><span>The latest evidence summary and full snapshot do not match. Refresh before making a decision.</span></p></div>}
      {vendor.evidence && Number.isInteger(vendor.evidenceReviewedRevision) && vendor.evidence.revision > vendor.evidenceReviewedRevision && <div className="admin-detail-revised" role="status"><RefreshCw size={18} /><p><strong>New evidence revision submitted</strong><span>{vendor.evidenceReviewedRevision > 0 ? `Evidence revision ${vendor.evidence.revision} replaces revision ${vendor.evidenceReviewedRevision} for the next review. Both remain immutable.` : `Evidence revision ${vendor.evidence.revision} is ready for its first evidence-backed review.`}</span></p></div>}
      {!vendor.evidence && evidenceState === "required" && <div className="admin-detail-warning" id="admin-evidence-required-warning" role="alert"><CircleAlert size={18} /><p><strong>Structured evidence is still required</strong><span>This application cannot be approved until the partner submits the required public work, reference and business evidence.</span></p></div>}
      {!vendor.evidence && evidenceState === "legacy" && <div className="admin-detail-warning admin-detail-warning--legacy" role="note"><CircleAlert size={18} /><p><strong>Legacy application without structured evidence</strong><span>This record predates evidence capture. Complete and document suitable work, reference and business checks before any approval; do not treat the missing snapshot as reviewed.</span></p></div>}

      <div className="admin-detail-grid">
        <section className="admin-detail-section">
          <div className="admin-detail-section__heading"><span><Building2 size={18} /></span><div><h3>Business identity</h3><p>Submitted organisation and account details.</p></div></div>
          <dl className="admin-detail-list">
            <div><dt>Trading name</dt><dd>{vendor.businessName || "Not provided"}</dd></div>
            <div><dt>Registered legal name</dt><dd>{vendor.legalName || "Not provided"}</dd></div>
            <div><dt>Account owner</dt><dd>{vendor.owner?.name || "Not provided"}</dd></div>
            <div><dt>Submitted</dt><dd>{formatDate(vendor.createdAt, true)}</dd></div>
          </dl>
        </section>

        <section className="admin-detail-section">
          <div className="admin-detail-section__heading"><span><UserRound size={18} /></span><div><h3>Private contact</h3><p>Use only for authorised partner review.</p></div></div>
          <dl className="admin-detail-list admin-detail-list--contact">
            <div><dt><Mail size={14} /> Email</dt><dd>{vendor.owner?.email || "Not provided"}</dd></div>
            <div><dt><Phone size={14} /> Phone</dt><dd>{vendor.phone || "Not provided"}</dd></div>
          </dl>
        </section>

        <section className="admin-detail-section admin-detail-section--wide">
          <div className="admin-detail-section__heading"><span><MapPin size={18} /></span><div><h3>Service fit</h3><p>Coverage and commercial range used for marketplace matching.</p></div></div>
          <div className="admin-service-summary">
            <dl>
              <div><dt>Primary service</dt><dd>{categoryLabel(vendor.category)}</dd></div>
              <div><dt>Home city</dt><dd>{vendor.city || "Not provided"}</dd></div>
              <div><dt>Typical project from</dt><dd>{formatCurrency(vendor.minBudget)}</dd></div>
              <div><dt>Typical project up to</dt><dd>{formatCurrency(vendor.maxBudget)}</dd></div>
            </dl>
            <div className="admin-chip-group"><strong>Categories</strong><div>{(vendor.categories.length ? vendor.categories : [vendor.category]).filter(Boolean).map((item) => <span key={item}>{categoryLabel(item)}</span>)}</div></div>
            <div className="admin-chip-group"><strong>Service areas</strong><div>{vendor.serviceAreas.length ? vendor.serviceAreas.map((item) => <span key={item}>{item}</span>) : <small>Not provided</small>}</div></div>
          </div>
        </section>

        <section className="admin-detail-section admin-detail-section--wide">
          <div className="admin-detail-section__heading"><span><Building2 size={18} /></span><div><h3>Business introduction and public profiles</h3><p>Applicant-written context and optional public business profiles.</p></div></div>
          <p className="admin-vendor-description">{vendor.description || "No description was provided."}</p>
          <div className="admin-evidence-links">
            {website && <a className="button button--small button--outline" href={website.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open {website.hostname} <ExternalLink size={14} /></a>}
            {instagramHandle && <a className="button button--small button--outline" href={`https://www.instagram.com/${instagramHandle}/`} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open Instagram <ExternalLink size={14} /></a>}
            {vendor.websiteUrl && !website && <span className="admin-evidence-link-blocked"><ShieldAlert size={15} /> Website link blocked because it is not a public HTTPS destination.</span>}
            {!vendor.websiteUrl && !instagramHandle && <span>No optional public profiles were submitted.</span>}
          </div>
        </section>

        <section className="admin-detail-section admin-detail-section--wide">
          <div className="admin-detail-section__heading"><span><FileCheck2 size={18} /></span><div><h3>Submitted review evidence</h3><p>Untrusted applicant-supplied links and business-registration disclosure. Submitted does not mean verified.</p></div></div>
          {vendor.evidence ? (
            <div className="admin-application-evidence">
              <dl className="admin-detail-list admin-application-evidence__summary">
                <div><dt>Evidence revision</dt><dd>{vendor.evidence.revision} · latest complete snapshot</dd></div>
                <div><dt>Applicant attestation</dt><dd>{vendor.evidence.attested ? `Recorded ${formatDate(vendor.evidence.attestedAt, true)}` : "Not recorded"}</dd></div>
                <div><dt>Business registration</dt><dd>{registrationLabel(vendor.evidence.registrationType)}</dd></div>
                <div><dt>Submitted reference</dt><dd>{vendor.evidence.registrationReference || "Declaration only"}</dd></div>
              </dl>
              {vendor.evidence.registrationType === "not_registered" && <div className="admin-evidence-declaration"><Landmark size={17} /><p><strong>Declaration only</strong><span>No government business-registration reference was submitted. Complete appropriate alternate business and identity checks before approval.</span></p></div>}
              <div className="admin-evidence-groups">
                <section><h4><Link2 size={15} /> Portfolio or work samples <small>{portfolioLinks.length}</small></h4><div>{portfolioLinks.map((link, index) => <a className="button button--small button--outline" href={link.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" key={`portfolio-${link.href}`}>Work sample {index + 1} · {link.hostname} <ExternalLink size={13} /></a>)}</div></section>
                <section><h4><Link2 size={15} /> Public review or reference links <small>{referenceLinks.length}</small></h4><div>{referenceLinks.map((link, index) => <a className="button button--small button--outline" href={link.href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" key={`reference-${link.href}`}>Reference {index + 1} · {link.hostname} <ExternalLink size={13} /></a>)}</div></section>
              </div>
              {safeEvidenceLinkCount !== evidenceLinkCount && <div className="admin-evidence-link-blocked"><ShieldAlert size={15} /> {evidenceLinkCount - safeEvidenceLinkCount} submitted link{evidenceLinkCount - safeEvidenceLinkCount === 1 ? " was" : "s were"} blocked because the destination is not safe to open.</div>}
              <div className="admin-evidence-external-warning"><ShieldAlert size={16} /><span>These external destinations are controlled by the applicant or another site. Check the hostname before opening and never enter Melaiva credentials there.</span></div>
            </div>
          ) : evidenceState === "legacy"
            ? <div className="admin-history-state"><CircleAlert size={18} /> No structured evidence snapshot is attached to this legacy application.</div>
            : <div className="admin-history-state admin-history-state--error"><CircleAlert size={18} /> Required structured evidence has not been submitted. Approval remains unavailable.</div>}
          <EvidenceRevisionHistory revisions={vendor.evidenceHistory} latestRevision={vendor.evidence?.revision || null} />
        </section>
      </div>

      <CurrentInformationRequest request={vendor.currentInformationRequest} />

      <ReviewHistory reviews={history} truncated={historyTruncated} loading={historyLoading} error={historyError} onRetry={onRetryHistory} />

      <section className="admin-decision-panel" aria-labelledby="admin-decision-panel-heading">
        <div><div className="eyebrow">Current review decision</div><h3 id="admin-decision-panel-heading">Choose the next accountable state.</h3><p>Every decision requires a reason and is checked against the Application version and Evidence revision you reviewed.</p>{evidenceBlocksApproval && <p className="admin-decision-panel__blocked" id="admin-evidence-approval-blocked"><CircleAlert size={14} /> Approval is unavailable until structured evidence is submitted.</p>}</div>
        <div className="admin-decision-panel__actions">
          {actions.map((action) => {
            const ActionIcon = action.tone === "danger" ? Ban : action.tone === "neutral" ? RotateCcw : action.tone === "information" ? CircleAlert : ShieldCheck;
            const actionAllowed = isAdminVendorActionAllowed(action, vendor);
            return <button key={action.id} className={`button ${action.tone === "danger" ? "admin-button--danger" : action.tone === "neutral" ? "button--outline" : action.tone === "information" ? "admin-button--information" : "button--primary"}`} type="button" disabled={!revisionReady || !requestRecordReady || !evidenceRecordReady || !actionAllowed} aria-describedby={!actionAllowed ? "admin-evidence-approval-blocked" : undefined} onClick={() => onDecision(action)}><ActionIcon size={16} /> {action.label}</button>;
          })}
        </div>
      </section>
    </article>
  );
}

export function AdminVendorsPage({ notify, onOpenAuth, authRevision = 0 }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedStatus = searchParams.get("status");
  const status = normalizeAdminVendorStatus(requestedStatus);
  const statusConfig = adminVendorStatusConfig(status);
  const [access, setAccess] = useState("checking");
  const [accessError, setAccessError] = useState("");
  const [accessRetryKey, setAccessRetryKey] = useState(0);
  const [adminUser, setAdminUser] = useState(null);
  const [vendors, setVendors] = useState([]);
  const [statusCounts, setStatusCounts] = useState(() => normalizeAdminStatusCounts());
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [detailVendor, setDetailVendor] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailRefreshKey, setDetailRefreshKey] = useState(0);
  const [history, setHistory] = useState([]);
  const [historyTruncated, setHistoryTruncated] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [decision, setDecision] = useState(null);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionError, setDecisionError] = useState("");
  const [decisionConflict, setDecisionConflict] = useState(false);
  const [decisionUnconfirmed, setDecisionUnconfirmed] = useState(false);
  const queueHeadingRef = useRef(null);
  const detailRef = useRef(null);
  const queueItemRefs = useRef(new Map());
  const statusTabRefs = useRef(new Map());
  const loadMoreControllerRef = useRef(null);
  const activeStatusRef = useRef(status);
  activeStatusRef.current = status;

  const clearPrivateState = useCallback(() => {
    setVendors([]);
    setSelectedId(null);
    setDetailVendor(null);
    setDetailError("");
    setHistory([]);
    setHistoryTruncated(false);
    setDecision(null);
    setDecisionConflict(false);
    setDecisionUnconfirmed(false);
    setNextCursor(null);
    setTotal(0);
  }, []);

  const applyAccessError = useCallback((error) => {
    if (Number(error?.status) === 401) {
      clearPrivateState(); setAdminUser(null); setAccess("guest"); return true;
    }
    if (Number(error?.status) === 403) {
      clearPrivateState(); setAdminUser(null); setAccess("forbidden"); return true;
    }
    return false;
  }, [clearPrivateState]);

  useEffect(() => () => loadMoreControllerRef.current?.abort(), []);

  useEffect(() => {
    if (requestedStatus === status) return;
    const params = new URLSearchParams(searchParams);
    params.set("status", status);
    setSearchParams(params, { replace: true });
  }, [requestedStatus, searchParams, setSearchParams, status]);

  useEffect(() => {
    if (access !== "ready") return undefined;
    const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth";
    const frame = window.requestAnimationFrame(() => statusTabRefs.current.get(status)?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior,
    }));
    return () => window.cancelAnimationFrame(frame);
  }, [access, status]);

  useEffect(() => {
    const controller = new AbortController();
    setAccess("checking"); setAccessError(""); clearPrivateState();
    async function checkAccess() {
      try {
        const compatible = await checkVendorApplicationEvidenceCompatibility({ signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!compatible) {
          setAdminUser(null); setAccess("upgrade"); return;
        }
        const response = await fetch("/api/v1/auth/me", { credentials: "include", signal: controller.signal });
        const payload = await readApiResponse(response, "Administrator access could not be checked.");
        if (controller.signal.aborted) return;
        if (payload.data?.user?.role !== "admin") {
          setAdminUser(null); setAccess("forbidden"); return;
        }
        setAdminUser(payload.data.user); setAccess("ready");
      } catch (error) {
        if (error?.name === "AbortError" || controller.signal.aborted) return;
        if (Number(error?.status) === 401) setAccess("guest");
        else if (Number(error?.status) === 403) setAccess("forbidden");
        else { setAccessError(error.message || "Secure staff-tool compatibility could not be checked."); setAccess("error"); }
      }
    }
    checkAccess();
    return () => controller.abort();
  }, [accessRetryKey, authRevision, clearPrivateState]);

  useEffect(() => {
    if (access !== "ready") return undefined;
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = null;
    const controller = new AbortController();
    setLoadingMore(false); setQueueLoading(true); setQueueError(""); setVendors([]); setSelectedId(null); setDetailVendor(null); setDetailError(""); setHistory([]); setHistoryTruncated(false); setDecision(null); setDecisionError(""); setDecisionConflict(false); setQuery(""); setNextCursor(null); setTotal(0);
    async function loadQueue() {
      try {
        const compatible = await checkVendorApplicationEvidenceCompatibility({ signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!compatible) {
          clearPrivateState(); setAdminUser(null); setAccess("upgrade"); return;
        }
        const params = new URLSearchParams({ status, limit: "50" });
        const response = await fetch(`/api/v1/admin/vendors?${params}`, { credentials: "include", headers: ADMIN_VENDOR_SUMMARY_HEADERS, signal: controller.signal });
        const payload = await readApiResponse(response, "Vendor applications could not be loaded.");
        if (controller.signal.aborted) return;
        if (!supportsAdminVendorSummaryContract(payload, response.headers.get("x-melaiva-admin-vendor-summary"))) {
          clearPrivateState(); setAdminUser(null); setAccess("upgrade"); return;
        }
        const data = Array.isArray(payload.data) ? payload.data.map(normalizeAdminVendorSummary) : [];
        setVendors(data);
        setStatusCounts(normalizeAdminStatusCounts(payload.meta?.statusCounts));
        setTotal(Number.isInteger(Number(payload.meta?.total)) ? Number(payload.meta.total) : data.length);
        setNextCursor(payload.meta?.nextCursor || null);
      } catch (error) {
        if (error?.name === "AbortError" || controller.signal.aborted) return;
        if (!applyAccessError(error)) setQueueError(error.message || "Vendor applications could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setQueueLoading(false);
      }
    }
    loadQueue();
    return () => controller.abort();
  }, [access, applyAccessError, clearPrivateState, refreshKey, status]);

  const selectedSummary = vendors.find((vendor) => vendor.id === selectedId) || null;
  const selectedVendor = detailVendor?.id === selectedId ? detailVendor : null;

  useEffect(() => {
    if (access !== "ready" || !selectedId) {
      setDetailVendor(null); setDetailError(""); setDetailLoading(false); return undefined;
    }
    const controller = new AbortController();
    setDetailVendor(null); setDetailLoading(true); setDetailError("");
    async function loadDetail() {
      try {
        const response = await fetch(`/api/v1/admin/vendors/${encodeURIComponent(selectedId)}`, { credentials: "include", signal: controller.signal });
        const payload = await readApiResponse(response, "Application detail could not be loaded.");
        if (!controller.signal.aborted && payload.data?.id === selectedId) {
          const normalizedDetail = normalizeVendorDetail(payload.data);
          const refreshedSummary = normalizeAdminVendorSummary({
            ...payload.data,
            informationRequestSummary: payload.data.currentInformationRequest,
          });
          setDetailVendor(normalizedDetail);
          setVendors((current) => current.map((vendor) => vendor.id === selectedId ? refreshedSummary : vendor));
        }
      } catch (error) {
        if (error?.name === "AbortError" || controller.signal.aborted) return;
        if (!applyAccessError(error)) setDetailError(error.message || "Application detail could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setDetailLoading(false);
      }
    }
    loadDetail();
    return () => controller.abort();
  }, [access, applyAccessError, detailRefreshKey, selectedId]);

  useEffect(() => {
    if (access !== "ready" || !selectedId) {
      setHistory([]); setHistoryTruncated(false); setHistoryError(""); setHistoryLoading(false); return undefined;
    }
    const controller = new AbortController();
    setHistoryLoading(true); setHistoryError(""); setHistory([]); setHistoryTruncated(false);
    async function loadHistory() {
      try {
        const response = await fetch(`/api/v1/admin/vendors/${encodeURIComponent(selectedId)}/reviews`, { credentials: "include", signal: controller.signal });
        const payload = await readApiResponse(response, "Decision history could not be loaded.");
        if (!controller.signal.aborted) {
          setHistory((Array.isArray(payload.data) ? payload.data : []).map(normalizeReview));
          setHistoryTruncated(Boolean(payload.meta?.truncated));
        }
      } catch (error) {
        if (error?.name === "AbortError" || controller.signal.aborted) return;
        if (!applyAccessError(error)) setHistoryError(error.message || "Decision history could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    }
    loadHistory();
    return () => controller.abort();
  }, [access, applyAccessError, historyRefreshKey, selectedId]);

  const visibleVendors = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return vendors;
    return vendors.filter((vendor) => [vendor.businessName, vendor.category, vendor.city]
      .filter(Boolean).join(" ").toLowerCase().includes(normalizedQuery));
  }, [query, vendors]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    const requestedStatus = status;
    const controller = new AbortController();
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = controller;
    setLoadingMore(true); setQueueError("");
    try {
      const compatible = await checkVendorApplicationEvidenceCompatibility({ signal: controller.signal });
      if (controller.signal.aborted || activeStatusRef.current !== requestedStatus) return;
      if (!compatible) {
        clearPrivateState(); setAdminUser(null); setAccess("upgrade"); return;
      }
      const params = new URLSearchParams({ status: requestedStatus, limit: "50", cursor: nextCursor });
      const response = await fetch(`/api/v1/admin/vendors?${params}`, { credentials: "include", headers: ADMIN_VENDOR_SUMMARY_HEADERS, signal: controller.signal });
      const payload = await readApiResponse(response, "More applications could not be loaded.");
      if (controller.signal.aborted || activeStatusRef.current !== requestedStatus) return;
      if (!supportsAdminVendorSummaryContract(payload, response.headers.get("x-melaiva-admin-vendor-summary"))) {
        clearPrivateState(); setAdminUser(null); setAccess("upgrade"); return;
      }
      const nextVendors = (Array.isArray(payload.data) ? payload.data : []).map(normalizeAdminVendorSummary);
      setVendors((current) => {
        const known = new Set(current.map((vendor) => vendor.id));
        return [...current, ...nextVendors.filter((vendor) => !known.has(vendor.id))];
      });
      setStatusCounts(normalizeAdminStatusCounts(payload.meta?.statusCounts));
      setTotal(Number.isInteger(Number(payload.meta?.total)) ? Number(payload.meta.total) : total);
      setNextCursor(payload.meta?.nextCursor || null);
    } catch (error) {
      if (error?.name === "AbortError" || controller.signal.aborted || activeStatusRef.current !== requestedStatus) return;
      if (!applyAccessError(error)) setQueueError(error.message || "More applications could not be loaded.");
    } finally {
      if (loadMoreControllerRef.current === controller) {
        loadMoreControllerRef.current = null;
        setLoadingMore(false);
      }
    }
  }

  function selectVendor(vendor) {
    setSelectedId(vendor.id);
    setDetailVendor(null);
    setDetailError("");
    if (window.matchMedia?.("(max-width: 860px)")?.matches) {
      const behavior = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth";
      window.requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: "start", behavior }));
    }
  }

  function openDecision(action) {
    if (!selectedVendor
      || !Number.isInteger(selectedVendor.revision)
      || (selectedVendor.status === "needs_information" && !selectedVendor.currentInformationRequest)
      || (selectedVendor.evidenceSummary && selectedVendor.evidence?.revision !== selectedVendor.evidenceSummary.revision)
      || !isAdminVendorActionAllowed(action, selectedVendor)) return;
    setDecisionError("");
    setDecisionConflict(false);
    setDecisionUnconfirmed(false);
    setDecision({ vendor: selectedVendor, action, idempotencyKey: createIdempotencyKey("vendor-review") });
  }

  const closeDecision = useCallback(() => {
    if (decisionBusy) return;
    setDecision(null); setDecisionError(""); setDecisionConflict(false);
    if (decisionUnconfirmed) setRefreshKey((value) => value + 1);
    setDecisionUnconfirmed(false);
  }, [decisionBusy, decisionUnconfirmed]);

  async function submitDecision({ reason, idempotencyKey, requestedFields, applicantMessage }) {
    if (!decision || decisionBusy || decisionConflict || !isAdminVendorActionAllowed(decision.action, decision.vendor)) return;
    setDecisionBusy(true); setDecisionError("");
    const reviewedVendor = decision.vendor;
    const targetStatus = decision.action.targetStatus;
    let mutationStarted = false;
    try {
      const compatible = await checkVendorApplicationEvidenceCompatibility();
      if (!compatible) {
        clearPrivateState(); setAdminUser(null); setAccess("upgrade"); return;
      }
      mutationStarted = true;
      const response = await fetch(`/api/v1/admin/vendors/${encodeURIComponent(reviewedVendor.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        credentials: "include",
        body: JSON.stringify({
          status: targetStatus,
          expectedStatus: reviewedVendor.status,
          expectedRevision: reviewedVendor.revision,
          reason,
          ...(targetStatus === "approved" && reviewedVendor.evidence
            ? {
                evidenceAcknowledged: true,
                expectedEvidenceRevision: reviewedVendor.evidence.revision,
              }
            : {}),
          ...(targetStatus === "needs_information"
            ? {
                expectedEvidenceRevision: reviewedVendor.evidence?.revision ?? reviewedVendor.evidenceSummary?.revision ?? 0,
                requestedFields,
                applicantMessage,
              }
            : {}),
        }),
      });
      const payload = await readApiResponse(response, "The review decision could not be saved.");
      if (activeStatusRef.current !== reviewedVendor.status) {
        setDecision(null);
        setDecisionConflict(false);
        setDecisionUnconfirmed(false);
        setRefreshKey((value) => value + 1);
        notify({
          title: "Partner decision saved",
          message: `${reviewedVendor.businessName} is now ${adminVendorStatusLabel(targetStatus).toLowerCase()}. The current queue was refreshed.`,
        });
        return;
      }
      const currentIndex = vendors.findIndex((vendor) => vendor.id === reviewedVendor.id);
      const remaining = vendors.filter((vendor) => vendor.id !== reviewedVendor.id);
      const nextVendor = remaining[Math.min(Math.max(currentIndex, 0), Math.max(remaining.length - 1, 0))] || null;
      setVendors(remaining);
      setTotal((current) => Math.max(0, current - 1));
      setStatusCounts((current) => payload.meta?.statusCounts
        ? normalizeAdminStatusCounts(payload.meta.statusCounts)
        : adjustAdminStatusCounts(current, reviewedVendor.status, targetStatus));
      setSelectedId(nextVendor?.id || null);
      setDetailVendor(null);
      setHistory([]);
      setHistoryTruncated(false);
      setDecision(null);
      setDecisionConflict(false);
      setDecisionUnconfirmed(false);
      notify({
        title: targetStatus === "approved" ? "Partner approval saved" : targetStatus === "needs_information" ? "Information request sent" : targetStatus === "pending" ? "Application returned to review" : targetStatus === "suspended" ? "Partner suspended" : "Application declined",
        message: `${reviewedVendor.businessName} is now ${adminVendorStatusLabel(targetStatus).toLowerCase()}.`,
      });
      window.setTimeout(() => (nextVendor ? queueItemRefs.current.get(nextVendor.id) : queueHeadingRef.current)?.focus?.(), 0);
    } catch (error) {
      if (!mutationStarted) {
        setDecisionError(decisionUnconfirmed
          ? "The secure service is still unavailable, so the earlier decision remains unconfirmed. The unchanged draft and secure submission key are preserved."
          : "Secure review compatibility could not be confirmed. No decision was saved.");
        return;
      }
      if (applyAccessError(error)) return;
      const failureState = classifyAdminVendorDecisionFailure(error);
      if (failureState === "idempotency_conflict") {
        setDecisionUnconfirmed(false);
        setDecisionConflict(true);
        setDecisionError("This secure submission key was already used for a different decision payload. Close this draft and review the latest application version before taking another action.");
      } else if (failureState === "application_changed") {
        setDecisionUnconfirmed(false);
        setDecisionConflict(true);
        setDecisionError("Application changed while this dialog was open. Your reason, applicant message and secure submission key are preserved. Close this dialog when you are ready to review the refreshed application version; this decision cannot be resubmitted against stale evidence.");
        setDetailRefreshKey((value) => value + 1);
        setHistoryRefreshKey((value) => value + 1);
        notify({ type: "warning", title: "Application changed", message: "The latest application detail is loading; your decision draft remains open and unchanged." });
      } else if (failureState === "unconfirmed") {
        setDecisionUnconfirmed(true);
        setDecisionError("We could not confirm whether this decision was saved. The draft is now locked so retrying reuses the exact same secure submission key and payload; you can also close it to refresh the queue first.");
      } else {
        setDecisionUnconfirmed(false);
        setDecisionError(error.message || "The review decision could not be saved.");
      }
    } finally { setDecisionBusy(false); }
  }

  if (access === "checking") return <AdminAccessState icon={LoaderCircle} eyebrow="Staff workspace" title="Checking administrator access" message="Confirming your secure session before loading partner information." />;
  if (access === "guest") return <AdminAccessState icon={LockKeyhole} eyebrow="Staff-only workspace" title="Sign in with an administrator account" message="Vendor applications contain private business and account details."><button className="button button--primary" type="button" onClick={onOpenAuth}>Sign in</button><Link className="button button--outline" to="/">Return home</Link></AdminAccessState>;
  if (access === "forbidden") return <AdminAccessState icon={ShieldAlert} eyebrow="Access restricted" title="Administrator access is required" message="This account cannot view or change private partner review records."><Link className="button button--primary" to="/dashboard">Open my account</Link><Link className="button button--outline" to="/">Return home</Link></AdminAccessState>;
  if (access === "upgrade") return <AdminAccessState icon={ShieldAlert} eyebrow="Staff tools temporarily paused" title="Refresh after the secure review upgrade" message="This version cannot confirm the protected vendor-review contract. No application data was loaded and no decision can be saved."><button className="button button--primary" type="button" onClick={() => setAccessRetryKey((value) => value + 1)}><RefreshCw size={16} /> Check again</button><Link className="button button--outline" to="/">Return home</Link></AdminAccessState>;
  if (access === "error") return <AdminAccessState icon={CircleAlert} eyebrow="Access check unavailable" title="The staff workspace could not be opened" message={accessError}><button className="button button--primary" type="button" onClick={() => setAccessRetryKey((value) => value + 1)}><RefreshCw size={16} /> Try again</button></AdminAccessState>;

  return (
    <div className="admin-page page-surface">
      <section className="admin-hero">
        <div className="shell admin-hero__inner">
          <div><div className="eyebrow eyebrow--light"><ShieldCheck size={15} /> Melaiva operations</div><h1>Vendor review</h1><p>Review the exact submitted evidence before granting marketplace approval.</p></div>
          <div className="admin-hero__session"><span><UserRound size={17} /></span><div><small>Signed in as administrator</small><strong>{adminUser?.name || adminUser?.email}</strong></div></div>
        </div>
      </section>

      <div className="shell admin-shell">
        <div className="admin-trust-note"><ShieldCheck size={18} /><p><strong>Private operations data</strong><span>Use application details and submitted evidence only for authorised partner review and support.</span></p></div>

        <nav className="admin-status-nav" aria-label="Vendor application status">
          {ADMIN_VENDOR_STATUSES.map((item) => {
            const count = statusCounts[item.id];
            return <button key={item.id} ref={(node) => { if (node) statusTabRefs.current.set(item.id, node); else statusTabRefs.current.delete(item.id); }} className={status === item.id ? "is-active" : ""} type="button" aria-pressed={status === item.id} onClick={() => {
              activeStatusRef.current = item.id;
              loadMoreControllerRef.current?.abort();
              const params = new URLSearchParams(searchParams);
              params.set("status", item.id);
              setSearchParams(params);
            }}><span>{item.label}</span>{count !== null && <small>{count}</small>}</button>;
          })}
        </nav>

        <div className="admin-workspace">
          <section className="admin-queue" aria-labelledby="admin-queue-heading">
            <header className="admin-queue__header">
              <div><div className="eyebrow">Oldest first</div><h2 id="admin-queue-heading" ref={queueHeadingRef} tabIndex="-1">{statusConfig.label}</h2><p>{queueLoading ? "Loading applications…" : `${total} application${total === 1 ? "" : "s"}`}</p></div>
              <button className="icon-button" type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={queueLoading} aria-label="Refresh vendor applications"><RefreshCw className={queueLoading ? "spin-icon" : ""} size={18} /></button>
            </header>
            {!queueLoading && vendors.length > 0 && <label className="admin-queue-search"><Search size={17} /><span className="sr-only">Filter loaded applications</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter loaded applications" /></label>}
            {queueError && <div className="admin-queue-error" role="alert"><CircleAlert size={18} /><p>{queueError}</p><button className="text-button" type="button" onClick={() => setRefreshKey((value) => value + 1)}>Retry</button></div>}
            {queueLoading ? <QueueSkeleton /> : visibleVendors.length ? (
              <div className="admin-queue__items">
                {visibleVendors.map((vendor) => (
                  <button
                    key={vendor.id}
                    ref={(node) => { if (node) queueItemRefs.current.set(vendor.id, node); else queueItemRefs.current.delete(vendor.id); }}
                    className={`admin-queue-card ${selectedId === vendor.id ? "is-selected" : ""}`}
                    type="button"
                    onClick={() => selectVendor(vendor)}
                    aria-current={selectedId === vendor.id ? "true" : undefined}
                    aria-expanded={selectedId === vendor.id}
                    aria-controls="admin-vendor-detail"
                  >
                    <span className="admin-queue-card__top"><AdminStatus status={vendor.status} /><small><CalendarDays size={13} /> {formatDate(vendor.createdAt)}</small></span>
                    <strong>{vendor.businessName}</strong>
                    <span className="admin-queue-card__meta"><span><Store size={14} /> {categoryLabel(vendor.category)}</span><span><MapPin size={14} /> {vendor.city}</span></span>
                    <span className="admin-queue-card__version">Application version {Number.isInteger(vendor.revision) ? vendor.revision : "unavailable"}</span>
                    <span className={`admin-queue-card__evidence ${vendor.evidenceSummary ? "is-ready" : "is-incomplete"}`}><FileCheck2 size={14} />{adminVendorEvidenceSummaryLabel(vendor)}</span>
                    {vendor.evidenceSummary && Number.isInteger(vendor.evidenceReviewedRevision) && vendor.evidenceSummary.revision > vendor.evidenceReviewedRevision && <span className="admin-queue-card__revision"><RefreshCw size={14} /> Revised since last review</span>}
                    {vendor.informationRequestSummary && <span className="admin-queue-card__request"><CircleAlert size={14} /><span>Request {vendor.informationRequestSummary.revision} · {vendor.informationRequestSummary.requestedFields.map(informationRequestFieldLabel).join(" · ")}</span></span>}
                    <span className="admin-queue-card__action">Review application <ArrowRight size={15} /></span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="admin-queue-empty"><span>{query ? <Search size={24} /> : <FileCheck2 size={24} />}</span><h3>{query ? "No loaded applications match" : statusConfig.emptyTitle}</h3><p>{query ? "Clear the local filter to return to this status queue." : statusConfig.emptyMessage}</p>{query && <button className="text-button" type="button" onClick={() => setQuery("")}>Clear filter</button>}</div>
            )}
            {nextCursor && !query && <button className="button button--outline admin-load-more" type="button" onClick={loadMore} disabled={loadingMore}>{loadingMore ? <LoaderCircle className="spin-icon" size={16} /> : null}{loadingMore ? "Loading…" : "Load more applications"}</button>}
          </section>

          <div className="admin-detail-column" ref={detailRef}>
            {selectedId && detailLoading
              ? <section className="admin-detail-empty" id="admin-vendor-detail" role="status"><span><LoaderCircle className="spin-icon" size={28} /></span><div className="eyebrow">Private application detail</div><h2>Loading {selectedSummary?.businessName || "application"}</h2><p>Retrieving the selected application and its evidence snapshot.</p></section>
              : selectedId && detailError
                ? <section className="admin-detail-empty" id="admin-vendor-detail" role="alert"><span><CircleAlert size={28} /></span><div className="eyebrow">Detail unavailable</div><h2>This application could not be opened</h2><p>{detailError}</p><button className="button button--primary" type="button" onClick={() => setDetailRefreshKey((value) => value + 1)}><RefreshCw size={15} /> Retry application</button></section>
                : selectedVendor
                  ? <VendorDetail vendor={selectedVendor} history={history} historyTruncated={historyTruncated} historyLoading={historyLoading} historyError={historyError} onRetryHistory={() => setHistoryRefreshKey((value) => value + 1)} onDecision={openDecision} />
                  : <section className="admin-detail-empty" id="admin-vendor-detail"><span><FileCheck2 size={28} /></span><div className="eyebrow">Evidence-backed review</div><h2>Select an application</h2><p>Open one queue item to retrieve its private details, submitted evidence and decision history.</p></section>}
          </div>
        </div>
      </div>

      {decision && <DecisionDialog key={`${decision.vendor.id}-${decision.action.id}`} decision={decision} busy={decisionBusy} blocked={decisionConflict} unconfirmed={decisionUnconfirmed} error={decisionError} onClose={closeDecision} onSubmit={submitDecision} />}
    </div>
  );
}
