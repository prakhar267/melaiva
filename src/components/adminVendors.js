export const ADMIN_VENDOR_STATUSES = [
  {
    id: "pending",
    label: "Awaiting review",
    shortLabel: "Pending",
    emptyTitle: "The review queue is clear",
    emptyMessage: "New partner applications will appear here in oldest-first order.",
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

const ACTIONS_BY_STATUS = {
  pending: [
    {
      id: "approve",
      targetStatus: "approved",
      label: "Approve & publish",
      title: "Approve this partner?",
      consequence: "This publishes the listing with a Melaiva verified badge and makes the partner eligible for matched briefs and sealed offers.",
      acknowledgement: "I confirm the required identity, work and business checks were completed outside this form.",
      tone: "approve",
    },
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
      consequence: "The verified listing will return to the marketplace and the partner can receive matched briefs and submit new offers again.",
      acknowledgement: "I confirm the suspension concern is resolved and the partner remains eligible for verification.",
      tone: "approve",
    },
  ],
  rejected: [
    {
      id: "reopen",
      targetStatus: "pending",
      label: "Return to review",
      title: "Return this application to review?",
      consequence: "The application will re-enter the active queue. It will not be published or marked verified until a later approval.",
      acknowledgement: "I confirm there is new information or a valid reason to reopen this application.",
      tone: "neutral",
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

export function adminVendorActions(value) {
  return ACTIONS_BY_STATUS[value] || [];
}

export function validateAdminReviewReason(value) {
  const reason = String(value || "").trim();
  if (reason.length < 10) return "Add an internal review reason of at least 10 characters.";
  if (reason.length > 1_000) return "Keep the internal review reason to 1,000 characters or fewer.";
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u.test(reason)) {
    return "Remove control or bidirectional formatting characters from the review reason.";
  }
  return "";
}

export function adjustAdminStatusCounts(counts, fromStatus, toStatus) {
  const next = { ...(counts || {}) };
  if (STATUS_IDS.has(fromStatus)) next[fromStatus] = Math.max(0, Number(next[fromStatus] || 0) - 1);
  if (STATUS_IDS.has(toStatus)) next[toStatus] = Number(next[toStatus] || 0) + 1;
  return next;
}

export function normalizeAdminStatusCounts(counts) {
  return Object.fromEntries(ADMIN_VENDOR_STATUSES.map(({ id }) => {
    const value = Number(counts?.[id]);
    return [id, Number.isInteger(value) && value >= 0 ? value : null];
  }));
}
