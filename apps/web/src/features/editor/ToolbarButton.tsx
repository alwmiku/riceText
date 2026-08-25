import { Button as ShadcnButton } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ToolbarButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
  mobile?: boolean;
};

export function ToolbarButton({
  label,
  active = false,
  mobile = false,
  className,
  children,
  ...props
}: ToolbarButtonProps) {
  return (
    <ShadcnButton
      variant="ghost"
      size={mobile ? "icon-lg" : "icon-sm"}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "text-[#54616b]",
        active && "bg-primary/10 text-primary",
        className,
      )}
      {...props}
    >
      {children as ReactNode}
    </ShadcnButton>
  );
}
