"use client";
import { AccountingWorkspace } from "@/components/AccountingWorkspace";

import { authFetch, clearAccessToken } from "@/lib/auth-client";

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
  FileText,
  Upload,
  Eye,
  Download,
  AlertTriangle,
  Layers,
  Briefcase,
} from "lucide-react";
import { formatCompactPkr, formatMinorCurrency } from "@/lib/format";
import { Locale, t } from "@/lib/i18n";
import { MaintenanceWorkspace } from "@/components/MaintenanceWorkspace";
import { NotificationsWorkspace } from "@/components/NotificationsWorkspace";
import { TenancyWorkspace, BillingWorkspace } from "@/components/Phase3Workspaces";
import { CrmWorkspace, ListingsWorkspace } from "@/components/Phase2Workspaces";

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

interface PropertyOwnerView {
  id: string;
  ownerId: string;
  fullName: string;
  email: string;
  cnicNtn: string;
  ownershipPct: number;
  isPrimary: boolean;
}

interface PropertyItem {
  id: string;
  branchId: string;
  branchCode: string | null;
  branchName: string | null;
  code: string;
  name: string;
  type: string;
  city: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  status: string;
  amenities: string[];
  buildingCount: number;
  totalUnits: number;
  availableUnits: number;
  rentedUnits: number;
  soldUnits: number;
  maintenanceUnits: number;
  owners: PropertyOwnerView[];
}

interface UnitItem {
  id: string;
  propertyId: string;
  propertyCode: string;
  propertyName: string;
  propertyCity: string;
  buildingId: string | null;
  buildingName: string | null;
  unitNumber: string;
  type: string;
  areaSqft: number;
  areaDisplay: string;
  bedrooms: number;
  bathrooms: number;
  status: string;
  marketPriceMinor: number;
  monthlyRentMinor: number;
  currency: string;
}

interface OwnerRecord {
  id: string;
  fullName: string;
  cnicNtn: string;
  email: string;
  phone: string;
  bankName: string | null;
  iban: string | null;
  managementFeePct: number;
  properties: Array<{
    propertyId: string;
    propertyCode: string;
    propertyName: string;
    ownershipPct: number;
    isPrimary: boolean;
  }>;
}

interface DocumentRecord {
  id: string;
  entityType: string;
  entityId: string;
  title: string;
  category: string;
  version: number;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  tags: string[];
  expiryDate: string | null;
  expiryStatus: "valid" | "expiring_soon" | "expired" | "no_expiry";
  contentText: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CsvImportReport {
  dryRun: boolean;
  totalRows: number;
  validCount: number;
  importedCount: number;
  failedCount: number;
  errors: Array<{
    rowNumber: number;
    field: string;
    message: string;
    rawRow: string;
  }>;
  importedUnits: Array<{
    id: string;
    propertyCode: string;
    unitNumber: string;
    type: string;
    areaDisplay: string;
    status: string;
    marketPriceMinor: number;
    monthlyRentMinor: number;
  }>;
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
  { label: "Admin (Demo)", email: "admin@fahadrealestate.test" },
  { label: "Sales Agent (Demo)", email: "agent@fahadrealestate.test" },
  { label: "Accountant (Demo)", email: "accountant@fahadrealestate.test" },
  { label: "Maintenance (Demo)", email: "maintenance@fahadrealestate.test" },
  { label: "Owner (Demo)", email: "owner@fahadrealestate.test" },
  { label: "Tenant (Demo)", email: "tenant@fahadrealestate.test" },
];

const SAMPLE_VALID_CSV = `property_code,building_code,unit_number,type,area_sqft,area_display,bedrooms,bathrooms,status,market_price_pkr,monthly_rent_pkr
FGHS-01,FGHS-01-A,FGHS-CSV-101,plot,2250,10 Marla,0,0,available,9500000,0
AC-01,AC-01-A,AC-CSV-202,house,2700,12 Marla,4,4,available,24500000,95000
TCC-01,TCC-01-A,TCC-CSV-303,shop,600,600 Sq.Ft.,0,1,available,18000000,110000`;

const SAMPLE_MIXED_ERROR_CSV = `property_code,building_code,unit_number,type,area_sqft,area_display,bedrooms,bathrooms,status,market_price_pkr,monthly_rent_pkr
VIP-01,VIP-01-A,VIP-CSV-401,house,4500,1 Kanal,5,6,available,48000000,185000
UNKNOWN-99,BLK-A,U-99,plot,2250,10 Marla,0,0,available,8000000,0
FGHS-01,FGHS-01-A,FGHS-01-U01,house,1800,8 Marla,3,3,available,15000000,65000
UCC-01,UCC-01-A,UCC-CSV-501,invalid_type,900,900 Sq.Ft.,0,1,available,14000000,85000
TCC-01,TCC-01-A,TCC-CSV-502,shop,-250,250 Sq.Ft.,0,1,available,9000000,55000`;

export default function DashboardPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<
    | "overview"
    | "listings"
    | "crm"
    | "tenancy"
    | "accounting"
    | "maintenance"
    | "notifications"
    | "billing"
    | "owners"
    | "documents"
    | "csv"
    | "rbac"
    | "users"
    | "security"
    | "audit"
  >("overview");
  const [user, setUser] = useState<UserProfile | null>(null);
  const [branches, setBranches] = useState<BranchItem[]>([]);
  useEffect(() => {
    if(user && activeTab === "accounting" && !user.permissions.includes("accounting:read")) setActiveTab("overview");
    if (user && activeTab === "maintenance" && !user.permissions.includes("maintenance:read")) {
      setActiveTab("notifications");
    }
  }, [user, activeTab]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [locale, setLocale] = useState<Locale>("en");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Phase 1: Portfolio & Units state
  const [properties, setProperties] = useState<PropertyItem[]>([]);
  const [propSearch, setPropSearch] = useState("");
  const [propTypeFilter, setPropTypeFilter] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const [units, setUnits] = useState<UnitItem[]>([]);
  const [unitStatusFilter, setUnitStatusFilter] = useState("");
  const [unitTypeFilter, setUnitTypeFilter] = useState("");

  // New Property & Unit forms
  const [newPropCode, setNewPropCode] = useState("");
  const [newPropName, setNewPropName] = useState("");
  const [newPropType, setNewPropType] = useState("housing_scheme");
  const [newPropCity, setNewPropCity] = useState("Rahim Yar Khan");
  const [newPropAddress, setNewPropAddress] = useState("");

  const [newUnitPropId, setNewUnitPropId] = useState("prop_1");
  const [newUnitNumber, setNewUnitNumber] = useState("");
  const [newUnitType, setNewUnitType] = useState("plot");
  const [newUnitAreaSqft, setNewUnitAreaSqft] = useState("2250");
  const [newUnitAreaDisplay, setNewUnitAreaDisplay] = useState("10 Marla");
  const [newUnitPricePkr, setNewUnitPricePkr] = useState("12500000");
  const [newUnitRentPkr, setNewUnitRentPkr] = useState("65000");

  // Phase 1: Owners & Multi-owner split state
  const [owners, setOwners] = useState<OwnerRecord[]>([]);
  const [newOwnerName, setNewOwnerName] = useState("");
  const [newOwnerCnic, setNewOwnerCnic] = useState("");
  const [newOwnerEmail, setNewOwnerEmail] = useState("");
  const [newOwnerPhone, setNewOwnerPhone] = useState("");
  const [newOwnerBank, setNewOwnerBank] = useState("Meezan Bank Limited");
  const [newOwnerFee, setNewOwnerFee] = useState("5.0");

  const [splitPropId, setSplitPropId] = useState("prop_1");
  const [splitOwner1Id, setSplitOwner1Id] = useState("own_1");
  const [splitOwner1Pct, setSplitOwner1Pct] = useState("60");
  const [splitOwner2Id, setSplitOwner2Id] = useState("own_2");
  const [splitOwner2Pct, setSplitOwner2Pct] = useState("40");

  // Phase 1: Document Vault state
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [docSearch, setDocSearch] = useState("");
  const [docCategoryFilter, setDocCategoryFilter] = useState("");
  const [docExpiryFilter, setDocExpiryFilter] = useState("");
  const [activeDocAccess, setActiveDocAccess] = useState<{
    title: string;
    version: number;
    signedUrl: string;
    contentPreview: string | null;
    auditLogId: string;
    accessedAt: string;
  } | null>(null);

  const [uploadEntityType, setUploadEntityType] = useState("property");
  const [uploadEntityId, setUploadEntityId] = useState("prop_1");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadCategory, setUploadCategory] = useState("noc_approval");
  const [uploadTags, setUploadTags] = useState("NOC, Approval, Verified");
  const [uploadExpiry, setUploadExpiry] = useState("2028-12-31");
  const [uploadContent, setUploadContent] = useState("");

  // Phase 1: CSV Import state
  const [csvText, setCsvText] = useState(SAMPLE_VALID_CSV);
  const [csvReport, setCsvReport] = useState<CsvImportReport | null>(null);

  // Phase 0: RBAC, Users, 2FA, Audit state
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUserItem[]>([]);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserRole, setNewUserRole] = useState("agent");

  const [totpSetup, setTotpSetup] = useState<{
    secret: string;
    otpauthUri: string;
    currentDemoCode: string;
  } | null>(null);
  const [totpVerifyCode, setTotpVerifyCode] = useState("");
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditFilter, setAuditFilter] = useState("");

  function showNotification(type: "success" | "error", text: string) {
    setToast({ type, text });
    setTimeout(() => setToast(null), 4500);
  }

  const fetchMe = useCallback(async () => {
    try {
      const res = await authFetch("/api/v1/auth/me");
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

  const fetchPortfolio = useCallback(async () => {
    const propParams = new URLSearchParams();
    if (propSearch) propParams.set("search", propSearch);
    if (propTypeFilter) propParams.set("type", propTypeFilter);

    const [propRes, unitRes] = await Promise.all([
      authFetch(`/api/v1/properties?${propParams.toString()}`),
      authFetch(
        `/api/v1/units?limit=100${selectedPropertyId ? `&propertyId=${selectedPropertyId}` : ""}${
          unitStatusFilter ? `&status=${unitStatusFilter}` : ""
        }${unitTypeFilter ? `&type=${unitTypeFilter}` : ""}`
      ),
    ]);

    if (propRes.ok) {
      const pData = await propRes.json();
      setProperties(pData.properties || []);
    }
    if (unitRes.ok) {
      const uData = await unitRes.json();
      setUnits(uData.items || []);
    }
  }, [propSearch, propTypeFilter, selectedPropertyId, unitStatusFilter, unitTypeFilter]);

  const fetchOwners = useCallback(async () => {
    const res = await authFetch("/api/v1/owners");
    if (res.ok) {
      const data = await res.json();
      setOwners(data.owners || []);
    }
  }, []);

  const fetchDocuments = useCallback(async () => {
    const params = new URLSearchParams();
    if (docSearch) params.set("search", docSearch);
    if (docCategoryFilter) params.set("category", docCategoryFilter);
    if (docExpiryFilter) params.set("expiryStatus", docExpiryFilter);

    const res = await authFetch(`/api/v1/documents?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setDocuments(data.documents || []);
    }
  }, [docSearch, docCategoryFilter, docExpiryFilter]);

  const fetchRbac = useCallback(async () => {
    const res = await authFetch("/api/v1/admin/roles");
    if (res.ok) {
      const data = await res.json();
      setRoles(data.roles || []);
      setPermissions(data.permissions || []);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    const res = await authFetch("/api/v1/admin/users");
    if (res.ok) {
      const data = await res.json();
      setOrgUsers(data.users || []);
    }
  }, []);

  const fetchAudit = useCallback(async (actionFilter = "") => {
    const q = actionFilter ? `?action=${encodeURIComponent(actionFilter)}` : "";
    const res = await authFetch(`/api/v1/admin/audit-logs${q}`);
    if (res.ok) {
      const data = await res.json();
      setAuditLogs(data.items || []);
    }
  }, []);

  useEffect(() => {
    fetchMe();
    fetchPortfolio();
    fetchOwners();
    fetchDocuments();
    fetchRbac();
    fetchUsers();
    fetchAudit();
  }, [fetchMe, fetchPortfolio, fetchOwners, fetchDocuments, fetchRbac, fetchUsers, fetchAudit]);

  async function handleQuickSwitchRole(targetEmail: string) {
    const res = await authFetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: targetEmail, password: "Password123!" }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.requiresTwoFactor || !data.user) {
        clearAccessToken();
        router.replace("/login");
        return;
      }
      showNotification(
        "success",
        `Switched active session to ${data.user.fullName} (${data.user.role.name})`
      );
      await Promise.all([
        fetchMe(),
        fetchPortfolio(),
        fetchOwners(),
        fetchDocuments(),
        fetchRbac(),
        fetchUsers(),
        fetchAudit(),
      ]);
    } else {
      const err = await res.json();
      showNotification("error", err?.error?.message || "Failed to switch role.");
    }
  }

  async function handleBranchChange(branchId: string) {
    const res = await authFetch("/api/v1/auth/context", {
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
    await authFetch("/api/v1/auth/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: nextLocale }),
    });
  }

  // Phase 1 handlers
  async function handleCreateProperty(e: React.FormEvent) {
    e.preventDefault();
    const res = await authFetch("/api/v1/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branchId: user?.branch?.id || branches[0]?.id || "br_ryk",
        code: newPropCode,
        name: newPropName,
        type: newPropType,
        city: newPropCity,
        address: newPropAddress,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      showNotification("error", data?.error?.message || "Failed to create property.");
      return;
    }
    setNewPropCode("");
    setNewPropName("");
    setNewPropAddress("");
    showNotification("success", `Created property ${data.property.name} (${data.property.code})`);
    fetchMe();
    fetchPortfolio();
    fetchAudit();
  }

  async function handleCreateUnit(e: React.FormEvent) {
    e.preventDefault();
    const res = await authFetch("/api/v1/units", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: newUnitPropId,
        unitNumber: newUnitNumber,
        type: newUnitType,
        areaSqft: Number(newUnitAreaSqft),
        areaDisplay: newUnitAreaDisplay,
        marketPriceMinor: Math.round(Number(newUnitPricePkr) * 100),
        monthlyRentMinor: Math.round(Number(newUnitRentPkr) * 100),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      showNotification("error", data?.error?.message || "Failed to create unit.");
      return;
    }
    setNewUnitNumber("");
    showNotification("success", `Created unit ${data.unit.unitNumber}`);
    fetchMe();
    fetchPortfolio();
    fetchAudit();
  }

  async function handleUpdateUnitStatus(unitId: string, status: string) {
    const res = await authFetch("/api/v1/units", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unitId, status }),
    });
    const data = await res.json();
    if (!res.ok) {
      showNotification("error", data?.error?.message || "Failed to update unit status.");
      return;
    }
    showNotification("success", `Updated unit ${data.unit.unitNumber} status to '${status}'`);
    fetchMe();
    fetchPortfolio();
    fetchAudit();
  }

  async function handleCreateOwner(e: React.FormEvent) {
    e.preventDefault();
    const res = await authFetch("/api/v1/owners", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: newOwnerName,
        cnicNtn: newOwnerCnic,
        email: newOwnerEmail,
        phone: newOwnerPhone,
        bankName: newOwnerBank,
        managementFeePct: Number(newOwnerFee),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      showNotification("error", data?.error?.message || "Failed to create owner.");
      return;
    }
    setNewOwnerName("");
    setNewOwnerCnic("");
    setNewOwnerEmail("");
    setNewOwnerPhone("");
    showNotification("success", `Registered owner ${data.owner.fullName}`);
    fetchOwners();
    fetchMe();
    fetchAudit();
  }

  async function handleSaveOwnershipSplit(e: React.FormEvent) {
    e.preventDefault();
    const allocations = [
      {
        ownerId: splitOwner1Id,
        ownershipPct: Number(splitOwner1Pct),
        isPrimary: true,
      },
    ];
    if (splitOwner2Id && Number(splitOwner2Pct) > 0 && splitOwner2Id !== splitOwner1Id) {
      allocations.push({
        ownerId: splitOwner2Id,
        ownershipPct: Number(splitOwner2Pct),
        isPrimary: false,
      });
    }

    const res = await authFetch("/api/v1/owners", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId: splitPropId,
        allocations,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      showNotification("error", data?.error?.message || "Failed to update ownership split.");
      return;
    }
    showNotification(
      "success",
      `Updated ownership allocations for ${data.property.name}`
    );
    fetchPortfolio();
    fetchOwners();
    fetchAudit();
  }

  async function handleRunCsvImport(dryRun: boolean) {
    const res = await authFetch("/api/v1/portfolio/import-csv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvText, dryRun }),
    });
    const data = await res.json();
    if (!res.ok) {
      showNotification("error", data?.error?.message || "CSV Import failed.");
      return;
    }
    setCsvReport(data.report);
    if (dryRun) {
      showNotification(
        "success",
        `Dry-Run Complete: ${data.report.validCount} valid rows, ${data.report.failedCount} error rows.`
      );
    } else {
      showNotification(
        "success",
        `Imported ${data.report.importedCount} units (${data.report.failedCount} rows skipped with errors).`
      );
      fetchMe();
      fetchPortfolio();
      fetchAudit();
    }
  }

  async function handleUploadDocument(e: React.FormEvent) {
    e.preventDefault();
    const tags = uploadTags
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const res = await authFetch("/api/v1/documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entityType: uploadEntityType,
        entityId: uploadEntityId,
        title: uploadTitle,
        category: uploadCategory,
        tags,
        expiryDate: uploadExpiry || null,
        contentText: uploadContent || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      showNotification("error", data?.error?.message || "Document upload failed.");
      return;
    }
    showNotification(
      "success",
      `Saved '${data.document.title}' (Version v${data.document.version})`
    );
    setUploadTitle("");
    setUploadContent("");
    fetchDocuments();
    fetchAudit();
  }

  async function handleAccessDocument(docId: string, accessType: "view" | "download") {
    const res = await authFetch(`/api/v1/documents/${docId}/access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessType }),
    });
    const data = await res.json();
    if (!res.ok) {
      showNotification("error", data?.error?.message || "Document access denied.");
      return;
    }
    setActiveDocAccess(data.access);
    showNotification(
      "success",
      `Recorded 'document.${accessType}ed' in Audit Log for '${data.access.title}' (v${data.access.version})`
    );
    fetchAudit();
  }

  // Phase 0 handlers
  async function handleTogglePermission(roleSlug: string, permissionCode: string, enabled: boolean) {
    const res = await authFetch("/api/v1/admin/roles", {
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
    const res = await authFetch("/api/v1/admin/users", {
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


  async function handleInit2FA() {
    const res = await authFetch("/api/v1/auth/2fa", {
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
    const res = await authFetch("/api/v1/auth/2fa", {
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
    const res = await authFetch("/api/v1/auth/2fa", {
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
    const res = await authFetch("/api/v1/auth/refresh", { method: "POST" });
    if (res.ok) {
      showNotification("success", "Refresh token rotated and new JWT Access Token issued.");
      fetchAudit();
    } else {
      showNotification("error", "Failed to rotate refresh token.");
    }
  }

  async function handleLogout() {
    try { await authFetch("/api/v1/auth/logout", { method: "POST" }); }
    finally { clearAccessToken(); router.replace("/login"); }
  }

  if (loading || !user || !summary) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-5 h-5 animate-spin text-emerald-400" />
          <span className="font-medium">Loading Fahad Real Estate workspace...</span>
        </div>
      </div>
    );
  }

  const isRtl = locale === "ur";

  const workspaceTabs = [
    { id: "overview", label: t(locale, "overview"), icon: Building2 },
    { id: "listings", label: t(locale, "listingsTab"), icon: Sparkles },
    { id: "crm", label: t(locale, "crmTab"), icon: Users },
    ...(user.permissions.includes("leases:read") ? [{ id: "tenancy", label: t(locale, "tenancyTab"), icon: FileText }] : []),
    ...(user.permissions.includes("invoices:read") ? [{ id: "billing", label: t(locale, "billingTab"), icon: Briefcase }] : []),
    ...(user.permissions.includes("maintenance:read") ? [{ id: "maintenance", label: t(locale, "maintenanceTab"), icon: Activity }] : []),
    ...(user.permissions.includes("accounting:read") ? [{id:"accounting",label:locale==="ur"?"اکاؤنٹنگ اور رپورٹس":"Accounting & reports",icon:FileSpreadsheet}] : []),
    { id: "notifications", label: t(locale, "notificationsTab"), icon: Activity },
    { id: "owners", label: t(locale, "ownersTab"), icon: Briefcase },
    { id: "documents", label: t(locale, "documentsTab"), icon: FileText },
    { id: "csv", label: t(locale, "csvImportTab"), icon: FileSpreadsheet },
    { id: "rbac", label: t(locale, "rbacMatrix"), icon: ShieldCheck },
    { id: "users", label: t(locale, "usersBranches"), icon: Users },
    { id: "security", label: t(locale, "security2fa"), icon: KeyRound },
    { id: "audit", label: t(locale, "auditLogs"), icon: Activity },
  ];

  return (
    <div lang={locale} dir={isRtl ? "rtl" : "ltr"} className="rems-dashboard min-h-screen min-w-0 w-full bg-slate-50 flex flex-col">
      {/* Top Navigation Header */}
      <header data-testid="dashboard-header" className="rems-dashboard-header bg-slate-900 text-white border-b border-slate-800 z-30">
        <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-3 grid items-center gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
          <div data-testid="dashboard-brand" className="flex min-w-0 items-center gap-3">
            <div className="dashboard-brand-mark w-10 h-10 shrink-0 rounded-xl bg-emerald-500 flex items-center justify-center text-slate-950">
              <Building2 className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <h1 className="font-bold text-base leading-tight tracking-tight">{t(locale, "appName")}</h1>
                <span data-testid="active-org-badge" title={user.organization.name}
                  className="block max-w-full truncate rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
                  {user.organization.name}
                </span>
              </div>
              <p data-testid="dashboard-identity" title={`${user.fullName} (${user.email})`} className="mt-1 truncate text-xs text-slate-400">
                {user.fullName} ({user.email})
              </p>
            </div>
          </div>

          <div data-testid="dashboard-controls" className="grid min-w-0 w-full grid-cols-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_auto_auto] gap-2 xl:w-[700px]">
            {/* Instant Role Switcher */}
            <div className="flex min-w-0 min-h-10 items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3">
              <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
              <select
                aria-label="Switch Role"
                title={`${user.role.name} (${user.email})`}
                data-testid="role-switcher-select"
                value={user.email}
                onChange={(e) => handleQuickSwitchRole(e.target.value)}
                className="min-w-0 w-full flex-1 bg-transparent py-2 text-xs font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 cursor-pointer"
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
              <div className="flex min-w-0 min-h-10 items-center gap-2 bg-slate-800 border border-slate-700 rounded-lg px-3">
                <MapPin className="w-4 h-4 shrink-0 text-amber-400" />
                <select
                  aria-label="Office"
                  disabled={branches.length === 1}
                  title={user.branch?.name || t(locale, "branch")}
                  data-testid="branch-switcher-select"
                  value={user.branch?.id || ""}
                  onChange={(e) => handleBranchChange(e.target.value)}
                  className="min-w-0 w-full flex-1 bg-transparent py-2 text-xs font-medium text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 cursor-pointer"
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
              className="inline-flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 transition"
            >
              <Globe className="w-3.5 h-3.5 text-emerald-400" />
              {t(locale, "languageToggle")}
            </button>

            {/* Sign Out */}
            <button
              type="button"
              onClick={handleLogout}
              data-testid="logout-btn"
              className="inline-flex min-h-10 items-center justify-center gap-1.5 whitespace-nowrap px-3 py-2 rounded-lg text-xs font-semibold bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-300 transition"
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

      {/* Active Role Context & Navigation Bar */}
      <div data-testid="dashboard-context" className="min-w-0 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-3">
          <div data-testid="dashboard-role-context" className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 max-w-full items-center gap-2 flex-wrap">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {t(locale, "activeRole")}:
              </span>
              <span
                data-testid="active-role-badge"
                className="max-w-full break-words px-3 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-900 border border-emerald-200"
              >
                {user.role.name} ({user.role.slug})
              </span>
              <span className="text-xs text-slate-500">
                {user.permissions.length} {t(locale, "assignedPermissions")}
              </span>
            </div>
            <span className="shrink-0 inline-flex items-center gap-2 text-xs font-medium text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
              {t(locale, "phase4Status")}
            </span>
          </div>

          <nav aria-label={t(locale, "workspaceNavigation")} className="min-w-0">
            <label className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 xl:hidden">
              <Layers className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
              <span className="text-xs font-semibold text-slate-500">{t(locale, "workspace")}</span>
              <select aria-label={t(locale, "workspace")} data-testid="workspace-select" value={activeTab}
                onChange={e => setActiveTab(e.target.value as typeof activeTab)}
                className="min-w-0 w-full flex-1 bg-transparent py-3 text-sm font-semibold text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
                {workspaceTabs.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
              </select>
            </label>
            <div data-testid="desktop-workspaces" className="hidden xl:flex xl:flex-wrap items-center gap-2">
            {workspaceTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`tab-${tab.id}`}
                  aria-current={isActive ? "page" : undefined}
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
            </div>
          </nav>
        </div>
      </div>

      {/* Main Workspace Body */}
      <main data-testid="dashboard-main" className="min-w-0 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* TAB 1: PORTFOLIO HIERARCHY (PROPERTY -> BUILDING -> UNIT) */}
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
                  {summary.kpis.totalOwners} Owners • {branches.length} Office
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
                  Across {summary.kpis.totalInvoices} invoices
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
                  Central Vault: {documents.length} Documents
                </div>
              </div>
            </div>

            {/* Properties Table with Multi-Owner Splits & Unit Breakdown */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-600" />
                    <span>Properties, Schemes & Multi-Owner Splits ({properties.length})</span>
                  </h3>
                  <p className="text-xs text-slate-500">
                    Sample inventory · Select a project to filter its units
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={propSearch}
                    onChange={(e) => setPropSearch(e.target.value)}
                    placeholder="Search project or code..."
                    className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs"
                  />
                  <select
                    value={propTypeFilter}
                    onChange={(e) => setPropTypeFilter(e.target.value)}
                    className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs bg-white"
                  >
                    <option value="">All Property Types</option>
                    <option value="housing_scheme">Housing Scheme</option>
                    <option value="commercial_center">Commercial Center</option>
                    <option value="residential_complex">Residential Complex</option>
                    <option value="mixed_use">Mixed Use</option>
                  </select>
                  {selectedPropertyId && (
                    <button
                      type="button"
                      onClick={() => setSelectedPropertyId("")}
                      className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700"
                    >
                      Clear Filter
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-600 text-xs uppercase border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Code</th>
                      <th className="py-3 px-4">Project / Property</th>
                      <th className="py-3 px-4">City & Office</th>
                      <th className="py-3 px-4">Ownership Splits</th>
                      <th className="py-3 px-4">Buildings</th>
                      <th className="py-3 px-4">Units (Avail / Rented / Maint)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {properties.map((p) => {
                      const isSelected = selectedPropertyId === p.id;
                      return (
                        <tr
                          key={p.id}
                          onClick={() =>
                            setSelectedPropertyId(isSelected ? "" : p.id)
                          }
                          className={`cursor-pointer transition ${
                            isSelected ? "bg-emerald-50/80" : "hover:bg-slate-50"
                          }`}
                        >
                          <td className="py-3 px-4 font-mono text-xs font-bold text-slate-800">
                            {p.code}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900">{p.name}</div>
                            <div className="text-xs text-slate-500 capitalize">
                              {p.type.replace("_", " ")} • {p.address}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-700">
                            <div className="font-medium">{p.city}</div>
                            <div className="text-slate-500">{p.branchName}</div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-wrap gap-1">
                              {p.owners.map((o) => (
                                <span
                                  key={o.id}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-50 text-indigo-900 border border-indigo-200"
                                >
                                  {o.fullName}: <strong>{o.ownershipPct}%</strong>
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-xs font-semibold text-slate-700">
                            {p.buildingCount} Block(s)
                          </td>
                          <td className="py-3 px-4 text-xs">
                            <span className="font-bold text-slate-900">{p.totalUnits} Total</span>{" "}
                            <span className="text-slate-500">
                              ({p.availableUnits} avail • {p.rentedUnits} rented •{" "}
                              {p.maintenanceUnits} maint)
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Units & Plots Browser + Quick Creation Forms */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Units, Plots, Houses & Commercial Shops ({units.length})
                    </h3>
                    <p className="text-xs text-slate-500">
                      {selectedPropertyId
                        ? `Filtered by Property ID: ${selectedPropertyId}`
                        : "Showing units across all organization properties"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={unitTypeFilter}
                      onChange={(e) => setUnitTypeFilter(e.target.value)}
                      className="px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs bg-white"
                    >
                      <option value="">All Types</option>
                      <option value="plot">Plot</option>
                      <option value="house">House</option>
                      <option value="shop">Shop</option>
                      <option value="apartment">Apartment</option>
                      <option value="office">Office</option>
                    </select>
                    <select
                      value={unitStatusFilter}
                      onChange={(e) => setUnitStatusFilter(e.target.value)}
                      className="px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs bg-white"
                    >
                      <option value="">All Statuses</option>
                      <option value="available">Available</option>
                      <option value="rented">Rented</option>
                      <option value="sold">Sold</option>
                      <option value="under_maintenance">Under Maintenance</option>
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto max-h-[520px]">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 text-slate-600 uppercase border-b border-slate-200 sticky top-0">
                      <tr>
                        <th className="py-3 px-4">Unit #</th>
                        <th className="py-3 px-4">Property & Block</th>
                        <th className="py-3 px-4">Type & Area</th>
                        <th className="py-3 px-4">Market Value</th>
                        <th className="py-3 px-4">Monthly Rent</th>
                        <th className="py-3 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {units.map((u) => (
                        <tr key={u.id} className="hover:bg-slate-50">
                          <td className="py-2.5 px-4 font-mono font-bold text-slate-900">
                            {u.unitNumber}
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="font-semibold text-slate-800">{u.propertyName}</div>
                            <div className="text-[11px] text-slate-500">
                              {u.buildingName || "Block A"}
                            </div>
                          </td>
                          <td className="py-2.5 px-4">
                            <span className="capitalize font-semibold text-slate-800">
                              {u.type}
                            </span>{" "}
                            • {u.areaDisplay} ({u.areaSqft} Sq.Ft.)
                          </td>
                          <td className="py-2.5 px-4 font-medium text-slate-800">
                            {formatCompactPkr(u.marketPriceMinor)}
                          </td>
                          <td className="py-2.5 px-4 font-medium text-emerald-700">
                            {formatMinorCurrency(u.monthlyRentMinor)}
                          </td>
                          <td className="py-2.5 px-4">
                            <select
                              aria-label={`Status for ${u.unitNumber}`}
                              value={u.status}
                              onChange={(e) => handleUpdateUnitStatus(u.id, e.target.value)}
                              className="px-2 py-1 rounded-lg border border-slate-300 text-xs font-semibold bg-white"
                            >
                              <option value="available">available</option>
                              <option value="rented">rented</option>
                              <option value="sold">sold</option>
                              <option value="under_maintenance">under_maintenance</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Add Property & Add Unit Forms */}
              <div className="lg:col-span-4 space-y-6">
                <form
                  onSubmit={handleCreateProperty}
                  className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3"
                >
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Plus className="w-4 h-4 text-emerald-600" />
                    <span>Add New Property / Project</span>
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Code
                      </label>
                      <input
                        type="text"
                        required
                        value={newPropCode}
                        onChange={(e) => setNewPropCode(e.target.value)}
                        placeholder="FGHS-03"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        City
                      </label>
                      <input
                        type="text"
                        required
                        value={newPropCity}
                        onChange={(e) => setNewPropCity(e.target.value)}
                        placeholder="Rahim Yar Khan"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Project Name
                    </label>
                    <input
                      type="text"
                      required
                      value={newPropName}
                      onChange={(e) => setNewPropName(e.target.value)}
                      placeholder="Fahad Residencia Phase II"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Type
                    </label>
                    <select
                      value={newPropType}
                      onChange={(e) => setNewPropType(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                    >
                      <option value="housing_scheme">Housing Scheme</option>
                      <option value="commercial_center">Commercial Center</option>
                      <option value="residential_complex">Residential Complex</option>
                      <option value="mixed_use">Mixed Use</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Address
                    </label>
                    <input
                      type="text"
                      required
                      value={newPropAddress}
                      onChange={(e) => setNewPropAddress(e.target.value)}
                      placeholder="Rahim Yar Khan, Punjab, Pakistan"
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition"
                  >
                    Create Property
                  </button>
                </form>

                <form
                  onSubmit={handleCreateUnit}
                  className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3"
                >
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Plus className="w-4 h-4 text-emerald-600" />
                    <span>Add Unit / Plot / Shop</span>
                  </h3>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Property
                    </label>
                    <select
                      value={newUnitPropId}
                      onChange={(e) => setNewUnitPropId(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                    >
                      {properties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} — {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Unit Number
                      </label>
                      <input
                        type="text"
                        required
                        value={newUnitNumber}
                        onChange={(e) => setNewUnitNumber(e.target.value)}
                        placeholder="FGHS-01-U99"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Type
                      </label>
                      <select
                        value={newUnitType}
                        onChange={(e) => setNewUnitType(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
                      >
                        <option value="plot">Plot</option>
                        <option value="house">House</option>
                        <option value="shop">Shop</option>
                        <option value="apartment">Apartment</option>
                        <option value="office">Office</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Area Display
                      </label>
                      <input
                        type="text"
                        required
                        value={newUnitAreaDisplay}
                        onChange={(e) => setNewUnitAreaDisplay(e.target.value)}
                        placeholder="10 Marla"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Area (Sq.Ft.)
                      </label>
                      <input
                        type="number"
                        required
                        value={newUnitAreaSqft}
                        onChange={(e) => setNewUnitAreaSqft(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Market Value (PKR)
                      </label>
                      <input
                        type="number"
                        required
                        value={newUnitPricePkr}
                        onChange={(e) => setNewUnitPricePkr(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Monthly Rent (PKR)
                      </label>
                      <input
                        type="number"
                        required
                        value={newUnitRentPkr}
                        onChange={(e) => setNewUnitRentPkr(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition"
                  >
                    Create Unit
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* PHASE 2 TAB: LISTINGS & MARKETING */}
        {activeTab === "listings" && (
          <ListingsWorkspace
            properties={properties}
            units={units}
            onNotify={showNotification}
            onRefreshAudit={() => fetchAudit(auditFilter)}
          />
        )}

        {/* PHASE 2 TAB: CRM (LEADS, VIEWINGS & DEALS) */}
        {activeTab === "crm" && (
          <CrmWorkspace
            units={units}
            onNotify={showNotification}
            onRefreshAudit={() => fetchAudit(auditFilter)}
            onRefreshPortfolio={() => {
              fetchMe();
              fetchPortfolio();
            }}
          />
        )}

        {activeTab === "tenancy" && <TenancyWorkspace permissions={user.permissions} locale={locale} units={units} onRefresh={() => { fetchPortfolio(); fetchAudit(auditFilter); }} />}
        {activeTab === "billing" && <BillingWorkspace permissions={user.permissions} locale={locale} onRefresh={() => { fetchMe(); fetchAudit(auditFilter); }} />}
        {activeTab === "accounting" && <AccountingWorkspace key={user.id} locale={locale} permissions={user.permissions} />}
        {activeTab === "maintenance" && <MaintenanceWorkspace key={user.id} permissions={user.permissions} locale={locale} roleSlug={user.role.slug} />}
        {activeTab === "notifications" && <NotificationsWorkspace key={user.id} permissions={user.permissions} locale={locale} />}
        {/* TAB 2: OWNERS & MULTI-OWNER SPLITS */}
        {activeTab === "owners" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Registered Property Owners & Co-Ownership Holdings ({owners.length})
                  </h3>
                  <p className="text-xs text-slate-500">
                    Supports multiple owners per property with ownership percentages and management
                    fee deduction rates
                  </p>
                </div>
              </div>
              <div className="divide-y divide-slate-200">
                {owners.map((o) => (
                  <div key={o.id} className="p-6 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <div className="text-base font-bold text-slate-900">{o.fullName}</div>
                        <div className="text-xs text-slate-500">
                          CNIC/NTN: <strong className="font-mono">{o.cnicNtn}</strong> • {o.email} •{" "}
                          {o.phone}
                        </div>
                      </div>
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-900">
                        Mgmt Fee: {o.managementFeePct}%
                      </span>
                    </div>
                    {o.bankName && (
                      <div className="text-xs text-slate-600 font-mono bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                        Bank: {o.bankName} | IBAN: {o.iban || "N/A"}
                      </div>
                    )}
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                        Property Holdings ({o.properties.length})
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {o.properties.map((hp) => (
                          <span
                            key={`${o.id}-${hp.propertyId}`}
                            className="px-2.5 py-1 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-900 border border-indigo-200"
                          >
                            {hp.propertyCode} ({hp.propertyName}):{" "}
                            <strong>{hp.ownershipPct}%</strong>
                            {hp.isPrimary ? " • Primary" : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-4 space-y-6">
              {/* Configure Multi-Owner Split Form */}
              <form
                onSubmit={handleSaveOwnershipSplit}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4"
              >
                <h3 className="text-sm font-bold text-slate-900">
                  Configure Multi-Owner Property Split
                </h3>
                <p className="text-xs text-slate-500">
                  Assign co-ownership percentages on any property (validated &le; 100%).
                </p>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Target Property
                  </label>
                  <select
                    value={splitPropId}
                    onChange={(e) => setSplitPropId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white"
                  >
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} — {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Primary Owner
                    </label>
                    <select
                      value={splitOwner1Id}
                      onChange={(e) => setSplitOwner1Id(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white"
                    >
                      {owners.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Share %
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={splitOwner1Pct}
                      onChange={(e) => setSplitOwner1Pct(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Co-Owner (Optional)
                    </label>
                    <select
                      value={splitOwner2Id}
                      onChange={(e) => setSplitOwner2Id(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white"
                    >
                      {owners.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.fullName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Share %
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={splitOwner2Pct}
                      onChange={(e) => setSplitOwner2Pct(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs transition"
                >
                  Save Ownership Split
                </button>
              </form>

              {/* Add New Owner Form */}
              <form
                onSubmit={handleCreateOwner}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-3"
              >
                <h3 className="text-sm font-bold text-slate-900">Register New Owner</h3>
                <input
                  type="text"
                  required
                  value={newOwnerName}
                  onChange={(e) => setNewOwnerName(e.target.value)}
                  placeholder="Full Name (e.g. Sardar Sikandar Hayat)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
                <input
                  type="text"
                  required
                  value={newOwnerCnic}
                  onChange={(e) => setNewOwnerCnic(e.target.value)}
                  placeholder="CNIC / NTN (e.g. 37405-9988776-1)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
                <input
                  type="email"
                  required
                  value={newOwnerEmail}
                  onChange={(e) => setNewOwnerEmail(e.target.value)}
                  placeholder="Email Address"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
                <input
                  type="text"
                  required
                  value={newOwnerPhone}
                  onChange={(e) => setNewOwnerPhone(e.target.value)}
                  placeholder="Phone (+92-300-...)"
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={newOwnerBank}
                    onChange={(e) => setNewOwnerBank(e.target.value)}
                    placeholder="Bank Name"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                  <input
                    type="number"
                    step="0.5"
                    value={newOwnerFee}
                    onChange={(e) => setNewOwnerFee(e.target.value)}
                    placeholder="Mgmt Fee %"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition"
                >
                  Create Owner Record
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 3: CENTRAL DOCUMENT VAULT */}
        {activeTab === "documents" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 space-y-4">
              {activeDocAccess && (
                <div className="p-4 rounded-2xl bg-emerald-950 text-emerald-100 border border-emerald-700 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                      Signed Vault Access & Audit Trail Recorded
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveDocAccess(null)}
                      className="text-xs text-emerald-300 hover:text-white"
                    >
                      Close
                    </button>
                  </div>
                  <div className="font-bold text-sm text-white">
                    {activeDocAccess.title} (v{activeDocAccess.version})
                  </div>
                  <p className="text-xs text-emerald-200">{activeDocAccess.contentPreview}</p>
                  <div className="text-[11px] font-mono text-emerald-400 pt-1">
                    Signed URL: {activeDocAccess.signedUrl} • Audit ID: {activeDocAccess.auditLogId}
                  </div>
                </div>
              )}

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Central Document Vault ({documents.length})
                    </h3>
                    <p className="text-xs text-slate-500">
                      Versioned storage with expiry tracking, role permissions, and view/download
                      audit logs
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={docSearch}
                      onChange={(e) => setDocSearch(e.target.value)}
                      placeholder="Search title, tags, content..."
                      className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs"
                    />
                    <select
                      value={docCategoryFilter}
                      onChange={(e) => setDocCategoryFilter(e.target.value)}
                      className="px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs bg-white"
                    >
                      <option value="">All Categories</option>
                      <option value="noc_approval">NOC Approval</option>
                      <option value="trade_licence">Trade Licence</option>
                      <option value="floor_plan">Floor Plan</option>
                      <option value="title_deed">Title Deed</option>
                      <option value="insurance">Insurance</option>
                      <option value="kyc_identity">KYC / Identity</option>
                    </select>
                    <select
                      value={docExpiryFilter}
                      onChange={(e) => setDocExpiryFilter(e.target.value)}
                      className="px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs bg-white"
                    >
                      <option value="">All Expiry States</option>
                      <option value="valid">Valid</option>
                      <option value="expiring_soon">Expiring Soon (&le;60d)</option>
                      <option value="expired">Expired</option>
                    </select>
                  </div>
                </div>

                <div className="divide-y divide-slate-200">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="p-5 hover:bg-slate-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-slate-900">{doc.title}</span>
                          <span className="px-2 py-0.5 rounded-md font-mono text-xs font-bold bg-slate-900 text-white">
                            v{doc.version}
                          </span>
                          <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-700">
                            {doc.category.replace("_", " ")}
                          </span>
                          {doc.expiryStatus === "expired" && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800">
                              <AlertTriangle className="w-3 h-3" />
                              Expired ({doc.expiryDate})
                            </span>
                          )}
                          {doc.expiryStatus === "expiring_soon" && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900">
                              <AlertTriangle className="w-3 h-3" />
                              Expiring Soon ({doc.expiryDate})
                            </span>
                          )}
                          {doc.expiryStatus === "valid" && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                              Valid until {doc.expiryDate}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600">{doc.contentText}</p>
                        <div className="flex items-center gap-1.5 flex-wrap pt-1">
                          <span className="text-[11px] font-mono text-slate-400">
                            Entity: {doc.entityType}:{doc.entityId}
                          </span>
                          {doc.tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[11px]"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleAccessDocument(doc.id, "view")}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAccessDocument(doc.id, "download")}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Upload Document / New Version Form */}
            <div className="lg:col-span-4">
              <form
                onSubmit={handleUploadDocument}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-3.5"
              >
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-emerald-600" />
                  <span>Upload Document / New Version</span>
                </h3>
                <p className="text-xs text-slate-500">
                  Uploading with an existing title on the same entity automatically increments{" "}
                  <code className="font-mono">v1 &rarr; v2</code>.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Entity Type
                    </label>
                    <select
                      value={uploadEntityType}
                      onChange={(e) => setUploadEntityType(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white"
                    >
                      <option value="property">Property</option>
                      <option value="owner">Owner</option>
                      <option value="unit">Unit</option>
                      <option value="organization">Organization</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Entity ID
                    </label>
                    <input
                      type="text"
                      required
                      value={uploadEntityId}
                      onChange={(e) => setUploadEntityId(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Document Title
                  </label>
                  <input
                    type="text"
                    required
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    placeholder="e.g. Taj Commercial Center — Fire Safety Certificate"
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Category
                    </label>
                    <select
                      value={uploadCategory}
                      onChange={(e) => setUploadCategory(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white"
                    >
                      <option value="noc_approval">NOC Approval</option>
                      <option value="trade_licence">Trade Licence</option>
                      <option value="floor_plan">Floor Plan</option>
                      <option value="title_deed">Title Deed</option>
                      <option value="insurance">Insurance</option>
                      <option value="kyc_identity">KYC Identity</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Expiry Date
                    </label>
                    <input
                      type="date"
                      value={uploadExpiry}
                      onChange={(e) => setUploadExpiry(e.target.value)}
                      className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tags (comma separated)
                  </label>
                  <input
                    type="text"
                    value={uploadTags}
                    onChange={(e) => setUploadTags(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Extracted Summary / Content Text (AI-searchable)
                  </label>
                  <textarea
                    rows={3}
                    value={uploadContent}
                    onChange={(e) => setUploadContent(e.target.value)}
                    placeholder="Enter key clauses, NOC reference numbers, or coverage details..."
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition"
                >
                  Upload to Vault
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 4: BULK CSV IMPORT STUDIO */}
        {activeTab === "csv" && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Bulk Portfolio CSV Import with Validation & Error Report
                  </h3>
                  <p className="text-xs text-slate-500">
                    Validates property codes, duplicate unit numbers, unit types, area dimensions,
                    and PKR prices before importing.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCsvText(SAMPLE_VALID_CSV);
                      setCsvReport(null);
                    }}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
                  >
                    Load Valid Sample CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCsvText(SAMPLE_MIXED_ERROR_CSV);
                      setCsvReport(null);
                    }}
                    className="px-3 py-1.5 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-semibold"
                  >
                    Load Mixed Valid + Error Sample CSV
                  </button>
                </div>
              </div>

              <textarea
                rows={7}
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                data-testid="csv-textarea"
                className="w-full p-3.5 rounded-xl border border-slate-300 font-mono text-xs bg-slate-50"
              />

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => handleRunCsvImport(true)}
                  data-testid="csv-dry-run-btn"
                  className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
                >
                  Validate CSV (Dry-Run)
                </button>
                <button
                  type="button"
                  onClick={() => handleRunCsvImport(false)}
                  data-testid="csv-commit-btn"
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                >
                  Commit Import Valid Rows
                </button>
              </div>
            </div>

            {csvReport && (
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-base text-slate-900">
                    CSV Validation & Import Report ({csvReport.dryRun ? "Dry-Run" : "Committed"})
                  </h4>
                  <div className="flex items-center gap-2 text-xs font-semibold">
                    <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-800">
                      Total Rows: {csvReport.totalRows}
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">
                      Valid: {csvReport.validCount}
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-red-100 text-red-800">
                      Errors: {csvReport.failedCount}
                    </span>
                  </div>
                </div>

                {csvReport.errors.length > 0 && (
                  <div className="overflow-x-auto border border-red-200 rounded-xl">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-red-50 text-red-900 uppercase border-b border-red-200">
                        <tr>
                          <th className="py-2.5 px-4">Row #</th>
                          <th className="py-2.5 px-4">Column / Field</th>
                          <th className="py-2.5 px-4">Validation Error Reason</th>
                          <th className="py-2.5 px-4">Raw CSV Row</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-red-100">
                        {csvReport.errors.map((err, i) => (
                          <tr key={i} className="bg-red-50/30">
                            <td className="py-2 px-4 font-mono font-bold text-red-900">
                              Line {err.rowNumber}
                            </td>
                            <td className="py-2 px-4 font-mono font-semibold text-red-800">
                              {err.field}
                            </td>
                            <td className="py-2 px-4 text-red-900">{err.message}</td>
                            <td className="py-2 px-4 font-mono text-[11px] text-slate-500">
                              {err.rawRow}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {csvReport.importedUnits.length > 0 && (
                  <div className="text-xs text-emerald-800 bg-emerald-50 p-3.5 rounded-xl border border-emerald-200">
                    Successfully imported {csvReport.importedUnits.length} units:{" "}
                    {csvReport.importedUnits.map((u) => u.unitNumber).join(", ")}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 5: RBAC MATRIX */}
        {activeTab === "rbac" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Role-Based Access Control (RBAC) Permission Matrix
                </h3>
                <p className="text-xs text-slate-600">
                  {user.permissions.includes("admin:manage")
                    ? "Signed in with 'admin:manage'. Click any checkbox to dynamically grant or revoke permissions."
                    : `Signed in as '${user.role.name}'. Clicking a checkbox tests server-side RBAC rejection (403 Forbidden).`}
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

        {/* TAB 6: USERS, BRANCHES & MULTI-TENANCY */}
        {activeTab === "users" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
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
                        <th className="py-3 px-4">Office</th>
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
                            {u.branchName ? `${u.branchName} (${u.branchCity})` : "Rahim Yar Khan Office"}
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

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200">
                  <h3 className="text-base font-bold text-slate-900">
                    Office ({branches.length})
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
                          Rahim Yar Khan
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>

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
                    placeholder="saad@fahadrealestate.test"
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


            </div>
          </div>
        )}

        {/* TAB 7: 2FA & SESSION SECURITY */}
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

        {/* TAB 8: AUDIT LOGS */}
        {activeTab === "audit" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Organization Security & Activity Audit Log
                </h3>
                <p className="text-xs text-slate-500">
                  Immutable trail of logins, portfolio changes, CSV imports, document views/downloads,
                  and RBAC checks
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
                  placeholder="Filter by action (e.g. document.viewed)"
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
