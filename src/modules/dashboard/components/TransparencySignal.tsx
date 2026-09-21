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
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-lg border border-black/10 bg-white/70 p-3 text-center dark:border-white/10 dark:bg-black/20"
        >
          <div className="text-2xl font-bold">{item.value}</div>
          <div className="text-xs text-black/60 dark:text-white/60">{item.label}</div>
        </div>
      ))}
    </section>
  );
}
