import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import Home from "./screens/Home";
import Capture from "./screens/Capture";
import Result from "./screens/Result";
import Chat from "./screens/Chat";
import Settings from "./screens/Settings";

function HomeLayout() {
  return (
    <div className="relative">
      <div className="absolute right-4 top-7 z-[1] md:right-12">
        <Link
          to="/settings"
          className="text-[22px] leading-none opacity-85 hover:opacity-100"
          aria-label="Settings"
        >
          ⚙︎
        </Link>
      </div>
      <Home />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeLayout />} />
        <Route path="/capture" element={<Capture />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/result/:id/chat" element={<Chat />} />
        <Route path="/result/:id" element={<Result />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
