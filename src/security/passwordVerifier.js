const KDF_CONTEXT = "melaiva:password:v1:";
const KDF_ITERATIONS = 310_000;

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function normalizeAuthEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isStrongPassword(password) {
  return typeof password === "string"
    && password.length >= 12
    && /[a-z]/u.test(password)
    && /[A-Z]/u.test(password)
    && /[0-9]/u.test(password);
}

export async function derivePasswordVerifier(email, password) {
  if (!globalThis.crypto?.subtle) throw new Error("Secure sign-in is not supported by this browser.");
  if (!isStrongPassword(password)) throw new Error("Use at least 12 characters with uppercase, lowercase and a number.");
  const encoder = new TextEncoder();
  const normalizedEmail = normalizeAuthEmail(email);
  const key = await globalThis.crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", iterations: KDF_ITERATIONS, salt: encoder.encode(`${KDF_CONTEXT}${normalizedEmail}`) },
    key,
    256,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

export const passwordKdf = "pbkdf2-sha256-v1";
