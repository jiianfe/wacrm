import { ImageResponse } from "next/og";

// PWA icon (192 / 512 px) for the web app manifest. Same mark as
// src/app/icon.tsx, scaled up. `?size=` is clamped to the two sizes the
// manifest asks for.
export const runtime = "edge";

export function GET(request: Request) {
  const asked = Number(new URL(request.url).searchParams.get("size"));
  const size = asked === 512 ? 512 : 192;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#7c3aed",
        }}
      >
        <svg
          width={size * 0.6}
          height={size * 0.6}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
