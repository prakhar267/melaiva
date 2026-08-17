export const ADMIN_VENDOR_STATUSES = [
  {
    id: "pending",
    label: "Awaiting review",
    shortLabel: "Pending",
    emptyTitle: "The review queue is clear",
    emptyMessage: "New partner applications will appear here in oldest-first order.",
  },
  {
    id: "needs_information",
    label: "Needs information",
    shortLabel: "Needs info",
    emptyTitle: "No applications need updates",
    emptyMessage: "Applications waiting for applicant evidence revisions will appear here.",
  },
  {
    id: "approved",
    label: "Approved",
    shortLabel: "Approved",
    emptyTitle: "No approved partners yet",
    emptyMessage: "Applications approved by the partner team will appear here.",
  },
  {
    id: "rejected",
    label: "Declined",
    shortLabel: "Declined",
    emptyTitle: "No declined applications",
    emptyMessage: "Applications declined during review will appear here.",
  },
  {
    id: "suspended",
    label: "Suspended",
    shortLabel: "Suspended",
    emptyTitle: "No suspended partners",
    emptyMessage: "Partners paused by the operations team will appear here.",
  },
];

const STATUS_IDS = new Set(ADMIN_VENDOR_STATUSES.map((status) => status.id));

export const ADMIN_INFORMATION_REQUEST_FIELDS = Object.freeze([
  { id: "portfolio", label: "Portfolio or work samples" },
  { id: "references", label: "Public reviews or references" },
  { id: "registration", label: "Business-registration disclosure" },
]);

const INFORMATION_REQUEST_FIELD_IDS = new Set(ADMIN_INFORMATION_REQUEST_FIELDS.map((field) => field.id));

const REQUEST_INFORMATION_ACTION = Object.freeze({
  id: "request_information",
  targetStatus: "needs_information",
  label: "Request information",
  title: "Request revised evidence?",
  consequence: "The applicant will see your requested fields and instructions in their private workspace. Marketplace access stays locked until they submit a new immutable evidence revision.",
  acknowledgement: "I confirm the applicant-facing instructions are necessary, respectful and contain no private operational notes or sensitive identifiers.",
  tone: "information",
});

const ACTIONS_BY_STATUS = {
  pending: [
    {
      id: "approve",
      targetStatus: "approved",
      label: "Approve & publish",
      title: "Approve this partner?",
      consequence: "This publishes the listing as marketplace reviewed and makes the partner eligible for matched briefs and sealed offers.",
      acknowledgement: "I confirm the submitted evidence and any required alternate checks support this marketplace decision.",
      tone: "approve",
    },
    REQUEST_INFORMATION_ACTION,
    {
      id: "reject",
      targetStatus: "rejected",
      label: "Decline application",
      title: "Decline this application?",
      consequence: "The application will leave the active review queue and the partner will remain ineligible for private briefs and offers.",
      acknowledgement: "I reviewed the application and recorded a clear internal reason for declining it.",
      tone: "danger",
    },
  ],
  approved: [
    {
      id: "suspend",
      targetStatus: "suspended",
      label: "Suspend partner",
      title: "Suspend this partner?",
      consequence: "Open proposals will be withdrawn, direct invitations will become unavailable, and new award messages will pause while prior records remain readable.",
      acknowledgement: "I understand this immediately restricts the partner's marketplace activity.",
      tone: "danger",
    },
  ],
  suspended: [
    {
      id: "restore",
      targetStatus: "approved",
      label: "Restore approval",
      title: "Restore this partner?",
      consequence: "The reviewed listing will return to the marketplace and the partner can receive matched briefs and submit new offers again.",
      acknowledgement: "I confirm the suspension concern is resolved and the partner remains eligible for marketplace approval.",
      tone: "approve",
    },
  ],
  rejected: [
    REQUEST_INFORMATION_ACTION,
    {
      id: "reopen",
      targetStatus: "pending",
      label: "Return to review",
      title: "Return this application to review?",
      consequence: "The application will re-enter the active queue. It will not be published or marked marketplace reviewed until a later approval.",
      acknowledgement: "I confirm there is new information or a valid reason to reopen this application.",
      tone: "neutral",
    },
  ],
  needs_information: [
    {
      id: "cancel_information_request",
      targetStatus: "pending",
      label: "Cancel request",
      title: "Cancel this information request?",
      consequence: "The application will return to active review without a new evidence revision. The request remains in immutable history.",
      acknowledgement: "I confirm the request is no longer needed and the existing evidence can return to review.",
      tone: "neutral",
    },
    {
      id: "reject",
      targetStatus: "rejected",
      label: "Decline application",
      title: "Decline this application?",
      consequence: "The open information request will close and the applicant will remain ineligible for private briefs and offers.",
      acknowledgement: "I reviewed the application and recorded a clear internal reason for declining it.",
      tone: "danger",
    },
  ],
};

export function normalizeAdminVendorStatus(value) {
  return STATUS_IDS.has(value) ? value : "pending";
}

export function adminVendorStatusLabel(value) {
  return ADMIN_VENDOR_STATUSES.find((status) => status.id === value)?.label || "Unknown status";
}

export function adminVendorStatusConfig(value) {
  return ADMIN_VENDOR_STATUSES.find((status) => status.id === value) || ADMIN_VENDOR_STATUSES[0];
}

export function normalizeAdminVendorSummary(vendor) {
  const revision = vendor?.reviewRevision === null || vendor?.reviewRevision === undefined
    ? Number.NaN
    : Number(vendor.reviewRevision);
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
  const informationRequestRevision = vendor?.informationRequestSummary?.revision === null || vendor?.informationRequestSummary?.revision === undefined
    ? Number.NaN
    : Number(vendor.informationRequestSummary.revision);
  const informationRequestEvidenceRevision = vendor?.informationRequestSummary?.evidenceRevision === null || vendor?.informationRequestSummary?.evidenceRevision === undefined
    ? Number.NaN
    : Number(vendor.informationRequestSummary.evidenceRevision);
  const requestedFieldsValid = Array.isArray(vendor?.informationRequestSummary?.requestedFields)
    && vendor.informationRequestSummary.requestedFields.length >= 1
    && vendor.informationRequestSummary.requestedFields.length <= INFORMATION_REQUEST_FIELD_IDS.size
    && vendor.informationRequestSummary.requestedFields.every((field) => INFORMATION_REQUEST_FIELD_IDS.has(field))
    && new Set(vendor.informationRequestSummary.requestedFields).size
      === vendor.informationRequestSummary.requestedFields.length;
  const requestedFields = requestedFieldsValid
    ? [...vendor.informationRequestSummary.requestedFields]
    : [];
  const informationRequestSummary = vendor?.informationRequestSummary
    && Number.isInteger(informationRequestRevision)
    && informationRequestRevision >= 1
    && Number.isInteger(informationRequestEvidenceRevision)
    && informationRequestEvidenceRevision >= 0
    && requestedFieldsValid
    ? {
        revision: informationRequestRevision,
        evidenceRevision: informationRequestEvidenceRevision,
        requestedFields,
        requestedAt: typeof vendor.informationRequestSummary.requestedAt === "string"
          ? vendor.informationRequestSummary.requestedAt
          : null,
      }
    : null;
  return {
    id: typeof vendor?.id === "string" ? vendor.id : "",
    businessName: typeof vendor?.businessName === "string" ? vendor.businessName : "",
    // Contract compatibility should reject unknown statuses before this point.
    // Preserve an unknown value as non-actionable rather than turning it into pending.
    status: STATUS_IDS.has(vendor?.status) ? vendor.status : null,
    category: typeof vendor?.category === "string" ? vendor.category : "",
    city: typeof vendor?.city === "string" ? vendor.city : "",
    createdAt: typeof vendor?.createdAt === "string" ? vendor.createdAt : null,
    revision: Number.isInteger(revision) && revision >= 0 ? revision : null,
    evidenceReviewedRevision: Number.isInteger(evidenceReviewedRevision) && evidenceReviewedRevision >= 0
      ? evidenceReviewedRevision
      : null,
    evidenceRequired: vendor?.evidenceRequired === false ? false : true,
    evidenceSummary,
    informationRequestSummary,
  };
}

export function adminVendorActions(value) {
  return ACTIONS_BY_STATUS[value] || [];
}

export function adminVendorEvidenceState(vendor) {
  if (vendor && Object.hasOwn(vendor, "evidence")) {
    if (vendor.evidence) return "submitted";
    return vendor.evidenceRequired === false ? "legacy" : "required";
  }
  if (vendor?.evidenceSummary) return "submitted";
  return vendor?.evidenceRequired === false ? "legacy" : "required";
}

export function adminVendorEvidenceSummaryLabel(vendor) {
  if (vendor?.evidenceSummary) {
    const linkCount = vendor.evidenceSummary.portfolioUrlCount + vendor.evidenceSummary.referenceUrlCount;
    return `Evidence revision ${vendor.evidenceSummary.revision} · ${linkCount} submitted link${linkCount === 1 ? "" : "s"}`;
  }
  return adminVendorEvidenceState(vendor) === "legacy"
    ? "Legacy · no structured evidence"
    : "Evidence required · submission incomplete";
}

export function isAdminVendorActionAllowed(action, vendor) {
  if (!action || !STATUS_IDS.has(vendor?.status)) return false;
  if (!adminVendorActions(vendor.status).some((candidate) => candidate.id === action.id)) return false;
  if (action.targetStatus === "approved") {
    return vendor.status !== "needs_information" && adminVendorEvidenceState(vendor) !== "required";
  }
  return true;
}

function compactSensitiveToken(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/gu, "");
}

function reviewReasonContainsStoredEvidence(reason, vendor) {
  const lowerReason = reason.toLowerCase();
  const compactReason = compactSensitiveToken(reason);
  const evidenceUrls = [
    ...(Array.isArray(vendor?.evidence?.portfolioUrls) ? vendor.evidence.portfolioUrls : []),
    ...(Array.isArray(vendor?.evidence?.referenceUrls) ? vendor.evidence.referenceUrls : []),
  ];
  for (const evidenceUrl of evidenceUrls) {
    try {
      const url = new URL(evidenceUrl);
      const hostname = url.hostname.replace(/\.$/u, "").toLowerCase();
      if (
        lowerReason.includes(String(evidenceUrl).toLowerCase())
        || lowerReason.includes(hostname)
        || compactReason.includes(compactSensitiveToken(hostname))
      ) return true;
    } catch {
      return true;
    }
  }
  const registrationReference = compactSensitiveToken(vendor?.evidence?.registrationReference);
  return registrationReference.length >= 8 && compactReason.includes(registrationReference);
}

export function validateAdminReviewReason(value, vendor) {
  const reason = String(value || "").trim();
  if (reason.length < 10) return "Add an internal review reason of at least 10 characters.";
  if (reason.length > 1_000) return "Keep the internal review reason to 1,000 characters or fewer.";
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(reason)) {
    return "Remove control or bidirectional formatting characters from the review reason.";
  }
  if (
    /(?:https?:\/\/|www\.|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b|\b[0-9]{1,3}(?:\.[0-9]{1,3}){3}\b)/iu.test(reason)
    || /\b(?:[0-9][\s-]*){12}\b/u.test(reason)
    || /\b(?:[A-Z][\s-]*){5}(?:[0-9][\s-]*){4}[A-Z]\b/iu.test(reason)
    || /\b[A-Z][\s-]*(?:[0-9][\s-]*){7}\b/iu.test(reason)
    || /(?:\bUDYAM[\s-]*[A-Z]{2}[\s-]*[0-9]{2}[\s-]*[0-9]{7}\b|\b[LU][\s-]*[0-9]{5}[\s-]*[A-Z]{2}[\s-]*[0-9]{4}[\s-]*[A-Z]{3}[\s-]*[0-9]{6}\b|\b[0-9]{2}[\s-]*[A-Z]{5}[\s-]*[0-9]{4}[\s-]*[A-Z][\s-]*[1-9A-Z][\s-]*Z[\s-]*[0-9A-Z]\b)/iu.test(reason)
  ) {
    return "Do not include web addresses, IP addresses, identity numbers or business-registration references in the review reason.";
  }
  if (reviewReasonContainsStoredEvidence(reason, vendor)) {
    return "Do not copy submitted evidence addresses or registration references into the review reason.";
  }
  return "";
}

export function informationRequestFieldLabel(value) {
  return ADMIN_INFORMATION_REQUEST_FIELDS.find((field) => field.id === value)?.label || "Requested evidence";
}

export function focusFirstInvalidAdminDecisionControl(container) {
  const target = container?.querySelector?.(
    'input[aria-invalid="true"]:not(:disabled), select[aria-invalid="true"]:not(:disabled), textarea[aria-invalid="true"]:not(:disabled), button[aria-invalid="true"]:not(:disabled)',
  );
  if (!target || typeof target.focus !== "function") return false;
  target.focus();
  return true;
}

export function validateAdminInformationRequest({ requestedFields, applicantMessage } = {}, vendor) {
  const errors = {};
  const fieldValues = Array.isArray(requestedFields) ? requestedFields : [];
  const normalizedFields = fieldValues.filter((field) => INFORMATION_REQUEST_FIELD_IDS.has(field));
  const message = String(applicantMessage || "").trim();
  if (!normalizedFields.length) errors.requestedFields = "Choose at least one evidence area for the applicant to update.";
  else if (normalizedFields.length !== fieldValues.length) errors.requestedFields = "Choose only the listed evidence areas.";
  else if (new Set(normalizedFields).size !== normalizedFields.length) errors.requestedFields = "Choose each evidence area only once.";
  if (message.length < 20) errors.applicantMessage = "Add applicant-visible instructions of at least 20 characters.";
  else if (message.length > 1_000) errors.applicantMessage = "Keep applicant-visible instructions to 1,000 characters or fewer.";
  else if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(message)) {
    errors.applicantMessage = "Remove control or bidirectional formatting characters from the applicant instructions.";
  } else if (
    /(?:https?:\/\/|www\.|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b|\b[0-9]{1,3}(?:\.[0-9]{1,3}){3}\b)/iu.test(message)
    || /\b(?:[0-9][\s-]*){12}\b/u.test(message)
    || /\b(?:[A-Z][\s-]*){5}(?:[0-9][\s-]*){4}[A-Z]\b/iu.test(message)
    || /\b[A-Z][\s-]*(?:[0-9][\s-]*){7}\b/iu.test(message)
    || /(?:\bUDYAM[\s-]*[A-Z]{2}[\s-]*[0-9]{2}[\s-]*[0-9]{7}\b|\b[LU][\s-]*[0-9]{5}[\s-]*[A-Z]{2}[\s-]*[0-9]{4}[\s-]*[A-Z]{3}[\s-]*[0-9]{6}\b|\b[0-9]{2}[\s-]*[A-Z]{5}[\s-]*[0-9]{4}[\s-]*[A-Z][\s-]*[1-9A-Z][\s-]*Z[\s-]*[0-9A-Z]\b)/iu.test(message)
  ) {
    errors.applicantMessage = "Do not include web addresses, IP addresses, identity numbers or business-registration references in applicant instructions.";
  } else if (reviewReasonContainsStoredEvidence(message, vendor)) {
    errors.applicantMessage = "Do not copy submitted evidence addresses or registration references into applicant instructions.";
  }
  return errors;
}

export function adminVendorDecisionAcknowledgement(action, vendor) {
  if (action?.targetStatus === "needs_information") return action.acknowledgement;
  if (action?.targetStatus !== "approved") return action?.acknowledgement || "";
  if (!vendor?.evidence) {
    if (adminVendorEvidenceState(vendor) === "required") {
      return "Approval is unavailable until this application has a structured evidence snapshot.";
    }
    if (action?.id === "restore") {
      return "I confirm I completed and documented suitable work, reference and business checks for this legacy application, and the suspension concern is resolved before restoring marketplace approval.";
    }
    return "I confirm I completed and documented suitable work, reference and business checks for this legacy application before granting marketplace approval.";
  }
  return `I reviewed evidence revision ${vendor.evidence.revision}${vendor.evidence.registrationType === "not_registered" ? " and completed suitable alternate business checks" : ""}. ${action.acknowledgement}`;
}

export function adjustAdminStatusCounts(counts, fromStatus, toStatus) {
  const next = { ...(counts || {}) };
  if (STATUS_IDS.has(fromStatus)) next[fromStatus] = Math.max(0, Number(next[fromStatus] || 0) - 1);
  if (STATUS_IDS.has(toStatus)) next[toStatus] = Number(next[toStatus] || 0) + 1;
  return next;
}

export function classifyAdminVendorDecisionFailure(error) {
  if (error?.code === "idempotency_conflict") return "idempotency_conflict";
  if ([409, 412].includes(Number(error?.status))) return "application_changed";
  if (error instanceof TypeError || Boolean(error?.unavailable) || Number(error?.status || 0) >= 500) {
    return "unconfirmed";
  }
  return "failed";
}

export function normalizeAdminStatusCounts(counts) {
  return Object.fromEntries(ADMIN_VENDOR_STATUSES.map(({ id }) => {
    const value = counts?.[id] === null || counts?.[id] === undefined ? Number.NaN : Number(counts[id]);
    return [id, Number.isInteger(value) && value >= 0 ? value : null];
  }));
}
