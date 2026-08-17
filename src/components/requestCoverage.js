const CONTROL_OR_BIDI_PATTERN = /[\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;

export function normalizeEligibleVendorCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const count = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export function requestCoverageCopy(value, stage = "draft") {
  const count = normalizeEligibleVendorCount(value);
  const published = stage === "success" || stage === "replay";
  const replayPrefix = stage === "replay"
    ? "This retry confirmed the original publish without creating another request. "
    : "";
  if (count === null) {
    return {
      count,
      tone: "unknown",
      title: stage === "replay" ? "Your original brief is confirmed" : stage === "success" ? "Your brief is open" : "Live coverage is still being checked",
      message: published
        ? `${replayPrefix}Coverage was not recorded with the publish response. Check your dashboard for the current window before expecting an offer; responses are not guaranteed.`
        : "You can continue, but do not expect an offer until the live response pool is confirmed.",
    };
  }
  if (count === 0) {
    return {
      count,
      tone: "warning",
      title: published
        ? "No reviewed partner matched when this brief opened"
        : "No reviewed partner currently matches this service and city",
      message: published
        ? `${replayPrefix}That count is the publish-time snapshot, not current availability. Check your dashboard for the live response window; Melaiva does not send coverage notifications yet.`
        : "You can still save and open this brief, but no response is currently expected. Coverage may change if a matching partner is approved before the offer window closes.",
    };
  }
  const partnerLabel = `${count} marketplace-reviewed partner${count === 1 ? "" : "s"}`;
  return {
    count,
    tone: "ready",
    title: published
      ? `${partnerLabel} matched when this brief opened`
      : `${partnerLabel} currently match this service and city`,
    message: published
      ? `${replayPrefix}That count is the publish-time snapshot, not current availability. It is not a response guarantee. Check your dashboard for the live window; Melaiva does not send email or push notifications yet.`
      : "They can see the brief after it is published, but availability, fit and a response are not guaranteed.",
  };
}

export function requestPrefillFromSearch(searchParams, { categoryIds, cityNames, now = Date.now() }) {
  const category = String(searchParams.get("category") || "").trim();
  const city = String(searchParams.get("city") || "").trim();
  const eventDate = String(searchParams.get("date") || "").trim();
  const guests = Number(searchParams.get("guests"));
  const validDate = /^\d{4}-\d{2}-\d{2}$/u.test(eventDate)
    && new Date(`${eventDate}T23:59:59`).getTime() > now;
  return {
    ...(categoryIds.includes(category) ? { categories: [category] } : {}),
    ...(cityNames.includes(city) && !CONTROL_OR_BIDI_PATTERN.test(city) ? { city } : {}),
    ...(validDate ? { eventDate } : {}),
    ...(Number.isInteger(guests) && guests >= 20 && guests <= 5_000 ? { guestCount: String(guests) } : {}),
  };
}

export function marketplaceRequestHref({ category, city, date, guests, vendor } = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ category, city, date, guests, vendor })) {
    const normalized = String(value || "").trim();
    if (normalized && !CONTROL_OR_BIDI_PATTERN.test(normalized)) params.set(key, normalized);
  }
  const query = params.toString();
  return query ? `/request?${query}` : "/request";
}

export function marketplaceVendorRequestHref(vendor, context = {}, { demo = false } = {}) {
  return marketplaceRequestHref({
    category: context.category || vendor?.category,
    city: context.city,
    date: context.date,
    guests: context.guests,
    vendor: demo ? "" : vendor?.slug,
  });
}

export function marketplaceEmptyStateCopy({ baseInventoryAvailable, preview = false, scope = "" }) {
  const normalizedScope = String(scope || "").trim();
  if (preview) {
    return {
      kind: "preview",
      title: "No example listings match every active filter",
      message: "The live catalog could not be reached, and none of the labelled preview listings match these browsing filters. Clear the filters or continue to the request builder, where live coverage will be checked again.",
    };
  }
  if (baseInventoryAvailable === false) {
    return {
      kind: "inventory",
      title: `No reviewed partners match ${normalizedScope || "this service and city"} yet`,
      message: "Partner inventory is opening city by city. Carry these details into a brief and the request builder will check the live response pool without promising an offer.",
    };
  }
  return {
    kind: "filters",
    title: "No partners match every active filter",
    message: `Partners are available${normalizedScope ? ` for ${normalizedScope}` : " in the catalog"}, but the current search, starting-budget, or review filters narrow this list to zero. Broaden or clear the browsing filters; request coverage checks the full approved service-and-city pool.`,
  };
}
