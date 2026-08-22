import { useEffect, useState, type CSSProperties } from "react";

export interface PollResultChartOption {
  id: string;
  label: string;
  votes: number;
  selected: boolean;
  disabled: boolean;
  multiple: boolean;
}

export interface PollResultChartProps {
  options: readonly PollResultChartOption[];
  voteLabel: string;
  onVote?: (optionId: string) => void;
  onSelectionChange?: (optionIds: readonly string[]) => void;
  onSubmit?: (optionIds: readonly string[]) => void;
  submitLabel?: string;
  voted?: boolean;
  /** Radio 组名，多个投票并存时用于隔离同名单选。 */
  groupName?: string;
  /** 图表绘图区高度（CSS 像素）。默认为紧凑的 160px。 */
  height?: number;
  /** 在需要定量网格时显示水平参考线。 */
  showGrid?: boolean;
  className?: string;
}

/** 用于持久化投票选项的可复用、无障碍纵向结果图表。 */
export function PollResultChart({
  options,
  voteLabel,
  onVote,
  height = 160,
  showGrid = false,
  className = "",
  onSelectionChange,
  onSubmit,
  submitLabel = "投票",
  voted = false,
  groupName,
}: PollResultChartProps) {
  const [pendingSelection, setPendingSelection] = useState<readonly string[]>(
    options.filter((option) => option.selected).map((option) => option.id),
  );
  const optionSelectionKey = options
    .filter((option) => option.selected)
    .map((option) => option.id)
    .join("|");
  useEffect(() => {
    if (voted) return;
    setPendingSelection(optionSelectionKey ? optionSelectionKey.split("|") : []);
  }, [optionSelectionKey, voted]);
  const totalVotes = options.reduce((total, option) => total + option.votes, 0);
  const maxVotes = Math.max(0, ...options.map((option) => option.votes));
  const plotStyle: CSSProperties = { height: `${Math.max(120, height)}px` };
  const columnGridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${Math.max(1, options.length)}, 88px)`,
  };

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
        <div className="rt-poll__chart-columns" style={columnGridStyle}>
          {options.map((option) => {
            const pendingSelected = pendingSelection.includes(option.id);
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
                aria-pressed={voted ? option.selected : pendingSelected}
                aria-label={`${option.label} ${option.votes} ${voteLabel}, ${percentage}%`}
                disabled={voted || option.disabled}
                onClick={() => {
                  if (voted || option.disabled) return;
                  const next = option.multiple
                    ? pendingSelected
                      ? pendingSelection.filter((id) => id !== option.id)
                      : [...pendingSelection, option.id]
                    : pendingSelected
                      ? []
                      : [option.id];
                  setPendingSelection(next);
                  onSelectionChange?.(next);
                }}
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
      {!voted ? (
        <div className="rt-poll__legend" style={columnGridStyle}>
          {options.map((option) => (
            <label key={option.id} className="rt-poll__legend-item">
              <input
                type={option.multiple ? "checkbox" : "radio"}
                name={groupName ?? "poll-selection"}
                checked={pendingSelection.includes(option.id)}
                disabled={option.disabled}
                onChange={() => {
                  const next = option.multiple
                    ? pendingSelection.includes(option.id)
                      ? pendingSelection.filter((id) => id !== option.id)
                      : [...pendingSelection, option.id]
                    : [option.id];
                  setPendingSelection(next);
                  onSelectionChange?.(next);
                }}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="rt-poll__submit"
        disabled={voted || pendingSelection.length === 0 || options.every((option) => option.disabled)}
        onClick={() => {
          if (pendingSelection.length === 0 || voted) return;
          if (onSubmit) onSubmit(pendingSelection);
          else pendingSelection.forEach((optionId) => onVote?.(optionId));
        }}
      >
        {voted ? "已投票" : submitLabel}
      </button>
    </div>
  );
}
