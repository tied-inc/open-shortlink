// URL validation for shortlink targets. Public shorteners are a convenient
// vector for SSRF / internal-network recon when clients follow the redirect
// from within a corporate network or from a cloud VM. We reject:
//   - non-http(s) schemes (javascript:, data:, file:, etc.)
//   - URLs carrying embedded credentials (user:pass@host)
//   - hosts that resolve to loopback / link-local / private / CGNAT / metadata
//     address ranges or obviously internal names (.local, .internal, bare
//     hostnames without a dot, localhost).

const MAX_URL_LENGTH = 2048;

const INTERNAL_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "broadcasthost",
]);

const INTERNAL_TLDS = [".local", ".internal", ".localhost", ".onion"];

export function isValidUrl(input: string): boolean {
  if (typeof input !== "string" || input.length === 0) return false;
  if (input.length > MAX_URL_LENGTH) return false;

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;

  // WHATWG URL preserves the enclosing brackets on hostname for IPv6 literals,
  // so strip them before pattern matching.
  const host = stripBrackets(url.hostname.toLowerCase());
  if (host === "") return false;

  if (INTERNAL_HOSTNAMES.has(host)) return false;
  if (INTERNAL_TLDS.some((tld) => host.endsWith(tld))) return false;
  if (!host.includes(".") && !isIpLiteral(host)) return false;

  if (isIpLiteral(host) && isInternalIp(host)) return false;

  return true;
}

function stripBrackets(host: string): string {
  if (host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1);
  }
  return host;
}

function isIpLiteral(host: string): boolean {
  if (host.includes(":")) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isInternalIp(host: string): boolean {
  if (host.includes(":")) return isInternalIpv6(host);
  return isInternalIpv4(host);
}

function isInternalIpv4(host: string): boolean {
  const parts = host.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    // Malformed literal; treat as not-allowed to be safe.
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  // 0.0.0.0/8        - "this network"
  if (a === 0) return true;
  // 10.0.0.0/8       - private
  if (a === 10) return true;
  // 127.0.0.0/8      - loopback
  if (a === 127) return true;
  // 169.254.0.0/16   - link-local (incl. AWS/GCP metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12    - private
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16   - private
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10    - CGNAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 224.0.0.0/4      - multicast
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4      - reserved (includes 255.255.255.255 broadcast)
  if (a >= 240) return true;
  return false;
}

function isInternalIpv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::" || h === "::1") return true;
  // fe80::/10 link-local, fc00::/7 unique local, ff00::/8 multicast.
  if (h.startsWith("fe80:") || h.startsWith("fe8") || h.startsWith("fe9")) return true;
  if (h.startsWith("fea") || h.startsWith("feb")) return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
  if (h.startsWith("ff")) return true;
  // IPv4-mapped (::ffff:a.b.c.d) — always represents a v4 endpoint, which the
  // shortener has no legitimate need to proxy through IPv6.
  if (h.includes("::ffff:")) return true;
  // NAT64 well-known prefix.
  if (h.startsWith("64:ff9b:")) return true;
  // IPv4-embedded at the end in dotted form (e.g. ::1.2.3.4).
  const v4Embedded = h.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4Embedded) return isInternalIpv4(v4Embedded[1]!);
  return false;
}
