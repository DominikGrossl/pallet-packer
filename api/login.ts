import {
  authTokenForPassword,
  buildAuthCookie,
  getSitePassword,
  timingSafeEqual,
} from "../lib/site-auth";

export const config = {
  runtime: "edge",
};

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  let password = "";
  const contentType = request.headers.get("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const body = (await request.json()) as { password?: unknown };
      password = typeof body.password === "string" ? body.password : "";
    } else {
      const form = await request.formData();
      const value = form.get("password");
      password = typeof value === "string" ? value : "";
    }
  } catch {
    return json({ ok: false, error: "Neplatný požadavek" }, 400);
  }

  if (!timingSafeEqual(password, getSitePassword())) {
    return json({ ok: false, error: "Nesprávné heslo" }, 401);
  }

  const token = await authTokenForPassword(password);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": buildAuthCookie(token, request.url),
      "Cache-Control": "no-store",
    },
  });
}

function json(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
