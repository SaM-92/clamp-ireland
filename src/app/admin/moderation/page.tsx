import { ModerationQueue } from "@/modules/moderation/components/ModerationQueue";

export default function ModerationPage() {
  return (
    <main id="main-content" className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-xl font-bold">Moderation queue</h1>
      <p className="mb-6 text-sm text-slate-600">
        Every note and photo stays private until reviewed. Edit identifying
        or accusatory text before approval. Reject photos requiring redaction;
        there is no image-blurring tool in this prototype.
      </p>
      <ModerationQueue />
    </main>
  );
}
