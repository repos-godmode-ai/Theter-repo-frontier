import { useCallback, useEffect, useMemo, useState } from "react";

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

export function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("Premium API");
  const [merchantPayTo, setMerchantPayTo] = useState("");
  const [amountAtomic, setAmountAtomic] = useState("1000");
  const [dailyLimit, setDailyLimit] = useState("0");
  const [approvalOver, setApprovalOver] = useState("0");

  const canUse = useMemo(() => Boolean(adminToken && gateway), [adminToken, gateway]);

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

  const createProduct = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/v1/admin/products", {
        method: "POST",
        body: JSON.stringify({
          name,
          merchantPayTo,
          amountAtomic,
          policy: { dailyLimitAtomic: dailyLimit, approvalOverAtomic: approvalOver },
        }),
      });
      await refresh();
    } catch (e: any) {
      setError(String(e.message));
    } finally {
      setBusy(false);
    }
  };

  const grant = async (referenceId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string }>(`/v1/admin/approvals/${referenceId}/grant`, { method: "POST" });
      alert(`Session issued. Token (store securely): ${res.token.slice(0, 24)}…`);
      await refresh();
    } catch (e: any) {
      setError(String(e.message));
    } finally {
      setBusy(false);
    }
  };

  if (!canUse) {
    return (
      <div style={{ fontFamily: "system-ui", padding: 24, maxWidth: 640 }}>
        <h1>USDT Paywall Console</h1>
        <p>
          Set <code>VITE_GATEWAY_URL</code> and <code>VITE_ADMIN_TOKEN</code> in <code>apps/console/.env</code> (see{" "}
          <code>.env.example</code>), then restart Vite.
        </p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "system-ui", padding: 24, maxWidth: 960 }}>
      <h1>USDT Paywall Console</h1>
      <p style={{ color: "#444" }}>
        Gateway: <code>{gateway}</code>
      </p>
      {error && <pre style={{ background: "#fee", padding: 12 }}>{error}</pre>}

      <section style={{ marginTop: 24 }}>
        <h2>Create product</h2>
        <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
          <label>
            Name
            <input style={{ width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Merchant USDT ATA (payTo)
            <input
              style={{ width: "100%", fontFamily: "monospace" }}
              value={merchantPayTo}
              onChange={(e) => setMerchantPayTo(e.target.value)}
              placeholder="Associated token account pubkey"
            />
          </label>
          <label>
            Price (atomic units, 6 decimals → 1 USDT = 1000000)
            <input style={{ width: "100%" }} value={amountAtomic} onChange={(e) => setAmountAtomic(e.target.value)} />
          </label>
          <label>
            Daily limit per payer (atomic, 0 = off)
            <input style={{ width: "100%" }} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} />
          </label>
          <label>
            Require approval over (atomic, 0 = off)
            <input style={{ width: "100%" }} value={approvalOver} onChange={(e) => setApprovalOver(e.target.value)} />
          </label>
          <button disabled={busy} onClick={createProduct}>
            Create
          </button>
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>Products</h2>
        <button onClick={() => refresh().catch((e) => setError(String(e.message)))}>Refresh</button>
        <ul>
          {products.map((p) => (
            <li key={p.publicId}>
              <strong>{p.name}</strong> — <code>{p.publicId}</code> — price {p.amountAtomic} — payTo{" "}
              <code>{p.merchantPayTo.slice(0, 8)}…</code>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>Recent payments</h2>
        <table cellPadding={8} style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
              <th>Ref</th>
              <th>Product</th>
              <th>Status</th>
              <th>Payer</th>
              <th>Tx</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.referenceId} style={{ borderBottom: "1px solid #eee" }}>
                <td>
                  <code>{p.referenceId}</code>
                </td>
                <td>{p.productPublicId}</td>
                <td>{p.status}</td>
                <td>
                  <code>{p.payerPubkey?.slice(0, 6) ?? "—"}</code>
                </td>
                <td>
                  <code>{p.transactionSignature?.slice(0, 8) ?? "—"}</code>
                </td>
                <td>
                  {p.status === "awaiting_approval" && (
                    <button disabled={busy} onClick={() => grant(p.referenceId)}>
                      Grant session
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
