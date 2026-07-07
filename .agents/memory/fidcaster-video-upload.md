---
name: FidCaster video upload backend
description: Which free video hosting services work from Replit server IPs and serve direct video URLs for Warpcast embeds
---

# Rule
For video uploads in FidCaster (server/index.ts upload-image endpoint):
1. Cloudinary (if configured) — best, permanent
2. **litterbox.catbox.moe** — video-only fallback: POST to `https://litterbox.catbox.moe/resources/internals/api.php` with `reqtype=fileupload`, `time=72h`, `fileToUpload`; returns `https://litter.catbox.moe/xxx.mp4` direct CDN URL
3. tmpfiles.org — last resort only; always returns HTML pages, Warpcast cannot preview

**Why:**
- `catbox.moe` (permanent endpoint) returns HTTP 412 "Invalid uploader" from Replit/cloud server IPs — blocked at IP level.
- `litterbox.catbox.moe` (temporary, ≤72h) accepts cloud server IPs and returns direct `.mp4` CDN URLs that Warpcast detects as video.
- `tmpfiles.org`: the `/dl/` URL prefix idea was WRONG — it does a 302 redirect back to the page URL. Both URL formats return `text/html`, never the raw video file.
- `0x0.st` has uploads fully disabled (bot abuse).
- Warpcast detects video when embed URL ends in `.mp4`/`.webm` AND serves `Content-Type: video/mp4`.

**How to apply:**
- litterbox files expire after 72h — acceptable for real-time video casts
- If Cloudinary is configured, it wins (permanent, best quality)
- Do NOT try to fix tmpfiles.org — it fundamentally cannot serve direct video files
