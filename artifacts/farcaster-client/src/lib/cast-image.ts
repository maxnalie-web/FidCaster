import type { NeynarCast } from "@/lib/neynar";

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines;
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous"; // needed to read pixels back out via toBlob
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // CORS-blocked or broken · caller falls back gracefully
    img.src = url;
  });
}

function drawRoundedAvatar(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, x: number, y: number, size: number, fallbackLetter: string) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    ctx.drawImage(img, x, y, size, size);
  } else {
    ctx.fillStyle = "#8B5CF6";
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${size * 0.45}px -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fallbackLetter.toUpperCase(), x + size / 2, y + size / 2 + 2);
  }
  ctx.restore();
}

/**
 * Renders a cast as a shareable PNG card: author, text, and the FidCaster
 * wordmark in the top-right corner. Avatar/embed images are best-effort · a
 * CORS-blocked host just falls back to an initial-letter avatar rather than
 * failing the whole export (canvas.toBlob throws on any tainted external
 * pixel, so nothing untrusted is drawn without crossOrigin succeeding first).
 */
export async function renderCastToImage(cast: NeynarCast): Promise<Blob> {
  const W = 1080;
  const PAD = 56;
  const canvas = document.createElement("canvas");
  const ctx2d = canvas.getContext("2d");
  if (!ctx2d) throw new Error("Canvas not supported");
  // Re-bind with a definite (non-null) type · TS doesn't retain the null-check
  // narrowing of `ctx2d` inside the `drawIcon` function declared further below.
  const ctx: CanvasRenderingContext2D = ctx2d;

  // Measure text height first so we can size the canvas before final drawing.
  ctx.font = "500 40px -apple-system, Segoe UI, Roboto, sans-serif";
  const textLines = wrapText(ctx, cast.text || "", W - PAD * 2);
  const lineHeight = 54;
  const headerH = 170;
  const footerH = 90;
  const H = headerH + textLines.length * lineHeight + footerH + 40;
  canvas.width = W;
  canvas.height = H;

  // Background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // FidCaster wordmark, top-right
  const logo = await loadImage("/fidcaster-logo-v2.png");
  const logoSize = 44;
  if (logo) ctx.drawImage(logo, W - PAD - logoSize, PAD - 10, logoSize, logoSize);
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "700 22px -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText("FidCaster", W - PAD - logoSize - 12, PAD - 10 + logoSize / 2);

  // Avatar + author
  const avatarSize = 72;
  const avatarImg = cast.author.pfp_url ? await loadImage(cast.author.pfp_url) : null;
  drawRoundedAvatar(ctx, avatarImg, PAD, PAD, avatarSize, cast.author.username?.[0] || "?");

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#0f0f0f";
  ctx.font = "700 30px -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText(cast.author.display_name || cast.author.username, PAD + avatarSize + 18, PAD + 32);
  ctx.fillStyle = "#6b6b6b";
  ctx.font = "500 24px -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.fillText(`@${cast.author.username}`, PAD + avatarSize + 18, PAD + 64);

  // Cast text
  ctx.fillStyle = "#111111";
  ctx.font = "500 40px -apple-system, Segoe UI, Roboto, sans-serif";
  let ty = headerH + 34;
  for (const line of textLines) {
    ctx.fillText(line, PAD, ty);
    ty += lineHeight;
  }

  // Footer divider + engagement stats + brand line
  ctx.strokeStyle = "#e5e5e5";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, H - footerH + 10);
  ctx.lineTo(W - PAD, H - footerH + 10);
  ctx.stroke();

  // Reply / Recast / Like icons · drawn as real lucide vector paths (same source
  // paths as MessageCircle / Repeat2 / Heart in CastCard's action bar) rather than
  // emoji, so the share image reads as an authentic extension of the app's own UI
  // instead of a generic social-card mockup.
  const ICON_PATHS = {
    reply:  ["M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"],
    recast: ["m2 9 3-3 3 3", "M13 18H7a2 2 0 0 1-2-2V6", "m22 15-3 3-3-3", "M11 6h6a2 2 0 0 1 2 2v10"],
    like:   ["M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"],
  } as const;

  function drawIcon(paths: readonly string[], x: number, y: number, size: number, color: string) {
    const scale = size / 24; // lucide paths are authored on a 24x24 grid
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const d of paths) ctx.stroke(new Path2D(d));
    ctx.restore();
  }

  const likes   = cast.reactions?.likes_count ?? 0;
  const recasts = cast.reactions?.recasts_count ?? 0;
  const replies = cast.replies?.count ?? 0;
  const iconSize = 26;
  const fy = H - footerH + 40;
  let fx = PAD;
  ctx.textBaseline = "alphabetic";
  const MUTED = "#71717a"; // matches the app's default (non-active) action-bar icon color
  const stat = (paths: readonly string[], n: number) => {
    drawIcon(paths, fx, fy, iconSize, MUTED);
    fx += iconSize + 8;
    ctx.font = "700 24px -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = "#3a3a3a";
    const label = n.toLocaleString();
    ctx.fillText(label, fx, fy + iconSize - 5);
    fx += ctx.measureText(label).width + 32;
  };
  stat(ICON_PATHS.reply, replies);
  stat(ICON_PATHS.recast, recasts);
  stat(ICON_PATHS.like, likes);

  ctx.fillStyle = "#9a9a9a";
  ctx.font = "500 22px -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("Shared from FidCaster", W - PAD, fy);
  ctx.textAlign = "left";

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Failed to render image"))), "image/png");
  });
}
