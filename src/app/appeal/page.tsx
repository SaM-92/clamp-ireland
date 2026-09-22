import Link from "next/link";
import { seoPolicy } from "@/modules/seo/config";
import { publicPageMetadata } from "@/modules/seo/policy";
import styles from "./appeal.module.css";

export const metadata = publicPageMetadata(
  seoPolicy,
  "/appeal",
  "Clamping appeal guide | Clamp Transparency Signal",
  "A Republic of Ireland clamping appeal guide: appeal to the parking controller first, understand the 60/21/30-day timelines, and prepare evidence for an NTA appeal.",
);

export default function AppealPage() {
  return (
    <main id="main-content" className={styles.guide} tabIndex={-1}>
      <Link href="/" className={styles.backLink}>Back to community map</Link>

      <header className={styles.intro}>
        <p className={styles.eyebrow}>Republic of Ireland</p>
        <h1>Clamping appeal guide</h1>
        <p>
          Challenging a vehicle clamping or relocation charge? Start with the
          responsible parking controller or operator, not the National Transport
          Authority (NTA).
        </p>
        <p className={styles.reviewed}>
          Reviewed <time dateTime="2026-09-22">22 September 2026</time>
        </p>
      </header>

      <aside className={styles.notice} aria-labelledby="scope-heading">
        <h2 id="scope-heading">Know the scope</h2>
        <p>
          This guide covers the <strong>Republic of Ireland only</strong>.
          The community map also covers Northern Ireland, but these NTA
          procedures do not apply in Northern Ireland.
        </p>
        <p>
          This is independent community information, not an NTA service or
          NTA-endorsed guidance. It is not legal advice and does not guarantee a
          refund. Check the official NTA guidance and your notice before acting.
        </p>
      </aside>

      <section className={styles.section} aria-labelledby="deadlines-heading">
        <h2 id="deadlines-heading">Three timings to keep in view</h2>
        <dl className={styles.deadlines}>
          <div>
            <dt>60 days</dt>
            <dd>To make your first-stage appeal, from the clamping or relocation.</dd>
          </div>
          <div>
            <dt>21 days</dt>
            <dd>For the controller to respond in writing, from receipt of your appeal.</dd>
          </div>
          <div>
            <dt>30 days</dt>
            <dd>To apply to the NTA, from receiving your first-stage decision.</dd>
          </div>
        </dl>
        <p>
          Adding a community report does not submit an appeal or stop, pause or
          extend an appeal deadline.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="stage-one-heading">
        <p className={styles.eyebrow}>Stage 1</p>
        <h2 id="stage-one-heading">Appeal to the parking controller first</h2>
        <p>
          Send your appeal to the responsible parking controller or operator
          within <strong>60 days of the clamping or relocation</strong>.
          Follow the appeal instructions on the clamp notice or release-fee
          receipt.
        </p>
        <p>
          Explain why you dispute the charge and include relevant evidence.
          Keep a copy of what you send and a record of when it was sent and
          received. The controller must give a written response within{" "}
          <strong>21 days of receiving your appeal</strong>.
        </p>
        <p>
          Keep the first-stage decision letter (Letter of Determination). You
          will need it if you take the appeal to the NTA.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="stage-two-heading">
        <p className={styles.eyebrow}>Stage 2</p>
        <h2 id="stage-two-heading">Still dissatisfied? Apply to the NTA</h2>
        <p>
          <strong>You must complete stage 1 before applying to the NTA.</strong>{" "}
          If you are not satisfied with the first-stage decision, make your
          NTA application within <strong>30 days of receiving that decision</strong>,
          not 30 days from the clamping.
        </p>
        <p>
          The person who was in charge of the vehicle at the time of the
          incident must complete the form. Include a copy of the first-stage
          Letter of Determination and relevant supporting documents.
        </p>
        <p>
          An independent appeals officer decides whether the appeal is allowed
          or not allowed. If it is allowed, the charges are refunded; submitting
          an appeal alone does not guarantee a refund.
        </p>
        <a className={styles.officialLink} href="https://clampingregulation.nationaltransport.ie/appeal">
          Open the official NTA appeal form
        </a>
      </section>

      <section className={styles.section} aria-labelledby="evidence-heading">
        <h2 id="evidence-heading">Evidence to keep privately</h2>
        <p>A useful checklist for preparing your appeal:</p>
        <ul className={styles.checklist}>
          <li>The clamp or relocation notice.</li>
          <li>The release-fee receipt and payment details.</li>
          <li>The first-stage decision letter, for an NTA appeal.</li>
          <li>Photos of the parking signs and vehicle location.</li>
          <li>Notes made at the time: dates, times, location and what happened.</li>
        </ul>
        <p>
          Keep vehicle registration plates, contact details and personal
          documents private. Send evidence through the controller&apos;s appeal
          process or the official NTA form as appropriate, not in a public
          community note. This website does not collect or submit your appeal.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="complaints-heading">
        <h2 id="complaints-heading">A complaint is a separate process</h2>
        <p>
          Complaints about conduct, delays or signage compliance are separate
          from an appeal against a clamping or relocation charge. Use the
          official NTA complaint form within <strong>60 days of the event</strong>.
          Do not substitute a complaint for an appeal or assume that it changes
          an appeal deadline.
        </p>
        <a className={styles.officialLink} href="https://clampingregulation.nationaltransport.ie/complaint">
          Open the official NTA complaint form
        </a>
      </section>

      <section className={styles.section} aria-labelledby="fines-heading">
        <h2 id="fines-heading">Parking fine appeals are different</h2>
        <p>
          A parking fine or fixed-charge notice is not the same as a clamping
          or relocation charge. To challenge a parking fine, follow the
          instructions and deadlines on that notice from its issuing authority.
          The NTA clamping appeal process described here is not a parking fine
          appeal process.
        </p>
      </section>

      <section className={styles.section} aria-labelledby="sources-heading">
        <h2 id="sources-heading">Official sources</h2>
        <p>
          This summary is based on the NTA&apos;s vehicle clamping regulation
          guidance, reviewed on 22 September 2026. Procedures can change; use the
          official guidance and forms for your application.
        </p>
        <a className={styles.officialLink} href="https://www.nationaltransport.ie/vehicle-clamping-regulation/">
          Read the NTA vehicle clamping regulation guidance
        </a>
      </section>
    </main>
  );
}
