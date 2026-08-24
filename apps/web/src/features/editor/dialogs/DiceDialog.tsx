import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { Button, Dialog } from "../../../components/ui";
import { createDice } from "../../../lib/api";
import type { DiceResult } from "../../../lib/types";

/** 创建服务端权威骰子结果，并把已持久化 attrs 交回编辑器插入。 */
export function DiceDialog({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onInsert: (result: DiceResult) => void;
}) {
  const [expression, setExpression] = useState("3d5");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setPending(true);
    setError("");
    try {
      onInsert(await createDice(expression));
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "骰子创建失败");
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="插入骰子"
      description="结果创建后会随正文持久化，只有明确重投才会变化。"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <LoaderCircle size={15} className="animate-spin" />}
            投掷并插入
          </Button>
        </>
      }
    >
      <label className="grid gap-2 text-sm font-semibold">
        骰子表达式
        <input
          className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
          value={expression}
          onChange={(event) => setExpression(event.target.value)}
          placeholder="例如 3d5、1d20+2"
          autoFocus
        />
      </label>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </Dialog>
  );
}
