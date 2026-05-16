import { Navigate, Route, Routes } from "react-router-dom";
import Chat from "./screens/Chat";
import History from "./screens/History";
import Result from "./screens/Result";
import Scanner from "./screens/Scanner";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Scanner />} />
      <Route path="/history" element={<History />} />
      <Route path="/result" element={<Result />} />
      <Route path="/result/:id" element={<Result />} />
      <Route path="/result/:id/chat" element={<Chat />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
