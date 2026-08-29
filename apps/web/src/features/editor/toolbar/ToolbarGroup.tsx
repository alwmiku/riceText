import { MoreHorizontal, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../../lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../../components/ui";
import { ToolbarButton } from "./ToolbarButton";

export function ToolbarGroup({
  label,
  icon: Icon = MoreHorizontal,
  collapsed,
  mobile = false,
  children,
}: {
  label: string;
  icon?: LucideIcon;
  collapsed: boolean;
  mobile?: boolean;
  children: ReactNode;
}) {
  if (!collapsed) {
    return (
      <div
        className="inline-flex min-w-0 items-center gap-1"
        role="group"
        aria-label={label}
      >
        {children}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolbarButton label={label} mobile={mobile}>
          <Icon size={mobile ? 22 : 18} />
        </ToolbarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side={mobile ? "top" : "bottom"}
        // 移动端底部菜单很高（格式项 + 拾色器），限高滚动避免 Radix 碰撞翻转
        // 把菜单挤出视口；桌面折叠工具栏同样受益。
        className={cn(
          "min-w-36",
          "max-h-[min(62vh,440px)] overflow-y-auto",
        )}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
