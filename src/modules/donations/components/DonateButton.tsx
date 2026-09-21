import { DONATION_URL } from "../config";

export function DonateButton({ className = "" }: { className?: string }) {
  return (
    <a
      href={DONATION_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950 transition-colors hover:bg-amber-300 ${className}`}
    >
      <span aria-hidden>☕</span> Buy us a coffee
    </a>
  );
}
