import { next } from "@vercel/edge";
import {
  AUTH_COOKIE,
  expectedAuthToken,
  isPublicPath,
  timingSafeEqual,
} from "./lib/site-auth";

export default async function middleware(request: Request) {
  const { pathname } = new URL(request.url);

  if (isPublicPath(pathname)) {
    return next();
  }

  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${AUTH_COOKIE}=([^;]*)`));
  const presented = match?.[1] ?? "";
  const expected = await expectedAuthToken();

  if (presented && timingSafeEqual(presented, expected)) {
    return next();
  }

  const loginUrl = new URL("/login.html", request.url);
  loginUrl.searchParams.set("next", pathname === "/" ? "/" : pathname);
  return Response.redirect(loginUrl, 302);
}
