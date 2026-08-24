import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Dialog } from "../../../components/ui";
import { createId } from "../../../lib/utils";

export interface PollDialogValues {
  question: string;
  multiple: boolean;
  options: Array<{ id: string; label: string }>;
}

const initialOptions = () => [
  { id: createId("poll-option"), label: "选项一" },
  { id: createId("poll-option"), label: "选项二" },
];

/** 创建或编辑正文中的持久化投票选项。 */
export function PollDialog({
  open,
  onOpenChange,
  onInsert,
  initial,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onInsert: (values: PollDialogValues) => void;
  initial?: PollDialogValues;
}) {
  const [question, setQuestion] = useState("");
  const [multiple, setMultiple] = useState(false);
  const [options, setOptions] = useState<Array<{ id: string; label: string }>>(
    initialOptions,
  );

  useEffect(() => {
    if (!open) return;
    setQuestion(initial?.question ?? "");
    setMultiple(initial?.multiple ?? false);
    setOptions(
      initial?.options.map((option) => ({ ...option })) ?? initialOptions(),
    );
  }, [open, initial]);

  const validOptions = options
    .map((option) => ({ ...option, label: option.label.trim() }))
    .filter((option) => option.label.length > 0);
  const valid = question.trim().length > 0 && validOptions.length >= 2;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "编辑投票" : "创建投票"}
      description="设置投票问题、可选项和单选或多选规则。"
      className="max-w-lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={!valid}
            onClick={() => {
              onInsert({
                question: question.trim(),
                multiple,
                options: validOptions,
              });
              onOpenChange(false);
            }}
          >
            {initial ? "保存投票" : "插入投票"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <label className="grid gap-1.5 text-xs font-semibold">
          投票问题
          <input
            className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="例如：下一章先去哪里？"
            autoFocus
          />
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold">
          <input
            type="checkbox"
            checked={multiple}
            onChange={(event) => setMultiple(event.target.checked)}
          />
          允许多选
        </label>
        <div className="grid gap-2">
          <span className="text-xs font-semibold">投票选项</span>
          {options.map((option, index) => (
            <div key={option.id} className="flex items-center gap-2">
              <input
                className="h-10 w-full min-w-0 flex-1 rounded-md border border-input bg-white px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
                value={option.label}
                aria-label={`投票选项 ${index + 1}`}
                onChange={(event) =>
                  setOptions((current) =>
                    current.map((item) =>
                      item.id === option.id
                        ? { ...item, label: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label={`删除投票选项 ${index + 1}`}
                title="删除选项"
                disabled={options.length <= 2}
                onClick={() =>
                  setOptions((current) =>
                    current.filter((item) => item.id !== option.id),
                  )
                }
              >
                <Trash2 size={16} />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() =>
              setOptions((current) => [
                ...current,
                { id: createId("poll-option"), label: "" },
              ])
            }
          >
            <Plus size={15} />
            添加选项
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
