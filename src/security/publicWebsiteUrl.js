function privateOrReservedHostname(value) {
  const hostname = String(value || "").toLowerCase().replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
  if (!hostname || !hostname.includes(".")) return true;
  if (["localhost", "0.0.0.0"].includes(hostname)) return true;
  if ([".localhost", ".local", ".internal", ".home", ".lan", ".corp", ".onion", ".test", ".example", ".invalid", ".arpa"]
    .some((suffix) => hostname.endsWith(suffix))) return true;
  if (hostname.includes(":")) return true;
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first, second] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && [0, 2, 168].includes(second))
    || (first === 198 && [18, 19, 51].includes(second))
    || (first === 203 && second === 0 && octets[2] === 113)
    || first >= 224;
}

export function parsePublicWebsiteUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" || url.username || url.password || privateOrReservedHostname(url.hostname)) return null;
    return { href: url.href, hostname: url.hostname.replace(/^www\./u, "") };
  } catch {
    return null;
  }
}
