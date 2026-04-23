import { LinkStore, type Link } from "../storage/kv";
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
}

export interface LinkResponse extends Link {
  shortUrl: string;
}

const MAX_GENERATE_ATTEMPTS = 5;

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

  async create(input: CreateLinkInput): Promise<LinkResponse> {
    if (!isValidUrl(input.url)) {
      throw new LinkValidationError("invalid url");
    }
    if (this.isSelfHost(input.url)) {
      throw new LinkValidationError(
        "target must not point to this shortener",
      );
    }
    if (input.expiresIn !== undefined && input.expiresIn <= 0) {
      throw new LinkValidationError("expiresIn must be positive");
    }

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

    const link = await this.store.put(slug, input.url, input.expiresIn);
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
