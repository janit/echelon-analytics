import { createDefine } from "fresh";
import type { DbAdapter } from "./lib/db/adapter.ts";

export interface State {
  db: DbAdapter;
  isAuthenticated: boolean;
  siteId: string;
  // deno-lint-ignore no-explicit-any
  pageData: Record<string, any>;
}

export const define = createDefine<State>();
