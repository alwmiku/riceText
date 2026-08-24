import { BrowserRouter } from "react-router-dom";
import { AppHeader } from "./app/AppHeader";
import { AppRoutes } from "./app/AppRoutes";
import { useDemoIdentity } from "./app/useDemoIdentity";
import { AppContext } from "./app-context";

/** 应用根组件；负责路由、身份恢复和身份选择持久化。 */
export default function App() {
  const value = useDemoIdentity();

  return (
    <AppContext.Provider value={value}>
      <BrowserRouter>
        <div className="min-h-screen bg-[#f7f9fa]">
          <AppHeader />
          <AppRoutes />
        </div>
      </BrowserRouter>
    </AppContext.Provider>
  );
}
