import { NextResponse, type NextRequest } from "next/server";
import { seoPolicy } from "@/modules/seo/config";
import { NOINDEX_HEADER, shouldNoIndexRequest } from "@/modules/seo/policy";

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  if (shouldNoIndexRequest(seoPolicy, request.nextUrl, request.headers.get("host"))) {
    response.headers.set("X-Robots-Tag", NOINDEX_HEADER);
  }
  return response;
}

export const config = {
  matcher: "/:path*",
};
