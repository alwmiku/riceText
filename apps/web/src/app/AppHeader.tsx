import { Edit3, Eye } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { IdentitySwitcher } from "./IdentitySwitcher";

/** 顶部品牌、路由导航与身份入口；移动端向下阅读时自动收起。 */
export function AppHeader() {
  const [hidden, setHidden] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const mobile = window.matchMedia?.("(max-width: 840px)");
    const isMobile = () => mobile?.matches ?? window.innerWidth <= 840;
    lastScrollY.current = window.scrollY;
    const handleScroll = () => {
      if (!isMobile()) return;
      const current = Math.max(0, window.scrollY);
      if (current <= 16) setHidden(false);
      else if (current > lastScrollY.current + 8) setHidden(true);
      else if (current < lastScrollY.current - 8) setHidden(false);
      lastScrollY.current = current;
    };
    const handleViewportChange = () => {
      lastScrollY.current = window.scrollY;
      if (!isMobile()) setHidden(false);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    mobile?.addEventListener("change", handleViewportChange);
    return () => {
      window.removeEventListener("scroll", handleScroll);
      mobile?.removeEventListener("change", handleViewportChange);
    };
  }, []);

  return (
    <header
      data-hidden={hidden}
      className="sticky top-0 z-30 h-[58px] border-b border-border bg-white/95 backdrop-blur-xl transition-transform duration-200 ease-out max-[840px]:data-[hidden=true]:pointer-events-none max-[840px]:data-[hidden=true]:-translate-y-full max-[430px]:h-[54px]"
    >
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
        <span className="inline-flex h-5 items-center rounded border border-[#d3a859] bg-[#fff9ed] px-1.5 text-[10px] font-bold whitespace-nowrap text-[#80530a] max-[840px]:hidden">本地环境</span>
        <IdentitySwitcher />
      </div>
    </header>
  );
}
