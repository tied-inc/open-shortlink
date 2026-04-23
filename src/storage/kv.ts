export interface LinkMetadata {
  createdAt: number;
  expiresAt?: number;
  // Embedded when the serialized metadata fits within the KV metadata budget,
  // so that `list` can return URLs without an extra `kv.get` per key.
  url?: string;
}

export interface Link {
  slug: string;
  url: string;
  createdAt: number;
  expiresAt?: number;
}

export interface ListResult {
  links: Link[];
  cursor?: string;
}

// Cloudflare KV metadata is capped at 1024 bytes of JSON. Leave a small margin
// for JSON-escape overhead on URLs that contain characters like quotes.
const KV_METADATA_LIMIT = 1024;
const KV_METADATA_MARGIN = 16;

function buildMetadata(
  createdAt: number,
  expiresAt: number | undefined,
  url: string,
): LinkMetadata {
  const withUrl: LinkMetadata = { createdAt, expiresAt, url };
  const size = new TextEncoder().encode(JSON.stringify(withUrl)).length;
  if (size <= KV_METADATA_LIMIT - KV_METADATA_MARGIN) return withUrl;
  return { createdAt, expiresAt };
}

export class LinkStore {
  constructor(private readonly kv: KVNamespace) {}

  async get(slug: string): Promise<Link | null> {
    const { value, metadata } = await this.kv.getWithMetadata<LinkMetadata>(
      slug,
    );
    if (value === null) return null;
    return {
      slug,
      url: value,
      createdAt: metadata?.createdAt ?? 0,
      expiresAt: metadata?.expiresAt,
    };
  }

  async exists(slug: string): Promise<boolean> {
    const value = await this.kv.get(slug);
    return value !== null;
  }

  async put(slug: string, url: string, expiresIn?: number): Promise<Link> {
    const now = Date.now();
    const expiresAt = expiresIn ? now + expiresIn * 1000 : undefined;
    const metadata = buildMetadata(now, expiresAt, url);
    await this.kv.put(slug, url, {
      metadata,
      ...(expiresIn ? { expirationTtl: expiresIn } : {}),
    });
    return { slug, url, createdAt: now, expiresAt };
  }

  async delete(slug: string): Promise<void> {
    await this.kv.delete(slug);
  }

  async list(limit = 20, cursor?: string): Promise<ListResult> {
    const result = await this.kv.list<LinkMetadata>({
      limit: Math.min(limit, 100),
      cursor,
    });

    const links: Link[] = await Promise.all(
      result.keys.map(async (key) => {
        const embedded = key.metadata?.url;
        const url = embedded ?? (await this.kv.get(key.name)) ?? "";
        return {
          slug: key.name,
          url,
          createdAt: key.metadata?.createdAt ?? 0,
          expiresAt: key.metadata?.expiresAt,
        };
      }),
    );

    return {
      links,
      cursor: result.list_complete ? undefined : result.cursor,
    };
  }
}
