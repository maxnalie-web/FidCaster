import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

interface FidCasterLogoProps {
  size?: number;
  showName?: boolean;
  className?: string;
}

const SPARKLES = [
  { x: "78%", y: "18%", delay: 0,   sz: 4 },
  { x: "88%", y: "42%", delay: 0.7, sz: 3 },
  { x: "65%", y: "10%", delay: 1.4, sz: 5 },
  { x: "82%", y: "62%", delay: 0.3, sz: 3 },
  { x: "55%", y: "82%", delay: 1.1, sz: 4 },
  { x: "20%", y: "22%", delay: 1.8, sz: 3 },
  { x: "12%", y: "55%", delay: 0.5, sz: 4 },
  { x: "38%", y: "88%", delay: 2.1, sz: 3 },
];

export function FidCasterLogo({ size = 96, showName = false, className = "" }: FidCasterLogoProps) {
  const imgRef = useRef<HTMLImageElement>(null);

  return (
    <div className={`flex flex-col items-center gap-3 select-none ${className}`}>
      <div className="relative" style={{ width: size, height: size }}>
        {/* Sparkles · framer-motion only on small decorative dots (no stacking context issue) */}
        {SPARKLES.map((s, i) => (
          <motion.div
            key={i}
            className="absolute rounded-full bg-violet-400 pointer-events-none"
            style={{ left: s.x, top: s.y, width: s.sz, height: s.sz, zIndex: 30 }}
            initial={{ opacity: 0, scale: 0 }}
            animate={{
              opacity: [0, 0.9, 0],
              scale: [0, 1, 0],
              y: [0, -10, -22],
            }}
            transition={{
              duration: 1.6,
              delay: s.delay,
              repeat: Infinity,
              repeatDelay: 2.5 + i * 0.4,
              ease: "easeOut",
            }}
          />
        ))}

        {/* Pulsing outer ring */}
        <motion.div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{ zIndex: 5 }}
          animate={{
            boxShadow: [
              "0 0 0 0px rgba(139,92,246,0)",
              "0 0 0 10px rgba(139,92,246,0.18)",
              "0 0 0 0px rgba(139,92,246,0)",
            ],
          }}
          transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
        />

        {/*
          Logo image uses PURE CSS animation (logo-animated class) · no framer-motion.
          This avoids the `will-change: transform` stacking context that breaks
          mix-blend-mode. The logo-blend class uses mix-blend-mode:multiply to
          erase the white PNG background against the page background.
        */}
        <img
          ref={imgRef}
          src="/fidcaster-logo.png"
          alt="FidCaster"
          className="relative logo-animated logo-blend"
          style={{ width: size, height: size, objectFit: "contain", zIndex: 10 }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      </div>

      {showName && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="text-center"
        >
          <span
            className="text-3xl font-extrabold tracking-tight gradient-text"
          >
            FidCaster
          </span>
        </motion.div>
      )}
    </div>
  );
}
