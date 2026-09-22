import type { MetadataRoute } from "next";
import { seoPolicy } from "@/modules/seo/config";
import { robotsDocument } from "@/modules/seo/policy";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return robotsDocument(seoPolicy);
}
