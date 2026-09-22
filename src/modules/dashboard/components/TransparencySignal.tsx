import type { TransparencyStats } from "../types";

export function TransparencySignal({ stats }: { stats: TransparencyStats }) {
  const items: { label: string; value: number }[] = [
    { label: "Clamps reported", value: stats.totalReports },
    { label: "Reported this month", value: stats.reportsThisMonth },
    { label: "High-risk locations", value: stats.highRiskLocations },
    { label: "Locations tracked", value: stats.totalLocations },
  ];

  return (
    <section
      aria-label="Clamp transparency signal"
      className="signal-stats"
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="signal-stat"
        >
          <span className="stat-value">{item.value}</span>
          <span className="stat-label">{item.label}</span>
        </div>
      ))}
    </section>
  );
}
