import { Check, ChevronDown, LoaderCircle, LogIn, LogOut } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { useAppContext } from "../app-context";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui";
import { identities } from "../lib/seed";

const roleLabels = {
  author: "作者",
  reader: "读者",
  moderator: "版主",
} as const;

const IdentityButton = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<"button"> & { label: string }
>(function IdentityButton({ label, ...props }, ref) {
  const value = useAppContext();
  return (
    <button
      ref={ref}
      type="button"
      className="flex h-9 items-center gap-2 rounded-md px-1.5 hover:bg-muted"
      aria-label={label}
      {...props}
    >
      <span className="grid size-7 place-items-center rounded-full bg-primary text-[10px] font-bold text-white">
        {value.identity.avatar}
      </span>
      <span className="text-left max-[840px]:hidden">
        <strong className="block text-xs leading-4">{value.identity.name}</strong>
        <small className="block text-[9px] leading-3 text-muted-foreground">
          {roleLabels[value.identity.role]} · {value.identity.coins} 金币
        </small>
      </span>
      <ChevronDown size={13} className="text-muted-foreground" />
    </button>
  );
});

/** Development identity switcher and production account/session control. */
export function IdentitySwitcher() {
  const value = useAppContext();

  if (value.authMode === "session" && value.authStatus === "loading") {
    return (
      <Button variant="ghost" size="sm" disabled aria-label="正在加载会话">
        <LoaderCircle size={14} className="animate-spin" />
        <span className="max-[430px]:hidden">加载中</span>
      </Button>
    );
  }

  if (value.authMode === "session" && value.authStatus !== "authenticated") {
    return (
      <Button variant="outline" size="sm" onClick={value.login}>
        <LogIn size={14} />
        登录
      </Button>
    );
  }

  if (value.authMode === "session") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IdentityButton label="账户菜单" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <div className="px-2 py-1.5">
            <strong className="block truncate text-xs">{value.identity.name}</strong>
            <small className="text-[10px] text-muted-foreground">
              {roleLabels[value.identity.role]} · {value.identity.coins} 金币
            </small>
          </div>
          <DropdownMenuItem onSelect={() => void value.logout()}>
            <LogOut size={14} />
            退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IdentityButton label="切换论坛身份" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5 text-[10px] font-bold text-muted-foreground">
          开发身份切换
        </div>
        {identities.map((identity) => (
          <DropdownMenuItem
            key={identity.id}
            onSelect={() => value.setIdentity(identity)}
          >
            <span className="grid size-7 place-items-center rounded-full bg-primary text-[10px] font-bold text-white">
              {identity.avatar}
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-xs">{identity.name}</strong>
              <small className="text-[10px] text-muted-foreground">
                {roleLabels[identity.role]} · {identity.coins} 金币
              </small>
            </span>
            {identity.id === value.identity.id ? (
              <Check size={14} className="text-primary" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
