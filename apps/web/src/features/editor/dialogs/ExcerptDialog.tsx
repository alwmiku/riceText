import { useId, useState, type ChangeEvent } from "react";
import { currentReaderTime, normalizeNovelExcerptVariant } from "@ricetext/document-core";
import { RichTextViewer, type JSONContent } from "@ricetext/editor-core";
import { Button, Dialog } from "../../../components/ui";
import { Input } from "../../../components/ui/input";
import { Separator } from "../../../components/ui/separator";
import {
  createExcerptValues, emptyExcerptValues, excerptAttributes, excerptParagraphs,
  isExcerptSourceUrlValid, isExcerptBatteryValid, readerDisplayDefaults, type ExcerptValues,
} from "./excerpt-values";

interface ExcerptDialogProps {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onInsert: (values: ExcerptValues) => boolean | void;
  initial?: ExcerptValues;
  existingContent?: JSONContent[];
}

/** 每次打开均创建新草稿，取消后重新打开也不例外。 */
export function ExcerptDialog(props: ExcerptDialogProps) {
  return props.open ? <ExcerptDialogForm {...props} /> : null;
}

function ExcerptDialogForm({ open, onOpenChange, onInsert, initial, existingContent }: ExcerptDialogProps) {
  const [values, setValues] = useState<ExcerptValues>(() => initial ? { ...emptyExcerptValues, ...initial, variant: normalizeNovelExcerptVariant(initial.variant) } : createExcerptValues());
  const [saveError, setSaveError] = useState(false);
  const id = useId();
  const editing = initial !== undefined;
  const validUrl = isExcerptSourceUrlValid(values.sourceUrl);
  const validBattery = isExcerptBatteryValid(values.batteryLevel);
  const canSubmit = validUrl && validBattery && (editing || Boolean(values.bookTitle.trim() && values.text.trim()));
  const field = (key: keyof ExcerptValues) => ({
    value: values[key],
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setValues((current) => {
        const next = { ...current, [key]: key === "variant" ? normalizeNovelExcerptVariant(event.target.value) : event.target.value };
        if (key === "variant" && !editing) {
          const previousDefaults = readerDisplayDefaults(current.variant);
          const nextDefaults = readerDisplayDefaults(event.target.value);
          for (const displayKey of Object.keys(nextDefaults) as Array<keyof typeof nextDefaults>) {
            if (current[displayKey] === previousDefaults[displayKey]) next[displayKey] = nextDefaults[displayKey];
          }
        }
        return next;
      }),
  });
  const preview: JSONContent = {
    type: "doc",
    content: [{
      type: "novelExcerpt",
      attrs: { ...excerptAttributes(values), sourceUrl: validUrl ? values.sourceUrl.trim() || null : null },
      content: editing ? existingContent ?? [] : excerptParagraphs(values.text),
    }],
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "编辑小说摘录" : "插入小说摘录"}
      className="max-w-4xl"
      footer={<>
        <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
        <Button disabled={!canSubmit} onClick={() => {
          if (!canSubmit) return;
          const result = onInsert({
            ...values,
            readerTime: editing ? values.readerTime : currentReaderTime(),
            bookTitle: values.bookTitle.trim(), chapterTitle: values.chapterTitle.trim(),
            author: values.author.trim(), sourceUrl: values.sourceUrl.trim(),
          });
          if (result === false) setSaveError(true);
          else onOpenChange(false);
        }}>{editing ? "保存修改" : "插入摘录"}</Button>
      </>}
    >
      <div className="grid min-w-0 gap-6 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold">
              书名
              <Input required={!editing} maxLength={300} placeholder="作品名称" {...field("bookTitle")} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold">
              章节
              <Input maxLength={300} placeholder="第三章" {...field("chapterTitle")} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold">
              作者
              <Input maxLength={200} placeholder="作者名称" {...field("author")} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold">
              排版
              <select aria-label="排版" className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" {...field("variant")}>
                <option value="fanqie">番茄轻小说</option>
                <option value="qidian">起点读书</option>
              </select>
            </label>
          </div>
          <fieldset className="flex min-w-0 flex-col gap-3">
            <legend className="mb-2 text-xs font-semibold">阅读页信息</legend>
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold" data-invalid={!validBattery || undefined}>
              电量（%）
              <Input type="number" min={0} max={100} step={1} inputMode="numeric" {...field("batteryLevel")} aria-invalid={!validBattery} aria-describedby={!validBattery ? id + "-battery-error" : undefined} />
            </label>
            {!validBattery && <p id={id + "-battery-error"} role="alert" className="text-xs text-destructive">电量应为 0 至 100 的整数。</p>}
            <label className="flex min-w-0 flex-col gap-1.5 text-xs font-semibold">
              顶部信息
              <Input maxLength={80} placeholder={values.variant === "fanqie" ? "00:24得991金币" : "起点热评"} {...field("headerLabel")} />
            </label>
          </fieldset>
          <label className="flex flex-col gap-1.5 text-xs font-semibold" data-invalid={!validUrl || undefined}>
            来源链接（可选）
            <Input type="url" maxLength={2048} placeholder="https://example.com/chapter" {...field("sourceUrl")} aria-invalid={!validUrl} aria-describedby={!validUrl ? id + "-url-error" : undefined} />
          </label>
          {!validUrl && <p id={id + "-url-error"} role="alert" className="text-xs text-destructive">请输入有效的 HTTP 或 HTTPS 链接。</p>}
          {!editing && <label className="flex flex-col gap-1.5 text-xs font-semibold">
            摘录正文
            <textarea required className="max-h-96 min-h-48 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" {...field("text")} />
          </label>}
          {saveError && <p role="alert" className="text-xs text-destructive">摘录已发生变化，请关闭后重新打开。</p>}
        </div>
        <section aria-label="摘录预览" className="flex min-w-0 flex-col gap-3">
          <h3 className="text-sm font-semibold">预览</h3>
          <Separator />
          <div className="max-h-96 min-w-0 overflow-auto break-words">
            <RichTextViewer content={preview} />
          </div>
        </section>
      </div>
    </Dialog>
  );
}
