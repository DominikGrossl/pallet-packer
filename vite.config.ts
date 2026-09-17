import { defineConfig, type Plugin, type Connect } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {
  AUTH_COOKIE,
  authTokenForPassword,
  buildAuthCookie,
  expectedAuthToken,
  getSitePassword,
  isPublicPath,
  timingSafeEqual,
} from "./lib/site-auth.ts";

function readCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

function siteAuthDevPlugin(): Plugin {
  const attach = (middlewares: Connect.Server) => {
    middlewares.use(async (req, res, next) => {
      try {
        const host = req.headers.host ?? "localhost";
        const url = new URL(req.url ?? "/", `http://${host}`);
        const pathname = url.pathname;

        if (pathname === "/api/login" && req.method === "POST") {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          const raw = Buffer.concat(chunks).toString("utf8");
          let password = "";
          const contentType = req.headers["content-type"] ?? "";
          if (contentType.includes("application/json")) {
            const body = JSON.parse(raw) as { password?: unknown };
            password = typeof body.password === "string" ? body.password : "";
          } else {
            password = new URLSearchParams(raw).get("password") ?? "";
          }

          if (!timingSafeEqual(password, getSitePassword())) {
            res.statusCode = 401;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ ok: false, error: "Nesprávné heslo" }));
            return;
          }

          const token = await authTokenForPassword(password);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Set-Cookie", buildAuthCookie(token, url.toString()));
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (isPublicPath(pathname)) {
          next();
          return;
        }

        const cookies = readCookies(req.headers.cookie);
        const expected = await expectedAuthToken();
        if (cookies[AUTH_COOKIE] && timingSafeEqual(cookies[AUTH_COOKIE], expected)) {
          next();
          return;
        }

        const loginUrl = new URL("/login.html", url.origin);
        loginUrl.searchParams.set("next", pathname === "/" ? "/" : pathname);
        res.statusCode = 302;
        res.setHeader("Location", loginUrl.pathname + loginUrl.search);
        res.end();
      } catch (error) {
        next(error as Error);
      }
    });
  };

  return {
    name: "site-auth-dev",
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), siteAuthDevPlugin()],
});
