import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";

export type ProductPolicy = {
  dailyLimitAtomic: string;
  approvalOverAtomic: string;
};

export type ProductRow = {
  id: number;
  public_id: string;
  name: string;
  merchant_pay_to: string;
  amount_atomic: string;
  policy_json: string;
  created_at: string;
};

export type PaymentRow = {
  id: number;
  reference_id: string;
  product_id: number;
  status: "pending" | "verified" | "rejected" | "awaiting_approval";
  transaction_signature: string | null;
  payer_pubkey: string | null;
  amount_paid_atomic: string | null;
  created_at: string;
  expires_at: string;
};

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      merchant_pay_to TEXT NOT NULL,
      amount_atomic TEXT NOT NULL,
      policy_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_id TEXT NOT NULL UNIQUE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      status TEXT NOT NULL,
      transaction_signature TEXT,
      payer_pubkey TEXT,
      amount_paid_atomic TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_payments_product ON payments(product_id);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
  `);
}

export function openDbSync(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

export function createProduct(
  db: Database.Database,
  input: {
    name: string;
    merchantPayTo: string;
    amountAtomic: string;
    policy: ProductPolicy;
  }
) {
  const publicId = nanoid(12);
  db.prepare(
    `INSERT INTO products (public_id, name, merchant_pay_to, amount_atomic, policy_json)
     VALUES (?, ?, ?, ?, ?)`
  ).run(publicId, input.name, input.merchantPayTo, input.amountAtomic, JSON.stringify(input.policy));
  return publicId;
}

export function getProductByPublicId(db: Database.Database, publicId: string): ProductRow | undefined {
  return db.prepare(`SELECT * FROM products WHERE public_id = ?`).get(publicId) as ProductRow | undefined;
}

export function listProducts(db: Database.Database): ProductRow[] {
  return db.prepare(`SELECT * FROM products ORDER BY id DESC`).all() as ProductRow[];
}

export function createPaymentChallenge(
  db: Database.Database,
  productId: number,
  ttlMinutes: number
): { referenceId: string; expiresAt: string } {
  const referenceId = nanoid(16);
  const expires = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  db.prepare(
    `INSERT INTO payments (reference_id, product_id, status, expires_at)
     VALUES (?, ?, 'pending', ?)`
  ).run(referenceId, productId, expires);
  return { referenceId, expiresAt: expires };
}

export function getPaymentByReference(db: Database.Database, referenceId: string): PaymentRow | undefined {
  return db.prepare(`SELECT * FROM payments WHERE reference_id = ?`).get(referenceId) as PaymentRow | undefined;
}

export function getPaymentByTxSignature(db: Database.Database, signature: string): PaymentRow | undefined {
  return db
    .prepare(`SELECT * FROM payments WHERE transaction_signature = ?`)
    .get(signature) as PaymentRow | undefined;
}

export function setPaymentAwaitingApproval(
  db: Database.Database,
  referenceId: string,
  txSig: string,
  payerPubkey: string,
  amountPaidAtomic: string
) {
  db.prepare(
    `UPDATE payments SET status = 'awaiting_approval', transaction_signature = ?, payer_pubkey = ?, amount_paid_atomic = ?
     WHERE reference_id = ?`
  ).run(txSig, payerPubkey, amountPaidAtomic, referenceId);
}

export function markPaymentVerified(
  db: Database.Database,
  referenceId: string,
  txSig: string,
  payerPubkey: string,
  amountPaidAtomic: string
) {
  db.prepare(
    `UPDATE payments SET status = 'verified', transaction_signature = ?, payer_pubkey = ?, amount_paid_atomic = ?
     WHERE reference_id = ?`
  ).run(txSig, payerPubkey, amountPaidAtomic, referenceId);
}

export function sumVerifiedPaymentsForPayerToday(
  db: Database.Database,
  productId: number,
  payerPubkey: string
): bigint {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CAST(amount_paid_atomic AS INTEGER)), 0) AS s
       FROM payments
       WHERE product_id = ?
         AND payer_pubkey = ?
         AND status = 'verified'
         AND substr(created_at, 1, 10) = substr(datetime('now'), 1, 10)`
    )
    .get(productId, payerPubkey) as { s: number };
  return BigInt(row.s);
}

export function listRecentPayments(db: Database.Database, limit = 50): (PaymentRow & { product_public_id: string })[] {
  return db
    .prepare(
      `SELECT p.*, pr.public_id AS product_public_id
       FROM payments p
       JOIN products pr ON pr.id = p.product_id
       ORDER BY p.id DESC
       LIMIT ?`
    )
    .all(limit) as (PaymentRow & { product_public_id: string })[];
}
