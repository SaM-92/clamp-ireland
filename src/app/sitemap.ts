import type { MetadataRoute } from "next";
import { seoPolicy } from "@/modules/seo/config";
import { sitemapDocument } from "@/modules/seo/policy";

export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapDocument(seoPolicy);
}
