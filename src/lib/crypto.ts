// Constant-time comparison over UTF-8 bytes. Operates on equal-length padded
// buffers so the loop runs for max(a,b) iterations regardless of input length,
// avoiding length-based timing leaks that a naive `if (a.length !== b.length)
// return false` would introduce.
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const len = Math.max(aBytes.length, bBytes.length, 1);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}
