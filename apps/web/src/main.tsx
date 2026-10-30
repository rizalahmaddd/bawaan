import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { currentSurface } from "./lib/surface";
import { PageSpinner } from "./ui/Feedback";
import "./styles/app.css";
import "./ui/ui.css";

const Landing = lazy(() => import("./surfaces/Landing"));
const Legal = lazy(() => import("./surfaces/Legal"));
const SellerApp = lazy(() => import("./seller/SellerApp"));
const Store = lazy(() => import("./surfaces/Store"));
const NotFound = lazy(() => import("./surfaces/NotFound"));
const Gallery = lazy(() => import("./surfaces/Gallery"));

function Root() {
  if (location.pathname.replace(/\/$/, "") === "/gallery") return <Gallery />;
  const surface = currentSurface();
  switch (surface.kind) {
    case "landing": {
      const page = location.pathname.replace(/\/$/, "");
      if (page === "/privasi" || page === "/syarat") return <Legal page={page.slice(1) as "privasi" | "syarat"} />;
      return <Landing />;
    }
    case "app":
      return <SellerApp />;
    case "store":
      return <Store slug={surface.slug} />;
    default:
      return <NotFound />;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<PageSpinner />}>
      <Root />
    </Suspense>
  </StrictMode>,
);
