export interface LinkMetadata {
  createdAt: number;
  expiresAt?: number;
  // Embedded when the serialized metadata fits within the KV metadata budget,
  // so that `list` can return URLs without an extra `kv.get` per key.
  url?: string;
}

export type GeoVariants = Record<string, string>;

export interface Link {
  slug: string;
  url: string;
  createdAt: number;
  expiresAt?: number;
  geo?: GeoVariants;
}

export interface ListResult {
  links: Link[];
  cursor?: string;
}

// Cloudflare KV metadata is capped at 1024 bytes of JSON. Leave a small margin
// for JSON-escape overhead on URLs that contain characters like quotes.
const KV_METADATA_LIMIT = 1024;
const KV_METADATA_MARGIN = 16;

interface StoredEnvelope {
  u: string;
  g: GeoVariants;
}

function serializeValue(url: string, geo: GeoVariants | undefined): string {
  if (!geo || Object.keys(geo).length === 0) return url;
  const envelope: StoredEnvelope = { u: url, g: geo };
  return JSON.stringify(envelope);
}

function parseValue(value: string): { url: string; geo?: GeoVariants } {
  if (value.length > 0 && value[0] === "{") {
    try {
      const parsed = JSON.parse(value) as Partial<StoredEnvelope>;
      if (typeof parsed.u === "string" && parsed.g && typeof parsed.g === "object") {
        return { url: parsed.u, geo: parsed.g };
      }
    } catch {
      // Not a JSON envelope — fall through to raw URL.
    }
  }
  return { url: value };
}

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
    const { url, geo } = parseValue(value);
    return {
      slug,
      url,
      geo,
      createdAt: metadata?.createdAt ?? 0,
      expiresAt: metadata?.expiresAt,
    };
  }

  async exists(slug: string): Promise<boolean> {
    const value = await this.kv.get(slug);
    return value !== null;
  }

  async put(
    slug: string,
    url: string,
    expiresIn?: number,
    geo?: GeoVariants,
  ): Promise<Link> {
    const now = Date.now();
    const expiresAt = expiresIn ? now + expiresIn * 1000 : undefined;
    const hasGeo = geo !== undefined && Object.keys(geo).length > 0;
    const metadata = buildMetadata(now, expiresAt, url);
    const storedValue = serializeValue(url, geo);
    await this.kv.put(slug, storedValue, {
      metadata,
      ...(expiresIn ? { expirationTtl: expiresIn } : {}),
    });
    return {
      slug,
      url,
      createdAt: now,
      expiresAt,
      ...(hasGeo ? { geo } : {}),
    };
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
        let url = embedded;
        if (url === undefined) {
          const raw = (await this.kv.get(key.name)) ?? "";
          url = parseValue(raw).url;
        }
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
