import { Edit3, Eye } from "lucide-react";
import { NavLink } from "react-router-dom";
import { IdentitySwitcher } from "./IdentitySwitcher";

/** 顶部品牌、路由导航与身份入口。 */
export function AppHeader() {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="flex shrink-0 items-center gap-2">
          <span className="brand-mark">稻</span>
          <strong className="brand-name text-sm">RiceText</strong>
        </div>

        <nav className="flex h-full items-center gap-4" aria-label="主导航">
          <NavLink
            to="/compose"
            className={({ isActive }) =>
              `route-tab ${isActive ? "!border-b-primary !text-primary" : ""}`
            }
          >
            <Edit3 size={15} />
            编辑
          </NavLink>
          <NavLink
            to="/read"
            className={({ isActive }) =>
              `route-tab ${isActive ? "!border-b-primary !text-primary" : ""}`
            }
          >
            <Eye size={15} />
            阅读
          </NavLink>
        </nav>

        <span className="flex-1" />
        <span className="demo-label desktop-only">演示环境</span>
        <IdentitySwitcher />
      </div>
    </header>
  );
}
