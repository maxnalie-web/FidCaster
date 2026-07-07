---
name: FidCaster video upload backend
description: Which services handle video uploads and what URL format they return
---

# Rule
For video uploads in FidCaster (server/index.ts upload-image endpoint):
1. Cloudinary (if configured) — best, permanent
2. **catbox.moe** — added as video-only fallback: POST to `https://catbox.moe/user/api.php` with `reqtype=fileupload` + `fileToUpload`; returns `https://files.catbox.moe/xxx.mp4` direct URL
3. tmpfiles.org — last resort; API returns `https://tmpfiles.org/ID/file.mp4` (page URL); must transform to `https://tmpfiles.org/dl/ID/file.mp4` for direct download

**Why:** Warpcast and other Farcaster clients detect video by checking if the embed URL directly serves a video file. Page URLs (tmpfiles.org without /dl/) return HTML, causing "no preview found for shared link" error.
