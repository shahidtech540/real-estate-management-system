"use client";
import { useState, type ReactNode } from "react";
import { authFetch } from "@/lib/auth-client";

/** Fetch protected files with the same session transport as the dashboard.
 * Never put an access token in a URL, referrer, history entry or download name. */
export function AuthenticatedDownload({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <a
        href={href}
        className={className}
        aria-disabled={busy}
        onClick={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const response = await authFetch(href);
            if (!response.ok)
              throw new Error(
                "Download failed. Your session may have expired; please sign in again.",
              );
            const url = URL.createObjectURL(await response.blob());
            const link = document.createElement("a");
            link.href = url;
            const filename = response.headers
              .get("Content-Disposition")
              ?.match(/filename="([^"]+)"/)?.[1];
            const ext = response.headers
              .get("Content-Type")
              ?.includes("application/pdf")
              ? "pdf"
              : href.includes("csv")
                ? "csv"
                : "json";
            link.download = filename || `rems-export.${ext}`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Download failed.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {children}
      </a>
      {error && (
        <span role="alert" className="block text-xs text-red-700">
          {error}
        </span>
      )}
    </>
  );
}
