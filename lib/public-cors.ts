import { NextResponse } from "next/server";

export const publicCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type ResponseInitWithHeaders = ResponseInit & {
  headers?: HeadersInit;
};

export function withPublicCors(init: ResponseInitWithHeaders = {}): ResponseInitWithHeaders {
  return {
    ...init,
    headers: {
      ...publicCorsHeaders,
      ...(init.headers ?? {}),
    },
  };
}

export function publicJson(data: unknown, init: ResponseInitWithHeaders = {}) {
  return NextResponse.json(data, withPublicCors(init));
}

export function publicError(message: string, status = 500, init: ResponseInitWithHeaders = {}) {
  return new NextResponse(message, withPublicCors({ ...init, status }));
}
