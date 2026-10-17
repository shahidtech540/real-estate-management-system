"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, Card, secondary } from "./Phase4Shared";
type Invoice = {
  id: string;
  booking_id: string;
  invoice_number: string;
  amount_minor: number;
  currency: string;
  due_date: string;
  status: string;
  plot_id: string;
  plot_number: string;
  project_name: string;
};
export function PlotTokenInvoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    api<{ invoices: Invoice[] }>("billing/plot-invoices")
      .then((d) => {
        if (live) setInvoices(d.invoices);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [refresh]);
  return (
    <Card title="Plot token invoices">
      <p className="text-sm">
        Separate buyer token requests, latest 200. Not rent invoices, money
        received, tax invoices, sale revenue or ledger postings. Open a plot for
        the issued PDF and current booking state.
      </p>
      <button
        className={secondary}
        type="button"
        onClick={() => setRefresh((n) => n + 1)}
        disabled={loading}
      >
        Refresh plot invoices
      </button>
      {error && <p role="alert">{error}</p>}
      {loading ? (
        <p role="status">Loading plot invoices…</p>
      ) : invoices.length ? (
        <ul className="space-y-3">
          {invoices.map((i) => (
            <li key={i.id} className="rounded border p-3 text-sm">
              <p>
                {i.invoice_number} · {i.currency}{" "}
                {(i.amount_minor / 100).toFixed(2)} · {i.status} · due{" "}
                {i.due_date}
              </p>
              <Link
                className="text-emerald-800 underline"
                href={`/plots/${encodeURIComponent(i.plot_id)}`}
              >
                {i.project_name} · Plot {i.plot_number}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>No plot token invoices yet.</p>
      )}
    </Card>
  );
}
