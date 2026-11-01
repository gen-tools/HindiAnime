import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "Hindi Anime - Watch Hindi Dubbed Anime Online";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "linear-gradient(135deg, #070908 0%, #0f1713 50%, #050706 100%)",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          fontFamily: "sans-serif",
          padding: "60px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "8px 24px",
            background: "rgba(34, 197, 94, 0.15)",
            border: "1px solid rgba(34, 197, 94, 0.4)",
            borderRadius: "9999px",
            marginBottom: "28px",
          }}
        >
          <span
            style={{
              color: "#22c55e",
              fontSize: "20px",
              fontWeight: 700,
              letterSpacing: "1px",
              textTransform: "uppercase",
            }}
          >
            🇮🇳 Hindi Dubbed Anime
          </span>
        </div>

        <h1
          style={{
            fontSize: "72px",
            fontWeight: 900,
            color: "#ffffff",
            textAlign: "center",
            lineHeight: 1.1,
            margin: 0,
          }}
        >
          Hindi Anime
        </h1>

        <p
          style={{
            fontSize: "30px",
            color: "#9ca3af",
            textAlign: "center",
            marginTop: "20px",
            maxWidth: "900px",
            lineHeight: 1.4,
          }}
        >
          Watch Hindi, Tamil, Telugu, English &amp; Japanese Dubbed Anime in HD
        </p>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "36px",
            marginTop: "40px",
          }}
        >
          <span style={{ color: "#22c55e", fontSize: "20px", fontWeight: 600 }}>
            ✓ 1080p HD Streaming
          </span>
          <span style={{ color: "#22c55e", fontSize: "20px", fontWeight: 600 }}>
            ✓ Fast Multi-Server Proxy
          </span>
          <span style={{ color: "#22c55e", fontSize: "20px", fontWeight: 600 }}>
            ✓ Ad-Free Experience
          </span>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
