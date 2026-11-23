import { displayScore } from "./inspectorModel.ts";

/**
 * A labelled score bar with its words ("Mildly interested") beside the label. The number and the
 * words both stay on the accessible meter; the visible text is hidden from assistive tech so it
 * isn't read twice.
 */
export default function Meter({
  label,
  score,
  words,
  tone,
}: {
  label: string;
  score: number;
  words: string;
  tone: "perception" | "interest";
}) {
  const value = displayScore(score);
  return (
    <div className="meter">
      <span className="meter-head" aria-hidden>
        <span className="meter-label">{label}</span>
        <span className="meter-words">{words}</span>
      </span>
      <div
        className={`meter-track meter-${tone}`}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={`${value} out of 100, ${words}`}
      >
        <div className="meter-fill" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
