import React, { useEffect, useRef, useState } from "react";

interface OnboardingProps {
  onDismiss(reason: "skip" | "finish"): void;
}

interface Step {
  title: string;
  body: string;
  points: string[];
}

const STEPS: Step[] = [
  {
    title: "Collect without breaking your reading",
    body: "Select useful language on a page, choose Collect, and keep reading.",
    points: [
      "Collector stores captures locally.",
      "A normal capture goes to Inbox; it is not automatically Ready.",
      "Collector does not continuously watch your browsing in the background.",
    ],
  },
  {
    title: "Review your Inbox later",
    body: "Review is a separate, intentional activity.",
    points: [
      "Inspect the language, context, and proposed study card.",
      "Ready means you explicitly approved the item for export.",
      "Archive keeps material out of the study queue without deleting it.",
    ],
  },
  {
    title: "Export with the right Anki profile",
    body: "Different languages can use different Anki profiles, decks, and note types.",
    points: [
      "Collector shows resolved destinations before export.",
      "Anki Desktop and AnkiConnect are required for direct Anki export.",
      "You can collect and review even while Anki is closed.",
    ],
  },
  {
    title: "Staged material stays separate",
    body: "Explicit Duolingo/backfill scans first collect visible material into Staged.",
    points: [
      "Staged material has not entered your normal corpus yet.",
      "Accepting Staged evidence moves it to Inbox, never directly to Ready.",
      "Normal use does not require uploading study material to a remote Collector service.",
    ],
  },
];

export function Onboarding({ onDismiss }: OnboardingProps): React.ReactElement {
  const [stepIndex, setStepIndex] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const step = STEPS[stepIndex]!;

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [stepIndex]);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="product-dialog onboarding-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-body"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onDismiss("skip");
          }
        }}
      >
        <div className="dialog-progress" role="status" aria-live="polite">
          Introduction {stepIndex + 1} of {STEPS.length}
        </div>
        <h2 id="onboarding-title" ref={headingRef} tabIndex={-1}>{step.title}</h2>
        <p id="onboarding-body">{step.body}</p>
        <ul className="onboarding-points">
          {step.points.map((point) => <li key={point}>{point}</li>)}
        </ul>

        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={() => onDismiss("skip")}>
            Skip introduction
          </button>
          <div className="dialog-actions-primary">
            {stepIndex > 0 && (
              <button
                type="button"
                className="ghost"
                onClick={() => setStepIndex((current) => current - 1)}
              >
                Back
              </button>
            )}
            {stepIndex < STEPS.length - 1 ? (
              <button
                type="button"
                className="primary"
                onClick={() => setStepIndex((current) => current + 1)}
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={() => onDismiss("finish")}
              >
                Finish
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
