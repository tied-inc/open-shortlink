export interface RecordedDataPoint {
  blobs?: string[];
  doubles?: number[];
  indexes?: string[];
}

export class MockAnalytics {
  public writes: RecordedDataPoint[] = [];

  writeDataPoint(dp: RecordedDataPoint) {
    this.writes.push(dp);
  }

  clear() {
    this.writes = [];
  }
}

export function createMockAnalytics(): AnalyticsEngineDataset {
  return new MockAnalytics() as unknown as AnalyticsEngineDataset;
}

export function asMockAnalytics(
  dataset: AnalyticsEngineDataset,
): MockAnalytics {
  return dataset as unknown as MockAnalytics;
}
