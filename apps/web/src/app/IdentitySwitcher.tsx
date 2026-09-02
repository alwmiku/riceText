import { Check, ChevronDown, LoaderCircle, LogIn, LogOut } from "lucide-react";
import {
  forwardRef,
  useState,
  type ComponentPropsWithoutRef,
  type FormEvent,
} from "react";
import { useAppContext } from "../app-context";
import {
  Button,
  Dialog,
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
  const [loginOpen, setLoginOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError(null);
    setSubmitting(true);
    try {
      await value.login(username, password);
      setPassword("");
      setLoginOpen(false);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "登录失败");
    } finally {
      setSubmitting(false);
    }
  };

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
      <>
        <Button variant="outline" size="sm" onClick={() => setLoginOpen(true)}>
          <LogIn size={14} />
          登录
        </Button>
        <Dialog
          open={loginOpen}
          onOpenChange={(open) => {
            setLoginOpen(open);
            if (!open) setLoginError(null);
          }}
          title="登录 RiceText"
          description="使用管理员在 D1 中创建的账号登录。"
        >
          <form className="space-y-4" onSubmit={(event) => void submitLogin(event)}>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>账号</span>
              <input
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-white px-3 outline-none focus:ring-2 focus:ring-ring"
                minLength={3}
                maxLength={64}
                pattern="[A-Za-z0-9._-]+"
                required
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              <span>密码</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-10 w-full rounded-md border border-input bg-white px-3 outline-none focus:ring-2 focus:ring-ring"
                minLength={10}
                maxLength={128}
                required
              />
            </label>
            {loginError ? (
              <p role="alert" className="text-sm text-destructive">{loginError}</p>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? <LoaderCircle size={14} className="animate-spin" /> : <LogIn size={14} />}
              {submitting ? "登录中" : "登录"}
            </Button>
          </form>
        </Dialog>
      </>
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
