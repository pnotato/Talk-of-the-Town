import type { Emotions } from "../generated/types.ts";
import { EMOTION_MOOD, MOOD_COLOR } from "../scene/blobMood.ts";
import { capitalise, emotionShares } from "./inspectorModel.ts";

/**
 * A blob's emotion mix: one bar split by share in each emotion's colour, then each emotion's
 * percentage, biggest first. The list carries the numbers for assistive tech; the bar only
 * repeats them, so it is hidden from it.
 */
export default function EmotionMix({ emotions }: { emotions: Emotions }) {
  const shares = emotionShares(emotions);
  return (
    <div className="emotion-mix">
      <span className="meter-head" aria-hidden>
        <span className="meter-label">Feelings</span>
      </span>
      <div className="emotion-bar" aria-hidden>
        {shares.map(({ emotion, percent }) => (
          <span
            key={emotion}
            className="emotion-segment"
            style={{ flexGrow: percent, background: MOOD_COLOR[EMOTION_MOOD[emotion]] }}
          />
        ))}
      </div>
      <ul className="emotion-list" aria-label="Feelings">
        {shares.map(({ emotion, percent }) => (
          <li key={emotion}>
            <span
              className="emotion-dot"
              style={{ background: MOOD_COLOR[EMOTION_MOOD[emotion]] }}
              aria-hidden
            />
            {capitalise(emotion)} <span className="emotion-percent">{percent}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
