// Minimal in-memory KVNamespace mock. Implements only the methods used by the app.

interface StoredEntry {
  value: string;
  metadata?: unknown;
  expiresAt?: number;
}

export class MockKV {
  private data = new Map<string, StoredEntry>();
  private now = () => Date.now();
  getCallCount = 0;

  setClock(fn: () => number) {
    this.now = fn;
  }

  private isExpired(entry: StoredEntry): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= this.now();
  }

  async get(key: string, _options?: unknown): Promise<string | null> {
    this.getCallCount++;
    const entry = this.data.get(key);
    if (!entry || this.isExpired(entry)) {
      if (entry) this.data.delete(key);
      return null;
    }
    return entry.value;
  }

  async getWithMetadata<T = unknown>(
    key: string,
    _options?: unknown,
  ): Promise<{ value: string | null; metadata: T | null }> {
    this.getCallCount++;
    const entry = this.data.get(key);
    if (!entry || this.isExpired(entry)) {
      if (entry) this.data.delete(key);
      return { value: null, metadata: null };
    }
    return {
      value: entry.value,
      metadata: (entry.metadata ?? null) as T | null,
    };
  }

  async put(
    key: string,
    value: string,
    options?: { metadata?: unknown; expirationTtl?: number },
  ): Promise<void> {
    const expiresAt = options?.expirationTtl
      ? this.now() + options.expirationTtl * 1000
      : undefined;
    this.data.set(key, {
      value,
      metadata: options?.metadata,
      expiresAt,
    });
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list<T = unknown>(options?: {
    limit?: number;
    cursor?: string;
    prefix?: string;
  }): Promise<{
    keys: { name: string; metadata?: T }[];
    list_complete: boolean;
    cursor?: string;
  }> {
    const limit = options?.limit ?? 1000;
    const prefix = options?.prefix ?? "";
    const startAfter = options?.cursor ?? "";

    const allKeys = Array.from(this.data.entries())
      .filter(([key, entry]) => {
        if (!key.startsWith(prefix)) return false;
        if (this.isExpired(entry)) {
          this.data.delete(key);
          return false;
        }
        return true;
      })
      .sort(([a], [b]) => a.localeCompare(b));

    const startIndex = startAfter
      ? allKeys.findIndex(([key]) => key > startAfter)
      : 0;
    const effectiveStart = startIndex === -1 ? allKeys.length : startIndex;
    const page = allKeys.slice(effectiveStart, effectiveStart + limit);
    const listComplete = effectiveStart + limit >= allKeys.length;

    return {
      keys: page.map(([name, entry]) => ({
        name,
        metadata: entry.metadata as T | undefined,
      })),
      list_complete: listComplete,
      cursor: listComplete ? undefined : page[page.length - 1]?.[0],
    };
  }

  clear() {
    this.data.clear();
  }

  size() {
    return this.data.size;
  }
}

export function createMockKV(): KVNamespace {
  return new MockKV() as unknown as KVNamespace;
}

export function asMockKV(kv: KVNamespace): MockKV {
  return kv as unknown as MockKV;
}

// Creates a KV namespace that throws on every operation — useful for testing
// error paths in route handlers.
export function createBrokenKV(
  message = "simulated KV failure",
): KVNamespace {
  const err = new Error(message);
  const handler = {
    get: () => {
      throw err;
    },
  };
  return new Proxy({} as KVNamespace, {
    get: () => handler.get,
  });
}
