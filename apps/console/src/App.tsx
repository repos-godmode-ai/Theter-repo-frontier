import { useCallback, useEffect, useMemo, useState } from "react";
import { BrandGlyph, HeroDiagram } from "./illustrations/HeroDiagram";

const gateway = import.meta.env.VITE_GATEWAY_URL ?? "http://localhost:8787";
const adminToken = import.meta.env.VITE_ADMIN_TOKEN ?? "";

type Product = {
  publicId: string;
  name: string;
  merchantPayTo: string;
  amountAtomic: string;
  policy: { dailyLimitAtomic: string; approvalOverAtomic: string };
  createdAt: string;
};

type Payment = {
  referenceId: string;
  productPublicId: string;
  status: string;
  transactionSignature: string | null;
  payerPubkey: string | null;
  amountPaidAtomic: string | null;
  createdAt: string;
  expiresAt: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${gateway}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${r.status}: ${t}`);
  }
  return r.json() as Promise<T>;
}

async function publicApi<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${gateway}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${r.status}: ${t}`);
  }
  return r.json() as Promise<T>;
}

function formatAtomic(atomic: string, decimals: number): string {
  const n = BigInt(atomic || "0");
  const scale = 10n ** BigInt(decimals);
  const whole = n / scale;
  const frac = n % scale;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

function statusClass(status: string): string {
  if (status === "verified") return "status status-verified";
  if (status === "pending") return "status status-pending";
  if (status === "awaiting_approval") return "status status-awaiting";
  if (status === "rejected") return "status status-rejected";
  return "status";
}

export function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);

  const [name, setName] = useState("Premium API");
  const [merchantPayTo, setMerchantPayTo] = useState("");
  const [amountAtomic, setAmountAtomic] = useState("1000000");
  const [dailyLimit, setDailyLimit] = useState("0");
  const [approvalOver, setApprovalOver] = useState("0");
  const [mintDecimals, setMintDecimals] = useState(6);
  const [merchantOwner, setMerchantOwner] = useState("");

  const canUse = useMemo(() => Boolean(adminToken && gateway), [adminToken, gateway]);

  const showToast = useCallback((title: string, body: string) => {
    setToast({ title, body });
    window.setTimeout(() => setToast(null), 12000);
  }, []);

  const refresh = useCallback(async () => {
    if (!canUse) return;
    setError(null);
    const [p, pay] = await Promise.all([
      api<{ products: Product[] }>("/v1/admin/products"),
      api<{ payments: Payment[] }>("/v1/admin/payments"),
    ]);
    setProducts(p.products);
    setPayments(pay.payments);
  }, [canUse]);

  useEffect(() => {
    refresh().catch((e) => setError(String(e.message)));
  }, [refresh]);

  useEffect(() => {
    if (!gateway) return;
    publicApi<{ decimals: number }>(`/v1/solana/mint-info`)
      .then((m) => setMintDecimals(m.decimals))
      .catch(() => setMintDecimals(6));
  }, [gateway]);

  const lookupAta = async () => {
    const o = merchantOwner.trim();
    if (!o) {
      setError("Enter merchant wallet address first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await publicApi<{
        associatedTokenAccounts: { tokenProgram: string; address: string }[];
      }>(`/v1/solana/derive-ata`, {
        method: "POST",
        body: JSON.stringify({ owner: o }),
      });
      const classic = res.associatedTokenAccounts.find((a) => a.tokenProgram.includes("Tokenkeg"));
      if (classic) setMerchantPayTo(classic.address);
      else if (res.associatedTokenAccounts[0]) setMerchantPayTo(res.associatedTokenAccounts[0].address);
    } catch (e: unknown) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const createProduct = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ publicId: string; payToValidation?: unknown }>("/v1/admin/products", {
        method: "POST",
        body: JSON.stringify({
          name,
          merchantPayTo,
          amountAtomic,
          policy: { dailyLimitAtomic: dailyLimit, approvalOverAtomic: approvalOver },
        }),
      });
      await refresh();
      showToast("Product created", `Public ID: ${res.publicId}${res.payToValidation ? " · on-chain payTo validated." : ""}`);
    } catch (e: unknown) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const grant = async (referenceId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string }>(`/v1/admin/approvals/${referenceId}/grant`, { method: "POST" });
      await refresh();
      showToast("Session issued — Bearer token", res.token);
    } catch (e: unknown) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  if (!canUse) {
    return (
      <>
        <div className="app-bg" aria-hidden />
        <div className="setup">
          <div className="setup-card animate-fade-up">
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
              <div className="brand-mark" style={{ width: 56, height: 56, borderRadius: 18 }}>
                <BrandGlyph />
              </div>
            </div>
            <h1>Configure operator access</h1>
            <p>
              Add <code>VITE_GATEWAY_URL</code> and <code>VITE_ADMIN_TOKEN</code> to{" "}
              <code>apps/console/.env</code> (see <code>.env.example</code>), then restart the dev server or redeploy.
            </p>
            <p style={{ fontSize: "0.85rem" }}>These values must match your paywall gateway and admin token.</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="app-bg" aria-hidden />
      <div className="shell">
        <header className="topbar animate-fade-up">
          <div className="brand">
            <div className="brand-mark">
              <BrandGlyph />
            </div>
            <div>
              <h1>USDT Paywall</h1>
              <p>Operator console · Solana micro-billing</p>
            </div>
          </div>
          <div className="topbar-actions">
            <span className="gateway-pill" title={gateway}>
              {gateway}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => refresh().catch((e) => setError(String(e.message)))}>
              Refresh data
            </button>
          </div>
        </header>

        {error && <div className="alert animate-fade-up">{error}</div>}

        <section className="hero">
          <div className="hero-copy animate-fade-up stagger-1">
            <h2>Programmable USDT access for your APIs</h2>
            <p>
              Create paywalled products, enforce daily spend caps, and approve high-value settlements before issuing
              session tokens—built for the same flow as HTTP 402 + on-chain USDT verification.
            </p>
            <div className="hero-badges">
              <span className="badge">Solana SPL</span>
              <span className="badge">Memo reference</span>
              <span className="badge badge-outline">Session JWT</span>
            </div>
            <p className="hero-doc-link">
              <a href="https://solana.com/docs/tokens" target="_blank" rel="noreferrer">
                Solana token docs
              </a>
              <span aria-hidden> · </span>
              <a href="https://solana.com/docs/core/transactions" target="_blank" rel="noreferrer">
                Transactions
              </a>
            </p>
          </div>
          <div className="hero-visual animate-fade-up stagger-2">
            <HeroDiagram />
          </div>
        </section>

        <div className="grid-2">
          <section className="card animate-fade-up stagger-2">
            <div className="card-header">
              <div>
                <h3 className="card-title">New product</h3>
                <p className="card-sub">Maps to a payTo SPL token account for the gateway mint (see ATA model).</p>
              </div>
            </div>

            <div className="field">
              <label htmlFor="p-owner">Merchant wallet (owner)</label>
              <div className="row-inline">
                <input
                  id="p-owner"
                  className="input input-mono"
                  value={merchantOwner}
                  onChange={(e) => setMerchantOwner(e.target.value)}
                  placeholder="Pubkey of wallet that owns the USDT ATA"
                />
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => lookupAta()}>
                  Fill ATA
                </button>
              </div>
              <p className="hint">Uses gateway <span className="mono">/v1/solana/derive-ata</span> (canonical ATA for this mint).</p>
            </div>

            <div className="field">
              <label htmlFor="p-name">Display name</label>
              <input id="p-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Market data API" />
            </div>

            <div className="field">
              <label htmlFor="p-ata">Merchant USDT ATA</label>
              <input
                id="p-ata"
                className="input input-mono"
                value={merchantPayTo}
                onChange={(e) => setMerchantPayTo(e.target.value)}
                placeholder="Associated token account (pubkey)"
              />
              <p className="hint">Must be the USDT ATA for the mint configured on the gateway.</p>
            </div>

            <div className="field">
              <label htmlFor="p-price">Price (atomic USDT)</label>
              <input id="p-price" className="input input-mono" value={amountAtomic} onChange={(e) => setAmountAtomic(e.target.value)} />
              <p className="hint">
                Mint decimals: {mintDecimals} · preview ≈{" "}
                <strong style={{ color: "var(--cyan)" }}>{formatAtomic(amountAtomic, mintDecimals)} USDT</strong> per access
              </p>
            </div>

            <div className="row-2">
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="p-daily">Daily limit / payer</label>
                <input
                  id="p-daily"
                  className="input input-mono"
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(e.target.value)}
                  placeholder="0 = off"
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="p-approval">Approve over (atomic)</label>
                <input
                  id="p-approval"
                  className="input input-mono"
                  value={approvalOver}
                  onChange={(e) => setApprovalOver(e.target.value)}
                  placeholder="0 = off"
                />
              </div>
            </div>
            <p className="hint">When approval threshold is set, large payments queue here until you grant a session.</p>

            <div style={{ marginTop: 22 }}>
              <button type="button" className="btn btn-primary" disabled={busy || !merchantPayTo.trim()} onClick={createProduct}>
                {busy ? "Working…" : "Create product"}
              </button>
            </div>
          </section>

          <section className="card animate-fade-up stagger-3">
            <div className="card-header">
              <div>
                <h3 className="card-title">Live products</h3>
                <p className="card-sub">{products.length ? `${products.length} configured` : "None yet — create one on the left."}</p>
              </div>
            </div>
            {products.length === 0 ? (
              <div className="empty">No products. Your public IDs will appear here for SDK wiring.</div>
            ) : (
              <div className="product-list">
                {products.map((p) => (
                  <div key={p.publicId} className="product-item">
                    <div>
                      <div className="product-name">{p.name}</div>
                      <div style={{ marginTop: 6 }}>
                        <span className="mono">{p.publicId}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Price</div>
                      <div className="mono" style={{ fontSize: "0.95rem" }}>
                        {formatAtomic(p.amountAtomic, mintDecimals)} USDT
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="card animate-fade-up stagger-4" style={{ marginTop: 20 }}>
          <div className="card-header">
            <div>
              <h3 className="card-title">Recent payments</h3>
              <p className="card-sub">Verification, policy holds, and session grants.</p>
            </div>
          </div>
          {payments.length === 0 ? (
            <div className="empty">No payment rows yet. Traffic will show here after callers hit your paywalled routes.</div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Product</th>
                    <th>Status</th>
                    <th>Payer</th>
                    <th>Transaction</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.referenceId}>
                      <td className="mono" style={{ maxWidth: 140 }}>
                        {p.referenceId}
                      </td>
                      <td className="mono">{p.productPublicId}</td>
                      <td>
                        <span className={statusClass(p.status)}>
                          <span className="status-dot" aria-hidden />
                          {p.status.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td className="mono">{p.payerPubkey ? `${p.payerPubkey.slice(0, 4)}…${p.payerPubkey.slice(-4)}` : "—"}</td>
                      <td className="mono">{p.transactionSignature ? `${p.transactionSignature.slice(0, 6)}…` : "—"}</td>
                      <td>
                        {p.status === "awaiting_approval" && (
                          <button type="button" className="btn btn-danger-ghost btn-sm" disabled={busy} onClick={() => grant(p.referenceId)}>
                            Grant session
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {toast && (
        <div className="toast" role="status">
          <strong>{toast.title}</strong>
          <span className="mono" style={{ display: "block", maxHeight: 120, overflow: "auto", marginTop: 8 }}>
            {toast.body}
          </span>
        </div>
      )}
    </>
  );
}
