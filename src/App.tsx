import { Navigate, Route, Routes } from "react-router-dom";
import Result from "./screens/Result";
import Scanner from "./screens/Scanner";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Scanner />} />
      <Route path="/result" element={<Result />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
