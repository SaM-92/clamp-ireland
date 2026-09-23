import { signOut } from "@/modules/auth/server/session";
export async function POST(request: Request) { return signOut(request, "admin"); }
