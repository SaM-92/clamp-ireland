"use client";

import { useEffect, useState } from "react";
import { MapView } from "@/modules/map/components/MapView";
import { ReportForm, type ReportFormValues } from "@/modules/reports/components/ReportForm";
import { TransparencySignal } from "@/modules/dashboard/components/TransparencySignal";
import { fetchLocations, ensureLocation } from "@/modules/locations/api";
import { submitReport } from "@/modules/reports/api";
import { getAccessToken } from "@/modules/auth/lib/supabaseAuth";
import type { LocationSummary } from "@/modules/locations/types";
import type { TransparencyStats } from "@/modules/dashboard/types";

export function HomeClient({ initialStats }: { initialStats: TransparencyStats }) {
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [pendingPin, setPendingPin] = useState<{ lat: number; lng: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchLocations()
      .then(setLocations)
      .catch(() => setMessage("Could not load existing reports."));
  }, []);

  function handleMapClick(lat: number, lng: number) {
    setMessage(null);
    setPendingPin({ lat, lng });
  }

  async function handleReportSubmit(values: ReportFormValues) {
    if (!pendingPin) return;
    const accessToken = await getAccessToken();
    if (!accessToken) {
      setMessage("Please sign in first — see the Sign in link above.");
      return;
    }
    const location = await ensureLocation(pendingPin.lat, pendingPin.lng, accessToken);
    await submitReport({ locationId: location.id, accessToken, ...values });
    setLocations(await fetchLocations());
    setPendingPin(null);
    setMessage("Thanks — your report was submitted.");
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 p-4">
      <TransparencySignal stats={initialStats} />
      {message && <p className="text-sm">{message}</p>}
      <div className="relative flex-1 overflow-hidden rounded-lg border">
        <MapView locations={locations} onMapClick={handleMapClick} />
        {pendingPin && (
          <div className="absolute inset-x-0 bottom-0 max-h-[70%] overflow-y-auto rounded-t-lg border-t bg-white shadow-lg dark:bg-black">
            <ReportForm onSubmit={handleReportSubmit} onCancel={() => setPendingPin(null)} />
          </div>
        )}
      </div>
    </div>
  );
}
