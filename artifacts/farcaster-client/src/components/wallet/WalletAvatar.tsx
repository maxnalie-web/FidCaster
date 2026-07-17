// Wallet identity avatar: a deterministic, per-wallet abstract pattern (a
// blockie/jazzicon-style identicon), not an emoji face or a flat monogram.
// Real wallets (MetaMask, Rainbow) use exactly this kind of generated
// identicon so every wallet reads as visually unique at a glance. Seeded
// from the wallet's own address when available (falls back to its label so
// a not-yet-derived wallet still gets a stable pattern). Same deterministic
// algorithm as the native app's WalletAvatar.tsx -- the same address
// produces the same identicon on both.
function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Blob {
  cx: number;
  cy: number;
  r: number;
  fill: string;
  opacity: number;
}

function generateBlobs(seedStr: string): Blob[] {
  const rand = mulberry32(hashSeed(seedStr));
  const blobs: Blob[] = [];
  const shapeCount = 3 + Math.floor(rand() * 2); // 3-4 shapes
  for (let i = 0; i < shapeCount; i++) {
    const angle = rand() * Math.PI * 2;
    const dist = 8 + rand() * 20; // offset from center, in a 0-100 viewbox
    blobs.push({
      cx: 50 + Math.cos(angle) * dist,
      cy: 50 + Math.sin(angle) * dist,
      r: 22 + rand() * 20,
      fill: rand() > 0.5 ? "#ffffff" : "#000000",
      opacity: 0.08 + rand() * 0.16,
    });
  }
  return blobs;
}

export function WalletAvatar({
  label,
  color,
  seed,
  size = 40,
  className,
}: {
  label: string;
  color: string;
  // Ideally the wallet's own address -- gives every wallet a distinct
  // pattern even if two wallets happen to share a label. Falls back to
  // `label` for a not-yet-derived wallet (e.g. mid "create wallet" flow).
  seed?: string;
  size?: number;
  className?: string;
}) {
  const seedStr = seed || label || "wallet";
  const blobs = generateBlobs(seedStr);
  const clipId = `wallet-avatar-clip-${seedStr.replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      style={{ borderRadius: "50%", flexShrink: 0 }}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx={50} cy={50} r={50} />
        </clipPath>
      </defs>
      <circle cx={50} cy={50} r={50} fill={color} />
      <g clipPath={`url(#${clipId})`}>
        {blobs.map((b, i) => (
          <circle key={i} cx={b.cx} cy={b.cy} r={b.r} fill={b.fill} opacity={b.opacity} />
        ))}
      </g>
    </svg>
  );
}
