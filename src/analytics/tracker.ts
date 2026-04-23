import { isAiUserAgent } from "./ai-detector";

export interface ClickEvent {
  slug: string;
  referer: string;
  country: string;
  userAgent: string;
}

export function trackClick(
  dataset: AnalyticsEngineDataset,
  event: ClickEvent,
): void {
  const isAi = isAiUserAgent(event.userAgent);
  dataset.writeDataPoint({
    blobs: [
      event.slug,
      event.referer,
      event.country,
      event.userAgent,
      isAi ? "ai" : "human",
    ],
    doubles: [Date.now()],
    indexes: [event.slug],
  });
}
