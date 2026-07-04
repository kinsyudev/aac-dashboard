import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

function getFsAllowList() {
  const allowList = new Set([searchForWorkspaceRoot(process.cwd())]);
  const gitPath = path.resolve(process.cwd(), ".git");

  try {
    if (!lstatSync(gitPath).isFile()) {
      return [...allowList];
    }

    // Git worktrees store ".git" as a pointer to the shared checkout metadata.
    const gitDir = readFileSync(gitPath, "utf8")
      .trim()
      .replace(/^gitdir:\s*/, "");

    if (!gitDir) {
      return [...allowList];
    }

    allowList.add(path.resolve(gitDir, "..", "..", ".."));
  } catch {
    return [...allowList];
  }

  return [...allowList];
}

export default defineConfig({
  server: {
    fs: {
      allow: getFsAllowList(),
    },
    port: 3000,
  },
  plugins: [
    tsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    nitro(),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
});
