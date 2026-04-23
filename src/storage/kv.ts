export interface LinkMetadata {
  createdAt: number;
  expiresAt?: number;
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
    const metadata: LinkMetadata = { createdAt: now, expiresAt };
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
        const url = (await this.kv.get(key.name)) ?? "";
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
