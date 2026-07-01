import { useEffect, useState } from "react";
import { getUseCase } from "./config/useCases";
import type { UseCaseId } from "./config/useCases";
import { hashFor, routeFromHash, type RouteState } from "./config/routing";
import { ArchitecturePage } from "./pages/ArchitecturePage";
import { DemoPage } from "./pages/DemoPage";
import { LandingPage } from "./pages/LandingPage";
import { ToastProvider } from "./ui/Toast";
import { SubRosaProvider } from "@sub-rosa/react";
import { RPC_URL } from "./lib/chain";

export default function App() {
  const [route, setRoute] = useState<RouteState>(routeFromHash);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function navigate(page: RouteState["page"], useCase: UseCaseId = route.useCase) {
    window.location.hash = hashFor(page, useCase);
    setRoute({ page, useCase });
  }

  const active = getUseCase(route.useCase);

  return (
    <ToastProvider>
      <SubRosaProvider config={{ rpcUrl: RPC_URL, networkPassphrase: "Test SDF Network ; September 2015" }}>
        {route.page === "landing" ? (
          <LandingPage
            onDemo={() => navigate("demo", "grants")}
            onCase={(id) => navigate("demo", id)}
          />
        ) : route.page === "architecture" ? (
          <ArchitecturePage goHome={() => navigate("landing")} />
        ) : (
          <DemoPage
            active={active}
            setActive={(id) => navigate("demo", id)}
            goHome={() => navigate("landing")}
          />
        )}
      </SubRosaProvider>
    </ToastProvider>
  );
}
