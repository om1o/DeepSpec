import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { setActiveAccount } from "../lib/accountScope";

beforeEach(() => setActiveAccount("test-user"));
