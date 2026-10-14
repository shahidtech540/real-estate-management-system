"use client";

import { authFetch, getAccessToken } from "@/lib/auth-client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  ShieldCheck,
  KeyRound,
  UserCheck,
  Briefcase,
  Calculator,
  Wrench,
  Home,
  Globe,
  Lock,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { Locale, t } from "@/lib/i18n";

interface DemoAccount {
  id: string;
  email: string;
  fullName: string;
  locale: string;
  twoFactorEnabled: number;
  roleSlug: string;
  roleName: string;
  roleDescription: string;
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  branchName: string | null;
  branchCity: string | null;
}

const ROLE_BADGE_STYLES: Record<string, { bg: string; icon: React.ReactNode }> = {
  admin: {
    bg: "bg-emerald-100 text-emerald-800 border-emerald-200",
    icon: <ShieldCheck className="w-4 h-4 text-emerald-700" />,
  },
  agent: {
    bg: "bg-blue-100 text-blue-800 border-blue-200",
    icon: <Briefcase className="w-4 h-4 text-blue-700" />,
  },
  accountant: {
    bg: "bg-purple-100 text-purple-800 border-purple-200",
    icon: <Calculator className="w-4 h-4 text-purple-700" />,
  },
  maintenance_staff: {
    bg: "bg-amber-100 text-amber-800 border-amber-200",
    icon: <Wrench className="w-4 h-4 text-amber-700" />,
  },
  owner: {
    bg: "bg-indigo-100 text-indigo-800 border-indigo-200",
    icon: <Building2 className="w-4 h-4 text-indigo-700" />,
  },
  tenant: {
    bg: "bg-teal-100 text-teal-800 border-teal-200",
    icon: <Home className="w-4 h-4 text-teal-700" />,
  },
};

export default function LoginPage() {
  const router = useRouter();
  const [locale, setLocale] = useState<Locale>("en");
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);
  const [email, setEmail] = useState("admin@fahadrealestate.test");
  const [password, setPassword] = useState("Password123!");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch("/api/v1/auth/login")
      .then((res) => res.json())
      .then((data) => {
        if (data.accounts) {
          setAccounts(data.accounts);
        }
      })
      .catch(() => {
        // ignore
      });
  }, []);

  useEffect(() => {
    // Reloading an embedded preview can reopen its original /login URL. Resume
    // an existing tab session instead of asking an authenticated user to sign in.
    if (getAccessToken()) {
      authFetch("/api/v1/auth/me")
        .then(res => { if (res.ok) router.replace("/dashboard"); })
        .catch(() => { /* Keep the sign-in form available on network failure. */ });
    }
  }, [router]);

  async function handleLogin(
    e?: React.FormEvent,
    overrideEmail?: string,
    overridePassword?: string
  ) {
    if (e) e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await authFetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: overrideEmail ?? email,
          password: overridePassword ?? password,
          twoFactorCode: twoFactorCode.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message || "Login failed. Please check credentials.");
        setLoading(false);
        return;
      }

      if (data.requiresTwoFactor) {
        setRequiresTwoFactor(true);
        setLoading(false);
        return;
      }

      if (!data.accessToken) throw new Error("Sign-in did not create a session. Please try again.");
      // Confirm authentication before leaving the form, rather than silently
      // bouncing back here when an embedded browser rejects cookies.
      const session = await authFetch("/api/v1/auth/me");
      if (!session.ok) throw new Error("Unable to establish your session. Please try opening the preview in a new tab.");
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error while signing in.");
      setLoading(false);
    }
  }

  function handleQuickSelect(acc: DemoAccount) {
    setEmail(acc.email);
    setPassword("Password123!");
    setRequiresTwoFactor(false);
    setTwoFactorCode("");
    handleLogin(undefined, acc.email, "Password123!");
  }

  const isRtl = locale === "ur";

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className="min-h-screen bg-gradient-to-br from-slate-900 via-emerald-950 to-slate-900 text-slate-100 flex flex-col"
    >
      {/* Top Header */}
      <header className="border-b border-white/10 bg-slate-950/50 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Building2 className="w-6 h-6 text-slate-950" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight text-white">
                {t(locale, "appName")}
              </h1>
              <p className="text-xs text-emerald-300/80">{t(locale, "tagline")}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <a
              href="/listings"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition"
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Public Listings Site (/listings)</span>
            </a>
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Rahim Yar Khan · One Office
            </span>
            <button
              type="button"
              onClick={() => setLocale(locale === "en" ? "ur" : "en")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition"
            >
              <Globe className="w-3.5 h-3.5" />
              {t(locale, "languageToggle")}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Sign-In Form */}
        <div className="lg:col-span-5 bg-white text-slate-900 rounded-2xl shadow-2xl border border-slate-200 p-6 sm:p-8">
          <div className="flex items-center gap-2 text-emerald-700 font-semibold text-xs uppercase tracking-wider mb-2">
            <Lock className="w-4 h-4" />
            <span>JWT + Refresh Token + RBAC + Optional 2FA</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-1">{t(locale, "signIn")}</h2>
          <p className="text-sm text-slate-600 mb-6">
            Sign in with credentials or click any role card to test role-based access control and
            multi-tenancy isolation.
          </p>

          {error && (
            <div
              role="alert"
              className="mb-4 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium"
            >
              {error}
            </div>
          )}

          <form onSubmit={(e) => handleLogin(e)} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
                {t(locale, "email")}
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="email-input"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 text-sm"
                placeholder="admin@fahadrealestate.test"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 mb-1.5">
                {t(locale, "password")}
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="password-input"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 text-sm"
              />
              <p className="mt-1 text-xs text-slate-500">
                Default demo password for all seeded accounts:{" "}
                <code className="font-mono font-semibold text-slate-700">Password123!</code>
              </p>
            </div>

            {requiresTwoFactor && (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                <label className="block text-xs font-bold uppercase tracking-wider text-amber-900 mb-1.5">
                  {t(locale, "twoFactorCode")}
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  required
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value)}
                  data-testid="two-factor-input"
                  className="w-full px-3.5 py-2 rounded-lg border border-amber-300 text-slate-900 font-mono tracking-widest text-center text-lg"
                  placeholder="000000"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              data-testid="login-submit"
              className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-sm shadow-lg shadow-emerald-600/20 flex items-center justify-center gap-2 transition"
            >
              <KeyRound className="w-4 h-4" />
              <span>{loading ? "Signing in..." : t(locale, "signIn")}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Portfolio Context Summary */}
          <div className="mt-6 pt-6 border-t border-slate-200">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              Our Projects · Rahim Yar Khan
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {[
                "Fahad Garden Housing Scheme",
                "Abdullah City",
                "Taj Commercial Center",
                "VIP Block",
                "University Commercial Centers",
              ].map((proj) => (
                <span
                  key={proj}
                  className="px-2.5 py-1 rounded-md bg-slate-100 text-slate-700 text-xs font-medium"
                >
                  {proj}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: One-Click Role Switcher Cards */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-emerald-400" />
                <span>{t(locale, "quickRoleLogin")}</span>
              </h2>
              <p className="text-sm text-slate-300">
                Click any role below to immediately log in and inspect its RBAC permissions, branch
                scope, and permissions.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {accounts.map((acc) => {
              const badge = ROLE_BADGE_STYLES[acc.roleSlug] || ROLE_BADGE_STYLES.admin;
              return (
                <button
                  key={acc.id}
                  type="button"
                  disabled={loading}
                  onClick={() => handleQuickSelect(acc)}
                  data-testid={`quick-login-${acc.roleSlug}-${acc.organizationId}`}
                  className={`text-left p-4 rounded-xl border transition group ${
                    "bg-slate-900/75 border-white/15 hover:border-emerald-400 hover:bg-slate-900"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${badge.bg}`}
                    >
                      {badge.icon}
                      {acc.roleName}
                    </span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/10 text-slate-300">
                      {acc.organizationName}
                    </span>
                  </div>

                  <div className="font-semibold text-white group-hover:text-emerald-300 transition text-sm">
                    {acc.fullName}
                  </div>
                  <div className="text-xs font-mono text-emerald-400/90 mb-1.5">{acc.email}</div>
                  <p className="text-xs text-slate-300 line-clamp-2 mb-2">{acc.roleDescription}</p>
                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-white/10">
                    <span>
                      Office: <strong className="text-slate-200">{acc.branchName || "All"}</strong>
                    </span>
                    <span className="text-emerald-400 font-semibold group-hover:translate-x-0.5 transition">
                      Click to Sign In →
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
