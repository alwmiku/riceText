import type { CSSProperties } from "react";

export interface PollResultChartOption {
  id: string;
  label: string;
  votes: number;
  selected: boolean;
  disabled: boolean;
}

export interface PollResultChartProps {
  options: readonly PollResultChartOption[];
  voteLabel: string;
  onVote?: (optionId: string) => void;
  /** Chart plot height in CSS pixels. Defaults to a compact 160px. */
  height?: number;
  /** Shows horizontal guide lines when a quantitative grid is useful. */
  showGrid?: boolean;
  className?: string;
}

/** Reusable, accessible vertical result chart for persisted poll options. */
export function PollResultChart({
  options,
  voteLabel,
  onVote,
  height = 160,
  showGrid = false,
  className = "",
}: PollResultChartProps) {
  const totalVotes = options.reduce((total, option) => total + option.votes, 0);
  const maxVotes = Math.max(0, ...options.map((option) => option.votes));
  const plotStyle: CSSProperties = { height: `${Math.max(120, height)}px` };

  return (
    <div
      className={`rt-poll__chart ${className}`.trim()}
      role="group"
      aria-label="投票结果"
    >
      <div className="rt-poll__chart-plot" style={plotStyle}>
        {showGrid
          ? [25, 50, 75, 100].map((value) => (
              <span
                key={value}
                className="rt-poll__chart-gridline"
                style={{ bottom: `${value}%` }}
                aria-hidden="true"
              />
            ))
          : null}
        <div className="rt-poll__chart-columns">
          {options.map((option) => {
            const percentage =
              totalVotes > 0
                ? Math.round((option.votes / totalVotes) * 100)
                : 0;
            const barHeight =
              maxVotes > 0 ? Math.round((option.votes / maxVotes) * 100) : 0;
            return (
              <button
                key={option.id}
                type="button"
                className="rt-poll__chart-column"
                aria-pressed={option.selected}
                aria-label={`${option.label} ${option.votes} ${voteLabel}, ${percentage}%`}
                disabled={option.disabled}
                onClick={() => onVote?.(option.id)}
              >
                <span className="rt-poll__chart-bar-area" aria-hidden="true">
                  <span
                    className="rt-poll__chart-bar-stack"
                    style={{ height: `${barHeight}%` }}
                  >
                    <span className="rt-poll__chart-value">{option.votes}</span>
                    <span className="rt-poll__chart-bar" />
                  </span>
                </span>
                <span className="rt-poll__chart-label" title={option.label}>
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
