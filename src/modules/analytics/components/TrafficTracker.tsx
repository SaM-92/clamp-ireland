import "server-only";
import { connection } from "next/server";
import { isTrafficEnabled } from "../server/config";
import { TrafficTrackerClient } from "./TrafficTrackerClient";

/** Server component: no props or public environment flag. Mount once in the root layout. */
export async function TrafficTracker() {
  await connection();
  return isTrafficEnabled() ? <TrafficTrackerClient /> : null;
}
