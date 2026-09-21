import { ModerationQueue } from "@/modules/moderation/components/ModerationQueue";

export default function ModerationPage() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-xl font-bold">Moderation queue</h1>
      <p className="mb-6 text-sm text-black/60 dark:text-white/60">
        Images stay hidden from the public map until approved here — blur
        faces/plates before approving if the uploader hasn&apos;t already.
        See docs/00-product-plan.md for why this gate exists.
      </p>
      <ModerationQueue />
    </main>
  );
}
