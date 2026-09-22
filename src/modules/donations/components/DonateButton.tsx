import { DONATION_URL } from "../config";
import { Icon } from "@/lib/components/Icon";

export function DonateButton({ className = "" }: { className?: string }) {
  if (!DONATION_URL) {
    return <span className={`support-placeholder ${className}`} title="Donation link coming soon">
      <Icon name="coffee" /> <span>Support us <span className="support-soon">soon</span></span>
    </span>;
  }
  return (
    <a
      href={DONATION_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`button button-support ${className}`}
    >
      <Icon name="coffee" /> <span>Buy us a coffee</span>
    </a>
  );
}
