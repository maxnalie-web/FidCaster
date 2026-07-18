// Auto-generated content for the in-app docs pages (src/pages/DocsPage.tsx).
// Each entry's html is static, author-written markup (no user input) rendered via
// dangerouslySetInnerHTML, styled by src/pages/docs-content.css.
export interface DocSection {
  id: string;
  label: string;
  num: string;
  html: string;
}

export const DOC_SECTIONS: DocSection[] = [
  {
    id: "getting-started",
    label: "Getting Started",
    num: "01",
    html: `<h2>Getting Started</h2>
        <p>FidCaster is entirely <strong>client-side</strong> - there's no email/password signup. Your identity <em>is</em> your Farcaster ID (FID), and you sign in with one of three methods below.</p>

        <h3>Sign-in methods</h3>
        <div class="card-grid">
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#7c3aed;--ic2:#a855f7;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg></div>
            <h4>Seed Phrase</h4>
            <p>The primary method. Enter your 12/24-word mnemonic to derive your wallet and signer locally.</p>
          </div>
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#6366f1;--ic2:#818cf8;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg></div>
            <h4>External Wallet</h4>
            <p>Connect MetaMask or any WalletConnect v2-compatible wallet.</p>
          </div>
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#a855f7;--ic2:#c084fc;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg></div>
            <h4>Sign In with Farcaster</h4>
            <p>Scan a QR code and approve in Warpcast for fast, read-only access.</p>
          </div>
        </div>

        <h3>1. Seed phrase (primary)</h3>
        <ol class="step-list">
          <li><strong>Enter your mnemonic.</strong> Type your existing 12 or 24-word seed phrase on the sign-in screen - or generate a new one if you're creating an account.</li>
          <li><strong>Local key derivation.</strong> FidCaster derives your custody wallet at <code>m/44'/60'/0'/0/0</code> and your Ed25519 Farcaster signer at <code>m/44'/60'/0'/0/1</code>, entirely inside your browser.</li>
          <li><strong>Vault encryption.</strong> Your mnemonic is encrypted with <strong>AES-GCM-256</strong>, using a key derived via <strong>PBKDF2 (200,000 iterations)</strong>, and stored in your browser's IndexedDB.</li>
          <li><strong>On-chain registration.</strong> If needed, your new signer is registered on Farcaster's <strong>Key Registry</strong> contract on Optimism.</li>
        </ol>

        <div class="callout warn">
          <div class="icon-wrap"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
          <p><strong>Your seed phrase never leaves your device.</strong> It is never sent to any server. Keep it safe - nobody, including the FidCaster team, can recover it for you.</p>
        </div>

        <h3>2. External wallet (MetaMask / WalletConnect)</h3>
        <p>Prefer to use a wallet you already have? Choose "Connect Wallet," sign a message to deterministically derive a Farcaster signer, and register it on-chain - your wallet stays fully under your control.</p>

        <h3>3. Sign In with Farcaster (SIWF)</h3>
        <p>For fast, read-only access: FidCaster builds an EIP-712 signed-key request locally, shows a QR code, and polls for approval once you confirm it in Warpcast.</p>

        <h3>Returning sessions</h3>
        <p>After your first login, you only need your <strong>local password</strong> to unlock your encrypted vault on future visits - no need to re-enter your seed phrase.</p>

        <h3>Multi-account management</h3>
        <p>Add and switch between <strong>multiple Farcaster accounts</strong> in one browser. Each account is stored and managed independently, batch operations for different accounts run concurrently without interfering with each other, and your account list stays in sync across open tabs.</p>`,
  },
  {
    id: "feed-casting",
    label: "Feed & Casting",
    num: "02",
    html: `<h2>Feed &amp; Casting</h2>
        <p>FidCaster gives you four distinct views into the Farcaster network, plus a full-featured composer for posting.</p>

        <h3>Feeds</h3>
        <table>
          <thead><tr><th>Feed</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><strong>Following</strong></td><td>Casts from accounts you follow, in chronological order</td></tr>
            <tr><td><strong>For You</strong></td><td>A personalized feed based on your engagement and interests</td></tr>
            <tr><td><strong>Trending</strong></td><td>The most-engaged casts on the network right now</td></tr>
            <tr><td><strong>Channels</strong></td><td>Posts scoped to a specific topical channel</td></tr>
          </tbody>
        </table>
        <p>Every feed uses <strong>infinite scroll</strong> - new content loads automatically as you scroll.</p>

        <h3>Writing a cast</h3>
        <ul>
          <li>Write your text within Farcaster's standard length limit.</li>
          <li>Attach an image - uploaded and hosted via <strong>Imgur</strong>.</li>
          <li>Pick a destination channel.</li>
          <li>Reply to, or quote, any existing cast.</li>
        </ul>
        <p>Every cast is signed locally in your browser and submitted directly as a signed message to a <strong>Farcaster hub</strong> - the FidCaster server is only a technical relay, never a party that can alter or withhold your content.</p>

        <h3>Reactions</h3>
        <p>All reactions are <strong>on-hub</strong> - written directly to the Farcaster protocol, not a proprietary database:</p>
        <div class="card-grid">
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#db2777;--ic2:#f472b6;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div>
            <h4>Like</h4><p>React to any cast instantly.</p>
          </div>
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#059669;--ic2:#34d399;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg></div>
            <h4>Recast</h4><p>Share a cast to your own followers.</p>
          </div>
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#0ea5e9;--ic2:#38bdf8;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
            <h4>Quote</h4><p>Add your own commentary above a cast.</p>
          </div>
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#7c3aed;--ic2:#a855f7;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/></svg></div>
            <h4>Follow</h4><p>Follow the author directly from their cast.</p>
          </div>
        </div>

        <h3>Threads</h3>
        <p>Opening a cast reveals the full conversation - replies and nested replies - and you can respond right from the same view.</p>

        <h3>Search &amp; profiles</h3>
        <p>Search across <strong>users and casts</strong> simultaneously, powered by Neynar's search infrastructure. Any profile shows display info, follower/following counts, and full cast history - and on your own profile, you can edit your display name, bio, avatar, and username.</p>`,
  },
  {
    id: "fid-market",
    label: "FID Market",
    num: "03",
    html: `<h2>FID Market</h2>
        <p>The <strong>FID Market</strong> is FidCaster's signature feature: a peer-to-peer marketplace for Farcaster IDs, fully implemented on-chain on <strong>Optimism</strong>. No custodian ever holds your funds or your identity - every trade is atomic and on-chain.</p>

        <div class="callout info">
          <div class="icon-wrap"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></div>
          <p><strong>Market contract</strong> - <code>0xcc11C0Bc08bbF8A5C0AAca80E884C6c7CC0eE3c3</code> on Optimism Mainnet.</p>
        </div>

        <h3>Selling a FID</h3>
        <ol class="step-list">
          <li><strong>List it.</strong> From the market page, choose "List."</li>
          <li><strong>Set a price.</strong> Specify your asking price in ETH.</li>
          <li><strong>Set a duration.</strong> Choose how long the listing stays active - from 10 minutes to 30 days.</li>
          <li><strong>Sign the transaction.</strong> Once confirmed, your FID is immediately visible and purchasable on the market.</li>
        </ol>
        <p>You can <strong>cancel</strong> your listing at any time before it's bought.</p>

        <h3>Buying a FID</h3>
        <ol class="step-list">
          <li><strong>Browse.</strong> Filter and sort the active listings on the market page.</li>
          <li><strong>Inspect.</strong> Open a listing to see price history, seller info, and its live on-chain state.</li>
          <li><strong>Buy.</strong> Confirm the transaction - ownership transfers atomically and instantly on Optimism.</li>
        </ol>

        <div class="callout tip">
          <div class="icon-wrap"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg></div>
          <p>A <strong>9% protocol fee</strong> applies to every successful trade, automatically deducted from the buy transaction.</p>
        </div>

        <h3>If your own FID is sold</h3>
        <p>If the FID tied to your active account gets purchased by someone else, ownership transfers immediately and irreversibly. FidCaster surfaces this with a dedicated screen so you're never left confused about your account state. Be certain before you list.</p>

        <h3>Market transparency</h3>
        <p>Every <code>Listed</code>, <code>Bought</code>, and <code>Cancelled</code> event is read straight from Optimism - nothing shown in the market activity feed is centralized or unverifiable.</p>`,
  },
  {
    id: "grow-cleanup",
    label: "Grow & Clean Up",
    num: "04",
    html: `<h2>Grow &amp; Clean Up</h2>
        <p>The <strong>Follow</strong> page gives you two powerful tools for managing your network at scale: <strong>Grow</strong> (smart batch-follow) and <strong>Clean Up</strong> (automated batch-unfollow).</p>

        <h3>Grow - smart batch-follow</h3>
        <ol class="step-list">
          <li><strong>Pick a target.</strong> Search for a profile whose audience you want to grow into - e.g., a large account in your niche.</li>
          <li><strong>Scan.</strong> FidCaster scans up to <strong>10,000</strong> of that profile's followers or following.</li>
          <li><strong>Filter precisely.</strong> Narrow the results with min/max follower count, Power Badge only, Farcaster Pro only, sort order, and an exclusion list.</li>
          <li><strong>Dedup check.</strong> Existing follow status is checked in bulk before anything runs, so you never re-follow someone you already follow.</li>
          <li><strong>Run it.</strong> A floating progress pill tracks the operation - it survives navigation across the whole app.</li>
        </ol>

        <div class="card-grid">
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#6366f1;--ic2:#818cf8;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div>
            <h4>Follower range</h4><p>Set min/max follower thresholds.</p>
          </div>
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#eab308;--ic2:#facc15;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
            <h4>Power Badge only</h4><p>Target Warpcast's verified active users.</p>
          </div>
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#a855f7;--ic2:#c084fc;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg></div>
            <h4>Pro subscribers only</h4><p>Target Farcaster Pro ($10/mo) members.</p>
          </div>
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#ef4444;--ic2:#f87171;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/></svg></div>
            <h4>Exclusion list</h4><p>Skip specific FIDs or usernames.</p>
          </div>
        </div>

        <div class="callout tip">
          <div class="icon-wrap"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg></div>
          <p>When strict filters (min followers, Power Badge, Pro) are active, FidCaster bypasses the 15-minute local cache and runs a full live scan - so results stay accurate.</p>
        </div>

        <h3>Clean Up - automated unfollow</h3>
        <p>Using the same engine, batch-unfollow accounts that don't follow you back - narrowed down with the same advanced filters as Grow.</p>

        <h3>Run multiple accounts at once</h3>
        <p>If you manage several Farcaster accounts in FidCaster, you can run Grow or Clean Up for <strong>each account independently and simultaneously</strong>. Each operation's state is saved and automatically resumes if you close or reload the page.</p>

        <h3>Rate limiting, by design</h3>
        <ul>
          <li>A <strong>1.5-second</strong> gap is enforced between every follow/unfollow action.</li>
          <li>Signer errors auto-retry up to <strong>3 times</strong>, 90 seconds apart.</li>
          <li>Rate-limit responses auto-retry up to <strong>3 times</strong>, 62 seconds apart.</li>
        </ul>`,
  },
  {
    id: "wallet-security",
    label: "Wallet & Security",
    num: "05",
    html: `<h2>Wallet &amp; Security</h2>
        <p>Security is FidCaster's foundational design principle. This section explains exactly <strong>what</strong> is stored, <strong>where</strong>, and <strong>how</strong>.</p>

        <h3>Security architecture</h3>
        <pre><code>Your seed phrase
      │
      ▼
PBKDF2-SHA256  (200,000 iterations, random 16-byte salt)
      │
      ▼
AES-GCM-256 encryption ──► stored in your browser's IndexedDB
                              (non-extractable CryptoKey)

Signer derivation (browser-only):
  seed phrase ─► HDKey ─► m/44'/60'/0'/0/1 ─► Ed25519 private key
                                                      │
                                                      ▼
                                        Registered on Farcaster's
                                        Key Registry (on-chain, Optimism)</code></pre>

        <h3>Guarantees</h3>
        <div class="card-grid">
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#7c3aed;--ic2:#a855f7;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
            <h4>Local-only secrets</h4><p>Your seed phrase never leaves your device - always encrypted at rest.</p>
          </div>
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#0ea5e9;--ic2:#38bdf8;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="2" y1="9" x2="22" y2="9"/></svg></div>
            <h4>No server custody</h4><p>No server, including FidCaster's own, ever receives your private key.</p>
          </div>
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#db2777;--ic2:#f472b6;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg></div>
            <h4>Local signing</h4><p>Signing always happens in your browser, never remotely.</p>
          </div>
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#f97316;--ic2:#fb923c;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
            <h4>Auto-lock</h4><p>Your session locks automatically on inactivity or a hidden tab.</p>
          </div>
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#059669;--ic2:#34d399;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
            <h4>Rate limiting</h4><p>Every server endpoint enforces request rate limits.</p>
          </div>
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#6366f1;--ic2:#818cf8;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
            <h4>Input validation</h4><p>Every server route validates FID bounds, hex formats, and addresses.</p>
          </div>
        </div>

        <h3>Wallet</h3>
        <p>The wallet panel shows your connected account's <strong>ETH balance</strong> and <strong>recent on-chain transactions</strong>.</p>

        <h3>Recovery address</h3>
        <p>Every FID has a <strong>recovery address</strong> that can reclaim control if you ever lose access to your primary key. In FidCaster you can view your current recovery address and jump straight to the on-chain transaction to update it.</p>

        <div class="callout tip">
          <div class="icon-wrap"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></svg></div>
          <p>We recommend setting your recovery address to a secure, separate wallet - ideally a hardware wallet.</p>
        </div>

        <h3>Security checklist</h3>
        <ul>
          <li>Only ever type your seed phrase on FidCaster's official sign-in screen.</li>
          <li>Never share your local vault password with anyone.</li>
          <li>Always double-check transaction details before selling a FID or moving funds.</li>
          <li>On shared or public devices, always lock or log out when you're done.</li>
        </ul>`,
  },
  {
    id: "mini-apps",
    label: "Mini Apps & Notifications",
    num: "06",
    html: `<h2>Mini Apps &amp; Notifications</h2>

        <h3>Mini Apps</h3>
        <p>Browse and launch <strong>Farcaster Mini Apps</strong> directly inside FidCaster - no need to leave the app or install anything separately.</p>
        <ul>
          <li>The catalog is fetched live from Farcaster's infrastructure.</li>
          <li>On web, Mini Apps open in an embedded iframe.</li>
          <li>On mobile (iOS/Android), Mini Apps open in a <strong>native in-app browser</strong> for a smoother, safer experience.</li>
        </ul>

        <h3>Notifications</h3>
        <p>The notifications panel is a live feed of everything relevant to your account:</p>
        <div class="card-grid">
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#db2777;--ic2:#f472b6;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></div>
            <h4>Likes</h4><p>See who liked your casts.</p>
          </div>
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#059669;--ic2:#34d399;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg></div>
            <h4>Recasts</h4><p>Track shares of your content.</p>
          </div>
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#7c3aed;--ic2:#a855f7;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="16" y1="11" x2="22" y2="11"/></svg></div>
            <h4>New follows</h4><p>Know instantly when someone follows you.</p>
          </div>
          <div class="lp-feature-card feature-card">
            <div class="icon-badge" style="--ic1:#0ea5e9;--ic2:#38bdf8;"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg></div>
            <h4>Mentions</h4><p>Catch every time you're tagged in a cast.</p>
          </div>
        </div>
        <p>Notifications are grouped by time, and a red badge on the icon shows your unread count.</p>`,
  },
  {
    id: "mobile",
    label: "Mobile Apps",
    num: "07",
    html: `<h2>Mobile Apps</h2>
        <p>Beyond the web app, FidCaster ships as a native application for <strong>iOS</strong> and <strong>Android</strong>, built with Capacitor.</p>

        <h3>How mobile differs from web</h3>
        <p>The feature set is identical to the web experience, with these distinctions:</p>
        <ul>
          <li><strong>Mini Apps</strong> open in a native in-app browser rather than an iframe.</li>
          <li>Secure vault storage leverages the OS's native security capabilities.</li>
          <li>Navigation and touch interactions are tuned for iOS and Android conventions.</li>
        </ul>

        <h3>Security on mobile</h3>
        <p>Exactly as on web: your seed phrase never leaves your device, all signing happens locally, and session auto-lock on inactivity is fully active.</p>`,
  },
  {
    id: "faq",
    label: "FAQ & Support",
    num: "08",
    html: `<h2>FAQ &amp; Support</h2>

        <div class="faq-item">
          <div class="faq-q"><span class="q-mark">Q.</span>Does FidCaster ever store or transmit my seed phrase?</div>
          <p class="faq-a">No. Your seed phrase is never sent to any server. It's encrypted with AES-GCM-256 and kept strictly local to your browser or device (IndexedDB). See <a href="/docs/wallet-security">Wallet &amp; Security</a> for details.</p>
        </div>
        <div class="faq-item">
          <div class="faq-q"><span class="q-mark">Q.</span>What if I forget my local password?</div>
          <p class="faq-a">Since your local password only decrypts the vault on that specific device - and neither it nor your seed phrase is ever stored server-side - the only way back in is signing in again with your <strong>original seed phrase</strong>.</p>
        </div>
        <div class="faq-item">
          <div class="faq-q"><span class="q-mark">Q.</span>What's the FID Market fee?</div>
          <p class="faq-a">A <strong>9%</strong> protocol fee applies to every successful trade, automatically calculated and deducted during the buy transaction.</p>
        </div>
        <div class="faq-item">
          <div class="faq-q"><span class="q-mark">Q.</span>Can I cancel a FID listing?</div>
          <p class="faq-a">Yes - as long as it hasn't been bought yet, you can cancel your listing at any time.</p>
        </div>
        <div class="faq-item">
          <div class="faq-q"><span class="q-mark">Q.</span>Is batch-following (Grow) risky for my account?</div>
          <p class="faq-a">FidCaster enforces sensible, protocol-friendly delays between actions and automatically adapts to Farcaster's rate limits. That said, tune your filters to genuine intent and avoid overly aggressive activity on brand-new accounts.</p>
        </div>
        <div class="faq-item">
          <div class="faq-q"><span class="q-mark">Q.</span>Can I manage multiple Farcaster accounts at once?</div>
          <p class="faq-a">Yes. FidCaster supports adding multiple accounts and running operations like Grow or Clean Up independently and concurrently for each. See <a href="/docs/getting-started">Getting Started</a>.</p>
        </div>
        <div class="faq-item">
          <div class="faq-q"><span class="q-mark">Q.</span>Which network powers the FID Market and signer registration?</div>
          <p class="faq-a">Both run on <strong>Optimism Mainnet</strong>.</p>
        </div>
        <div class="faq-item">
          <div class="faq-q"><span class="q-mark">Q.</span>How do Mini Apps open on mobile?</div>
          <p class="faq-a">On iOS and Android, Mini Apps open inside a native in-app browser for a safer, smoother experience than a web iframe.</p>
        </div>

        <h3 style="margin-top:40px;">Need more help?</h3>
        <p>Open an issue on the project's GitHub repository to report a bug or request a feature.</p>`,
  },
];
