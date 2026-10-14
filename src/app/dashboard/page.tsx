"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  ShieldCheck,
  Users,
  KeyRound,
  FileSpreadsheet,
  LogOut,
  Globe,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Lock,
  Sparkles,
  Plus,
  Activity,
  MapPin,
} from "lucide-react";
import { formatCompactPkr, formatMinorCurrency } from "@/lib/format";
import { Locale, t } from "@/lib/i18n";

interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  locale: Locale;
  twoFactorEnabled: boolean;
  status: string;
  organization: {
    id: string;
    slug: string;
    name: string;
    legalName: string;
    defaultCurrency: string;
  };
  branch: {
    id: string;
    code: string;
    name: string;
    city: string;
  } | null;
  role: {
    id: string;
    slug: string;
    name: string;
    description: string;
  };
  permissions: string[];
}

interface BranchItem {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string;
  phone: string | null;
  isHeadquarters: number;
}

interface DashboardSummary {
  kpis: {
    totalProperties: number;
    totalUnits: number;
    occupiedUnits: number;
    occupancyRatePct: number;
    totalOwners: number;
    totalTenants: number;
    activeLeases: number;
    totalInvoices: number;
    totalBilledMinor: number;
    totalCollectedMinor: number;
    arrearsMinor: number;
    currency: string;
  };
  properties: Array<{
    id: string;
    code: string;
    name: string;
    type: string;
    city: string;
    address: string;
    totalUnits: number;
    status: string;
    branchName: string;
    primaryOwnerName: string;
  }>;
  agents: Array<{
    id: string;
    slug: string;
    name: string;
    description: string;
    autonomyLevel: string;
    isEnabled: number;
    costBudgetMinor: number;
    currency: string;
  }>;
}

interface RoleItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  permissions: string[];
}

interface PermissionItem {
  id: string;
  code: string;
  module: string;
  description: string;
}

interface OrgUserItem {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  roleSlug: string;
  roleName: string;
  branchName: string | null;
  branchCity: string | null;
  twoFactorEnabled: number;
  status: string;
}

interface AuditLogItem {
  id: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string;
  ipAddress: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

const QUICK_SWITCH_ACCOUNTS = [
  { label: "Admin (PakLand)", email: "admin@pakland.pk" },
  { label: "Sales Agent (PakLand)", email: "agent@pakland.pk" },
  { label: "Accountant (PakLand)", email: "accountant@pakland.pk" },
  { label: "Maintenance (PakLand)", email: "maintenance@pakland.pk" },
  { label: "Owner (PakLand)", email: "owner@pakland.pk" },
  { label: "Tenant (PakLand)", email: "tenant@pakland.pk" },
  { label: "Admin (Indus Valley Org 2)", email: "admin@indusvalley.pk" },
];

export default function DashboardPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<
    "overview" | "rbac" | "users" | "security" | "audit"
  >("overview");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [locale, setLocale] = useState<Locale>("en");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // RBAC state
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);

  // Users state
  const [orgUsers, setOrgUsers] = useState<OrgUserItem[]>([]);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserRole, setNewUserRole] = useState("agent");
  const [newBranchCode, setNewBranchCode] = useState("");
  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchCity, setNewBranchCity] = useState("");
  const [newBranchAddress, setNewBranchAddress] = useState("");

  // 2FA state
  const [totpSetup, setTotpSetup] = useState<{
    secret: string;
    otpauthUri: string;
    currentDemoCode: string;
  } | null>(null);
  const [totpVerifyCode, setTotpVerifyCode] = useState("");

  // Audit logs state
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditFilter, setAuditFilter] = useState("");

  function showNotification(type: "success" | "error", text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 4000);
  }

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/auth/me");
      if (!res.ok) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      setUser(data.user);
      setBranches(data.branches || []);
      setSummary(data.summary);
      setLocale(data.user.locale || "en");
      setLoading(false);
    } catch {
      router.push("/login");
    }
  }, [router]);

  const fetchRbac = useCallback(async () => {
    const res = await fetch("/api/v1/admin/roles");
    if (res.ok) {
      const data = await res.json();
      setRoles(data.roles || []);
      setPermissions(data.permissions || []);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    const res = await fetch("/api/v1/admin/users");
    if (res.ok) {
      const data = await res.json();
      setOrgUsers(data.users || []);
    }
  }, []);

  const fetchAudit = useCallback(async (actionFilter = "") => {
    const q = actionFilter ? `?action=${encodeURIComponent(actionFilter)}` : "";
    const res = await fetch(`/api/v1/admin/audit-logs${q}`);
    if (res.ok) {
      const data = await res.json();
      setAuditLogs(data.items || []);
    }
  }, []);

  useEffect(() => {
    fetchMe();
    fetchRbac();
    fetchUsers();
    fetchAudit();
  }, [fetchMe, fetchRbac, fetchUsers, fetchAudit]);

  async function handleQuickSwitchRole(targetEmail: string) {
    const res = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: targetEmail, password: "Password123!" }),
    });
    if (res.ok) {
      const data = await res.json();
      showNotification("success", `Switched active session to ${data.user.fullName} (${data.user.role.name})`);
      await Promise.all([fetchMe(), fetchRbac(), fetchUsers(), fetchAudit()]);
    } else {
      const err = await res.json();
      showNotification("error", err?.error?.message || "Failed to switch role.");
    }
  }

  async function handleBranchChange(branchId: string) {
    const res = await fetch("/api/v1/auth/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId }),
    });
    if (res.ok) {
      const data = await res.json();
      setUser(data.user);
      showNotification("success", `Switched active branch to ${data.user.branch?.name}`);
      fetchAudit();
    }
  }

  async function handleLocaleToggle() {
    const nextLocale: Locale = locale === "en" ? "ur" : "en";
    setLocale(nextLocale);
    await fetch("/api/v1/auth/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: nextLocale }),
    });
  }

  async function handleTogglePermission(roleSlug: string, permissionCode: string, enabled: boolean) {
    const res = await fetch("/api/v1/admin/roles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleSlug, permissionCode, enabled }),
    });
    const data = await res.json();
    if (!res.ok) {
      showNotification("error", data?.error?.message || "Permission Denied by RBAC Guard");
      fetchAudit();
      return;
    }
    setRoles(data.roles || []);
    showNotification(
      "success",
      `${enabled ? "Granted" : "Revoked"} '${permissionCode}' on role '${roleSlug}'`
    );
    fetchAudit();
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/v1/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: newUserEmail,
        fullName: newUserName,
        password: "Password123!",
        roleSlug: newUserRole,
        branchId: user?.branch?.id,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      showNotification("error", data?.error?.message || "Failed to create user.");
      fetchAudit();
      return;
    }
    setNewUserEmail("");
    setNewUserName("");
    showNotification("success", `Created user ${data.user.email} (${data.user.roleName})`);
    fetchUsers();
    fetchAudit();
  }

  async function handleCreateBranch(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/v1/admin/branches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: newBranchCode,
        name: newBranchName,
        city: newBranchCity,
        address: newBranchAddress,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      showNotification("error", data?.error?.message || "Failed to create branch.");
      fetchAudit();
      return;
    }
    setNewBranchCode("");
    setNewBranchName("");
    setNewBranchCity("");
    setNewBranchAddress("");
    showNotification("success", `Created branch ${data.branch.name}`);
    fetchMe();
    fetchAudit();
  }

  async function handleInit2FA() {
    const res = await fetch("/api/v1/auth/2fa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setup" }),
    });
    const data = await res.json();
    if (res.ok) {
      setTotpSetup(data);
      setTotpVerifyCode(data.currentDemoCode);
      showNotification("success", "TOTP 2FA secret generated. Verify code to activate.");
      fetchAudit();
    }
  }

  async function handleVerify2FA(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/v1/auth/2fa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify", code: totpVerifyCode }),
    });
    const data = await res.json();
    if (res.ok) {
      setTotpSetup(null);
      showNotification("success", "Two-Factor Authentication (2FA) is now ENABLED on your account.");
      fetchMe();
      fetchAudit();
    } else {
      showNotification("error", data?.error?.message || "Invalid 2FA verification code.");
    }
  }

  async function handleDisable2FA() {
    const res = await fetch("/api/v1/auth/2fa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "disable" }),
    });
    if (res.ok) {
      setTotpSetup(null);
      showNotification("success", "Two-Factor Authentication (2FA) disabled.");
      fetchMe();
      fetchAudit();
    }
  }

  async function handleRotateRefreshToken() {
    const res = await fetch("/api/v1/auth/refresh", { method: "POST" });
    if (res.ok) {
      showNotification("success", "Refresh token rotated and new JWT Access Token issued.");
      fetchAudit();
    } else {
      showNotification("error", "Failed to rotate refresh token.");
    }
  }

  async function handleLogout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    localStorage.removeItem("rems_access_token");
    router.push("/login");
  }

  if (loading || !user || !summary) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-5 h-5 animate-spin text-emerald-400" />
          <span className="font-medium">Loading PakLand Agentic REMS Workspace...</span>
        </div>
      </div>
    );
  }

  const isRtl = locale === "ur";

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Navigation Header */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center text-slate-950 font-bold">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base tracking-tight">{t(locale, "appName")}</span>
                <span
                  data-testid="active-org-badge"
                  className="text-xs px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium"
                >
                  {user.organization.name}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {user.fullName} ({user.email})
              </p>
            </div>
          </div>

          {/* Right Controls: Role Switcher, Branch Switcher, Locale Toggle, Logout */}
          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Instant Role Switcher */}
            <div className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-slate-400 hidden md:inline">
                {t(locale, "switchRole")}:
              </span>
              <select
                aria-label="Switch Role"
                data-testid="role-switcher-select"
                value={user.email}
                onChange={(e) => handleQuickSwitchRole(e.target.value)}
                className="bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer"
              >
                {QUICK_SWITCH_ACCOUNTS.map((acc) => (
                  <option key={acc.email} value={acc.email} className="bg-slate-900 text-white">
                    {acc.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Branch Switcher */}
            {branches.length > 0 && (
              <div className="flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1">
                <MapPin className="w-3.5 h-3.5 text-amber-400" />
                <select
                  aria-label="Switch Branch"
                  data-testid="branch-switcher-select"
                  value={user.branch?.id || ""}
                  onChange={(e) => handleBranchChange(e.target.value)}
                  className="bg-transparent text-xs font-medium text-slate-200 focus:outline-none cursor-pointer"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id} className="bg-slate-900 text-white">
                      {b.name} ({b.city})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Language / RTL Toggle */}
            <button
              type="button"
              onClick={handleLocaleToggle}
              data-testid="locale-toggle-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition"
            >
              <Globe className="w-3.5 h-3.5 text-emerald-400" />
              {t(locale, "languageToggle")}
            </button>

            {/* Sign Out */}
            <button
              type="button"
              onClick={handleLogout}
              data-testid="logout-btn"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 transition"
            >
              <LogOut className="w-3.5 h-3.5" />
              {t(locale, "signOut")}
            </button>
          </div>
        </div>
      </header>

      {/* Toast Notification Banner */}
      {toast && (
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-4">
          <div
            role="status"
            className={`p-3.5 rounded-xl border flex items-center justify-between text-sm font-medium shadow-sm ${
              toast.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : "bg-red-50 border-red-200 text-red-900"
            }`}
          >
            <div className="flex items-center gap-2">
              {toast.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              ) : (
                <XCircle className="w-4 h-4 text-red-600" />
              )}
              <span>{toast.text}</span>
            </div>
          </div>
        </div>
      )}

      {/* Active Role Context Banner */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {t(locale, "activeRole")}:
              </span>
              <span
                data-testid="active-role-badge"
                className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-900 border border-emerald-300"
              >
                {user.role.name} ({user.role.slug})
              </span>
              <span className="text-xs text-slate-500">
                • {user.permissions.length} Assigned Permissions
              </span>
              {user.twoFactorEnabled && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300">
                  2FA Enabled
                </span>
              )}
            </div>
            <p className="text-sm text-slate-600 mt-1">{user.role.description}</p>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
            {[
              { id: "overview", label: t(locale, "overview"), icon: Building2 },
              { id: "rbac", label: t(locale, "rbacMatrix"), icon: ShieldCheck },
              { id: "users", label: t(locale, "usersBranches"), icon: Users },
              { id: "security", label: t(locale, "security2fa"), icon: KeyRound },
              { id: "audit", label: t(locale, "auditLogs"), icon: Activity },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${
                    isActive
                      ? "bg-slate-900 text-white shadow-sm"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Main Workspace Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* TAB 1: PORTFOLIO OVERVIEW & ROLE WORKSPACE */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {t(locale, "properties")}
                </div>
                <div
                  data-testid="kpi-properties"
                  className="text-3xl font-bold text-slate-900 mt-1"
                >
                  {summary.kpis.totalProperties}
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  {summary.kpis.totalOwners} Registered Owners • {branches.length} Branches
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {t(locale, "totalUnits")} & {t(locale, "occupancyRate")}
                </div>
                <div className="text-3xl font-bold text-emerald-700 mt-1">
                  {summary.kpis.occupiedUnits} / {summary.kpis.totalUnits}{" "}
                  <span className="text-lg font-semibold">({summary.kpis.occupancyRatePct}%)</span>
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  {summary.kpis.activeLeases} Active Leases • {summary.kpis.totalTenants} Tenants
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {t(locale, "rentCollected")}
                </div>
                <div className="text-2xl font-bold text-slate-900 mt-1">
                  {formatCompactPkr(summary.kpis.totalCollectedMinor)}
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  Across {summary.kpis.totalInvoices} invoices (Minor units verified)
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {t(locale, "arrearsBalance")}
                </div>
                <div className="text-2xl font-bold text-amber-700 mt-1">
                  {formatMinorCurrency(summary.kpis.arrearsMinor)}
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  Monitored by Rent Collection AI Agent
                </div>
              </div>
            </div>

            {/* Active Role Capabilities & Permissions Card */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <h3 className="text-base font-bold text-slate-900 mb-2 flex items-center gap-2">
                <Lock className="w-4 h-4 text-emerald-600" />
                <span>
                  Granted Permissions for Current Role:{" "}
                  <span className="text-emerald-700">{user.role.name}</span>
                </span>
              </h3>
              <p className="text-xs text-slate-600 mb-3">
                Every API endpoint and AI Agent Tool validates these permission scopes plus row-level{" "}
                <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">
                  organization_id = {user.organization.id}
                </code>
                .
              </p>
              <div className="flex flex-wrap gap-1.5">
                {user.permissions.map((perm) => (
                  <span
                    key={perm}
                    className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 font-mono text-xs font-medium"
                  >
                    {perm}
                  </span>
                ))}
              </div>
            </div>

            {/* Properties Table */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Organization Portfolio ({user.organization.name})
                  </h3>
                  <p className="text-xs text-slate-500">
                    Scoped strictly by multi-tenant organization_id ({user.organization.id})
                  </p>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
                  {summary.properties.length} Properties
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-600 text-xs uppercase border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Code</th>
                      <th className="py-3 px-4">Project / Property Name</th>
                      <th className="py-3 px-4">Type</th>
                      <th className="py-3 px-4">City & Branch</th>
                      <th className="py-3 px-4">Primary Owner</th>
                      <th className="py-3 px-4">Units</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {summary.properties.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-700">
                          {p.code}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900">{p.name}</td>
                        <td className="py-3 px-4 text-xs capitalize text-slate-600">
                          {p.type.replace("_", " ")}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600">
                          {p.city} ({p.branchName || "HQ"})
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-700">
                          {p.primaryOwnerName || "Organization Owned"}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-800">{p.totalUnits}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Seeded AI Agents Registry Preview */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-600" />
                    <span>Configured AI Agents in Data Model (6 Domain Agents)</span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Human-in-the-loop approval queue & kill switches configured per agent
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {summary.agents.map((ag) => (
                  <div
                    key={ag.id}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="font-bold text-sm text-slate-900">{ag.name}</span>
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-semibold">
                          {ag.autonomyLevel}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mb-3">{ag.description}</p>
                    </div>
                    <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-200 flex items-center justify-between">
                      <span>Budget: {formatMinorCurrency(ag.costBudgetMinor)}</span>
                      <span className="text-emerald-700 font-semibold">● Active</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: RBAC & PERMISSION MATRIX */}
        {activeTab === "rbac" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Role-Based Access Control (RBAC) Permission Matrix
                </h3>
                <p className="text-xs text-slate-600">
                  {user.permissions.includes("admin:manage")
                    ? "You are signed in with 'admin:manage' permission. Click any checkbox to dynamically grant or revoke permissions."
                    : `You are signed in as '${user.role.name}'. Clicking a checkbox will test server-side RBAC guard rejection (403 Forbidden).`}
                </p>
              </div>
              <span className="text-xs font-mono bg-slate-100 px-3 py-1.5 rounded-lg text-slate-700">
                {permissions.length} Permissions × {roles.length} Roles
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-900 text-white uppercase">
                  <tr>
                    <th className="py-3 px-4">Module</th>
                    <th className="py-3 px-4">Permission Code</th>
                    {roles.map((r) => (
                      <th key={r.id} className="py-3 px-3 text-center">
                        <div>{r.slug}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {permissions.map((perm) => (
                    <tr key={perm.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 font-semibold text-slate-700">{perm.module}</td>
                      <td className="py-2.5 px-4">
                        <div className="font-mono font-semibold text-slate-900">{perm.code}</div>
                        <div className="text-[11px] text-slate-500">{perm.description}</div>
                      </td>
                      {roles.map((r) => {
                        const hasPerm = r.permissions.includes(perm.code);
                        return (
                          <td key={r.id} className="py-2.5 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={hasPerm}
                              onChange={(e) =>
                                handleTogglePermission(r.slug, perm.code, e.target.checked)
                              }
                              className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: USERS, BRANCHES & MULTI-TENANCY */}
        {activeTab === "users" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Organization Users Table */}
            <div className="lg:col-span-8 space-y-6">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Users in {user.organization.name}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Strict row-level tenant isolation: users from other organizations are never
                      visible
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">
                    {orgUsers.length} Users
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="py-3 px-4">Full Name & Email</th>
                        <th className="py-3 px-4">Role</th>
                        <th className="py-3 px-4">Branch</th>
                        <th className="py-3 px-4">2FA</th>
                        <th className="py-3 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {orgUsers.map((u) => (
                        <tr key={u.id} className="hover:bg-slate-50">
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900">{u.fullName}</div>
                            <div className="text-xs font-mono text-slate-500">{u.email}</div>
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800">
                              {u.roleName}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-600">
                            {u.branchName ? `${u.branchName} (${u.branchCity})` : "All Branches"}
                          </td>
                          <td className="py-3 px-4 text-xs">
                            {u.twoFactorEnabled ? (
                              <span className="text-emerald-700 font-semibold">Enabled</span>
                            ) : (
                              <span className="text-slate-400">Optional</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                              {u.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Branches List */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200">
                  <h3 className="text-base font-bold text-slate-900">
                    Organization Branches ({branches.length})
                  </h3>
                </div>
                <div className="divide-y divide-slate-200">
                  {branches.map((b) => (
                    <div key={b.id} className="px-6 py-3.5 flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-sm text-slate-900">
                          {b.name}{" "}
                          <span className="font-mono text-xs text-slate-500">({b.code})</span>
                        </div>
                        <div className="text-xs text-slate-600">
                          {b.address} — {b.city}
                        </div>
                      </div>
                      {b.isHeadquarters ? (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-900">
                          Headquarters
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Create User & Create Branch Forms */}
            <div className="lg:col-span-4 space-y-6">
              <form
                onSubmit={handleCreateUser}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4"
              >
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Plus className="w-4 h-4 text-emerald-600" />
                  <span>Invite / Create User</span>
                </h3>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    placeholder="Saad Haroon"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    placeholder="saad@pakland.pk"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Role</label>
                  <select
                    value={newUserRole}
                    onChange={(e) => setNewUserRole(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
                  >
                    <option value="admin">Organization Administrator (admin)</option>
                    <option value="agent">Sales & Leasing Agent (agent)</option>
                    <option value="accountant">Finance & Accountant (accountant)</option>
                    <option value="maintenance_staff">
                      Maintenance Coordinator (maintenance_staff)
                    </option>
                    <option value="owner">Property Owner (owner)</option>
                    <option value="tenant">Tenant (tenant)</option>
                  </select>
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition"
                >
                  Create User in {user.organization.name}
                </button>
              </form>

              <form
                onSubmit={handleCreateBranch}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4"
              >
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Plus className="w-4 h-4 text-emerald-600" />
                  <span>Add Regional Branch</span>
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Code</label>
                    <input
                      type="text"
                      required
                      value={newBranchCode}
                      onChange={(e) => setNewBranchCode(e.target.value)}
                      placeholder="MUL-01"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">City</label>
                    <input
                      type="text"
                      required
                      value={newBranchCity}
                      onChange={(e) => setNewBranchCity(e.target.value)}
                      placeholder="Multan"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Branch Name
                  </label>
                  <input
                    type="text"
                    required
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder="Multan Bosan Road Office"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Address</label>
                  <input
                    type="text"
                    required
                    value={newBranchAddress}
                    onChange={(e) => setNewBranchAddress(e.target.value)}
                    placeholder="Main Bosan Road, Multan"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition"
                >
                  Create Branch
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 4: 2FA & SESSION SECURITY */}
        {activeTab === "security" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
              <h3 className="text-lg font-bold text-slate-900">
                Two-Factor Authentication (RFC 6238 TOTP)
              </h3>
              <p className="text-xs text-slate-600">
                Protect your account with time-based one-time passwords compatible with Google
                Authenticator and Authy.
              </p>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase font-bold text-slate-500">Current Status</div>
                  <div className="text-sm font-bold text-slate-900 mt-0.5">
                    {user.twoFactorEnabled ? "Enabled (TOTP Active)" : "Disabled (Optional)"}
                  </div>
                </div>
                {user.twoFactorEnabled ? (
                  <button
                    type="button"
                    onClick={handleDisable2FA}
                    className="px-3.5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
                  >
                    Disable 2FA
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleInit2FA}
                    data-testid="init-2fa-btn"
                    className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                  >
                    Configure 2FA Now
                  </button>
                )}
              </div>

              {totpSetup && (
                <form
                  onSubmit={handleVerify2FA}
                  className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 space-y-3"
                >
                  <div className="text-xs font-bold text-emerald-900">
                    Step 1: Add Base32 Secret to Authenticator App
                  </div>
                  <div className="font-mono text-xs bg-white p-2.5 rounded-lg border border-emerald-200 break-all">
                    Secret: <strong>{totpSetup.secret}</strong>
                  </div>
                  <div className="text-xs text-emerald-800">
                    Current valid 6-digit TOTP code for instant verification:{" "}
                    <code className="font-mono font-bold bg-white px-2 py-0.5 rounded">
                      {totpSetup.currentDemoCode}
                    </code>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-emerald-900 mb-1">
                      Step 2: Confirm 6-Digit Code
                    </label>
                    <input
                      type="text"
                      value={totpVerifyCode}
                      onChange={(e) => setTotpVerifyCode(e.target.value)}
                      maxLength={6}
                      required
                      className="w-full px-3 py-2 rounded-lg border border-emerald-300 font-mono text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    data-testid="verify-2fa-btn"
                    className="w-full py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold text-xs"
                  >
                    Verify & Activate 2FA
                  </button>
                </form>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
              <h3 className="text-lg font-bold text-slate-900">
                JWT & Stateful Refresh Token Rotation
              </h3>
              <p className="text-xs text-slate-600">
                Every session issues a short-lived HMAC-SHA256 JWT Access Token (15m) and a
                database-backed Refresh Token (7d) that rotates on every refresh call.
              </p>

              <div className="space-y-2 text-xs bg-slate-50 p-4 rounded-xl border border-slate-200 font-mono">
                <div>User ID: {user.id}</div>
                <div>Organization ID: {user.organization.id}</div>
                <div>Branch ID: {user.branch?.id || "ALL"}</div>
                <div>Role ID: {user.role.id}</div>
              </div>

              <button
                type="button"
                onClick={handleRotateRefreshToken}
                data-testid="rotate-token-btn"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Test Refresh Token Rotation Now</span>
              </button>
            </div>
          </div>
        )}

        {/* TAB 5: AUDIT LOGS */}
        {activeTab === "audit" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Organization Security & Activity Audit Log
                </h3>
                <p className="text-xs text-slate-500">
                  Immutable trail of logins, token refreshes, role changes, permission checks, and
                  cross-tenant blocks
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={auditFilter}
                  onChange={(e) => {
                    setAuditFilter(e.target.value);
                    fetchAudit(e.target.value);
                  }}
                  placeholder="Filter by action (e.g. auth.login)"
                  className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs"
                />
                <button
                  type="button"
                  onClick={() => fetchAudit(auditFilter)}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-600 uppercase border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">Timestamp (UTC)</th>
                    <th className="py-3 px-4">Actor</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Entity</th>
                    <th className="py-3 px-4">IP</th>
                    <th className="py-3 px-4">Metadata</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono text-slate-500">{log.createdAt}</td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">
                          {log.actorName || "System"}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {log.actorEmail || ""}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-800">
                          {log.action}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600">
                        {log.entityType}:{log.entityId}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-500">{log.ipAddress}</td>
                      <td className="py-3 px-4 font-mono text-[11px] text-slate-600 max-w-xs truncate">
                        {JSON.stringify(log.metadata)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
