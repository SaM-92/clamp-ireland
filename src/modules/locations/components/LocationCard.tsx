"use client";

import { Icon } from "@/lib/components/Icon";
import { usePlaceLabel } from "@/modules/locations/lib/usePlaceLabel";
import type { LocationSummary } from "@/modules/locations/types";

export function LocationCard({ location, preview, onSelect }: {
  location: LocationSummary;
  preview: boolean;
  onSelect: (location: LocationSummary) => void;
}) {
  const label = usePlaceLabel(location.lat, location.lng);
  const fallbackHeading = preview ? "Preview location" : "Community-reported location";
  const heading = label?.name ?? fallbackHeading;
  const subtitle = label
    ? label.address || (preview ? "Preview location" : "Community-reported location")
    : `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;

  return (
    <button className="location-card" onClick={() => onSelect(location)}>
      <span className={`risk-symbol risk-${location.riskLevel}`}><Icon name="pin" /></span>
      <span className="location-card-copy">
        <strong>{heading}</strong>
        <span>{subtitle}</span>
        <small>{location.reportCount} report{location.reportCount === 1 ? "" : "s"} · {location.riskLevel} signal</small>
      </span>
      <Icon name="arrow" />
    </button>
  );
}
