import { displayScore } from "./inspectorModel.ts";

/**
 * A 0–100 score as a long bar with its name, number and a few words to the right, readable
 * without colour.
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
      <div className="meter-read" aria-hidden>
        <span className="meter-label">{label}</span>
        <strong className="meter-number">{value}</strong>
        <span className="meter-words">{words}</span>
      </div>
    </div>
  );
}
