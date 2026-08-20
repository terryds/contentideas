import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Nav } from "./components/Nav";
import { Inbox } from "./pages/Inbox";
import { Editor } from "./pages/Editor";
import { Sources } from "./pages/Sources";
import { Runs } from "./pages/Runs";
import { Settings } from "./pages/Settings";
import "./styles/tokens.css";
import "./styles/app.css";

function Shell() {
  const [unreachable, setUnreachable] = useState(false);
  const location = useLocation();
  const wide = location.pathname.startsWith("/item/") || location.pathname.startsWith("/cluster/");

  useEffect(() => {
    const down = () => setUnreachable(true);
    const up = () => setUnreachable(false);
    window.addEventListener("api-unreachable", down);
    window.addEventListener("api-reachable", up);
    return () => {
      window.removeEventListener("api-unreachable", down);
      window.removeEventListener("api-reachable", up);
    };
  }, []);

  return (
    <div className={wide ? "shell shell-wide" : "shell"}>
      <Nav />
      {unreachable && <div className="banner-error">Server not responding — is the process running?</div>}
      <Routes>
        <Route path="/" element={<Inbox />} />
        <Route path="/item/:id" element={<Editor />} />
        <Route path="/cluster/:id" element={<Editor clusterMode />} />
        <Route path="/sources" element={<Sources />} />
        <Route path="/runs" element={<Runs />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  </StrictMode>,
);
