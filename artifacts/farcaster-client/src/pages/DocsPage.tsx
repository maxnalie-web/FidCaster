import { useEffect, useState } from "react";
import { useLocation, useRoute, Link } from "wouter";
import { ArrowLeft, Menu, X } from "lucide-react";
import { FidCasterLogo } from "@/components/FidCasterLogo";
import { isDocsSubdomain } from "@/App";
import { DOC_SECTIONS, type DocSection } from "@/pages/docsContent";
import { cn } from "@/lib/utils";
import "./docs-content.css";

// On docs.fidcaster.xyz, sections live at "/getting-started" etc. (no "/docs"
// prefix - the hostname already says "docs"). On the main domain they live at
// "/docs/getting-started". Both cases are served by the same DocsPage.
function sectionHref(onDocsHost: boolean, id?: string): string {
  if (onDocsHost) return id ? `/${id}` : "/";
  return id ? `/docs/${id}` : "/docs";
}

/* Mirrors LoginPage/DownloadPage's background tone so the docs feel like
   part of the same site instead of a separately-styled static page. */
function BackgroundGlow() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
      <div className="absolute inset-0" style={{
        background: "radial-gradient(ellipse 80% 60% at 50% -10%, #12052e 0%, #060018 45%, #020008 100%)",
      }} />
      <div className="absolute" style={{
        top: "0%", left: "10%", width: "55vw", height: "55vw", maxWidth: 700, maxHeight: 700,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(124,58,237,0.2) 0%, rgba(109,40,217,0.06) 45%, transparent 68%)",
        filter: "blur(60px)",
      }} />
      <div className="absolute" style={{
        bottom: "5%", right: "5%", width: "45vw", height: "45vw", maxWidth: 600, maxHeight: 600,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(99,102,241,0.16) 0%, rgba(79,70,229,0.05) 50%, transparent 70%)",
        filter: "blur(70px)",
      }} />
    </div>
  );
}

const OVERVIEW_ID = "";

function SidebarLinks({ activeId, onDocsHost, onNavigate }: { activeId: string; onDocsHost: boolean; onNavigate?: () => void }) {
  return (
    <>
      <div className="text-[0.68rem] uppercase tracking-[0.1em] font-extrabold text-white/25 px-3.5 mb-2">Overview</div>
      <Link
        href={sectionHref(onDocsHost)}
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] text-[0.87rem] font-semibold mb-0.5 no-underline transition-colors",
          activeId === OVERVIEW_ID ? "bg-gradient-to-r from-violet-500/25 to-transparent text-violet-300" : "text-white/50 hover:bg-white/5 hover:text-white"
        )}
      >
        <span className="text-[0.72rem] w-[18px] font-bold" style={{ color: activeId === OVERVIEW_ID ? "#a78bfa" : "rgba(255,255,255,0.25)" }}>·</span>
        Introduction
      </Link>
      <div className="text-[0.68rem] uppercase tracking-[0.1em] font-extrabold text-white/25 px-3.5 mt-6 mb-2">Guide</div>
      {DOC_SECTIONS.map((s) => (
        <Link
          key={s.id}
          href={sectionHref(onDocsHost, s.id)}
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] text-[0.87rem] font-semibold mb-0.5 no-underline transition-colors",
            activeId === s.id ? "bg-gradient-to-r from-violet-500/25 to-transparent text-violet-300" : "text-white/50 hover:bg-white/5 hover:text-white"
          )}
        >
          <span className="text-[0.72rem] w-[18px] font-bold" style={{ color: activeId === s.id ? "#a78bfa" : "rgba(255,255,255,0.25)" }}>{s.num}</span>
          {s.label}
        </Link>
      ))}
    </>
  );
}

function IntroContent({ onDocsHost }: { onDocsHost: boolean }) {
  return (
    <div className="max-w-[800px] mx-auto px-6 md:px-9 pt-10 md:pt-16 pb-24">
      <div className="text-center mb-14">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold mb-6"
          style={{ background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.26)", color: "#c4b5fd" }}>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Documentation · Live on Optimism
        </div>
        <h1 className="font-black leading-[1.05] mb-4" style={{ fontSize: "clamp(2.1rem,5vw,3.6rem)", letterSpacing: "-0.035em" }}>
          <span className="bg-gradient-to-r from-violet-300 via-fuchsia-300 to-indigo-300 bg-clip-text text-transparent">Master every part</span>
          <br />
          <span className="text-white">of FidCaster.</span>
        </h1>
        <p className="text-lg text-white/45 max-w-[600px] mx-auto mb-2">
          The only Farcaster client with a built-in peer-to-peer FID marketplace on Optimism.
        </p>
        <p className="text-sm text-white/25 max-w-[480px] mx-auto">
          A precise, complete guide to every feature - written for real use, not marketing.
        </p>
      </div>

      <h2 className="text-white text-2xl font-black mb-3">Documentation Contents</h2>
      <p className="text-white/50 mb-6">Pick a section below, or use the sidebar to jump straight to what you need.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {DOC_SECTIONS.map((s) => (
          <Link
            key={s.id}
            href={sectionHref(onDocsHost, s.id)}
            className="rounded-[1.1rem] p-6 no-underline transition-all hover:-translate-y-1"
            style={{ background: "rgba(15,8,40,0.6)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <span className="font-bold text-white">{s.num} · {s.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function SectionNav({ prev, next }: { prev: { href: string; label: string } | null; next: { href: string; label: string } | null }) {
  return (
    <div className="flex justify-between gap-4 mt-9 pt-7" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
      {prev ? (
        <Link href={prev.href} className="flex-1 flex flex-col gap-1 p-4 rounded-2xl no-underline text-white transition-all hover:-translate-y-0.5"
          style={{ background: "rgba(15,8,40,0.5)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <span className="text-[0.68rem] uppercase tracking-wide text-white/30">Previous</span>
          <span className="font-bold text-sm">← {prev.label}</span>
        </Link>
      ) : <span className="flex-1" />}
      {next ? (
        <Link href={next.href} className="flex-1 flex flex-col items-end gap-1 p-4 rounded-2xl no-underline text-white text-right transition-all hover:-translate-y-0.5"
          style={{ background: "rgba(15,8,40,0.5)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <span className="text-[0.68rem] uppercase tracking-wide text-white/30">Next</span>
          <span className="font-bold text-sm">{next.label} →</span>
        </Link>
      ) : null}
    </div>
  );
}

export function DocsPage() {
  const [, navigate] = useLocation();
  const onDocsHost = isDocsSubdomain();
  const [, prefixedParams] = useRoute<{ section?: string }>("/docs/:section");
  const [, hostParams] = useRoute<{ section?: string }>("/:section");
  const section = onDocsHost ? hostParams?.section : prefixedParams?.section;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // "Back home" always means the marketing site's actual root - on the docs
  // subdomain, wouter's own "/" already resolves to the docs overview here,
  // so this has to be a real cross-host navigation, not a relative one.
  const goHome = () => {
    if (onDocsHost) window.location.href = "https://fidcaster.xyz";
    else navigate("/");
  };

  const current: DocSection | undefined = section ? DOC_SECTIONS.find((s) => s.id === section) : undefined;
  const activeId = current ? current.id : OVERVIEW_ID;

  useEffect(() => {
    document.title = current ? `${current.label} - FidCaster Docs` : "FidCaster Docs - User Guide";
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    setMobileNavOpen(false);
  }, [section]);

  const idx = current ? DOC_SECTIONS.findIndex((s) => s.id === current.id) : -1;
  const prev = current
    ? (idx > 0 ? { href: sectionHref(onDocsHost, DOC_SECTIONS[idx - 1].id), label: DOC_SECTIONS[idx - 1].label } : { href: sectionHref(onDocsHost), label: "Introduction" })
    : null;
  const next = current && idx < DOC_SECTIONS.length - 1 ? { href: sectionHref(onDocsHost, DOC_SECTIONS[idx + 1].id), label: DOC_SECTIONS[idx + 1].label } : null;

  // Cross-links inside the section content (e.g. the FAQ pointing at Wallet &
  // Security) are hardcoded to "/docs/<id>" in docsContent.ts - strip that
  // prefix on the docs subdomain where sections live at "/<id>" instead.
  const sectionHtml = current ? (onDocsHost ? current.html.replace(/href="\/docs\//g, 'href="/') : current.html) : "";

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden" style={{ background: "#040110" }}>
      <BackgroundGlow />

      <nav className="fixed top-0 left-0 right-0 flex items-center justify-between px-4 md:px-10 py-4"
        style={{
          zIndex: 50, background: "rgba(4,1,16,0.7)",
          borderBottom: "1px solid rgba(255,255,255,0.05)", backdropFilter: "blur(20px)",
        }}
      >
        <div className="flex items-center gap-1.5 md:gap-3">
          <button
            className="md:hidden p-2 -ml-1 rounded-lg text-white/70"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label="Toggle sections menu"
          >
            {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <button onClick={goHome} className="flex items-center gap-2.5">
            <FidCasterLogo size={26} showName={false} />
            <span className="text-white font-black text-base" style={{ letterSpacing: "-0.02em" }}>FidCaster Docs</span>
          </button>
        </div>
        <div className="hidden md:flex items-center gap-6 text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
          <Link href={sectionHref(onDocsHost, "getting-started")} className="hover:text-white/70 transition-colors no-underline">Guide</Link>
          <Link href={sectionHref(onDocsHost, "fid-market")} className="hover:text-white/70 transition-colors no-underline">FID Market</Link>
          <Link href={sectionHref(onDocsHost, "faq")} className="hover:text-white/70 transition-colors no-underline">FAQ</Link>
        </div>
        <button
          onClick={goHome}
          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200"
          style={{ background: "rgba(124,58,237,0.18)", border: "1px solid rgba(124,58,237,0.35)", color: "#c4b5fd" }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back home
        </button>
      </nav>

      <div className="flex max-w-[1360px] mx-auto pt-[70px] relative" style={{ zIndex: 1 }}>
        <aside className="hidden md:block w-[262px] shrink-0 sticky top-[70px] self-start py-8 px-3.5 overflow-y-auto" style={{ height: "calc(100vh - 70px)" }}>
          <SidebarLinks activeId={activeId} onDocsHost={onDocsHost} />
        </aside>

        {mobileNavOpen && (
          <div className="md:hidden fixed inset-0 z-40" style={{ top: 62 }}>
            <div className="absolute inset-0 bg-black/60" onClick={() => setMobileNavOpen(false)} />
            <aside className="relative w-[80vw] max-w-[300px] h-full overflow-y-auto py-6 px-3.5" style={{ background: "#07021b", borderRight: "1px solid rgba(255,255,255,0.08)" }}>
              <SidebarLinks activeId={activeId} onDocsHost={onDocsHost} onNavigate={() => setMobileNavOpen(false)} />
            </aside>
          </div>
        )}

        <main className="flex-1 min-w-0">
          {!current ? (
            <IntroContent onDocsHost={onDocsHost} />
          ) : (
            <div className="max-w-[800px] mx-auto px-6 md:px-9 pt-10 md:pt-16 pb-24">
              <div className="flex items-center gap-2.5 mb-2.5">
                <span className="w-6 h-6 rounded-lg flex items-center justify-center text-[0.68rem] font-extrabold"
                  style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)", color: "#c4b5fd" }}>
                  {current.num}
                </span>
                <span className="text-[0.72rem] font-extrabold uppercase tracking-[0.09em]" style={{ color: "#a78bfa" }}>Guide</span>
              </div>
              <div className="docs-prose" dangerouslySetInnerHTML={{ __html: sectionHtml }} />
              <SectionNav prev={prev} next={next} />
            </div>
          )}

          <footer className="text-center py-10 px-6 text-sm" style={{ color: "rgba(255,255,255,0.25)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            FidCaster User Documentation · Built for{" "}
            <a href="https://fidcaster.xyz" className="text-violet-300 no-underline">fidcaster.xyz</a>
          </footer>
        </main>
      </div>
    </div>
  );
}
