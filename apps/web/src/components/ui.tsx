import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { X } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/utils';

type ButtonVariant = 'default' | 'secondary' | 'ghost' | 'outline' | 'destructive';
type ButtonSize = 'default' | 'sm' | 'icon';

/** shadcn 风格按钮属性；保留原生 button 能力并增加视觉 variant/size。 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 语义对应的视觉层级。 */
  variant?: ButtonVariant;
  /** 固定高度与内边距预设；icon 用于无文字工具按钮。 */
  size?: ButtonSize;
}

/** 全站统一按钮，默认 `type=button`，防止在表单内意外提交。 */
export function Button({ className, variant = 'default', size = 'default', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-45',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        variant === 'default' && 'bg-primary text-primary-foreground hover:bg-primary/90',
        variant === 'secondary' && 'bg-muted text-foreground hover:bg-[#e8edef]',
        variant === 'ghost' && 'text-foreground hover:bg-muted',
        variant === 'outline' && 'border border-input bg-white text-foreground hover:bg-muted',
        variant === 'destructive' && 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        size === 'default' && 'h-10 px-4',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'icon' && 'h-9 w-9 p-0',
        className,
      )}
      {...props}
    />
  );
}

/** Radix tooltip 包装器，为不带文字的工具按钮提供可访问名称说明。 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={350}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content sideOffset={6} className="z-[100] rounded bg-[#20272c] px-2 py-1 text-[11px] text-white shadow-lg">
            {label}
            <TooltipPrimitive.Arrow className="fill-[#20272c]" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

/** 带 tooltip、aria-label 与可选按下状态的固定尺寸图标按钮。 */
export function IconButton({ label, active, className, ...props }: ButtonProps & { label: string; active?: boolean }) {
  return (
    <Tooltip label={label}>
      <Button
        size="icon"
        variant="ghost"
        aria-label={label}
        aria-pressed={active}
        className={cn('h-8 w-8 text-[#54616b]', active && 'bg-accent text-accent-foreground', className)}
        {...props}
      />
    </Tooltip>
  );
}

/** 可访问的受控模态框；标题、描述、关闭按钮和焦点管理由 Radix 提供。 */
export function Dialog({ open, onOpenChange, title, description, children, footer, className }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
        <DialogPrimitive.Content className={cn('fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[calc(100%-24px)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg border border-border bg-white shadow-2xl', className)}>
          <div className="border-b border-border px-5 py-4 pr-12">
            <DialogPrimitive.Title className="text-base font-bold text-foreground">{title}</DialogPrimitive.Title>
            {description && <DialogPrimitive.Description className="mt-1 text-xs leading-5 text-muted-foreground">{description}</DialogPrimitive.Description>}
          </div>
          <div className="p-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
          <DialogPrimitive.Close className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="关闭">
            <X size={17} />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

/** 通过 Portal 渲染的菜单面板，避免被编辑器 overflow 容器裁剪。 */
export function DropdownMenuContent({ children, align = 'start', className }: { children: ReactNode; align?: 'start' | 'center' | 'end'; className?: string }) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content align={align} sideOffset={6} className={cn('z-50 min-w-44 rounded-md border border-border bg-white p-1 shadow-xl', className)}>
        {children}
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}

/** 菜单命令项；仅在值存在时传递可选属性以兼容严格 TS 配置。 */
export function DropdownMenuItem({ children, onSelect, disabled, className }: { children: ReactNode; onSelect?: () => void; disabled?: boolean; className?: string }) {
  return (
    <DropdownMenuPrimitive.Item {...(disabled === undefined ? {} : { disabled })} {...(onSelect ? { onSelect } : {})} className={cn('flex min-h-9 cursor-default select-none items-center gap-2 rounded px-2.5 text-sm outline-none data-[disabled]:opacity-45 data-[highlighted]:bg-muted', className)}>
      {children}
    </DropdownMenuPrimitive.Item>
  );
}

/** 小型状态标签，不承载点击行为。 */
export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'teal' | 'amber' | 'green' | 'red'; className?: string }) {
  return <span className={cn('inline-flex min-h-5 items-center rounded px-1.5 text-[10px] font-bold', tone === 'neutral' && 'bg-muted text-muted-foreground', tone === 'teal' && 'bg-accent text-accent-foreground', tone === 'amber' && 'bg-[#fff2d5] text-[#805006]', tone === 'green' && 'bg-[#e6f6ed] text-[#19734b]', tone === 'red' && 'bg-[#fae9e9] text-[#a63434]', className)}>{children}</span>;
}

/** 单选分段控件，使用 aria-pressed 表达当前模式。 */
export function Segmented<T extends string>({ value, options, onChange, ariaLabel }: { value: T; options: Array<{ value: T; label: string; icon?: ReactNode }>; onChange: (value: T) => void; ariaLabel: string }) {
  return (
    <div className="inline-flex rounded-md border border-border bg-muted p-0.5" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onChange(option.value)} aria-pressed={value === option.value} className={cn('inline-flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-semibold text-muted-foreground', value === option.value && 'bg-white text-foreground shadow-sm')}>
          {option.icon}{option.label}
        </button>
      ))}
    </div>
  );
}
