import { MoreHorizontal, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../../components/ui";
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
        className="min-w-48"
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
