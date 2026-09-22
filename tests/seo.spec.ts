import { expect, test } from "@playwright/test";
import {
  createSeoPolicy,
  NOINDEX_HEADER,
  parseSiteOrigin,
  PRIVATE_ROBOTS,
  publicPageMetadata,
  robotsDocument,
  shouldNoIndexRequest,
  sitemapDocument,
  websiteStructuredData,
} from "../src/modules/seo/policy";

// A syntax fixture only; no requests are sent to this domain.
const origin = "https://clamp-fixture.ie";
const production = {
  siteUrl: origin,
  allowIndexing: true,
  runtime: "production",
};

test.describe("SEO policy", () => {
  test("defaults to noindex without inventing an origin or canonical", () => {
    const policy = createSeoPolicy({});
    expect(policy).toEqual({ origin: null, indexEnabled: false });
    expect(publicPageMetadata(policy, "/", "Map", "Community map")).toEqual({
      title: "Map",
      description: "Community map",
      robots: PRIVATE_ROBOTS,
      openGraph: {
        title: "Map",
        description: "Community map",
        siteName: "Clamp Transparency Signal",
        type: "website",
        locale: "en_IE",
      },
    });
    expect(websiteStructuredData(policy)).toBeNull();
    expect(sitemapDocument(policy)).toEqual([]);
    expect(robotsDocument(policy)).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  test("accepts and normalises public HTTPS origins", () => {
    expect(parseSiteOrigin(undefined)).toBeNull();
    expect(parseSiteOrigin("")).toBeNull();
    expect(parseSiteOrigin(origin)).toBe(origin);
    expect(parseSiteOrigin(`${origin}/`)).toBe(origin);
    expect(parseSiteOrigin("https://CLAMP-FIXTURE.IE:443/")).toBe(origin);
    expect(parseSiteOrigin("https://www.clamp-fixture.ie")).toBe("https://www.clamp-fixture.ie");
  });

  test("rejects malformed explicit origins, even when indexing is disabled", () => {
    const invalidOrigins = [
      " ", ` ${origin}`, `${origin} `,
      "not-a-url", "//clamp-fixture.ie", "http://clamp-fixture.ie",
      "https://user:secret@clamp-fixture.ie", "https://@clamp-fixture.ie",
      `${origin}/appeal`, `${origin}/a/..`, `${origin}//`,
      `${origin}?query=1`, `${origin}?`, `${origin}#section`, `${origin}#`,
      "https:\\\\clamp-fixture.ie",
      "https://localhost", "https://sub.localhost", "https://app.local",
      "https://app.internal", "https://app.localdomain", "https://app.lan",
      "https://app.home.arpa", "https://app.test", "https://example.com",
      "https://app.example.org", "https://app.invalid", "https://server",
      "https://127.0.0.1", "https://127.1", "https://2130706433",
      "https://0x7f000001", "https://[::1]", "https://[fe80::1]",
      "https://10.0.0.1", "https://192.168.1.1", "https://169.254.169.254",
      "https://clamp-fixture.ie.", "https://bad_label.ie",
    ];
    for (const siteUrl of invalidOrigins) {
      expect(() => createSeoPolicy({ siteUrl, allowIndexing: false }), siteUrl).toThrow("Invalid SITE_URL:");
    }
  });

  test("requires opt-in, configured origin, production runtime and no Vercel preview", () => {
    expect(createSeoPolicy(production).indexEnabled).toBe(true);
    expect(createSeoPolicy({ ...production, vercelEnv: "production" }).indexEnabled).toBe(true);
    for (const configuration of [
      { ...production, allowIndexing: false },
      { ...production, allowIndexing: undefined },
      { ...production, siteUrl: "" },
      { ...production, runtime: "development" },
      { ...production, runtime: "test" },
      { ...production, runtime: undefined },
      { ...production, vercelEnv: "preview" },
      { ...production, vercelEnv: "development" },
      { ...production, vercelEnv: "" },
      { ...production, vercelEnv: "unknown" },
    ]) {
      const policy = createSeoPolicy(configuration);
      expect(policy.indexEnabled).toBe(false);
      expect(sitemapDocument(policy)).toEqual([]);
      expect(robotsDocument(policy)).toEqual({ rules: { userAgent: "*", disallow: "/" } });
      expect(shouldNoIndexRequest(policy, new URL(origin), "clamp-fixture.ie")).toBe(true);
    }
  });

  test("uses self-referential canonical and OG URLs, not fabricated dates or entities", () => {
    const policy = createSeoPolicy(production);
    for (const path of ["/", "/appeal"] as const) {
      expect(publicPageMetadata(policy, path, "Page title", "Page description")).toMatchObject({
        title: "Page title",
        description: "Page description",
        robots: { index: true, follow: true },
        alternates: { canonical: `${origin}${path}` },
        openGraph: { title: "Page title", description: "Page description", url: `${origin}${path}` },
      });
    }
    expect(sitemapDocument(policy)).toEqual([{ url: `${origin}/` }, { url: `${origin}/appeal` }]);
    expect(websiteStructuredData(policy)).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Clamp Transparency Signal",
      url: `${origin}/`,
      description: "A community reporting map for clamping hotspots in Ireland.",
    });
    const preview = createSeoPolicy({ ...production, vercelEnv: "preview" });
    expect(publicPageMetadata(preview, "/appeal", "Guide", "Description")).toMatchObject({
      robots: PRIVATE_ROBOTS,
      alternates: { canonical: `${origin}/appeal` },
    });
  });

  test("allows search but not GPTBot training, with private APIs excluded", () => {
    expect(robotsDocument(createSeoPolicy(production))).toEqual({
      rules: [
        { userAgent: "*", allow: "/", disallow: ["/api/", "/api$"] },
        { userAgent: "OAI-SearchBot", allow: "/", disallow: ["/api/", "/api$"] },
        { userAgent: "GPTBot", disallow: "/" },
      ],
      sitemap: `${origin}/sitemap.xml`,
    });
    // Auth/admin HTML is crawlable so robots meta/headers can actually be seen.
  });

  test("noindexes alternate hosts and all private route families without DB access", () => {
    const policy = createSeoPolicy(production);
    for (const path of ["/", "/appeal", "/appeal?source=map"]) {
      expect(shouldNoIndexRequest(policy, new URL(path, origin), "clamp-fixture.ie")).toBe(false);
    }
    for (const path of [
      "/admin", "/admin/", "/admin/moderation", "/ADMIN",
      "/auth", "/auth/sign-in", "/auth/callback", "/%61uth/sign-in",
      "/api", "/api/reports", "/api/admin/overview", "/api/moderation/reports",
      "/%FF",
    ]) {
      expect(shouldNoIndexRequest(policy, new URL(path, origin), "clamp-fixture.ie"), path).toBe(true);
    }
    for (const host of ["localhost:3001", "preview.clamp-fixture.ie", "clamp-fixture.vercel.app", "unrelated.ie"]) {
      expect(shouldNoIndexRequest(policy, new URL(origin), host)).toBe(true);
    }
    expect(shouldNoIndexRequest(policy, new URL("http://clamp-fixture.ie"), "clamp-fixture.ie")).toBe(true);
    expect(shouldNoIndexRequest(policy, new URL("https://preview.clamp-fixture.ie"), null)).toBe(true);
    expect(shouldNoIndexRequest(policy, new URL(origin), "CLAMP-FIXTURE.IE")).toBe(false);
  });
});

test.describe("unconfigured local server SEO", () => {
  test.use({ javaScriptEnabled: false });

  test("serves noindex public HTML without guessed canonicals or JSON-LD", async ({ page }) => {
    for (const path of ["/", "/appeal"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      expect(response?.headers()["x-robots-tag"]).toBe(NOINDEX_HEADER);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
      await expect(page.locator('meta[property="og:url"]')).toHaveCount(0);
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Clamp Transparency Signal/);
      await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", /clamping/);
      await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
    }
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Clamping appeal guide");
    await expect(page.getByRole("main")).toContainText("You must complete stage 1 before applying to the NTA.");
    await expect(page.getByRole("main")).toContainText("30 days of receiving that decision");
    await expect(page.getByRole("link", { name: "Open the official NTA appeal form", exact: true })).toHaveAttribute("href", "https://clampingregulation.nationaltransport.ie/appeal");
  });

  test("serves a disallow-all robots file and an empty sitemap by default", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(robots.headers()["content-type"]).toContain("text/plain");
    expect(await robots.text()).toMatch(/User-Agent: \*\s+Disallow: \//);
    expect(await robots.text()).not.toContain("Sitemap:");
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(sitemap.headers()["content-type"]).toContain("xml");
    expect(await sitemap.text()).toContain("<urlset");
    expect(await sitemap.text()).not.toContain("<loc>");
  });

  test("protects admin/auth responses with noindex headers and metadata", async ({ page, request }) => {
    for (const path of ["/auth/sign-in", "/admin", "/admin/moderation"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(path.startsWith("/admin") ? 404 : 200);
      expect(response?.headers()["x-robots-tag"]).toBe(NOINDEX_HEADER);
      const robots = page.locator('meta[name="robots"]');
      expect(await robots.count()).toBeGreaterThan(0);
      for (const tag of await robots.all()) await expect(tag).toHaveAttribute("content", /noindex/);
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    }
    const api = await request.get("/api/admin/overview");
    expect(api.status()).toBe(404);
    expect(api.headers()["x-robots-tag"]).toBe(NOINDEX_HEADER);
  });

  test("does not trust forwarded host claims", async ({ request }) => {
    const response = await request.get("/appeal", {
      headers: { "X-Forwarded-Host": "clamp-fixture.ie", "X-Forwarded-Proto": "https" },
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["x-robots-tag"]).toBe(NOINDEX_HEADER);
  });
});
