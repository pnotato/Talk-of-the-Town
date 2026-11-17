import { displayScore } from "./inspectorModel.ts";

/** A 0–100 score as a labelled bar with its number and a few words, readable without colour. */
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
      <div className="meter-head">
        <span className="meter-label">{label}</span>
        <span className="meter-value">
          <strong>{value}</strong>
          <span className="meter-words">{words}</span>
        </span>
      </div>
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
