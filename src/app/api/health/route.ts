import { releaseMetadata } from "@/modules/release/metadata";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok", ...releaseMetadata() }, {
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
