/**
 * Inline SVG hero: API → 402 → USDT on Solana → session.
 * No external image hosts; scales crisply on retina.
 */
export function HeroDiagram() {
  return (
    <svg
      className="animate-float"
      viewBox="0 0 400 320"
      width="100%"
      height="auto"
      style={{ maxWidth: 420, display: "block" }}
      role="img"
      aria-label="Diagram: API request, payment required, USDT settlement on Solana, session access"
    >
      <defs>
        <linearGradient id="g-card" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(38,161,123,0.35)" />
          <stop offset="100%" stopColor="rgba(94,234,212,0.12)" />
        </linearGradient>
        <linearGradient id="g-line" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(94,234,212,0)" />
          <stop offset="50%" stopColor="rgba(94,234,212,0.45)" />
          <stop offset="100%" stopColor="rgba(94,234,212,0)" />
        </linearGradient>
        <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Orbit rings */}
      <ellipse cx="200" cy="168" rx="168" ry="118" fill="none" stroke="rgba(94,234,212,0.08)" strokeWidth="1" />
      <ellipse cx="200" cy="168" rx="132" ry="92" fill="none" stroke="rgba(94,234,212,0.06)" strokeWidth="1" />

      {/* Client */}
      <rect x="28" y="120" width="88" height="72" rx="14" fill="url(#g-card)" stroke="rgba(94,234,212,0.25)" />
      <text x="72" y="152" textAnchor="middle" fill="#e8edf7" fontSize="11" fontFamily="system-ui, sans-serif" fontWeight="600">
        Client
      </text>
      <text x="72" y="172" textAnchor="middle" fill="#8b95ad" fontSize="9" fontFamily="ui-monospace, monospace">
        GET /api
      </text>

      {/* Arrow 1 */}
      <path
        d="M 125 156 L 158 156"
        stroke="url(#g-line)"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <polygon points="168,156 158,151 158,161" fill="rgba(94,234,212,0.7)" />

      {/* API + 402 */}
      <rect x="172" y="96" width="112" height="120" rx="16" fill="rgba(12,16,28,0.9)" stroke="rgba(248,113,113,0.35)" />
      <text x="228" y="128" textAnchor="middle" fill="#fecaca" fontSize="10" fontFamily="ui-monospace, monospace" fontWeight="600">
        402
      </text>
      <text x="228" y="148" textAnchor="middle" fill="#e8edf7" fontSize="11" fontFamily="system-ui, sans-serif" fontWeight="600">
        Paywall
      </text>
      <text x="228" y="168" textAnchor="middle" fill="#8b95ad" fontSize="8" fontFamily="ui-monospace, monospace">
        challenge
      </text>
      <rect x="188" y="182" width="80" height="22" rx="6" fill="rgba(38,161,123,0.2)" stroke="rgba(38,161,123,0.35)" />
      <text x="228" y="197" textAnchor="middle" fill="#a7f3d0" fontSize="8" fontFamily="ui-monospace, monospace">
        USDT + memo
      </text>

      {/* Arrow 2 */}
      <path
        d="M 290 156 L 318 156"
        stroke="url(#g-line)"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
      <polygon points="328,156 318,151 318,161" fill="rgba(94,234,212,0.7)" />

      {/* Solana */}
      <circle cx="358" cy="156" r="38" fill="url(#g-card)" stroke="rgba(94,234,212,0.35)" filter="url(#glow)" />
      <text x="358" y="150" textAnchor="middle" fill="#e8edf7" fontSize="10" fontFamily="system-ui, sans-serif" fontWeight="700">
        SOL
      </text>
      <text x="358" y="166" textAnchor="middle" fill="#5eead4" fontSize="9" fontFamily="ui-monospace, monospace">
        USDT
      </text>

      {/* Curved flow back */}
      <path
        d="M 358 210 Q 200 280 72 210"
        fill="none"
        stroke="rgba(94,234,212,0.15)"
        strokeWidth="2"
        strokeDasharray="6 8"
      />
      <rect x="140" y="244" width="120" height="36" rx="10" fill="rgba(56,189,248,0.12)" stroke="rgba(56,189,248,0.3)" />
      <text x="200" y="266" textAnchor="middle" fill="#bae6fd" fontSize="9" fontFamily="system-ui, sans-serif" fontWeight="600">
        Session JWT
      </text>
    </svg>
  );
}

export function BrandGlyph() {
  return (
    <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden>
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#26a17b" />
          <stop offset="100%" stopColor="#5eead4" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#bg)" opacity="0.9" />
      <path
        d="M10 16 L14 20 L22 12"
        fill="none"
        stroke="#070a12"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
