import { ChevronDown } from "lucide-react";
import { useAppContext } from "../app-context";
import {
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

/** 论坛身份下拉切换器。 */
export function IdentitySwitcher() {
  const value = useAppContext();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-md px-1.5 hover:bg-muted"
          aria-label="切换论坛身份"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-[10px] font-bold text-white">
            {value.identity.avatar}
          </span>
          <span className="text-left max-[840px]:hidden">
            <strong className="block text-xs leading-4">
              {value.identity.name}
            </strong>
            <small className="block text-[9px] leading-3 text-muted-foreground">
              {roleLabels[value.identity.role]} · {value.identity.coins} 金币
            </small>
          </span>
          <ChevronDown size={13} className="text-muted-foreground" />
        </button>
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
            <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-[10px] font-bold text-white">
              {identity.avatar}
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block truncate text-xs">{identity.name}</strong>
              <small className="text-[10px] text-muted-foreground">
                {identity.role} · {identity.coins} 金币
              </small>
            </span>
            {identity.id === value.identity.id && (
              <span className="text-primary">✓</span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
