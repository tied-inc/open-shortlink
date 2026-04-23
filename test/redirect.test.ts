import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Bindings } from "../src/bindings";
import { redirectRoute } from "../src/routes/redirect";
import { LinkStore } from "../src/storage/kv";
import { asMockAnalytics } from "./helpers/mock-analytics";
import { createTestCtx, createTestEnv } from "./helpers/test-app";

function buildApp() {
  const app = new Hono<{ Bindings: Bindings }>();
  app.route("/", redirectRoute);
  return app;
}

async function seed(env: Bindings, slug: string, url: string) {
  await new LinkStore(env.SHORTLINKS).put(slug, url);
}

describe("GET /:slug", () => {
  let app: ReturnType<typeof buildApp>;
  let env: Bindings;

  beforeEach(() => {
    app = buildApp();
    env = createTestEnv();
  });

  test("redirects to stored URL with 302", async () => {
    await seed(env, "abc", "https://example.com/target");

    const res = await app.request(
      "/abc",
      { method: "GET" },
      env,
      createTestCtx(),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/target");
  });

  test("returns 404 for unknown slug", async () => {
    const res = await app.request(
      "/missing",
      { method: "GET" },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(404);
  });

  test("records click in Analytics Engine", async () => {
    await seed(env, "abc", "https://example.com");

    await app.request(
      "/abc",
      {
        method: "GET",
        headers: {
          referer: "https://twitter.com/post",
          "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.0)",
        },
      },
      env,
      createTestCtx(),
    );

    const writes = asMockAnalytics(env.ANALYTICS).writes;
    expect(writes).toHaveLength(1);
    const write = writes[0]!;
    expect(write.blobs?.[0]).toBe("abc"); // slug
    expect(write.blobs?.[1]).toBe("https://twitter.com/post"); // referer
    expect(write.blobs?.[4]).toBe("ai"); // AI flag (GPTBot)
    expect(write.doubles?.[0]).toBeGreaterThan(0); // timestamp
  });

  test("records human access when UA is not AI", async () => {
    await seed(env, "abc", "https://example.com");

    await app.request(
      "/abc",
      {
        method: "GET",
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        },
      },
      env,
      createTestCtx(),
    );

    const writes = asMockAnalytics(env.ANALYTICS).writes;
    expect(writes[0]?.blobs?.[4]).toBe("human");
  });

  test("handles missing referer and user-agent", async () => {
    await seed(env, "abc", "https://example.com");

    const res = await app.request(
      "/abc",
      { method: "GET" },
      env,
      createTestCtx(),
    );

    expect(res.status).toBe(302);
    const writes = asMockAnalytics(env.ANALYTICS).writes;
    expect(writes[0]?.blobs?.[1]).toBe(""); // empty referer
    expect(writes[0]?.blobs?.[3]).toBe(""); // empty UA
    expect(writes[0]?.blobs?.[4]).toBe("human");
  });
});
