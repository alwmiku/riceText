import { Edit3, Eye } from "lucide-react";
import { NavLink } from "react-router-dom";
import { IdentitySwitcher } from "./IdentitySwitcher";

/** 顶部品牌、路由导航与身份入口。 */
export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 h-[58px] border-b border-border bg-white/95 backdrop-blur-xl max-[430px]:h-[54px]">
      <div className="mx-auto flex h-full max-w-[1600px] items-center gap-[18px] px-5 max-[840px]:gap-3 max-[840px]:px-3 max-[430px]:gap-2 max-[430px]:px-2">
        <div className="flex shrink-0 items-center gap-2">
          <span className="grid h-[30px] w-[30px] place-items-center rounded-[7px] bg-[#197c73] font-extrabold text-white shadow-[inset_0_-3px_0_rgb(0_0_0/0.1)]">稻</span>
          <strong className="text-sm max-[430px]:hidden">RiceText</strong>
        </div>

        <nav className="flex h-full items-center gap-4" aria-label="主导航">
          <NavLink
            to="/compose"
            className={({ isActive }) =>
              `inline-flex h-9 items-center gap-[7px] border-b-2 border-transparent px-1 text-sm font-semibold text-[#58636f] max-[430px]:text-[13px] ${isActive ? "!border-b-primary !text-primary" : ""}`
            }
          >
            <Edit3 size={15} />
            编辑
          </NavLink>
          <NavLink
            to="/read"
            className={({ isActive }) =>
              `inline-flex h-9 items-center gap-[7px] border-b-2 border-transparent px-1 text-sm font-semibold text-[#58636f] max-[430px]:text-[13px] ${isActive ? "!border-b-primary !text-primary" : ""}`
            }
          >
            <Eye size={15} />
            阅读
          </NavLink>
        </nav>

        <span className="flex-1" />
        <span className="inline-flex h-5 items-center rounded border border-[#d3a859] bg-[#fff9ed] px-1.5 text-[10px] font-bold whitespace-nowrap text-[#80530a] max-[840px]:hidden">演示环境</span>
        <IdentitySwitcher />
      </div>
    </header>
  );
}
