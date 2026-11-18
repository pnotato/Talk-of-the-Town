import { displayScore } from "./inspectorModel.ts";

/** A labelled score bar; its numeric and qualitative values remain available to assistive tech. */
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
      <span className="meter-label" aria-hidden>
        {label}
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
