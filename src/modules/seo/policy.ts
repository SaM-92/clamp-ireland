import type { Metadata, MetadataRoute } from "next";

export type SeoPolicy = {
  origin: string | null;
  indexEnabled: boolean;
};

type SeoConfiguration = {
  siteUrl?: string;
  allowIndexing?: boolean;
  runtime?: string;
  vercelEnv?: string;
};

export const SITE_NAME = "Clamp Transparency Signal";
export const NOINDEX_HEADER = "noindex, nofollow, noarchive";
export const PRIVATE_ROBOTS = { index: false, follow: false, noarchive: true } as const;

export function parseSiteOrigin(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;

  const invalid = () => new Error(
    "Invalid SITE_URL: configure a public HTTPS origin only (for example, your verified domain), without credentials, a path, query or fragment. Local, IP and reserved domains are not allowed.",
  );
  // Check the raw form too: URL normalisation can erase paths such as /a/..
  if (!/^https:\/\/[^/?#@\\\s]+\/?$/i.test(value)) throw invalid();

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }

  const host = url.hostname;
  const labels = host.split(".");
  const reservedSuffixes = [
    "localhost", "local", "localdomain", "internal", "intranet", "lan",
    "home", "corp", "test", "invalid", "example", "onion", "arpa",
    "example.com", "example.net", "example.org",
  ];
  if (
    url.protocol !== "https:" || url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash ||
    host.length > 253 || labels.length < 2 ||
    labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ||
    !/^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/i.test(labels[labels.length - 1]) ||
    reservedSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
  ) {
    throw invalid();
  }
  return url.origin;
}

export function createSeoPolicy(configuration: SeoConfiguration): SeoPolicy {
  const origin = parseSiteOrigin(configuration.siteUrl);
  return {
    origin,
    indexEnabled: Boolean(
      origin &&
      configuration.allowIndexing === true &&
      configuration.runtime === "production" &&
      (configuration.vercelEnv === undefined || configuration.vercelEnv === "production"),
    ),
  };
}

export function publicPageMetadata(
  policy: SeoPolicy,
  path: "/" | "/appeal",
  title: string,
  description: string,
): Metadata {
  const url = policy.origin ? new URL(path, policy.origin).href : undefined;
  return {
    title,
    description,
    robots: policy.indexEnabled ? { index: true, follow: true } : PRIVATE_ROBOTS,
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: {
      title,
      description,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_IE",
      ...(url ? { url } : {}),
    },
  };
}

export function sitemapDocument(policy: SeoPolicy): MetadataRoute.Sitemap {
  if (!policy.indexEnabled || !policy.origin) return [];
  const origin = policy.origin;
  return ["/", "/appeal"].map((path) => ({ url: new URL(path, origin).href }));
}

export function robotsDocument(policy: SeoPolicy): MetadataRoute.Robots {
  if (!policy.indexEnabled || !policy.origin) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  const publicRules = { allow: "/", disallow: ["/api/", "/api$"] };
  return {
    rules: [
      { userAgent: "*", ...publicRules },
      { userAgent: "OAI-SearchBot", ...publicRules },
      { userAgent: "GPTBot", disallow: "/" },
    ],
    sitemap: new URL("/sitemap.xml", policy.origin).href,
  };
}

export function websiteStructuredData(policy: SeoPolicy) {
  if (!policy.origin) return null;
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: new URL("/", policy.origin).href,
    description: "A community reporting map for clamping hotspots in Ireland.",
  };
}

export function shouldNoIndexRequest(
  policy: SeoPolicy,
  requestUrl: URL,
  hostHeader: string | null,
): boolean {
  if (!policy.indexEnabled || !policy.origin) return true;
  const canonical = new URL(policy.origin);
  // Use the request authority, not an untrusted X-Forwarded-Host override.
  if (
    requestUrl.protocol !== canonical.protocol ||
    (hostHeader ?? requestUrl.host).toLowerCase() !== canonical.host
  ) return true;

  let pathname: string;
  try {
    pathname = decodeURIComponent(requestUrl.pathname).toLowerCase();
  } catch {
    return true;
  }
  return ["/admin", "/auth", "/api"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
