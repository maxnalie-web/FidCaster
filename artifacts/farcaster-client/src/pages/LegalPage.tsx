import { useEffect, useState } from "react";
import { FidCasterLogo } from "@/components/FidCasterLogo";
import { XLogo, TelegramLogo } from "@/components/NeynarScoreBadge";
import { useLocation } from "wouter";
import { motion } from "framer-motion";

type Tab = "terms" | "privacy";

export function LegalPage() {
  const [location] = useLocation();
  const [tab, setTab] = useState<Tab>(location.includes("privacy") ? "privacy" : "terms");

  useEffect(() => { window.scrollTo(0, 0); }, [tab]);

  return (
    <div className="min-h-screen text-white" style={{
      background: "radial-gradient(ellipse 80% 60% at 50% -10%, #12052e 0%, #060018 45%, #020008 100%)",
    }}>
      {/* Grid bg */}
      <div className="fixed inset-0 pointer-events-none lp-grid-bg" style={{ zIndex: 0 }} />
      <div className="fixed pointer-events-none" style={{
        top: "0%", left: "5%", width: "60vw", height: "60vw", maxWidth: 800, maxHeight: 800,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(124,58,237,0.18) 0%, rgba(109,40,217,0.05) 45%, transparent 68%)",
        filter: "blur(55px)", zIndex: 0,
      }} />

      {/* Nav */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-6 md:px-12 py-4 border-b" style={{
        borderColor: "rgba(255,255,255,0.06)",
        background: "rgba(2,0,8,0.85)",
        backdropFilter: "blur(16px)",
      }}>
        <a href="/" className="flex items-center gap-2.5 no-underline">
          <FidCasterLogo size={26} showName={false} />
          <span className="font-bold text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>FidCaster</span>
        </a>
        <div className="hidden md:flex items-center gap-6 text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
          <a href="/" className="hover:text-white/70 transition-colors">Home</a>
          <a href="https://docs.fidcaster.xyz" className="hover:text-white/70 transition-colors">Docs</a>
          <a href="/download" className="hover:text-white/70 transition-colors">Download</a>
        </div>
        <a href="/login" className="lp-cta-btn text-sm px-4 py-2" style={{ padding: "6px 16px" }}>
          Open App
        </a>
      </nav>

      {/* Hero */}
      <div className="relative z-10 max-w-4xl mx-auto px-6 pt-16 pb-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <p className="text-xs uppercase tracking-widest mb-3 font-semibold" style={{ color: "rgba(124,58,237,0.9)" }}>Legal</p>
          <h1 className="text-5xl md:text-6xl font-black mb-4" style={{ letterSpacing: "-0.03em" }}>
            {tab === "terms" ? "Terms of Service" : "Privacy Policy"}
          </h1>
          <p className="text-base mb-8" style={{ color: "rgba(255,255,255,0.35)" }}>Last updated: July 2025</p>

          {/* Tab switcher */}
          <div className="inline-flex items-center gap-1 p-1 rounded-xl mb-10" style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}>
            {(["terms", "privacy"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="px-5 py-2 rounded-lg text-sm font-semibold transition-all"
                style={tab === t ? {
                  background: "linear-gradient(135deg, rgba(124,58,237,0.6) 0%, rgba(99,102,241,0.6) 100%)",
                  color: "#fff",
                  boxShadow: "0 2px 12px rgba(124,58,237,0.3)",
                } : { color: "rgba(255,255,255,0.4)" }}
              >
                {t === "terms" ? "Terms of Service" : "Privacy Policy"}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Content */}
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          {tab === "terms"
            ? <TermsContent onSwitch={() => setTab("privacy")} />
            : <PrivacyContent onSwitch={() => setTab("terms")} />}
        </motion.div>
      </div>

      {/* Footer */}
      <footer className="relative z-10 border-t px-6 md:px-12 py-8 mt-16" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <FidCasterLogo size={22} showName={false} />
            <span className="text-white/50 text-sm font-semibold">FidCaster</span>
            <span className="text-white/20 text-xs">· The Farcaster client for power users.</span>
          </div>
          <div className="flex items-center gap-6 text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>
            <a href="/legal" className="hover:text-white/50 transition-colors">Terms</a>
            <a href="/legal" onClick={(e) => { e.preventDefault(); setTab("privacy"); }} className="hover:text-white/50 transition-colors">Privacy</a>
            <a href="https://docs.fidcaster.xyz" className="hover:text-white/50 transition-colors">Docs</a>
            <span>© {new Date().getFullYear()} FidCaster</span>
          </div>
          <div className="flex items-center gap-3" style={{ color: "rgba(255,255,255,0.25)" }}>
            <a href="https://x.com/fidcaster" target="_blank" rel="noopener noreferrer" className="hover:text-white/60 transition-colors"><XLogo size={14} /></a>
            <a href="https://t.me/Fidcaster" target="_blank" rel="noopener noreferrer" className="hover:text-white/60 transition-colors"><TelegramLogo size={14} /></a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── Shared primitives ── */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-lg font-bold text-white mt-12 mb-4 pb-3" style={{ borderBottom: "1px solid rgba(124,58,237,0.2)" }}>
      {children}
    </h2>
  );
}
function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold mt-6 mb-2" style={{ color: "rgba(255,255,255,0.75)" }}>{children}</h3>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed mb-3" style={{ color: "rgba(255,255,255,0.5)" }}>{children}</p>;
}
function Callout({ icon, children }: { icon?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl px-5 py-4 my-6 text-sm leading-relaxed flex gap-3" style={{
      background: "rgba(124,58,237,0.08)",
      border: "1px solid rgba(124,58,237,0.2)",
      color: "rgba(255,255,255,0.6)",
    }}>
      {icon && <span className="text-base shrink-0">{icon}</span>}
      <div>{children}</div>
    </div>
  );
}
function BulletList({ items, icon = "•" }: { items: string[]; icon?: string }) {
  return (
    <ul className="text-sm space-y-2 mb-4 pl-1" style={{ color: "rgba(255,255,255,0.5)" }}>
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2.5">
          <span className="shrink-0 mt-0.5" style={{ color: icon === "✗" ? "#22c55e" : "rgba(124,58,237,0.9)" }}>{icon}</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
function Card({ name, desc }: { name: string; desc: string }) {
  return (
    <div className="flex gap-3 text-sm p-3.5 rounded-xl" style={{
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.07)",
    }}>
      <span className="font-semibold shrink-0 w-28" style={{ color: "rgba(255,255,255,0.65)" }}>{name}</span>
      <span style={{ color: "rgba(255,255,255,0.4)" }}>{desc}</span>
    </div>
  );
}

/* ── Terms ── */
function TermsContent({ onSwitch }: { onSwitch: () => void }) {
  return (
    <div className="max-w-3xl">
      <Callout icon="📋">
        <strong className="text-white">TL;DR -</strong> FidCaster is an open-source client for the Farcaster protocol. Your private keys stay on your device. We sell nothing. Using the service means you accept these terms.
      </Callout>

      <SectionHeading>1. Acceptance</SectionHeading>
      <P>By accessing or using FidCaster (fidcaster.xyz and all subdomains, mobile apps, and related services), you agree to these Terms. If you don't agree, please don't use the service.</P>

      <SectionHeading>2. What FidCaster Is</SectionHeading>
      <P>FidCaster is a user interface (client) for the decentralized Farcaster protocol. We don't store, control, or own your identity or messages - everything lives on Farcaster's public infrastructure (hubs and Optimism smart contracts).</P>

      <SubHeading>2.1 Key Management</SubHeading>
      <P>Your private keys and seed phrase are stored exclusively on your device, encrypted with AES-GCM-256. They are never sent to our servers. You are solely responsible for keeping them safe.</P>

      <SubHeading>2.2 FID Market</SubHeading>
      <P>The FID Market is a peer-to-peer platform for buying and selling Farcaster IDs. Transactions happen directly on the Optimism blockchain. FidCaster is not a financial intermediary and bears no responsibility for transaction outcomes.</P>

      <SubHeading>2.3 Built-in Wallet</SubHeading>
      <P>The in-app EVM wallet is a self-custody tool. You control your keys. FidCaster cannot recover lost funds, reverse transactions, or access your assets.</P>

      <SectionHeading>3. Your Responsibilities</SectionHeading>
      <P>By using FidCaster you agree to:</P>
      <BulletList items={[
        "Not publish illegal, abusive, or harmful content.",
        "Not use the service for spam, phishing, or network manipulation.",
        "Not harm other users or the Farcaster network infrastructure.",
        "Comply with Farcaster protocol rules and the Optimism network.",
        "Be at least 18 years old, or use the service with parental consent.",
      ]} />

      <SectionHeading>4. Limitation of Liability</SectionHeading>
      <P>FidCaster is provided "as-is." We make no guarantees about uptime, data accuracy, or blockchain transaction outcomes. To the maximum extent permitted by law, our liability for any damages is limited to zero.</P>

      <Callout icon="⚠️">
        <strong className="text-white">Blockchain transactions are irreversible.</strong> Always double-check addresses and amounts before confirming. FidCaster is not liable for digital asset losses caused by user error.
      </Callout>

      <SectionHeading>5. Intellectual Property</SectionHeading>
      <P>FidCaster's code is open source. Content you publish belongs to you and is stored on the public Farcaster protocol. The FidCaster name and logo are owned by the development team.</P>

      <SectionHeading>6. Changes to These Terms</SectionHeading>
      <P>We may update these Terms. For material changes, we'll announce via our official channels (X/Telegram). Continued use after notice means you accept the updated terms.</P>

      <SectionHeading>7. Governing Law</SectionHeading>
      <P>These Terms are governed by principles applicable to decentralized internet protocols. Given the decentralized nature of Farcaster, no single jurisdiction takes precedence.</P>

      <div className="mt-12 pt-6 border-t text-sm" style={{ borderColor: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.3)" }}>
        Also read our{" "}
        <button onClick={onSwitch} className="underline hover:text-white/60 transition-colors">Privacy Policy</button>.
      </div>
    </div>
  );
}

/* ── Privacy ── */
function PrivacyContent({ onSwitch }: { onSwitch: () => void }) {
  return (
    <div className="max-w-3xl">
      <Callout icon="🔒">
        <strong className="text-white">TL;DR -</strong> We don't sell your data. Private keys never touch our servers. Your Farcaster data is public by nature - we just display it.
      </Callout>

      <SectionHeading>1. What We Don't Collect</SectionHeading>
      <P>FidCaster does <strong className="text-white">not</strong> collect, store, or process:</P>
      <BulletList icon="✗" items={[
        "Private keys, seed phrases, or passwords - these live only on your device.",
        "Email addresses, real names, phone numbers, or any identity data beyond your Farcaster profile.",
        "Browsing history or in-app behavior.",
        "Payment information - transactions go directly to the blockchain.",
      ]} />

      <SectionHeading>2. What We Do Use</SectionHeading>

      <SubHeading>2.1 Public Farcaster Data</SubHeading>
      <P>Your profile, casts, followers, and other data live on the public Farcaster protocol. FidCaster reads this from Farcaster hubs and the Neynar API to render the UI. This data is inherently public.</P>

      <SubHeading>2.2 Local Device Storage</SubHeading>
      <P>The following is stored only on your device (IndexedDB / localStorage) and never sent to our servers:</P>
      <BulletList items={[
        "Encrypted vault (seed phrase encrypted with AES-GCM-256 + PBKDF2 200k iterations)",
        "App preferences and display settings",
        "Address book and wallet list",
      ]} />

      <SubHeading>2.3 Server Logs</SubHeading>
      <P>Our servers keep standard HTTP logs (IP address, request path, response code) for a short period for security and debugging. These logs are never sold or transferred to third parties.</P>

      <SectionHeading>3. Third-Party Services</SectionHeading>
      <P>FidCaster uses the following third-party services:</P>
      <div className="space-y-2 my-4">
        {[
          { name: "Neynar", desc: "Farcaster read/write API - delivers public protocol data." },
          { name: "Cloudinary", desc: "Upload and hosting of profile images and cast media." },
          { name: "Optimism / Base RPC", desc: "Sending blockchain transactions for signer registration and FID Market." },
          { name: "Blockscout", desc: "Fetching ERC-20 token balances for your wallet." },
        ].map((s) => <Card key={s.name} {...s} />)}
      </div>
      <P>Each of these services has its own independent privacy policy.</P>

      <SectionHeading>4. Data Sharing</SectionHeading>
      <P>We do <strong className="text-white">not</strong> sell, rent, or transfer your information to third parties - except:</P>
      <BulletList items={[
        "Legal requirements or court orders (only server logs would be available).",
        "Data you yourself have published to the public Farcaster protocol.",
      ]} />

      <SectionHeading>5. Security</SectionHeading>
      <P>AES-GCM-256 encryption with a PBKDF2-derived key (200,000 iterations) protects your local vault. Server communication is encrypted over HTTPS. That said, no system is 100% secure - always store your seed phrase in a safe place.</P>

      <SectionHeading>6. Your Rights</SectionHeading>
      <P>Since we don't store personal data, data deletion requests to us are moot. To remove data from the Farcaster protocol itself, use the protocol's own tools (e.g. the Key Registry contract on Optimism).</P>

      <SectionHeading>7. Contact</SectionHeading>
      <P>Questions or concerns? Reach us through our official channels:</P>
      <div className="flex gap-4 mt-3">
        <a href="https://x.com/fidcaster" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm hover:text-white/70 transition-colors"
          style={{ color: "rgba(255,255,255,0.4)" }}>
          <XLogo size={14} /> @fidcaster
        </a>
        <a href="https://t.me/Fidcaster" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm hover:text-white/70 transition-colors"
          style={{ color: "rgba(255,255,255,0.4)" }}>
          <TelegramLogo size={14} /> Telegram
        </a>
      </div>

      <div className="mt-12 pt-6 border-t text-sm" style={{ borderColor: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.3)" }}>
        Also read our{" "}
        <button onClick={onSwitch} className="underline hover:text-white/60 transition-colors">Terms of Service</button>.
      </div>
    </div>
  );
}
