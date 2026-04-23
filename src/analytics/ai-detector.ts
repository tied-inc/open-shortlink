const AI_USER_AGENT_PATTERNS = [
  "GPTBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "PerplexityBot",
  "Bytespider",
  "Applebot-Extended",
  "Google-Extended",
  "CCBot",
  "anthropic-ai",
  "cohere-ai",
  "meta-externalagent",
];

export function isAiUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return AI_USER_AGENT_PATTERNS.some((pattern) =>
    userAgent.includes(pattern),
  );
}

export function detectAiBot(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  return (
    AI_USER_AGENT_PATTERNS.find((pattern) => userAgent.includes(pattern)) ??
    null
  );
}
