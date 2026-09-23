import { finishGoogleSignIn } from "@/modules/auth/server/google";
export const runtime = "nodejs";
export async function GET(request: Request) { return finishGoogleSignIn(request, "admin"); }
