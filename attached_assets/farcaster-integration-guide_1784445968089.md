# راهنمای جامع اتصال اپلیکیشن به Farcaster Mini App

## فهرست مطالب
1. [مفاهیم پایه](#1-مفاهیم-پایه)
2. [ساختار فایل‌ها](#2-ساختار-فایلها)
3. [Manifest - فایل شناسایی اپ](#3-manifest---فایل-شناسایی-اپ)
4. [Embed Preview - پیش‌نمایش لینک در کست‌ها](#4-embed-preview---پیشنمایش-لینک-در-کستها)
5. [SDK و اتصال به فارکستر](#5-sdk-و-اتصال-به-فارکستر)
6. [sdk.actions.ready() - سیگنال آماده بودن اپ](#6-sdkactionsready---سیگنال-آماده-بودن-اپ)
7. [سیستم نوتیفیکیشن](#7-سیستم-نوتیفیکیشن)
8. [Share / composeCast - اشتراک‌گذاری کست](#8-share--composecast---اشتراکگذاری-کست)
9. [Add Mini App Gate - دروازه اضافه کردن اپ](#9-add-mini-app-gate---دروازه-اضافه-کردن-اپ)
10. [اتصال کیف پول (Wallet)](#10-اتصال-کیف-پول-wallet)
11. [مشکلات رایج و راه‌حل‌ها](#11-مشکلات-رایج-و-راهحلها)
12. [چک‌لیست نهایی](#12-چکلیست-نهایی)

---

## 1. مفاهیم پایه

### Mini App چیست؟
Mini App (قبلا Frame v2) یک اپلیکیشن وب است که داخل iframe فارکستر (Warpcast) اجرا می‌شود. کاربران بدون خروج از فارکستر، اپ شما را باز می‌کنند.

### اجزای اصلی
```
┌─────────────────────────────────────────┐
│  Farcaster Client (Warpcast)            │
│  ┌───────────────────────────────────┐  │
│  │  iframe: https://yourapp.xyz      │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │  Your React App             │  │  │
│  │  │  @farcaster/frame-sdk       │  │  │
│  │  │  wagmi (wallet)             │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### ارتباط بین اجزا
```
کلاینت فارکستر (Warpcast)
    ↕ sdk.context (اطلاعات کاربر: fid, username, pfpUrl)
    ↕ sdk.actions (ready, composeCast, addFrame)
    ↕ sdk.on (event listeners)
سرور شما
    ↕ /.well-known/farcaster.json (manifest)
    ↕ /api/webhook (نوتیفیکیشن‌ها)
    ↕ Farcaster API (ارسال نوتیفیکیشن)
```

### پکیج‌های مورد نیاز
```bash
npm install @farcaster/frame-sdk @farcaster/frame-wagmi-connector wagmi viem
```

- `@farcaster/frame-sdk` - SDK اصلی ارتباط با فارکستر
- `@farcaster/frame-wagmi-connector` - اتصال کیف پول فارکستر به wagmi
- `wagmi` - مدیریت کیف پول اتریوم
- `viem` - کتابخانه تعامل با بلاکچین

---

## 2. ساختار فایل‌ها

```
project/
├── client/
│   ├── index.html                          ← متا تگ‌های OG و fc:frame
│   ├── public/
│   │   ├── og-image.png                    ← عکس پیش‌نمایش (3:2 نسبت)
│   │   ├── icon.png                        ← آیکون اپ (200x200)
│   │   └── splash.png                      ← اسپلش اسکرین (200x200)
│   └── src/
│       ├── lib/
│       │   ├── farcaster.ts                ← SDK init, composeCast, addMiniApp, signalReady
│       │   └── wagmi.ts                    ← کانفیگ wagmi + farcaster connector
│       └── components/
│           └── FarcasterProvider.tsx        ← Provider اصلی + AddMiniAppGate
├── server/
│   ├── index.ts                            ← manifest endpoint + static files
│   ├── routes/
│   │   └── webhook.ts                      ← دریافت و ارسال نوتیفیکیشن
│   └── db/
│       └── schema.ts                       ← جدول notification_tokens
```

---

## 3. Manifest - فایل شناسایی اپ

### Manifest چیست؟
فایل JSON که در `/.well-known/farcaster.json` سرو می‌شود و به فارکستر می‌گوید این دامنه یک Mini App است.

### ساختار Manifest (فرمت جدید)

```typescript
// server/index.ts
app.get("/.well-known/farcaster.json", (_req, res) => {
  res.json({
    // 1. امضای دیجیتال - اثبات مالکیت دامنه
    accountAssociation: {
      header: process.env.FC_ACCOUNT_HEADER,    // شامل fid و نوع
      payload: process.env.FC_ACCOUNT_PAYLOAD,   // شامل دامنه
      signature: process.env.FC_ACCOUNT_SIGNATURE, // امضای دیجیتال
    },
    // 2. اطلاعات Mini App
    miniapp: {                    // ⚠️ کلید "miniapp" نه "frame"!
      version: "1",
      name: "PolyCaster",        // حداکثر 32 کاراکتر
      iconUrl: "https://polycaster.xyz/icon.png",       // 200x200px, کمتر از 1MB
      homeUrl: "https://polycaster.xyz",                 // آدرس اصلی اپ
      imageUrl: "https://polycaster.xyz/og-image.png",   // 3:2 نسبت، حداکثر 512 کاراکتر
      buttonTitle: "Open PolyCaster",                    // حداکثر 32 کاراکتر
      splashImageUrl: "https://polycaster.xyz/splash.png", // 200x200px
      splashBackgroundColor: "#020617",                    // رنگ پس‌زمینه اسپلش
      webhookUrl: "https://polycaster.xyz/api/webhook",   // آدرس webhook نوتیفیکیشن
    },
  });
});
```

### نکات مهم Manifest

**کلید `miniapp` نه `frame`:**
```javascript
// ❌ غلط - فرمت قدیمی
{ frame: { name: "...", ... } }

// ✅ درست - فرمت جدید
{ miniapp: { name: "...", ... } }
```

**accountAssociation چیست؟**
امضای دیجیتال که ثابت می‌کند شما مالک این دامنه هستید. از Farcaster Developer Dashboard ساخته می‌شود:
1. برو به https://farcaster.xyz/~/developers/mini-apps
2. QR Code رو با اپ فارکستر اسکن کن
3. دامنه رو وارد کن
4. `header`, `payload`, `signature` رو دریافت و در Environment Variables ذخیره کن

**دامنه باید دقیقا مطابقت کند:**
اگر دامنه‌ات `polycaster.xyz` است، payload دقیقا `{"domain":"polycaster.xyz"}` باید باشد. `www.polycaster.xyz` جواب نمی‌دهد.

### تفاوت Manifest محلی و Hosted

```javascript
// روش 1: Hosted (فارکستر مدیریت می‌کند) - ساده‌تر ولی imageUrl ممکنه نباشه
app.get("/.well-known/farcaster.json", (_req, res) => {
  res.redirect(307, "https://api.farcaster.xyz/miniapps/hosted-manifest/YOUR_ID");
});

// روش 2: محلی (خودت مدیریت می‌کنی) - کنترل کامل ✅
app.get("/.well-known/farcaster.json", (_req, res) => {
  res.json({ accountAssociation: {...}, miniapp: {...} });
});
```

**مزیت محلی:** کنترل کامل روی `imageUrl`، `buttonTitle`، و بقیه فیلدها
**مزیت Hosted:** آپدیت از Developer Dashboard بدون نیاز به deploy

### کش Manifest
فارکستر manifest رو تا **24 ساعت** کش می‌کند. بعد از تغییر، ممکنه تا یک روز طول بکشه تا اعمال بشه.

---

## 4. Embed Preview - پیش‌نمایش لینک در کست‌ها

### Embed Preview چیست؟
وقتی لینک اپت رو تو یه کست share می‌کنی، فارکستر یه پیش‌نمایش (عکس + دکمه) نشون میده. بدون تنظیم درست، پیام "Preview not available" ظاهر می‌شود.

### دو جزء لازم

**جزء 1: متا تگ `fc:frame` در HTML**

```html
<!-- client/index.html -->
<head>
  <!-- متا تگ‌های عادی OG -->
  <meta property="og:title" content="PolyCaster - Predict. Bet. Win." />
  <meta property="og:image" content="https://polycaster.xyz/og-image.png" />

  <!-- ⭐ متا تگ فارکستر - این مهم‌ترین بخشه -->
  <meta name="fc:frame" content='JSON_STRING' />
</head>
```

**ساختار JSON متا تگ fc:frame:**
```json
{
  "version": "1",
  "imageUrl": "https://polycaster.xyz/og-image.png",
  "button": {
    "title": "Open PolyCaster",
    "action": {
      "type": "launch_miniapp",
      "name": "PolyCaster",
      "url": "https://polycaster.xyz",
      "splashImageUrl": "https://polycaster.xyz/splash.png",
      "splashBackgroundColor": "#020617"
    }
  }
}
```

**نکته:** این JSON باید در یک خط و بدون فاصله اضافه باشد:
```html
<meta name="fc:frame" content='{"version":"1","imageUrl":"https://polycaster.xyz/og-image.png","button":{"title":"Open PolyCaster","action":{"type":"launch_miniapp","name":"PolyCaster","url":"https://polycaster.xyz","splashImageUrl":"https://polycaster.xyz/splash.png","splashBackgroundColor":"#020617"}}}' />
```

**جزء 2: فایل عکس og-image.png**

```typescript
// سرو عکس با هدر کش مناسب
app.get("/og-image.png", (_req, res) => {
  res.setHeader("Cache-Control", "public, immutable, no-transform, max-age=300");
  res.sendFile(path.resolve(__dirname, "../client/public/og-image.png"));
});
```

### مشخصات عکس پیش‌نمایش

| ویژگی | مقدار |
|--------|-------|
| **نسبت ابعاد** | 3:2 (مثلا 1200x800 یا 1536x1024) |
| **فرمت** | PNG (توصیه شده)، JPG، GIF، WebP |
| **حداکثر حجم URL** | 512 کاراکتر |
| **هدر کش** | `Cache-Control: public, immutable, no-transform, max-age=300` |

```
✅ 1200 x 800   = 1.50 = 3:2
✅ 1536 x 1024  = 1.50 = 3:2
✅ 600 x 400    = 1.50 = 3:2
❌ 1200 x 630   = 1.90 ≠ 3:2 (این نسبت OG عادیه نه فارکستر)
❌ 1200 x 1200  = 1.00 ≠ 3:2
```

### تفاوت فرمت قدیمی و جدید متا تگ

```html
<!-- ❌ فرمت قدیمی - دیگه کار نمی‌کنه -->
<meta property="fc:frame" content="v2" />
<meta property="fc:frame:button:1" content="Open App" />
<meta property="fc:frame:button:1:action" content="launch_frame" />

<!-- ✅ فرمت جدید - JSON در یک meta tag -->
<meta name="fc:frame" content='{"version":"1","imageUrl":"...","button":{...}}' />
```

### چرا Preview not available می‌آد؟

1. **متا تگ `fc:frame` نیست یا فرمت غلطه** → JSON درست بنویس
2. **`imageUrl` در manifest یا متا تگ نیست** → اضافه کن
3. **نسبت عکس 3:2 نیست** → عکس رو resize کن
4. **عکس قابل دسترسی نیست** → URL رو تو مرورگر چک کن
5. **کش فارکستر** → تا 24 ساعت صبر کن
6. **manifest فرمت `frame` داره بجای `miniapp`** → کلید رو عوض کن

### تست Embed Preview
آدرس: https://farcaster.xyz/~/developers/mini-apps/preview
URL اپت رو وارد کن و ببین درست نمایش داده میشه یا نه.

---

## 5. SDK و اتصال به فارکستر

### مقداردهی اولیه SDK

```typescript
// client/src/lib/farcaster.ts
import sdk from "@farcaster/frame-sdk";

export async function initFarcasterSdk() {
  try {
    // sdk.context یک Promise هست
    // اگر اپ داخل فارکستر باز بشه → اطلاعات کاربر برمیگرده
    // اگر خارج فارکستر باشه → null برمیگرده
    const context = await Promise.race([
      sdk.context,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);

    if (context?.user) {
      const fid = context.user.fid;
      // fid = Farcaster ID - شناسه یکتای هر کاربر فارکستر
      return { user: context.user, isFrameContext: true };
    }
  } catch (err) {
    console.log("Not in Farcaster frame context");
  }
  return { user: null, isFrameContext: false };
}
```

### ساختار context.user
```typescript
interface FarcasterUser {
  fid: number;          // Farcaster ID (عدد یکتا)
  username?: string;    // نام کاربری (مثلا "dwr.eth")
  displayName?: string; // نام نمایشی
  pfpUrl?: string;      // عکس پروفایل
  custody?: string;     // آدرس custody wallet
  verifiedAddresses?: {
    ethAddresses: string[];  // آدرس‌های تایید شده اتریوم
    solAddresses: string[];  // آدرس‌های تایید شده سولانا
  };
}
```

### ساختار context.client
```typescript
interface FrameClient {
  added: boolean;                // آیا کاربر اپ رو اضافه کرده؟
  notificationDetails?: {
    token: string;               // توکن نوتیفیکیشن
    url: string;                 // URL API نوتیفیکیشن فارکستر
  };
}
```

### چرا Promise.race با timeout؟
```typescript
const context = await Promise.race([
  sdk.context,                    // ممکنه هیچوقت resolve نشه (خارج فارکستر)
  new Promise(r => setTimeout(() => r(null), 3000)), // بعد 3 ثانیه null برگردون
]);
```
اگر اپ خارج فارکستر باز بشه، `sdk.context` هیچوقت resolve نمی‌شه. بدون timeout، اپ برای همیشه loading می‌مونه.

---

## 6. sdk.actions.ready() - سیگنال آماده بودن اپ

### ready() چیست؟
وقتی اپ داخل فارکستر باز می‌شود، اول یک splash screen (لوگو + رنگ پس‌زمینه) نمایش داده می‌شود. تا وقتی `sdk.actions.ready()` فراخوانی نشود، این splash screen می‌ماند.

### مشکل رایج: "Ready not called"
```
Developer Mode
Ready not called
Your app hasn't called sdk.actions.ready() yet.
This may cause the splash screen to persist.
```

### زمان درست فراخوانی ready()

```typescript
// ❌ غلط - خیلی زود، قبل از رندر React
export async function initFarcasterSdk() {
  const context = await sdk.context;
  if (context?.user) {
    sdk.actions.ready();  // UI هنوز رندر نشده!
    return { user: context.user, isFrameContext: true };
  }
}

// ✅ درست - بعد از رندر React
export default function FarcasterProvider({ children }) {
  useEffect(() => {
    initFarcasterSdk().then(({ user, isFrameContext }) => {
      setUser(user);
      setIsFrameContext(isFrameContext);
      setIsLoading(false);
      // 100ms تاخیر تا React حتما رندر کنه
      setTimeout(() => signalReady(), 100);
    });
  }, []);
}
```

### تابع signalReady
```typescript
export function signalReady() {
  try {
    sdk.actions.ready();
    console.log("[FC] sdk.actions.ready() called");
  } catch (err) {
    console.error("[FC] ready() error:", err);
  }
}
```

### ترتیب درست عملیات
```
1. initFarcasterSdk()         → context + user دریافت میشه
2. setUser(user)              → state آپدیت میشه
3. setIsLoading(false)        → loading تموم میشه
4. React re-render            → محتوای اپ نمایش داده میشه
5. setTimeout(signalReady)    → splash screen بسته میشه ✅
```

---

## 7. سیستم نوتیفیکیشن

### نوتیفیکیشن چجوری کار میکنه؟

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│ کاربر اپ رو  │ ──→ │ فارکستر     │ ──→ │ سرور شما         │
│ اضافه میکنه  │     │ token و url  │     │ token رو ذخیره   │
│              │     │ میفرسته     │     │ میکنه            │
└──────────────┘     └──────────────┘     └──────────────────┘

┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│ سرور شما     │ ──→ │ Farcaster API    │ ──→ │ کاربر        │
│ POST to url  │     │ نوتیف ارسال      │     │ نوتیف دریافت │
│ با token     │     │ میکنه           │     │ میکنه        │
└──────────────┘     └──────────────────┘     └──────────────┘
```

### مرحله 1: دریافت توکن نوتیفیکیشن

توکن از **سه راه** دریافت می‌شود:

**راه 1: Event Listener در کلاینت**
```typescript
sdk.on("frameAdded", ({ notificationDetails }) => {
  if (notificationDetails?.token && notificationDetails?.url) {
    saveNotificationToken(fid, notificationDetails);
  }
});
```

**راه 2: context.client بعد از init**
```typescript
const clientNotifDetails = (context.client as any)?.notificationDetails;
if (clientNotifDetails?.token && clientNotifDetails?.url) {
  saveNotificationToken(fid, clientNotifDetails);
}
```

**راه 3: Webhook سرور فارکستر (مهم‌ترین)**
فارکستر خودش POST به `webhookUrl` شما می‌فرستد. این درخواست فرمت JWS دارد (header/payload/signature).

### مرحله 2: ذخیره توکن در دیتابیس

**جدول دیتابیس:**
```typescript
export const notificationTokens = pgTable("notification_tokens", {
  id: serial("id").primaryKey(),
  fid: integer("fid").notNull(),        // Farcaster ID کاربر
  token: text("token").notNull(),        // توکن نوتیفیکیشن (UUID)
  url: text("url").notNull(),            // URL API فارکستر
  enabled: boolean("enabled").default(true), // فعال/غیرفعال
  createdAt: timestamp("created_at").defaultNow(),
});
```

**Webhook Handler:**
```typescript
// server/routes/webhook.ts
router.post("/", async (req, res) => {
  const parsed = parseFarcasterEvent(req.body);
  if (!parsed || !parsed.fid) {
    return res.status(400).json({ error: "Missing event or fid" });
  }
  await handleEvent(parsed.event, parsed.fid, parsed.notificationDetails);
  res.json({ success: true });
});
```

### فرمت‌های مختلف Webhook

فارکستر event‌ها رو با فرمت‌های مختلف می‌فرسته. باید همه رو handle کنی:

**فرمت 1: JWS (از سرور فارکستر)**
```json
{
  "header": "eyJmaWQiOjM5MzkwMC...",
  "payload": "eyJkb21haW4iOiJwb2x5Y2FzdGVyLnh5eiJ9",
  "signature": "1idi2VgUanZ1..."
}
```
باید payload رو Base64URL decode کنی:
```typescript
function decodeBase64Url(str: string): string {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf-8');
}
```

**فرمت 2: مستقیم (از کلاینت خودت)**
```json
{
  "event": "miniapp_added",
  "fid": 393900,
  "notificationDetails": {
    "token": "019c6ee0-5f0b-d39e...",
    "url": "https://api.farcaster.xyz/v1/frame-notifications"
  }
}
```

### رویدادهای مختلف

| رویداد | معنی | عملیات |
|--------|------|--------|
| `miniapp_added` / `frame_added` | کاربر اپ رو اضافه کرد | توکن ذخیره کن |
| `miniapp_removed` / `frame_removed` | کاربر اپ رو حذف کرد | توکن رو پاک کن |
| `notifications_enabled` | کاربر نوتیف رو فعال کرد | توکن جدید ذخیره کن |
| `notifications_disabled` | کاربر نوتیف رو غیرفعال کرد | `enabled=false` بذار |

### مرحله 3: ارسال نوتیفیکیشن

```typescript
router.post("/send", async (req, res) => {
  const { title, body, targetUrl, targetFids } = req.body;

  // توکن‌های فعال رو از دیتابیس بخون
  const tokens = await db.select().from(notificationTokens)
    .where(eq(notificationTokens.enabled, true));

  // گروه‌بندی بر اساس URL (معمولا همه یک URL دارن)
  const grouped = {};
  for (const t of tokens) {
    if (!grouped[t.url]) grouped[t.url] = { url: t.url, tokenValues: [] };
    grouped[t.url].tokenValues.push(t.token);
  }

  // ارسال به Farcaster API
  for (const group of Object.values(grouped)) {
    await fetch(group.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notificationId: `myapp-${Date.now()}`,  // ID یکتا
        title: title,                            // عنوان نوتیف
        body: body,                              // متن نوتیف
        targetUrl: targetUrl || "https://myapp.xyz", // لینک هدف
        tokens: group.tokenValues,               // آرایه توکن‌ها
      }),
    });
  }
});
```

### مشکلات رایج نوتیفیکیشن

**مشکل 1: توکن ذخیره نمیشه**
- چک کن که `webhookUrl` در manifest درسته
- چک کن endpoint `/api/webhook` روی سرور فعاله
- چک کن دیتابیس وصله و جدول `notification_tokens` وجود داره

**مشکل 2: JWS payload فید نداره**
```javascript
// payload فارکستر ممکنه fid نداشته باشه!
// {"event":"frame_added","notificationDetails":{...}} ← fid نیست!
// راه‌حل: از کلاینت هم token بفرست (دو-مسیره)
```

**مشکل 3: نوتیف ارسال نمیشه**
- چک کن توکن‌ها enabled هستن: `SELECT * FROM notification_tokens WHERE enabled = true`
- چک کن URL فارکستر درسته: `https://api.farcaster.xyz/v1/frame-notifications`
- لاگ response رو ببین: ممکنه توکن منقضی شده باشه

**مشکل 4: کاربر اپ رو اضافه کرده ولی توکن نیست**
```typescript
// بعد از addFrame، گاهی notificationDetails فوری نمیاد
// راه‌حل: retry با تاخیر
const result = await sdk.actions.addFrame();
let notifDetails = result?.notificationDetails;

if (!notifDetails?.token) {
  await new Promise(r => setTimeout(r, 500));
  const ctx = await sdk.context;
  notifDetails = ctx?.client?.notificationDetails;
}

if (!notifDetails?.token) {
  await new Promise(r => setTimeout(r, 1500));
  const ctx2 = await sdk.context;
  notifDetails = ctx2?.client?.notificationDetails;
}
```

---

## 8. Share / composeCast - اشتراک‌گذاری کست

### composeCast چیست؟
تابعی که پنجره نوشتن کست رو با متن و embed آماده باز می‌کنه.

```typescript
export async function composeCast(text: string, embeds?: string[]) {
  try {
    await sdk.actions.composeCast({
      text,                    // متن کست
      embeds: embeds as any,   // آرایه URL‌ها برای embed
    });
  } catch (err) {
    console.error("Failed to compose cast:", err);
  }
}
```

### مثال استفاده
```typescript
// اشتراک‌گذاری برد
const handleShare = () => {
  const text = `Just claimed 0.05 ETH (~$125.00) in winnings on @polycaster!\n\n"Will ETH hit $3000?"\n\nPredict & win on Base:`;
  composeCast(text, ["https://polycaster.xyz"]);
};
```

### نکات مهم
- `embeds` آرایه‌ای از URL هاست. فارکستر embed اول رو به عنوان پیش‌نمایش نشون میده
- اگر URL در embeds یک Mini App باشه و `fc:frame` متا تگ داشته باشه، پیش‌نمایش Mini App نمایش داده میشه
- متن کست حداکثر 1024 کاراکتر
- حداکثر 2 embed

---

## 9. Add Mini App Gate - دروازه اضافه کردن اپ

### Gate چیست؟
صفحه‌ای که قبل از نمایش اپ اصلی، از کاربر می‌خواهد اپ رو به فارکسترش اضافه کنه. این مهمه چون:
1. دسترسی به نوتیفیکیشن‌ها فعال میشه
2. اپ تو لیست Mini Apps کاربر ظاهر میشه
3. توکن نوتیفیکیشن دریافت میشه

### بررسی وضعیت
```typescript
function AddMiniAppGate({ children, isFrameContext }) {
  const [added, setAdded] = useState(null);

  useEffect(() => {
    if (!isFrameContext) {
      setAdded(true);  // خارج فارکستر → مستقیم نمایش بده
      return;
    }
    (async () => {
      const ctx = await sdk.context;
      if (ctx?.client?.added) {
        setAdded(true);   // قبلا اضافه شده
      } else {
        setAdded(false);  // هنوز اضافه نشده → Gate نمایش بده
      }
    })();
  }, [isFrameContext]);
}
```

### addFrame / addMiniApp
```typescript
export async function addMiniApp() {
  const result = await sdk.actions.addFrame();
  // result.notificationDetails ممکنه باشه یا نباشه
  // retry لازمه...
}
```

---

## 10. اتصال کیف پول (Wallet)

### Farcaster Wagmi Connector
```typescript
// client/src/lib/wagmi.ts
import { farcasterFrame } from "@farcaster/frame-wagmi-connector";
import { createConfig, http } from "wagmi";
import { base } from "wagmi/chains";

export const config = createConfig({
  chains: [base],
  connectors: [farcasterFrame()],   // ← connector فارکستر
  transports: { [base.id]: http() },
});
```

### Auto Connect
وقتی اپ داخل فارکستر باز میشه، کیف پول خودکار وصل میشه:
```typescript
function AutoConnect({ isFrameContext }) {
  const { connect, connectors } = useConnect();

  useEffect(() => {
    if (isFrameContext && connectors.length > 0) {
      connect({ connector: connectors[0] });
    }
  }, [isFrameContext, connectors, connect]);

  return null;
}
```

### ساختار Provider
```tsx
<WagmiProvider config={config}>
  <AutoConnect isFrameContext={isFrameContext} />
  <FarcasterContext.Provider value={{ user, isFrameContext, isLoading, shareMarket }}>
    <AddMiniAppGate isFrameContext={isFrameContext}>
      {children}
    </AddMiniAppGate>
  </FarcasterContext.Provider>
</WagmiProvider>
```

---

## 11. مشکلات رایج و راه‌حل‌ها

### مشکل: "Preview not available"
```
علت: متا تگ fc:frame نیست یا فرمت غلطه
راه‌حل:
1. متا تگ fc:frame با JSON جدید اضافه کن
2. imageUrl نسبت 3:2 داشته باشه
3. manifest کلید "miniapp" داشته باشه (نه "frame")
4. با Embed Tool فارکستر تست کن
```

### مشکل: "Ready not called"
```
علت: sdk.actions.ready() فراخوانی نشده یا خیلی زود فراخوانی شده
راه‌حل:
1. ready() رو از initFarcasterSdk حذف کن
2. بعد از setIsLoading(false) با setTimeout(100ms) فراخوانی کن
3. لاگ "[FC] sdk.actions.ready() called" رو چک کن
```

### مشکل: توکن نوتیفیکیشن ذخیره نمیشه
```
علت‌های ممکن:
1. webhookUrl در manifest غلطه
2. endpoint /api/webhook کار نمی‌کنه
3. جدول notification_tokens وجود نداره
4. فرمت JWS رو درست decode نمی‌کنی

راه‌حل:
1. webhookUrl رو چک کن (باید HTTPS باشه)
2. لاگ‌های webhook رو بخون
3. دیتابیس رو query بزن: SELECT * FROM notification_tokens
4. هم از کلاینت و هم از سرور webhook توکن بفرست (دو-مسیره)
```

### مشکل: اپ داخل فارکستر لود نمیشه
```
علت‌های ممکن:
1. manifest در /.well-known/farcaster.json نیست
2. accountAssociation امضا غلطه
3. دامنه در signature با دامنه واقعی فرق داره
4. homeUrl غلطه

راه‌حل:
1. curl https://yourapp.xyz/.well-known/farcaster.json بزن
2. header/payload/signature رو از Developer Dashboard بگیر
3. دامنه دقیقا یکی باشه (بدون www)
```

### مشکل: کیف پول وصل نمیشه
```
علت: farcasterFrame connector نیست یا AutoConnect نیست
راه‌حل:
1. wagmi.ts رو چک کن: connectors: [farcasterFrame()]
2. AutoConnect کامپوننت فعال باشه
3. isFrameContext === true باشه
```

### مشکل: composeCast کار نمی‌کنه
```
علت: خارج فارکستر هستی یا SDK نیست
راه‌حل:
1. فقط داخل فارکستر کار میکنه
2. اول sdk.context چک شده باشه
3. try/catch بذار
```

---

## 12. چک‌لیست نهایی

### قبل از Deploy

- [ ] `/.well-known/farcaster.json` با فرمت `miniapp` (نه `frame`)
- [ ] `accountAssociation` با header/payload/signature از Developer Dashboard
- [ ] دامنه در signature دقیقا با دامنه واقعی یکی
- [ ] `og-image.png` با نسبت 3:2 و فرمت PNG
- [ ] `icon.png` سایز 200x200 و کمتر از 1MB
- [ ] `splash.png` سایز 200x200
- [ ] متا تگ `fc:frame` با JSON جدید در index.html
- [ ] `sdk.actions.ready()` بعد از رندر React فراخوانی میشه
- [ ] Webhook endpoint `/api/webhook` فعال و لاگ‌دار
- [ ] جدول `notification_tokens` در دیتابیس وجود داره
- [ ] Event listener‌ها (frameAdded, notificationsEnabled, ...) ست شدن
- [ ] `farcasterFrame()` در wagmi connectors هست
- [ ] AutoConnect برای وصل خودکار کیف پول فعاله

### بعد از Deploy

- [ ] `curl https://yourapp.xyz/.well-known/farcaster.json` جواب JSON درست میده
- [ ] `curl https://yourapp.xyz/og-image.png` عکس رو میده
- [ ] با Embed Tool فارکستر (https://farcaster.xyz/~/developers/mini-apps/preview) تست کن
- [ ] اپ رو داخل Warpcast باز کن و splash screen بسته بشه
- [ ] اپ رو Add کن و توکن نوتیفیکیشن ذخیره بشه
- [ ] یه کست share کن و پیش‌نمایش نمایش داده بشه
- [ ] نوتیفیکیشن تست ارسال کن

### محیط‌های مختلف دیتابیس

```
Development DB: محیط کدنویسی (Replit editor)
Production DB: محیط اپ پابلیش شده

نکته: توکن‌های نوتیفیکیشن فقط تو Production DB ذخیره میشن
چون کاربران اپ پابلیش شده رو استفاده میکنن.
```

---

## مرجع سریع API

### SDK Actions
```typescript
sdk.actions.ready()                          // سیگنال آماده بودن
sdk.actions.composeCast({ text, embeds })     // باز کردن پنجره کست
sdk.actions.addFrame()                        // درخواست اضافه کردن اپ
```

### SDK Events
```typescript
sdk.on("frameAdded", ({ notificationDetails }) => {})
sdk.on("frameRemoved", () => {})
sdk.on("notificationsEnabled", ({ notificationDetails }) => {})
sdk.on("notificationsDisabled", () => {})
```

### SDK Context
```typescript
const context = await sdk.context;
context.user.fid           // Farcaster ID
context.user.username       // نام کاربری
context.user.pfpUrl        // عکس پروفایل
context.client.added       // اپ اضافه شده؟
context.client.notificationDetails  // توکن نوتیفیکیشن
```

### Notification API
```
POST https://api.farcaster.xyz/v1/frame-notifications
Body: {
  notificationId: "unique-id",
  title: "عنوان",
  body: "متن",
  targetUrl: "https://yourapp.xyz",
  tokens: ["token1", "token2"]
}
```

---

## منابع
- مستندات رسمی: https://miniapps.farcaster.xyz
- Specification: https://miniapps.farcaster.xyz/docs/specification
- Embed Tool: https://farcaster.xyz/~/developers/mini-apps/preview
- Developer Dashboard: https://farcaster.xyz/~/developers/mini-apps
- SDK: https://www.npmjs.com/package/@farcaster/frame-sdk
