import { LinkStore, type GeoVariants, type Link } from "../storage/kv";
import { generateSlug, isValidSlug } from "../lib/slug";
import { isValidUrl } from "../lib/validate";

export class LinkConflictError extends Error {
  constructor(slug: string) {
    super(`slug already exists: ${slug}`);
    this.name = "LinkConflictError";
  }
}

export class LinkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkValidationError";
  }
}

export class LinkNotFoundError extends Error {
  constructor(slug: string) {
    super(`link not found: ${slug}`);
    this.name = "LinkNotFoundError";
  }
}

export interface CreateLinkInput {
  url: string;
  slug?: string;
  expiresIn?: number;
  geo?: Record<string, string>;
}

export interface LinkResponse extends Link {
  shortUrl: string;
}

const MAX_GENERATE_ATTEMPTS = 5;
const COUNTRY_CODE_RE = /^[A-Z]{2}$/;

export class LinkService {
  constructor(
    private readonly store: LinkStore,
    private readonly baseUrl: string,
  ) {}

  private toResponse(link: Link): LinkResponse {
    return { ...link, shortUrl: `${this.baseUrl}/${link.slug}` };
  }

  private isSelfHost(target: string): boolean {
    try {
      return new URL(target).host === new URL(this.baseUrl).host;
    } catch {
      return false;
    }
  }

  private validateTarget(url: string, label: string): void {
    if (!isValidUrl(url)) {
      throw new LinkValidationError(`invalid url: ${label}`);
    }
    if (this.isSelfHost(url)) {
      throw new LinkValidationError(
        `target must not point to this shortener: ${label}`,
      );
    }
  }

  private normalizeGeo(
    geo: Record<string, string> | undefined,
  ): GeoVariants | undefined {
    if (geo === undefined) return undefined;
    const entries = Object.entries(geo);
    if (entries.length === 0) return undefined;
    const normalized: GeoVariants = {};
    for (const [rawCode, url] of entries) {
      const code = rawCode.toUpperCase();
      if (!COUNTRY_CODE_RE.test(code)) {
        throw new LinkValidationError(
          `invalid country code (expected ISO 3166-1 alpha-2): ${rawCode}`,
        );
      }
      if (typeof url !== "string") {
        throw new LinkValidationError(`geo[${code}] must be a string`);
      }
      this.validateTarget(url, `geo[${code}]`);
      normalized[code] = url;
    }
    return normalized;
  }

  async create(input: CreateLinkInput): Promise<LinkResponse> {
    this.validateTarget(input.url, "url");
    if (input.expiresIn !== undefined && input.expiresIn <= 0) {
      throw new LinkValidationError("expiresIn must be positive");
    }
    const geo = this.normalizeGeo(input.geo);

    let slug = input.slug;
    if (slug !== undefined) {
      if (!isValidSlug(slug)) {
        throw new LinkValidationError("invalid slug");
      }
      if (await this.store.exists(slug)) {
        throw new LinkConflictError(slug);
      }
    } else {
      for (let i = 0; i < MAX_GENERATE_ATTEMPTS; i++) {
        const candidate = generateSlug();
        if (!(await this.store.exists(candidate))) {
          slug = candidate;
          break;
        }
      }
      if (!slug) {
        throw new Error("failed to generate unique slug");
      }
    }

    const link = await this.store.put(slug, input.url, input.expiresIn, geo);
    return this.toResponse(link);
  }

  async get(slug: string): Promise<LinkResponse> {
    const link = await this.store.get(slug);
    if (!link) throw new LinkNotFoundError(slug);
    return this.toResponse(link);
  }

  async list(limit?: number, cursor?: string) {
    const result = await this.store.list(limit, cursor);
    return {
      links: result.links.map((l) => this.toResponse(l)),
      cursor: result.cursor,
    };
  }

  async delete(slug: string): Promise<void> {
    const exists = await this.store.exists(slug);
    if (!exists) throw new LinkNotFoundError(slug);
    await this.store.delete(slug);
  }
}
