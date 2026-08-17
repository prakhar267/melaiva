export class ApiRequestError extends Error {
  constructor(message, { status = 0, code = "request_failed", details, unavailable = false } = {}) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.unavailable = unavailable;
  }
}

export async function readApiResponse(response, fallbackMessage = "We couldn’t complete that request.") {
  if (response.status === 204) return null;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiRequestError(fallbackMessage, {
      status: response.status,
      code: "unexpected_response",
      unavailable: true,
    });
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiRequestError(fallbackMessage, {
      status: response.status,
      code: "invalid_response",
      unavailable: true,
    });
  }

  if (!response.ok) {
    const detail = Array.isArray(payload?.error?.details)
      ? payload.error.details.map((item) => item.message || item).filter(Boolean).join(" ")
      : payload?.error?.details?.message;
    throw new ApiRequestError(detail || payload?.error?.message || fallbackMessage, {
      status: response.status,
      code: payload?.error?.code,
      details: payload?.error?.details,
      unavailable: response.status >= 500,
    });
  }

  return payload;
}

export function isServiceUnavailable(error) {
  return error instanceof TypeError || Boolean(error?.unavailable) || Number(error?.status || 0) >= 500;
}

export function createIdempotencyKey(prefix = "melaiva", cryptoProvider = globalThis.crypto) {
  const uuid = cryptoProvider?.randomUUID?.();
  if (uuid) return `${prefix}-${uuid}`;
  if (!cryptoProvider?.getRandomValues) {
    throw new Error("Secure random generation is unavailable in this browser.");
  }

  const bytes = new Uint8Array(16);
  cryptoProvider.getRandomValues(bytes);
  const randomPart = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${randomPart}`;
}
