"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AnalyticsResponse,
  AuditLogItem,
  createUser,
  deleteScheduleSnapshot,
  deleteUser,
  downloadSnapshot,
  postAuditEvent,
  fetchAnalytics,
  AuditSessionItem,
  deleteScheduleRow,
  fetchAuditLogs,
  fetchAuditSessions,
  fetchScheduleRows,
  ScheduleRowItem,
  fetchCurrentUser,
  fetchSnapshots,
  fetchUsers,
  logoutUser,
  pingSession,
  PortalUserInfo,
  SnapshotItem,
  uploadScheduleWorkbook,
} from "@/lib/api";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

type TabKey = "dashboard" | "analysis" | "records" | "upload" | "users" | "logs";

type AnalysisScope =
  | { type: "all" }
  | { type: "line"; line: string; label: string }
  | { type: "customer"; customer: string; label: string }
  | { type: "part"; customer: string; partNo: string; line: string; label: string };

type CmpSortKey =
  | "customer"
  | "partNo"
  | "line"
  | "demand"
  | "commitment"
  | "dispatched"
  | "diff"
  | "achievementRate"
  | "compareDelta"
  | "status";

function formatNumber(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(n)) return "0";
  return new Intl.NumberFormat("en-IN").format(Number(n));
}

function shiftMonthKey(ym: string, offset: number): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) return ym;
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatShortMonth(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) return ym;
  const [y, m] = ym.split("-").map(Number);
  return `${SHORT_MONTHS[m - 1]}-${String(y).slice(-2)}`;
}

function formatQuoteMonth(ym: string): string {
  if (!/^\d{4}-\d{2}$/.test(ym)) return ym;
  const [y, m] = ym.split("-").map(Number);
  return `${SHORT_MONTHS[m - 1]}'${String(y).slice(-2)}`;
}

function formatAxisTick(n: number): string {
  if (n === 0) return "0";
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function deltaToneClass(text: string): string {
  if (text.startsWith("▲")) return "text-emerald-700";
  if (text.startsWith("▼")) return "text-red-700";
  return "text-slate-500";
}

const SUPPORTED_EXCEL_COLUMNS = [
  "Sl No", "Customer", "Customer Code", "PART No.", "Helper", "Customer Part No",
  "Line", "Description", "Oct-26 / Nov-26 / Dec-26 month columns", "Application",
  "Schedule Received Date", "Schedule Start Month", "Schedule End Month",
  "Schedule Version", "Delivery Month (e.g. Oct-26)", "Original Customer Schedule",
  "Current Customer Schedule", "Actual Production Qty", "Actual Dispatch Qty",
  "Dispatch Date", "Variance Reason", "Net Customer Revision",
  "Final Schedule Variance", "Achievement", "Backlog",
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const router = useRouter();
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [clockText, setClockText] = useState<string>("--:--:--");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reason") === "timeout") {
      setError("Your session timed out after 30 minutes of inactivity. Please sign in again.");
    }
  }, []);

  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>("__ALL__");
  const [selectedCustomer, setSelectedCustomer] = useState<string>("ALL");
  const [selectedYear, setSelectedYear] = useState<string>("2026");
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [targetPercent, setTargetPercent] = useState<number>(80);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (!statusMessage) return;
    const timer = setTimeout(() => setStatusMessage(""), 4000);
    return () => clearTimeout(timer);
  }, [statusMessage]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(""), 5000);
    return () => clearTimeout(timer);
  }, [error]);

// Analysis tab controls
  const [analysisScope, setAnalysisScope] = useState<AnalysisScope>({ type: "all" });
  const [analysisScopeText, setAnalysisScopeText] = useState<string>("");
  const [scopeDropdownOpen, setScopeDropdownOpen] = useState<boolean>(false);
  const scopeDropdownRef = useRef<HTMLDivElement | null>(null);
  const [compareMode, setCompareMode] = useState<string>("PREV");
  const [trendRange, setTrendRange] = useState<"6" | "12" | "all">("6");
  const [cmpSearch, setCmpSearch] = useState<string>("");
  const [cmpFilter, setCmpFilter] = useState<"all" | "increased" | "decreased" | "unchanged">("all");
  const [cmpSortKey, setCmpSortKey] = useState<CmpSortKey>("diff");
  const [cmpSortDir, setCmpSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (scopeDropdownRef.current && !scopeDropdownRef.current.contains(e.target as Node)) {
        setScopeDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  // Records tab controls
  const [recordsSearch, setRecordsSearch] = useState<string>("");
  const [recordsCustomer, setRecordsCustomer] = useState<string>("ALL");
  const [showAllColumns, setShowAllColumns] = useState<boolean>(false);

  // Upload tab controls
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [snapshotDate, setSnapshotDate] = useState<string>("");
  const [uploading, setUploading] = useState<boolean>(false);

  // Auth / Users / Logs state
  const [currentUser, setCurrentUser] = useState<PortalUserInfo | null>(null);

  const [usersList, setUsersList] = useState<PortalUserInfo[]>([]);
  const [newName, setNewName] = useState<string>("");
  const [newUsername, setNewUsername] = useState<string>("");
  const [newPassword, setNewPassword] = useState<string>("");
  const [newRole, setNewRole] = useState<"planner" | "admin">("planner");

  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [auditView, setAuditView] = useState<"logs" | "sessions">("logs");
  const [auditCategory, setAuditCategory] = useState<string>("all");
  const [auditSearch, setAuditSearch] = useState<string>("");

  const [scheduleRows, setScheduleRows] = useState<ScheduleRowItem[]>([]);
  const [auditSessions, setAuditSessions] = useState<AuditSessionItem[]>([]);
  const [activeSessionsCount, setActiveSessionsCount] = useState<number>(1);
  const [inspectSession, setInspectSession] = useState<AuditSessionItem | null>(null);
  const [trendYear, setTrendYear] = useState<string>("2026");
  const [lineSortKey, setLineSortKey] = useState<"line" | "commitment" | "dispatched" | "fillRate" | "shortfall">("fillRate");
  const [lineSortDir, setLineSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    setSnapshotDate((prev) => prev || new Date().toISOString().slice(0, 10));
    const updateClock = () =>
      setClockText(new Date().toLocaleTimeString("en-IN", { hour12: false }));
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  const loadAdminUsers = useCallback(async (userArg?: PortalUserInfo | null) => {
    const u = userArg ?? currentUser;
    if (!u || u.role !== "admin") return;
    try {
      const list = await fetchUsers();
      setUsersList(list);
    } catch {
      // Ignore unauthorized
    }
  }, [currentUser]);

  const loadAuditDashboard = useCallback(async (userArg?: PortalUserInfo | null) => {
    const u = userArg ?? currentUser;
    if (!u || u.role !== "admin") return;
    try {
      const [logs, sessRes] = await Promise.all([
        fetchAuditLogs(250),
        fetchAuditSessions(100),
      ]);
      setAuditLogs(logs);
      setAuditSessions(sessRes.sessions);
      setActiveSessionsCount(sessRes.activeCount);
    } catch {
      // Ignore unauthorized
    }
  }, [currentUser]);

  const refreshData = useCallback(
    async (opts?: {
      preferredSource?: string;
      preferredMonth?: string;
      preferredCustomer?: string;
      preferredTarget?: number;
      resetCustomer?: boolean;
    }) => {
      setLoading(true);
      setError("");
      try {
        const snaps = await fetchSnapshots();
        setSnapshots(snaps);

        const baseSrc = opts?.preferredSource ?? selectedSource;
        const nextSrc =
          baseSrc === "__ALL__" || snaps.some((s) => s.snapshotId === baseSrc)
            ? baseSrc
            : "__ALL__";
        setSelectedSource(nextSrc);

        const nextCust = opts?.resetCustomer ? "ALL" : (opts?.preferredCustomer ?? selectedCustomer);
        const nextMonth = opts?.preferredMonth !== undefined ? opts.preferredMonth : selectedMonth;
        const nextTarget = opts?.preferredTarget ?? targetPercent;

        const [data, rows] = await Promise.all([
          fetchAnalytics({
            snapshotId: nextSrc,
            customer: nextCust,
            month: nextMonth || undefined,
            target: nextTarget,
          }),
          fetchScheduleRows(nextSrc),
        ]);

        setSelectedCustomer(nextCust);
        setAnalytics(data);
        setScheduleRows(rows);
        setSelectedMonth(data.selectedMonth);
        setSelectedYear(data.selectedMonth.slice(0, 4));
        setTrendYear(data.selectedMonth.slice(0, 4));
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load schedule data.");
      } finally {
        setLoading(false);
      }
    },
    [selectedSource, selectedCustomer, selectedMonth, targetPercent]
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const u = await fetchCurrentUser();
        if (!alive) return;
        if (!u) {
          router.replace("/login");
          return;
        }
        setCurrentUser(u);
        setAuthReady(true);
        if (String(u.role || "").toLowerCase() === "admin") {
          await Promise.all([loadAdminUsers(u), loadAuditDashboard(u)]);
        }
        await refreshData({ preferredSource: "__ALL__", resetCustomer: true });
      } catch {
        if (alive) router.replace("/login");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function switchTab(tab: TabKey) {
    const isAdmin = String(currentUser?.role || "").toLowerCase() === "admin";
    if ((tab === "users" || tab === "logs") && !isAdmin) {
      setActiveTab("dashboard");
      return;
    }
    setActiveTab(tab);
    const labelMap: Record<TabKey, string> = {
      dashboard: "Dashboard",
      analysis: "Analysis",
      records: "Records",
      upload: "Upload",
      users: "Users",
      logs: "Logs",
    };
    postAuditEvent("TAB_VIEW", `Opened ${labelMap[tab]} tab`, "dashboard").catch(() => {});
    if (tab === "users") loadAdminUsers();
    if (tab === "logs") loadAuditDashboard();
  }

  useEffect(() => {
    if (!authReady) return;
    const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
    const HEARTBEAT_MS = 5 * 60 * 1000;     // keep backend session alive every 5 min while active

    let lastActivity = Date.now();
    let lastPing = Date.now();
    let timedOut = false;

    const triggerTimeout = async () => {
      if (timedOut) return;
      timedOut = true;
      await logoutUser("timeout");
      setCurrentUser(null);
      setUsersList([]);
      setAuditLogs([]);
      router.replace("/login?reason=timeout");
    };

    const markActivity = () => {
      if (timedOut) return;
      const now = Date.now();
      if (now - lastActivity >= IDLE_TIMEOUT_MS) {
        triggerTimeout();
        return;
      }
      lastActivity = now;
    };

    const activityEvents: (keyof WindowEventMap)[] = [
      "mousedown",
      "mousemove",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ];
    activityEvents.forEach((ev) => window.addEventListener(ev, markActivity, { passive: true }));

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && Date.now() - lastActivity >= IDLE_TIMEOUT_MS) {
        triggerTimeout();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastActivity >= IDLE_TIMEOUT_MS) {
        triggerTimeout();
        return;
      }
      if (now - lastPing >= HEARTBEAT_MS && lastActivity > lastPing) {
        lastPing = now;
        pingSession().catch(() => {});
      }
    }, 15_000);

    return () => {
      clearInterval(interval);
      activityEvents.forEach((ev) => window.removeEventListener(ev, markActivity));
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [authReady, router]);

  async function logoutPortal() {
    await logoutUser();
    setCurrentUser(null);
    setUsersList([]);
    setAuditLogs([]);
    router.replace("/login");
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null;
    setSelectedFile(f);
    setStatusMessage("");
  }

  async function uploadExcel(fileOverride?: File) {
    const targetFile = fileOverride || selectedFile;
    if (!targetFile) {
      setError("Please choose or drop an Excel file first.");
      return;
    }
    setUploading(true);
    setError("");
    setStatusMessage("");
    try {
      const uploaded = await uploadScheduleWorkbook(targetFile, snapshotDate);
      setStatusMessage(`Uploaded "${uploaded.filename}" (${uploaded.rowCount} rows) successfully`);
      setSelectedFile(null);
      await refreshData({ preferredSource: uploaded.snapshotId, resetCustomer: true });
      if (currentUser?.role === "admin") await loadAuditDashboard(currentUser);
      switchTab("dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDeleteSnapshot(snapshotId: string, filename: string) {
    if (!window.confirm(`Delete "${filename}"? This cannot be undone.`)) return;
    try {
      await deleteScheduleSnapshot(snapshotId);
      setStatusMessage("Workbook & snapshot deleted successfully");
      await refreshData({
        preferredSource: selectedSource === snapshotId ? "__ALL__" : selectedSource,
        resetCustomer: true,
      });
      if (currentUser?.role === "admin") await loadAuditDashboard(currentUser);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    }
  }

  const availableYears = useMemo(() => {
    const months = analytics?.availableMonths || [];
    return [...new Set(months.map((m) => m.slice(0, 4)))].sort();
  }, [analytics]);

  const monthsForYear = useMemo(() => {
    const months = analytics?.availableMonths || [];
    return months.filter((m) => m.startsWith(`${selectedYear}-`));
  }, [analytics, selectedYear]);

  // Schedule trio totals across monthlyTrend or partRows
  const scheduleTrio = useMemo(() => {
    const sel = analytics?.selectedMonth || "";
    const prev = sel ? shiftMonthKey(sel, -1) : "";
    const prev2 = sel ? shiftMonthKey(sel, -2) : "";
    const next = sel ? shiftMonthKey(sel, 1) : "";
    const trendByMonth = new Map((analytics?.monthlyTrend || []).map((t) => [t.month, t]));

    const getDemand = (mk: string) => {
      if (!mk) return null;
      if (mk === sel && analytics) return analytics.summary.totalDemand;
      const pt = trendByMonth.get(mk);
      return pt && pt.hasData ? pt.demand : null;
    };

    const prevVal = getDemand(prev);
    const prev2Val = getDemand(prev2);
    const selVal = getDemand(sel);
    const nextVal = getDemand(next);

    const deltaText = (curr: number | null, base: number | null, baseLabel: string) => {
      if (curr === null) return "Not in this sheet";
      if (!base || base <= 0) return "No earlier month to compare";
      const diff = curr - base;
      const pct = (diff / base) * 100;
      const sign = diff > 0 ? "+" : "";
      const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "●";
      return `${arrow} ${sign}${pct.toFixed(1)}% (${sign}${formatNumber(diff)}) vs ${baseLabel}`;
    };

    return {
      prevLabel: formatShortMonth(prev),
      prevVal,
      prevDelta: deltaText(prevVal, prev2Val, formatShortMonth(prev2)),
      selLabel: formatShortMonth(sel),
      selVal,
      selDelta: deltaText(selVal, prevVal, formatShortMonth(prev)),
      nextLabel: formatShortMonth(next),
      nextVal,
      nextDelta: deltaText(nextVal, selVal, formatShortMonth(sel)),
    };
  }, [analytics]);

  const topShortfallParts = useMemo(() => {
    return (analytics?.partRows || [])
      .filter((r) => r.commitment > 0 && r.diff < 0)
      .sort((a, b) => a.diff - b.diff);
  }, [analytics]);

const analysisAvailableMonths = useMemo(() => {
    const set = new Set<string>(analytics?.availableMonths || []);
    for (const r of scheduleRows) {
      Object.keys(r.monthlySchedules || {}).forEach((m) => /^\d{4}-\d{2}$/.test(m) && set.add(m));
      Object.keys(r.monthlyCommitments || {}).forEach((m) => /^\d{4}-\d{2}$/.test(m) && set.add(m));
      Object.keys(r.monthlyDispatches || {}).forEach((m) => /^\d{4}-\d{2}$/.test(m) && set.add(m));
    }
    return [...set].sort();
  }, [scheduleRows, analytics]);

  const compareMonthKey = useMemo(() => {
    if (compareMode === "NONE" || !selectedMonth) return "";
    if (compareMode === "PREV") return shiftMonthKey(selectedMonth, -1);
    if (analysisAvailableMonths.includes(compareMode) && compareMode !== selectedMonth) {
      return compareMode;
    }
    return shiftMonthKey(selectedMonth, -1);
  }, [compareMode, selectedMonth, analysisAvailableMonths]);

  // Options for the Customer / Part / Line searchable dropdown
  const scopeMenuData = useMemo(() => {
    const uniqueParts = new Map<
      string,
      { customer: string; partNo: string; customerPartNo: string; line: string; description: string }
    >();
    const lineStats = new Map<string, { companies: Set<string>; parts: Set<string> }>();
    const custStats = new Map<string, Set<string>>();

    for (const r of scheduleRows) {
      const customer = (r.customerGroup || r.customer || "Unknown").trim();
      const partNo = (r.partNo || "-").trim();
      const rawLine = (r.line || "").trim();
      const line = !rawLine || /^\d+$/.test(rawLine) ? "Uncategorized" : rawLine;
      const pkey = `${customer}||${partNo}`;

      if (!uniqueParts.has(pkey)) {
        uniqueParts.set(pkey, {
          customer,
          partNo,
          customerPartNo: (r.customerPartNo || "").trim(),
          line,
          description: (r.productDescription || "").trim(),
        });
      }

      if (!lineStats.has(line)) lineStats.set(line, { companies: new Set(), parts: new Set() });
      lineStats.get(line)!.companies.add(customer);
      lineStats.get(line)!.parts.add(pkey);

      if (!custStats.has(customer)) custStats.set(customer, new Set());
      custStats.get(customer)!.add(pkey);
    }

    const lines = [...lineStats.entries()]
      .map(([line, st]) => ({ line, companies: st.companies.size, parts: st.parts.size }))
      .sort((a, b) => a.line.localeCompare(b.line));

    const customers = [...custStats.entries()]
      .map(([customer, parts]) => ({ customer, parts: parts.size }))
      .sort((a, b) => a.customer.localeCompare(b.customer));

    const parts = [...uniqueParts.values()].sort(
      (a, b) => a.customer.localeCompare(b.customer) || a.partNo.localeCompare(b.partNo)
    );

    const tokens =
      analysisScope.type === "all"
        ? analysisScopeText.trim().toLowerCase().split(/\s+/).filter(Boolean)
        : [];

    const matchTokens = (haystack: string) =>
      tokens.length === 0 || tokens.every((t) => haystack.toLowerCase().includes(t));

    return {
      totalParts: uniqueParts.size,
      lines: lines.filter((l) => matchTokens(`all companies ${l.line}`)),
      customers: customers.filter((c) => matchTokens(c.customer)),
      parts: parts.filter((p) =>
        matchTokens(`${p.customer} ${p.partNo} ${p.customerPartNo} ${p.line} ${p.description}`)
      ),
    };
  }, [scheduleRows, analysisScope, analysisScopeText]);

  const analysisScopeLabel = useMemo(() => {
    if (analysisScope.type === "line") return `All customers · ${analysisScope.line}`;
    if (analysisScope.type === "customer") return `${analysisScope.customer} · All parts`;
    if (analysisScope.type === "part") return `${analysisScope.customer} · ${analysisScope.partNo}`;
    if (analysisScopeText.trim()) return `Filter: "${analysisScopeText.trim()}"`;
    return "All customers · All parts";
  }, [analysisScope, analysisScopeText]);

  // All Analysis tab metrics computed live from the scoped rows
  const analysisComputed = useMemo(() => {
    const tokens =
      analysisScope.type === "all"
        ? analysisScopeText.trim().toLowerCase().split(/\s+/).filter(Boolean)
        : [];

    const scopedRows = scheduleRows.filter((r) => {
      const customer = (r.customerGroup || r.customer || "Unknown").trim();
      const partNo = (r.partNo || "-").trim();
      const rawLine = (r.line || "").trim();
      const line = !rawLine || /^\d+$/.test(rawLine) ? "Uncategorized" : rawLine;

      if (analysisScope.type === "line") return line === analysisScope.line;
      if (analysisScope.type === "customer") return customer === analysisScope.customer;
      if (analysisScope.type === "part") {
        return customer === analysisScope.customer && partNo === analysisScope.partNo;
      }
      if (tokens.length > 0) {
        const hay = `${r.customer} ${r.customerGroup} ${r.customerCode} ${r.partNo} ${r.customerPartNo} ${r.line} ${r.productDescription}`.toLowerCase();
        return tokens.every((t) => hay.includes(t));
      }
      return true;
    });

    const getSched = (r: ScheduleRowItem, mk: string) =>
      mk ? Number(r.monthlySchedules?.[mk] || 0) : 0;
    const getCommit = (r: ScheduleRowItem, mk: string) => {
      if (!mk) return 0;
      const cm = r.monthlyCommitments || {};
      return Object.prototype.hasOwnProperty.call(cm, mk)
        ? Number(cm[mk] || 0)
        : Number(r.monthlySchedules?.[mk] || 0);
    };
    const getDisp = (r: ScheduleRowItem, mk: string) =>
      mk ? Number(r.monthlyDispatches?.[mk] || 0) : 0;

    // 1) Monthly Trend for scoped rows
    const monthlyTrend = analysisAvailableMonths.map((m) => {
      let demand = 0;
      let commitment = 0;
      let dispatched = 0;
      let hasData = false;
      for (const r of scopedRows) {
        const d = getSched(r, m);
        const c = getCommit(r, m);
        const p = getDisp(r, m);
        if (d || c || p) hasData = true;
        demand += d;
        commitment += c;
        dispatched += p;
      }
      return {
        month: m,
        label: formatShortMonth(m),
        demand,
        commitment,
        dispatched,
        fillRate: commitment > 0 ? Math.round((dispatched / commitment) * 1000) / 10 : null,
        hasData,
      };
    });

    // 2) Aggregate by customer + partNo for selectedMonth and compareMonthKey
    let totalDemand = 0;
    let totalCommitment = 0;
    let totalDispatched = 0;
    let grossShortfall = 0;
    let grossSurplus = 0;
    let partsShortfall = 0;
    let partsOnTarget = 0;
    let partsScheduled = 0;

    const partAgg = new Map<
      string,
      {
        customer: string;
        partNo: string;
        line: string;
        demand: number;
        commitment: number;
        dispatched: number;
        compareDemand: number;
      }
    >();

    for (const r of scopedRows) {
      const customer = (r.customerGroup || r.customer || "Unknown").trim();
      const partNo = (r.partNo || "-").trim();
      const line = (r.line || "-").trim() || "-";
      const pkey = `${customer}||${partNo}`;

      const dQty = getSched(r, selectedMonth);
      const cQty = getCommit(r, selectedMonth);
      const pQty = getDisp(r, selectedMonth);
      const cmpQty = compareMonthKey ? getSched(r, compareMonthKey) : 0;

      if (!partAgg.has(pkey)) {
        partAgg.set(pkey, {
          customer,
          partNo,
          line,
          demand: 0,
          commitment: 0,
          dispatched: 0,
          compareDemand: 0,
        });
      }
      const item = partAgg.get(pkey)!;
      item.demand += dQty;
      item.commitment += cQty;
      item.dispatched += pQty;
      item.compareDemand += cmpQty;
    }

    let totalCompareDemand = 0;
    let partsUp = 0;
    let partsDown = 0;
    let aboveCount = 0;
    let shortfallCount = 0;
    let metCount = 0;

    const allParts: {
      customer: string;
      partNo: string;
      line: string;
      demand: number;
      commitment: number;
      dispatched: number;
      diff: number;
      achievementRate: number | null;
      compareDemand: number;
      compareDelta: number;
      status: "shortfall" | "met" | "above" | "no_plan";
    }[] = [];

    for (const item of partAgg.values()) {
      totalDemand += item.demand;
      totalCommitment += item.commitment;
      totalDispatched += item.dispatched;
      totalCompareDemand += item.compareDemand;

      if (compareMonthKey) {
        if (item.demand > item.compareDemand) partsUp += 1;
        else if (item.demand < item.compareDemand) partsDown += 1;
      }

      const diff = item.dispatched - item.commitment;
      const ach =
        item.commitment > 0
          ? Math.round((item.dispatched / item.commitment) * 1000) / 10
          : null;

      if (item.commitment > 0) {
        partsScheduled += 1;
        if (ach !== null && ach >= targetPercent) partsOnTarget += 1;
        if (diff < 0) {
          grossShortfall += Math.abs(diff);
          partsShortfall += 1;
        } else if (diff > 0) {
          grossSurplus += diff;
        }
      }

      if (item.demand === 0 && item.commitment === 0 && item.dispatched === 0) {
        continue;
      }

      const status: "shortfall" | "met" | "above" | "no_plan" =
        item.commitment <= 0
          ? "no_plan"
          : diff < 0
            ? "shortfall"
            : diff > 0
              ? "above"
              : "met";

      if (status === "above") aboveCount += 1;
      else if (status === "shortfall") shortfallCount += 1;
      else if (status === "met") metCount += 1;

      allParts.push({
        ...item,
        diff,
        achievementRate: ach,
        compareDelta: item.demand - item.compareDemand,
        status,
      });
    }

    const momDiff = totalDemand - totalCompareDemand;
    const momPct = totalCompareDemand > 0 ? (momDiff / totalCompareDemand) * 100 : null;
    const fulfillmentRate =
      totalCommitment > 0 ? Math.round((totalDispatched / totalCommitment) * 1000) / 10 : null;

    return {
      monthlyTrend,
      summary: {
        totalDemand,
        totalCommitment,
        totalDispatched,
        fulfillmentRate,
        grossShortfall,
        grossSurplus,
        netDiff: totalDispatched - totalCommitment,
        partsShortfall,
        partsOnTarget,
        partsScheduled,
      },
      counts: {
        all: allParts.length,
        above: aboveCount,
        shortfall: shortfallCount,
        met: metCount,
        partsUp,
        partsDown,
        momDiff,
        momPct,
      },
      parts: allParts,
    };
  }, [scheduleRows, analysisScope, analysisScopeText, analysisAvailableMonths, selectedMonth, compareMonthKey, targetPercent]);

  function toggleCmpSort(key: CmpSortKey) {
    if (cmpSortKey === key) {
      setCmpSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setCmpSortKey(key);
      const ascDefault = key === "customer" || key === "partNo" || key === "line" || key === "status" || key === "diff";
      setCmpSortDir(ascDefault ? "asc" : "desc");
    }
  }

  const filteredComparisonRows = useMemo(() => {
    const q = cmpSearch.trim().toLowerCase();
    const statusOrder = { shortfall: 0, no_plan: 1, met: 2, above: 3 };
    const list = analysisComputed.parts.filter((r) => {
      if (cmpFilter === "increased" && r.status !== "above") return false;
      if (cmpFilter === "decreased" && r.status !== "shortfall") return false;
      if (cmpFilter === "unchanged" && r.status !== "met") return false;
      if (!q) return true;
      return (
        r.customer.toLowerCase().includes(q) ||
        r.partNo.toLowerCase().includes(q) ||
        r.line.toLowerCase().includes(q)
      );
    });

    const dir = cmpSortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      if (cmpSortKey === "customer") return a.customer.localeCompare(b.customer) * dir;
      if (cmpSortKey === "partNo") return a.partNo.localeCompare(b.partNo) * dir;
      if (cmpSortKey === "line") return a.line.localeCompare(b.line) * dir;
      if (cmpSortKey === "status") return (statusOrder[a.status] - statusOrder[b.status]) * dir;
      if (cmpSortKey === "achievementRate") {
        const av = a.achievementRate ?? -1;
        const bv = b.achievementRate ?? -1;
        return (av - bv) * dir;
      }
      return (a[cmpSortKey] - b[cmpSortKey]) * dir;
    });
  }, [analysisComputed.parts, cmpSearch, cmpFilter, cmpSortKey, cmpSortDir]);

  const productLineSummary = useMemo(() => {
    const map = new Map<string, { line: string; commitment: number; dispatched: number; shortfall: number }>();
    for (const r of analysisComputed.parts) {
      const lineName = !r.line || r.line === "-" || /^\d+$/.test(r.line) ? "Uncategorized" : r.line;
      const cur = map.get(lineName) || { line: lineName, commitment: 0, dispatched: 0, shortfall: 0 };
      cur.commitment += r.commitment;
      cur.dispatched += r.dispatched;
      if (r.commitment > 0 && r.diff < 0) {
        cur.shortfall += r.diff;
      }
      map.set(lineName, cur);
    }
    const items = [...map.values()]
      .filter((x) => x.commitment > 0 || x.dispatched > 0)
      .map((x) => ({
        ...x,
        fillRate: x.commitment > 0 ? Math.round((x.dispatched / x.commitment) * 1000) / 10 : null,
      }));

    items.sort((a, b) => {
      const dir = lineSortDir === "asc" ? 1 : -1;
      if (lineSortKey === "line") return a.line.localeCompare(b.line) * dir;
      const av = a[lineSortKey] ?? -1;
      const bv = b[lineSortKey] ?? -1;
      return (Number(av) - Number(bv)) * dir;
    });

    const totalCommitment = items.reduce((s, x) => s + x.commitment, 0);
    const totalDispatched = items.reduce((s, x) => s + x.dispatched, 0);
    const totalShortfall = items.reduce((s, x) => s + x.shortfall, 0);
    const totalFillRate = totalCommitment > 0 ? Math.round((totalDispatched / totalCommitment) * 1000) / 10 : null;
    return { items, totalCommitment, totalDispatched, totalShortfall, totalFillRate };
  }, [analysisComputed.parts, lineSortKey, lineSortDir]);

  function toggleLineSort(key: "line" | "commitment" | "dispatched" | "fillRate" | "shortfall") {
    if (lineSortKey === key) {
      setLineSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setLineSortKey(key);
      setLineSortDir(key === "line" ? "asc" : "desc");
    }
  }

  const filteredRecordsRows = useMemo(() => {
    const q = recordsSearch.trim().toLowerCase();
    return scheduleRows.filter((r) => {
      const cname = (r.customerGroup || r.customer || "").trim();
      if (recordsCustomer !== "ALL" && cname !== recordsCustomer) return false;
      if (!q) return true;
      return [
        r.serialNo,
        r.customer,
        r.customerGroup,
        r.customerCode,
        r.partNo,
        r.helper,
        r.customerPartNo,
        r.line,
        r.productDescription,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [scheduleRows, recordsSearch, recordsCustomer]);

  async function handleDeleteRow(rowId: number, partNo: string) {
    if (!window.confirm(`Delete schedule row for part "${partNo}"?`)) return;
    try {
      await deleteScheduleRow(rowId);
      setStatusMessage(`Deleted row for part ${partNo}.`);
      await refreshData();
      if (currentUser?.role === "admin") await loadAuditDashboard(currentUser);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not delete row.");
    }
  }

  function exportComparisonToCSV() {
    const headers = ["Customer", "Part No", "Line", "Customer Schedule", "IFB Commitment", "IFB Dispatch", "Difference", "Achievement %", "Status"];
    const csv = [
      headers.join(","),
      ...filteredComparisonRows.map((r) => {
        const status = r.commitment <= 0 ? "No plan" : r.diff === 0 ? "Met" : r.diff > 0 ? "Above" : "Shortfall";
        return [
          `"${String(r.customer).replace(/"/g, '""')}"`,
          `"${String(r.partNo).replace(/"/g, '""')}"`,
          `"${String(r.line).replace(/"/g, '""')}"`,
          r.demand,
          r.commitment,
          r.dispatched,
          r.diff,
          r.achievementRate ?? "",
          status,
        ].join(",");
      }),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `IFB_Analysis_${selectedMonth || "export"}.csv`;
    postAuditEvent("EXPORT", "Exported analysis CSV", "export").catch(() => {});
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportRecordsToCSV() {
    const m1Key = selectedMonth || "2026-09";
    const m2Key = shiftMonthKey(m1Key, 1);
    const m3Key = shiftMonthKey(m1Key, 2);
    const headers = [
      "Sl No", "Customer", "Customer Code", "Part No", "Helper", "Customer Part No",
      "Line", "Description", formatShortMonth(m1Key), formatShortMonth(m2Key),
      formatShortMonth(m3Key), "Actual Dispatch", "Backlog",
    ];
    const csv = [
      headers.join(","),
      ...filteredRecordsRows.map((r) => {
        const q1 = Number(r.monthlySchedules?.[m1Key] || 0);
        const q2 = Number(r.monthlySchedules?.[m2Key] || 0);
        const q3 = Number(r.monthlySchedules?.[m3Key] || 0);
        const disp = Number(r.monthlyDispatches?.[m1Key] || 0);
        return [
          `"${String(r.serialNo).replace(/"/g, '""')}"`,
          `"${String(r.customer).replace(/"/g, '""')}"`,
          `"${String(r.customerCode).replace(/"/g, '""')}"`,
          `"${String(r.partNo).replace(/"/g, '""')}"`,
          `"${String(r.helper).replace(/"/g, '""')}"`,
          `"${String(r.customerPartNo).replace(/"/g, '""')}"`,
          `"${String(r.line).replace(/"/g, '""')}"`,
          `"${String(r.productDescription).replace(/"/g, '""')}"`,
          q1, q2, q3, disp, q1 - disp,
        ].join(",");
      }),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `IFB_Records_${m1Key}.csv`;
    postAuditEvent("EXPORT", "Exported records CSV", "export").catch(() => {});
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportAuditLogsToCSV() {
    const headers = ["Time", "User", "Role", "Category", "Action", "Activity"];
    const csv = [
      headers.join(","),
      ...visibleAuditLogs.map((l) =>
        [
          `"${l.at ? new Date(l.at).toLocaleString("en-IN") : ""}"`,
          `"${String(l.username).replace(/"/g, '""')}"`,
          `"${String(l.role).replace(/"/g, '""')}"`,
          `"${String(l.category).replace(/"/g, '""')}"`,
          `"${String(l.action).replace(/"/g, '""')}"`,
          `"${String(l.summary).replace(/"/g, '""')}"`,
        ].join(",")
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `IFB_Audit_Logs_${new Date().toISOString().slice(0, 10)}.csv`;
    postAuditEvent("EXPORT", "Exported audit logs CSV", "export").catch(() => {});
    a.click();
    URL.revokeObjectURL(url);
  }

  function renderTrendChart(
    points = analytics?.monthlyTrend || [],
    range: "6" | "12" | "all" = trendRange,
    showSummaryStrip = false
  ) {
    const byMonth = new Map(points.map((p) => [p.month, p]));
    let visiblePoints = points;
    if (range === "12") {
      visiblePoints = Array.from({ length: 12 }, (_, idx) => {
        const mk = `${trendYear}-${String(idx + 1).padStart(2, "0")}`;
        return (
          byMonth.get(mk) || {
            month: mk,
            label: formatShortMonth(mk),
            demand: 0,
            commitment: 0,
            dispatched: 0,
            fillRate: null,
            hasData: false,
          }
        );
      });
    } else if (range === "6") {
      visiblePoints = points.slice(-6);
    }

    const rawMax = Math.max(1, ...visiblePoints.flatMap((p) => [p.demand, p.commitment, p.dispatched]));
    const axisMax = Math.ceil(rawMax / 50000) * 50000 || 100000;
    const axisMid = Math.round(axisMax / 2);
    const selectedPt = visiblePoints.find((p) => p.month === analytics?.selectedMonth);

    return (
      <div>
        <div className="mb-3 flex flex-wrap gap-5 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <i className="bar-demand inline-block h-2.5 w-2.5 rounded-sm" />
            Customer demand
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="bar-commit inline-block h-2.5 w-2.5 rounded-sm" />
            IFB commitment
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i className="bar-disp inline-block h-2.5 w-2.5 rounded-sm" />
            Dispatched
          </span>
        </div>

        <div className="overflow-x-auto">
          <div className="relative flex min-w-[640px] items-stretch gap-3 pt-2">
            {/* Y-Axis ticks */}
            <div className="flex h-44 w-11 shrink-0 flex-col justify-between pb-1 text-right text-[11px] font-medium text-slate-400">
              <span>{formatAxisTick(axisMax)}</span>
              <span>{formatAxisTick(axisMid)}</span>
              <span>0</span>
            </div>

            {/* Plot area */}
            <div className="relative flex-1">
              <div className="pointer-events-none absolute inset-x-0 top-0 flex h-44 flex-col justify-between">
                <div className="border-t border-slate-100" />
                <div className="border-t border-slate-100" />
                <div className="border-t border-slate-200" />
              </div>

              <div
                className="relative grid gap-1.5"
                style={{ gridTemplateColumns: `repeat(${Math.max(1, visiblePoints.length)}, minmax(52px, 1fr))` }}
              >
                {visiblePoints.map((pt, idx) => {
                  const dPct = pt.demand > 0 ? Math.max(3, Math.min(100, (pt.demand / axisMax) * 100)) : 0;
                  const cPct = pt.commitment > 0 ? Math.max(3, Math.min(100, (pt.commitment / axisMax) * 100)) : 0;
                  const pPct = pt.dispatched > 0 ? Math.max(3, Math.min(100, (pt.dispatched / axisMax) * 100)) : 0;
                  const isSel = pt.month === analytics?.selectedMonth;
                  const fill = pt.fillRate;
                  const chipClass =
                    fill === null
                      ? "bg-slate-100 text-slate-400"
                      : fill >= targetPercent
                        ? "bg-emerald-100 text-emerald-700"
                        : fill >= targetPercent - 10
                          ? "bg-amber-100 text-amber-700"
                          : "bg-red-100 text-red-700";

                  const tooltipPos =
                    idx === 0
                      ? "left-0"
                      : idx === visiblePoints.length - 1
                        ? "right-0"
                        : "left-1/2 -translate-x-1/2";

                  return (
                    <button
                      key={pt.month}
                      type="button"
                      disabled={!pt.hasData}
                      onClick={() => pt.hasData && refreshData({ preferredMonth: pt.month })}
                      className={`group relative flex flex-col items-center rounded-lg px-1 pt-0 pb-2 text-center transition ${
                        isSel
                          ? "bg-sky-50/90"
                          : pt.hasData
                            ? "hover:bg-slate-50 cursor-pointer"
                            : "cursor-default"
                      }`}
                    >
                      {pt.hasData && (
                        <div
                          className={`pointer-events-none absolute top-1 z-30 w-48 rounded-lg bg-slate-900/95 px-3 py-2 text-left text-[11px] text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 ${tooltipPos}`}
                        >
                          <div className="mb-1.5 flex items-center justify-between border-b border-slate-700 pb-1 font-bold">
                            <span>{formatQuoteMonth(pt.month)}</span>
                            <span className="text-emerald-300">
                              {fill !== null ? `${fill.toFixed(1)}%` : "–"}
                            </span>
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 text-slate-300">
                                <i className="bar-demand inline-block h-2 w-2 rounded-xs" />
                                Schedule
                              </span>
                              <span className="font-mono font-semibold">{formatNumber(pt.demand)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 text-slate-300">
                                <i className="bar-commit inline-block h-2 w-2 rounded-xs" />
                                Commitment
                              </span>
                              <span className="font-mono font-semibold">{formatNumber(pt.commitment)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 text-slate-300">
                                <i className="bar-disp inline-block h-2 w-2 rounded-xs" />
                                Dispatched
                              </span>
                              <span className="font-mono font-semibold">{formatNumber(pt.dispatched)}</span>
                            </div>
                            <div className="mt-1 flex items-center justify-between gap-2 border-t border-slate-700 pt-1">
                              <span className="text-slate-300">Fill Rate</span>
                              <span className="font-mono font-bold text-emerald-300">
                                {fill !== null ? `${fill.toFixed(1)}%` : "–"}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex h-44 items-end justify-center gap-1">
                        {pt.hasData && (
                          <>
                            <div className="bar-demand w-2.5 sm:w-3 rounded-t" style={{ height: `${dPct}%` }} />
                            <div className="bar-commit w-2.5 sm:w-3 rounded-t" style={{ height: `${cPct}%` }} />
                            <div className="bar-disp w-2.5 sm:w-3 rounded-t" style={{ height: `${pPct}%` }} />
                          </>
                        )}
                      </div>
                      <span className={`mt-2 text-xs ${isSel ? "font-bold text-[#123b63]" : "font-medium text-slate-600"}`}>
                        {formatQuoteMonth(pt.month)}
                      </span>
                      <span className={`mt-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${chipClass}`}>
                        {fill !== null ? `${fill.toFixed(1)}%` : "–"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {showSummaryStrip && selectedPt && (
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600">
            <span className="font-bold text-[#123b63]">{formatQuoteMonth(selectedPt.month)}</span>
            <span>Customer demand <strong className="text-slate-900">{formatNumber(selectedPt.demand)}</strong></span>
            <span>IFB commitment <strong className="text-slate-900">{formatNumber(selectedPt.commitment)}</strong></span>
            <span>Dispatched <strong className="text-slate-900">{formatNumber(selectedPt.dispatched)}</strong></span>
            <span>Fill rate <strong className="text-slate-900">{selectedPt.fillRate !== null ? `${selectedPt.fillRate.toFixed(1)}%` : "–"}</strong></span>
          </div>
        )}
      </div>
    );
  }

  const rate = analytics?.summary.fulfillmentRate ?? null;
  const isAboveTarget = rate !== null && rate >= targetPercent;
  const m1 = analytics?.selectedMonth || "2026-09";
  const m2 = shiftMonthKey(m1, 1);
  const m3 = shiftMonthKey(m1, 2);

  const visibleAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return auditLogs.filter((l) => {
      if (inspectSession) {
        if (l.username !== inspectSession.username) return false;
        const t = l.at ? new Date(l.at).getTime() : 0;
        const start = new Date(inspectSession.signedInAt).getTime() - 2000;
        const end =
          inspectSession.status === "active"
            ? Date.now() + 60000
            : new Date(inspectSession.lastActiveAt).getTime() + 5000;
        if (t < start || t > end) return false;
      }
      if (auditCategory !== "all" && l.category.toLowerCase() !== auditCategory) return false;
      if (!q) return true;
      return `${l.username} ${l.action} ${l.summary}`.toLowerCase().includes(q);
    });
  }, [auditLogs, auditCategory, auditSearch, inspectSession]);

  if (!authReady) return null;
  const navItems: { key: TabKey; icon: string; label: string }[] = [
    { key: "dashboard", icon: "📊", label: "Dashboard" },
    { key: "analysis", icon: "📈", label: "Analysis" },
    { key: "records", icon: "📋", label: "Records" },
    { key: "upload", icon: "📤", label: "Upload" },
  ];
  if (currentUser?.role === "admin") {
    navItems.push(
      { key: "users", icon: "👥", label: "Users" },
      { key: "logs", icon: "🕒", label: "Logs" }
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f1f5f9] text-[#0f172a]">
      {/* TOP HEADER */}
      <header className="ifb-header">
        <div className="flex items-center gap-3.5">
          <div className="ifb-logo">IFB</div>
          <div>
            <h1 className="text-lg font-bold leading-tight">IFB Manufacturing Solutions</h1>
            <p className="text-xs text-slate-300">Real-Time Production, Delivery Schedule &amp; Performance Portal</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>{loading ? "Syncing..." : "System Online | Connected"}</span>
          </div>
          <div className="rounded bg-black/25 px-3 py-1 font-mono text-xs text-slate-200">{clockText}</div>
          {currentUser && (
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 py-1 pr-1.5 pl-3 text-xs font-medium">
              <span>
                {currentUser.name} ({currentUser.username})
              </span>
              <button
                type="button"
                onClick={logoutPortal}
                className="rounded-full bg-[#e11d48] px-3 py-0.5 text-xs font-bold text-white hover:bg-[#be123c] cursor-pointer"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </header>

      {/* SIDEBAR + MAIN SHELL */}
      <div className="ifb-shell">
        <aside className="ifb-sidebar">
          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              title={item.label}
              onClick={() => switchTab(item.key)}
              className={`ifb-nav-btn ${activeTab === item.key ? "active" : ""}`}
            >
              <span className="ifb-nav-icon">{item.icon}</span>
              <span className="ifb-nav-label">{item.label}</span>
            </button>
          ))}
        </aside>

        <main className="ifb-main space-y-5">
          {(statusMessage || error) && (
            <div className="fixed top-3 right-4 z-[200] flex flex-col gap-2">
              {statusMessage && (
                <div
                  role="status"
                  className="flex items-center gap-2.5 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-xl"
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-white text-[11px] font-black text-emerald-700">
                    ✓
                  </span>
                  <span>{statusMessage}</span>
                  <button
                    type="button"
                    aria-label="Close notification"
                    onClick={() => setStatusMessage("")}
                    className="ml-2 rounded px-1 text-white/80 hover:bg-white/15 hover:text-white cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              )}
              {error && (
                <div
                  role="alert"
                  className="flex items-center gap-2.5 rounded-lg bg-red-600 px-4 py-2.5 text-xs font-bold text-white shadow-xl"
                >
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-white text-[11px] font-black text-red-700">
                    !
                  </span>
                  <span>{error}</span>
                  <button
                    type="button"
                    aria-label="Close error"
                    onClick={() => setError("")}
                    className="ml-2 rounded px-1 text-white/80 hover:bg-white/15 hover:text-white cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 1: DASHBOARD */}
          {activeTab === "dashboard" && (
            <>
              <div className="ifb-panel flex flex-wrap items-center justify-between gap-4 py-3">
                <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-slate-600">
                  <label className="flex items-center gap-2">
                    Customer:
                    <select
                      value={selectedCustomer}
                      onChange={(e) => refreshData({ preferredCustomer: e.target.value })}
                      className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-900"
                    >
                      <option value="ALL">All Customers (Consolidated)</option>
                      {(analytics?.customers || []).map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </label>

                  <label className="flex items-center gap-2">
                    Source:
                    <select
                      value={selectedSource}
                      onChange={(e) => refreshData({ preferredSource: e.target.value, resetCustomer: true })}
                      className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-900"
                    >
                      <option value="__ALL__">Latest Uploaded Sheet</option>
                      {snapshots.map((s) => (
                        <option key={s.snapshotId} value={s.snapshotId}>
                          {s.filename} ({s.snapshotDate})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex items-center gap-2">
                    Year:
                    <select
                      value={selectedYear}
                      onChange={(e) => {
                        const y = e.target.value;
                        setSelectedYear(y);
                        const match = (analytics?.availableMonths || []).filter((m) => m.startsWith(`${y}-`));
                        if (match.length) refreshData({ preferredMonth: match[match.length - 1] });
                      }}
                      className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-900"
                    >
                      {availableYears.length ? (
                        availableYears.map((y) => <option key={y} value={y}>{y}</option>)
                      ) : (
                        <option value="2026">2026</option>
                      )}
                    </select>
                  </label>

                  <label className="flex items-center gap-2">
                    Month:
                    <select
                      value={selectedMonth}
                      onChange={(e) => refreshData({ preferredMonth: e.target.value })}
                      className="rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-900"
                    >
                      {monthsForYear.length ? (
                        monthsForYear.map((m) => (
                          <option key={m} value={m}>{MONTH_NAMES[Number(m.slice(5, 7)) - 1] || m}</option>
                        ))
                      ) : (
                        <option value="">No Month</option>
                      )}
                    </select>
                  </label>

                  <label className="flex items-center gap-1.5">
                    Target:
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={targetPercent}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (v >= 1 && v <= 100) {
                          setTargetPercent(v);
                          refreshData({ preferredTarget: v });
                        }
                      }}
                      className="w-14 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-900"
                    />
                    <span>%</span>
                  </label>
                </div>

                <button
                  type="button"
                  onClick={() => switchTab("upload")}
                  className="rounded-md bg-[#123b63] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0c2844]"
                >
                  + Upload Schedule
                </button>
              </div>

              <div>
                <h2 className="text-lg font-bold text-[#123b63]">
                  {selectedCustomer === "ALL" ? "All customers" : selectedCustomer} · {formatShortMonth(selectedMonth)}
                </h2>
                <p className="text-xs text-slate-500">
                  Source: {selectedSource === "__ALL__" ? "Latest Uploaded Sheet" : snapshots.find((s) => s.snapshotId === selectedSource)?.filename || selectedSource}
                </p>
              </div>

              {/* Schedule Trio */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="ifb-panel">
                  <div className="text-[11px] font-bold uppercase text-slate-500">PREVIOUS · {scheduleTrio.prevLabel || "–"}</div>
                  <div className="mt-1 text-3xl font-extrabold">{scheduleTrio.prevVal !== null ? formatNumber(scheduleTrio.prevVal) : "–"}</div>
                  <div className={`mt-1 text-xs font-semibold ${deltaToneClass(scheduleTrio.prevDelta)}`}>{scheduleTrio.prevDelta}</div>
                </div>
                <div className="ifb-panel border-t-4 border-t-sky-600">
                  <div className="text-[11px] font-bold uppercase text-slate-500">SELECTED · {scheduleTrio.selLabel || "–"}</div>
                  <div className="mt-1 text-3xl font-extrabold text-sky-700">{scheduleTrio.selVal !== null ? formatNumber(scheduleTrio.selVal) : "–"}</div>
                  <div className={`mt-1 text-xs font-semibold ${deltaToneClass(scheduleTrio.selDelta)}`}>{scheduleTrio.selDelta}</div>
                </div>
                <div className="ifb-panel">
                  <div className="text-[11px] font-bold uppercase text-slate-500">UPCOMING · {scheduleTrio.nextLabel || "–"}</div>
                  <div className="mt-1 text-3xl font-extrabold">{scheduleTrio.nextVal !== null ? formatNumber(scheduleTrio.nextVal) : "–"}</div>
                  <div className={`mt-1 text-xs font-semibold ${deltaToneClass(scheduleTrio.nextDelta)}`}>{scheduleTrio.nextDelta}</div>
                </div>
              </div>

              {/* 3 KPI Cards */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="ifb-panel border-t-4 border-t-[#123b63] flex items-start gap-3.5">
                  <span className="rounded bg-slate-100 p-2 text-xl">🚚</span>
                  <div>
                    <div className="text-[11px] font-bold uppercase text-slate-500">DISPATCHED</div>
                    <div className="text-2xl font-extrabold text-[#123b63]">{formatNumber(analytics?.summary.totalDispatched)}</div>
                    <div className="text-xs text-slate-500">of {formatNumber(analytics?.summary.totalCommitment)} committed</div>
                  </div>
                </div>

                <div className="ifb-panel border-t-4 border-t-emerald-600 flex items-start gap-3.5">
                  <span className="rounded bg-slate-100 p-2 text-xl">✅</span>
                  <div className="flex-1">
                    <div className="text-[11px] font-bold uppercase text-slate-500">FULFILLMENT</div>
                    <div className={`text-2xl font-extrabold ${isAboveTarget ? "text-emerald-600" : "text-red-600"}`}>
                      {rate !== null ? `${rate.toFixed(1)}%` : "–"}
                    </div>
                    <div className="mt-1.5 h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${isAboveTarget ? "bg-emerald-500" : "bg-red-500"}`}
                        style={{ width: `${Math.min(100, Math.max(0, rate ?? 0))}%` }}
                      />
                    </div>
                    <div className="mt-1 text-xs text-slate-500">Target {targetPercent}% · {isAboveTarget ? "On target" : "Below target"}</div>
                  </div>
                </div>

                <div className="ifb-panel border-t-4 border-t-violet-600 flex items-start gap-3.5">
                  <span className="rounded bg-slate-100 p-2 text-xl">⚠️</span>
                  <div>
                    <div className="text-[11px] font-bold uppercase text-slate-500">SHORTFALL</div>
                    <div className="text-2xl font-extrabold text-violet-700">
                      {(analytics?.summary.grossShortfall || 0) > 0 ? `-${formatNumber(analytics?.summary.grossShortfall)}` : "0"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {analytics?.summary.partsShortfall || 0} parts short · {formatNumber(analytics?.summary.grossSurplus || 0)} above plan
                    </div>
                  </div>
                </div>
              </div>

              {/* 6-Month Trend */}
              <div className="ifb-panel">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold">6-Month Trend</h3>
                    <p className="text-xs text-slate-500">Click a month to switch the dashboard to it. The chip is dispatched ÷ commitment.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => switchTab("analysis")}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-50"
                  >
                    Open Analysis →
                  </button>
                </div>
                {renderTrendChart(undefined, "6")}
              </div>

              {/* Top Shortfall Parts */}
              <div className="ifb-panel">
                <h3 className="text-base font-bold">Top Shortfall Parts</h3>
                <p className="mb-3 text-xs text-slate-500">
                  Showing {Math.min(5, topShortfallParts.length)} of {topShortfallParts.length} short parts · {formatShortMonth(selectedMonth)}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 text-[11px] uppercase text-slate-500">
                      <tr>
                        <th className="py-2 pr-3">Part No.</th>
                        <th className="py-2 pr-3">Customer</th>
                        <th className="py-2 pr-3 text-right">Committed</th>
                        <th className="py-2 pr-3 text-right">Dispatched</th>
                        <th className="py-2 pr-3 text-right">Short</th>
                        <th className="py-2">Fill Rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {topShortfallParts.slice(0, 5).map((r) => (
                        <tr key={`${r.customer}-${r.partNo}`}>
                          <td className="py-2 pr-3"><span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono">{r.partNo}</span></td>
                          <td className="py-2 pr-3 font-medium">{r.customer}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(r.commitment)}</td>
                          <td className="py-2 pr-3 text-right">{formatNumber(r.dispatched)}</td>
                          <td className="py-2 pr-3 text-right font-bold text-red-600">{formatNumber(r.diff)}</td>
                          <td className="py-2 font-semibold">{r.achievementRate !== null ? `${r.achievementRate.toFixed(1)}%` : "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* TAB 2: SCHEDULE ANALYSIS & COMPARISON */}
          {activeTab === "analysis" && (
            <>
              <div className="ifb-panel grid grid-cols-1 gap-4 md:grid-cols-5">
                <label className="flex flex-col gap-1 text-xs font-bold">
                  Excel Sheet:
                  <select
                    value={selectedSource}
                    onChange={(e) => {
                      setAnalysisScope({ type: "all" });
                      setAnalysisScopeText("");
                      setCompareMode("PREV");
                      refreshData({ preferredSource: e.target.value, resetCustomer: true });
                    }}
                    className="rounded-md border border-slate-300 px-2.5 py-2 font-semibold"
                  >
                    <option value="__ALL__">Latest Uploaded Sheet</option>
                    {snapshots.map((s) => (
                      <option key={s.snapshotId} value={s.snapshotId}>{s.snapshotDate} · {s.filename}</option>
                    ))}
                  </select>
                </label>

                <div ref={scopeDropdownRef} className="relative flex flex-col gap-1 text-xs font-bold md:col-span-2">
                  <span>Customer / Part / Line:</span>
                  <div className="relative">
                    <input
                      type="text"
                      value={analysisScopeText}
                      onFocus={() => setScopeDropdownOpen(true)}
                      onClick={() => setScopeDropdownOpen(true)}
                      onChange={(e) => {
                        setAnalysisScope({ type: "all" });
                        setAnalysisScopeText(e.target.value);
                        setScopeDropdownOpen(true);
                      }}
                      placeholder="All customers & parts — type company, part, or line (e.g. blower)..."
                      className="w-full rounded-md border border-slate-300 py-2 pr-8 pl-2.5 font-normal focus:border-blue-500 focus:outline-none"
                    />
                    {(analysisScopeText || analysisScope.type !== "all") && (
                      <button
                        type="button"
                        title="Clear filter"
                        onClick={() => {
                          setAnalysisScope({ type: "all" });
                          setAnalysisScopeText("");
                          setScopeDropdownOpen(false);
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {scopeDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
                      <div className="border-b border-slate-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        RESET / ALL
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setAnalysisScope({ type: "all" });
                          setAnalysisScopeText("");
                          setScopeDropdownOpen(false);
                        }}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-slate-800 hover:bg-blue-50"
                      >
                        <span>All Customers &amp; All Parts</span>
                        <span className="text-[11px] text-slate-400">{scopeMenuData.totalParts} parts</span>
                      </button>

                      {scopeMenuData.lines.length > 0 && (
                        <>
                          <div className="border-y border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            PRODUCT LINES (ALL COMPANIES)
                          </div>
                          {scopeMenuData.lines.map((ln) => (
                            <button
                              key={ln.line}
                              type="button"
                              onClick={() => {
                                const label = `All companies · ${ln.line}`;
                                setAnalysisScope({ type: "line", line: ln.line, label });
                                setAnalysisScopeText(label);
                                setScopeDropdownOpen(false);
                              }}
                              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-slate-800 hover:bg-blue-50"
                            >
                              <span>All companies · {ln.line}</span>
                              <span className="text-[11px] text-slate-400">
                                {ln.companies} companies · {ln.parts} parts
                              </span>
                            </button>
                          ))}
                        </>
                      )}

                      {scopeMenuData.customers.length > 0 && (
                        <>
                          <div className="border-y border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            CUSTOMERS
                          </div>
                          {scopeMenuData.customers.map((c) => (
                            <button
                              key={c.customer}
                              type="button"
                              onClick={() => {
                                setAnalysisScope({ type: "customer", customer: c.customer, label: c.customer });
                                setAnalysisScopeText(c.customer);
                                setScopeDropdownOpen(false);
                              }}
                              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-slate-800 hover:bg-blue-50"
                            >
                              <span>{c.customer}</span>
                              <span className="text-[11px] text-slate-400">{c.parts} parts</span>
                            </button>
                          ))}
                        </>
                      )}

                      {scopeMenuData.parts.length > 0 && (
                        <>
                          <div className="border-y border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                            PARTS ({scopeMenuData.parts.length})
                          </div>
                          {scopeMenuData.parts.slice(0, 60).map((p) => (
                            <button
                              key={`${p.customer}-${p.partNo}`}
                              type="button"
                              onClick={() => {
                                const label = `${p.customer} · ${p.partNo}`;
                                setAnalysisScope({
                                  type: "part",
                                  customer: p.customer,
                                  partNo: p.partNo,
                                  line: p.line,
                                  label,
                                });
                                setAnalysisScopeText(label);
                                setScopeDropdownOpen(false);
                              }}
                              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-blue-50"
                            >
                              <div className="min-w-0">
                                <span className="font-mono font-bold text-slate-900">{p.partNo}</span>
                                <span className="ml-2 font-medium text-slate-700">{p.customer}</span>
                                {p.description && (
                                  <div className="truncate text-[11px] font-normal text-slate-400">{p.description}</div>
                                )}
                              </div>
                              <span className="shrink-0 text-[11px] font-normal text-slate-400">{p.line}</span>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>

                <label className="flex flex-col gap-1 text-xs font-bold">
                  Month:
                  <select
                    value={selectedMonth}
                    onChange={(e) => refreshData({ preferredMonth: e.target.value })}
                    className="rounded-md border border-slate-300 px-2.5 py-2 font-semibold"
                  >
                    {analysisAvailableMonths.map((m) => (
                      <option key={m} value={m}>{formatShortMonth(m)} ({m})</option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs font-bold">
                  Compare with:
                  <select
                    value={compareMode}
                    onChange={(e) => setCompareMode(e.target.value)}
                    className="rounded-md border border-slate-300 px-2.5 py-2 font-semibold"
                  >
                    <option value="PREV">
                      Previous month{selectedMonth ? ` (${formatQuoteMonth(shiftMonthKey(selectedMonth, -1))})` : ""}
                    </option>
                    <option value="NONE">No comparison</option>
                    {analysisAvailableMonths.filter((m) => m !== selectedMonth).length > 0 && (
                      <optgroup label="Months in selected sheet">
                        {analysisAvailableMonths
                          .filter((m) => m !== selectedMonth)
                          .map((m) => (
                            <option key={m} value={m}>
                              {formatShortMonth(m)} ({m})
                            </option>
                          ))}
                      </optgroup>
                    )}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="ifb-panel">
                  <div className="text-[11px] font-bold uppercase text-slate-500">PLANNED / COMMITTED</div>
                  <div className="mt-1 text-2xl font-extrabold">{formatNumber(analysisComputed.summary.totalCommitment)}</div>
                  <div className="text-xs text-slate-500">Committed Units ({formatQuoteMonth(selectedMonth)})</div>
                </div>
                <div className="ifb-panel">
                  <div className="text-[11px] font-bold uppercase text-slate-500">ACTUAL DISPATCHED</div>
                  <div className="mt-1 text-2xl font-extrabold">{formatNumber(analysisComputed.summary.totalDispatched)}</div>
                  <div className="text-xs text-slate-500">Shipped Units ({formatQuoteMonth(selectedMonth)})</div>
                </div>
                <div className="ifb-panel border-l-4 border-l-blue-600">
                  <div className="text-[11px] font-bold uppercase text-slate-500">SHORTFALL VS COMMITMENT</div>
                  <div className="mt-1 text-2xl font-extrabold">
                    {analysisComputed.summary.grossShortfall > 0
                      ? `- ${formatNumber(analysisComputed.summary.grossShortfall)}`
                      : "0"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {analysisComputed.summary.partsShortfall} parts short · {formatNumber(analysisComputed.summary.grossSurplus)} shipped above plan · net {formatNumber(analysisComputed.summary.netDiff)}
                  </div>
                </div>
                <div className="ifb-panel border-l-4 border-l-emerald-600">
                  <div className="text-[11px] font-bold uppercase text-slate-500">FULFILLMENT RATE</div>
                  <div className="mt-1 text-2xl font-extrabold">
                    {analysisComputed.summary.fulfillmentRate !== null
                      ? `${analysisComputed.summary.fulfillmentRate.toFixed(1)}%`
                      : "0%"}
                  </div>
                  <div className="text-xs text-slate-500">
                    {analysisComputed.summary.partsOnTarget} of {analysisComputed.summary.partsScheduled} scheduled parts on target
                  </div>
                </div>
              </div>

              <div className="ifb-panel">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold">Monthly Trend</h3>
                    <p className="text-xs text-slate-500">
                      {analysisScopeLabel} · {trendRange === "12" ? `Jan'${trendYear.slice(-2)} to Dec'${trendYear.slice(-2)}` : "Uploaded months"}. Hover a month for details; click to select it.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <div className="inline-flex rounded-md border border-slate-300 bg-slate-100 p-0.5 font-semibold">
                      {(["6", "12", "all"] as const).map((rng) => (
                        <button
                          key={rng}
                          type="button"
                          onClick={() => setTrendRange(rng)}
                          className={`rounded px-2.5 py-1 ${trendRange === rng ? "bg-white text-blue-800 shadow-xs" : "text-slate-600"}`}
                        >
                          {rng === "6" ? "6 months" : rng === "12" ? "1 year" : "All"}
                        </button>
                      ))}
                    </div>
                    <select
                      value={trendYear}
                      onChange={(e) => {
                        setTrendYear(e.target.value);
                        setTrendRange("12");
                      }}
                      className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-800"
                    >
                      {(availableYears.length ? availableYears : ["2026"]).map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                    <label className="font-semibold text-slate-600">
                      Target{" "}
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={targetPercent}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (v >= 1 && v <= 100) {
                            setTargetPercent(v);
                            refreshData({ preferredTarget: v });
                          }
                        }}
                        className="w-14 rounded border border-slate-300 px-2 py-1 text-slate-900"
                      />{" "}
                      %
                    </label>
                  </div>
                </div>
                {renderTrendChart(analysisComputed.monthlyTrend, trendRange, true)}
              </div>

              <div className="ifb-panel">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                  <div>
                    <h3 className="text-base font-bold">Part-wise Schedule Comparison · {formatQuoteMonth(selectedMonth)}</h3>
                    <p className="text-xs text-slate-500">
                      {analysisScopeLabel}
                      {compareMonthKey && (
                        <>
                          {" "}· Customer schedule {formatQuoteMonth(selectedMonth)} vs {formatQuoteMonth(compareMonthKey)}:{" "}
                          {analysisComputed.counts.momDiff >= 0 ? "+" : ""}
                          {formatNumber(analysisComputed.counts.momDiff)} units
                          {analysisComputed.counts.momPct !== null
                            ? ` (${analysisComputed.counts.momDiff >= 0 ? "+" : ""}${analysisComputed.counts.momPct.toFixed(1)}%)`
                            : ""}
                          , {analysisComputed.counts.partsUp} parts up, {analysisComputed.counts.partsDown} down
                        </>
                      )}
                    </p>
                  </div>
                  <button type="button" onClick={exportComparisonToCSV} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">
                    📥 Export to CSV
                  </button>
                </div>

                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded bg-slate-50 p-2.5 border border-slate-200">
                  <input
                    type="text"
                    value={cmpSearch}
                    onChange={(e) => setCmpSearch(e.target.value)}
                    placeholder="🔍 Search customer, part no, line..."
                    className="w-72 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        { key: "all", label: `All (${analysisComputed.counts.all})` },
                        { key: "increased", label: `Above commitment (${analysisComputed.counts.above})` },
                        { key: "decreased", label: `Shortfall (${analysisComputed.counts.shortfall})` },
                        { key: "unchanged", label: `Met (${analysisComputed.counts.met})` },
                      ] as const
                    ).map((pill) => (
                      <button
                        key={pill.key}
                        type="button"
                        onClick={() => setCmpFilter(pill.key)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${cmpFilter === pill.key ? "bg-[#123b63] text-white" : "bg-white border border-slate-300 text-slate-600"}`}
                      >
                        {pill.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="max-h-[420px] overflow-x-auto overflow-y-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500 shadow-[inset_0_-1px_0_#e2e8f0] select-none">
                      <tr>
                        {(
                          [
                            { key: "customer", label: "Customer", align: "text-left" },
                            { key: "partNo", label: "Part No.", align: "text-left" },
                            { key: "line", label: "Line", align: "text-left" },
                            { key: "demand", label: "Customer Schedule", align: "text-right" },
                            { key: "commitment", label: "IFB Commitment", align: "text-right text-blue-700" },
                            { key: "dispatched", label: "IFB Dispatch", align: "text-right" },
                            { key: "diff", label: "Difference", align: "text-right" },
                            { key: "achievementRate", label: "Achievement %", align: "text-right" },
                          ] as { key: CmpSortKey; label: string; align: string }[]
                        ).map((col) => (
                          <th
                            key={col.key}
                            onClick={() => toggleCmpSort(col.key)}
                            className={`cursor-pointer py-2.5 px-2 hover:text-slate-900 ${col.align}`}
                          >
                            {col.label}
                            {cmpSortKey === col.key && (
                              <span className="ml-1 text-[10px]">{cmpSortDir === "asc" ? "▲" : "▼"}</span>
                            )}
                          </th>
                        ))}
                        {compareMonthKey && (
                          <th
                            onClick={() => toggleCmpSort("compareDelta")}
                            className="cursor-pointer py-2.5 px-2 text-right hover:text-slate-900"
                          >
                            Schedule Δ vs {formatQuoteMonth(compareMonthKey)}
                            {cmpSortKey === "compareDelta" && (
                              <span className="ml-1 text-[10px]">{cmpSortDir === "asc" ? "▲" : "▼"}</span>
                            )}
                          </th>
                        )}
                        <th
                          onClick={() => toggleCmpSort("status")}
                          className="cursor-pointer py-2.5 px-2 text-center hover:text-slate-900"
                        >
                          Status
                          {cmpSortKey === "status" && (
                            <span className="ml-1 text-[10px]">{cmpSortDir === "asc" ? "▲" : "▼"}</span>
                          )}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredComparisonRows.map((r) => {
                        const achColor =
                          r.achievementRate === null
                            ? "text-slate-400"
                            : r.achievementRate >= targetPercent
                              ? "text-emerald-600"
                              : r.achievementRate >= targetPercent - 10
                                ? "text-amber-600"
                                : "text-red-600";
                        const statusBadge =
                          r.status === "no_plan"
                            ? { text: "No plan", cls: "bg-slate-100 text-slate-500" }
                            : r.status === "met"
                              ? { text: "Met ✓", cls: "bg-emerald-100 text-emerald-700" }
                              : r.status === "above"
                                ? { text: "Above", cls: "bg-sky-100 text-sky-700" }
                                : { text: "Shortfall", cls: "bg-red-100 text-red-700" };
                        return (
                          <tr key={`${r.customer}-${r.partNo}-${r.line}`}>
                            <td className="py-2 px-2 font-semibold">{r.customer}</td>
                            <td className="py-2 px-2"><span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono">{r.partNo}</span></td>
                            <td className="py-2 px-2">{r.line}</td>
                            <td className="py-2 px-2 text-right">{formatNumber(r.demand)}</td>
                            <td className="py-2 px-2 text-right">{formatNumber(r.commitment)}</td>
                            <td className="py-2 px-2 text-right">{formatNumber(r.dispatched)}</td>
                            <td className={`py-2 px-2 text-right font-bold ${r.diff < 0 ? "text-red-600" : r.diff > 0 ? "text-emerald-600" : "text-slate-500"}`}>
                              {r.diff > 0 ? `+${formatNumber(r.diff)}` : formatNumber(r.diff)}
                            </td>
                            <td className={`py-2 px-2 text-right font-bold ${achColor}`}>
                              {r.achievementRate !== null ? `${r.achievementRate.toFixed(1)}%` : "–"}
                            </td>
                            {compareMonthKey && (
                              <td className={`py-2 px-2 text-right font-bold ${r.compareDelta > 0 ? "text-emerald-600" : r.compareDelta < 0 ? "text-red-600" : "text-slate-400"}`}>
                                {r.compareDemand > 0 || r.demand > 0 ? `${r.compareDelta > 0 ? "+" : ""}${formatNumber(r.compareDelta)}` : "–"}
                              </td>
                            )}
                            <td className="py-2 px-2 text-center">
                              <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${statusBadge.cls}`}>
                                {statusBadge.text}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Fill Rate by Product Line */}
              <div className="ifb-panel">
                <div className="mb-3">
                  <h3 className="text-base font-bold">Fill Rate by Product Line</h3>
                  <p className="text-xs text-slate-500">For the selected month. Click a heading to sort.</p>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500 select-none">
                      <tr>
                        <th className="cursor-pointer py-2.5 px-3 hover:text-slate-900" onClick={() => toggleLineSort("line")}>
                          Product Line{lineSortKey === "line" && <span className="ml-1 text-[10px]">{lineSortDir === "asc" ? "▲" : "▼"}</span>}
                        </th>
                        <th className="cursor-pointer py-2.5 px-3 text-right hover:text-slate-900" onClick={() => toggleLineSort("commitment")}>
                          Commitment{lineSortKey === "commitment" && <span className="ml-1 text-[10px]">{lineSortDir === "asc" ? "▲" : "▼"}</span>}
                        </th>
                        <th className="cursor-pointer py-2.5 px-3 text-right hover:text-slate-900" onClick={() => toggleLineSort("dispatched")}>
                          Dispatched{lineSortKey === "dispatched" && <span className="ml-1 text-[10px]">{lineSortDir === "asc" ? "▲" : "▼"}</span>}
                        </th>
                        <th className="cursor-pointer py-2.5 px-3 hover:text-slate-900" onClick={() => toggleLineSort("fillRate")}>
                          Fill Rate{lineSortKey === "fillRate" && <span className="ml-1 text-[10px]">{lineSortDir === "asc" ? "▲" : "▼"}</span>}
                        </th>
                        <th className="cursor-pointer py-2.5 px-3 text-right hover:text-slate-900" onClick={() => toggleLineSort("shortfall")}>
                          Shortfall{lineSortKey === "shortfall" && <span className="ml-1 text-[10px]">{lineSortDir === "asc" ? "▲" : "▼"}</span>}
                        </th>
                        <th className="py-2.5 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {productLineSummary.items.map((ln) => {
                        const fr = ln.fillRate ?? 0;
                        const isOn = ln.fillRate !== null && fr >= targetPercent;
                        const isClose = ln.fillRate !== null && !isOn && fr >= targetPercent - 10;
                        const barCls = isOn ? "bg-emerald-500" : isClose ? "bg-amber-500" : "bg-red-500";
                        const badgeCls = isOn
                          ? "bg-emerald-100 text-emerald-700"
                          : isClose
                            ? "bg-amber-100 text-amber-700"
                            : "bg-red-100 text-red-700";
                        const statusTxt = isOn ? "On target" : isClose ? "Close" : "Below target";
                        return (
                          <tr key={ln.line}>
                            <td className="py-2.5 px-3 font-bold text-slate-900">{ln.line}</td>
                            <td className="py-2.5 px-3 text-right">{formatNumber(ln.commitment)}</td>
                            <td className="py-2.5 px-3 text-right">{formatNumber(ln.dispatched)}</td>
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-3">
                                <span className="w-12 text-right font-semibold">
                                  {ln.fillRate !== null ? `${ln.fillRate.toFixed(1)}%` : "–"}
                                </span>
                                <div className="h-2 w-40 rounded-full bg-slate-200 overflow-hidden">
                                  <div className={`h-full rounded-full ${barCls}`} style={{ width: `${Math.min(100, Math.max(0, fr))}%` }} />
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold text-red-600">
                              {ln.shortfall < 0 ? formatNumber(ln.shortfall) : "–"}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold ${badgeCls}`}>
                                {statusTxt}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="bg-slate-50 font-bold border-t border-slate-200">
                        <td className="py-2.5 px-3">Total</td>
                        <td className="py-2.5 px-3 text-right">{formatNumber(productLineSummary.totalCommitment)}</td>
                        <td className="py-2.5 px-3 text-right">{formatNumber(productLineSummary.totalDispatched)}</td>
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-3">
                            <span className="w-12 text-right">
                              {productLineSummary.totalFillRate !== null ? `${productLineSummary.totalFillRate.toFixed(1)}%` : "–"}
                            </span>
                            <div className="h-2 w-40 rounded-full bg-slate-200 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${(productLineSummary.totalFillRate ?? 0) >= targetPercent ? "bg-emerald-500" : "bg-red-500"}`}
                                style={{ width: `${Math.min(100, Math.max(0, productLineSummary.totalFillRate ?? 0))}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          {productLineSummary.totalShortfall < 0 ? formatNumber(productLineSummary.totalShortfall) : "–"}
                        </td>
                        <td className="py-2.5 px-3" />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* TAB 3: MASTER PRODUCTION SCHEDULE RECORDS */}
          {activeTab === "records" && (
            <div className="ifb-panel">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <div>
                  <h2 className="text-lg font-bold">Master Production Schedule Records</h2>
                  <p className="text-xs text-slate-500">Monthly Plan: {formatShortMonth(m1)} (FIRM) and (TENTATIVE 2 months)</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={exportRecordsToCSV} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">
                    📥 Export to CSV
                  </button>
                  <button type="button" onClick={() => switchTab("upload")} className="rounded-md bg-[#123b63] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0c2844]">
                    + Upload Schedule
                  </button>
                </div>
              </div>

              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded bg-slate-50 p-2.5 border border-slate-200 text-xs">
                <input
                  type="text"
                  value={recordsSearch}
                  onChange={(e) => setRecordsSearch(e.target.value)}
                  placeholder="🔍 Search customer, part, line, description, or source..."
                  className="w-64 rounded border border-slate-300 bg-white px-3 py-1.5"
                />
                <label className="flex items-center gap-1.5 font-medium">
                  Customer:
                  <select
                    value={recordsCustomer}
                    onChange={(e) => setRecordsCustomer(e.target.value)}
                    className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    <option value="ALL">All Customers</option>
                    {(analytics?.customers || []).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 font-medium">
                  Delivery month:
                  <select
                    value={selectedMonth}
                    onChange={(e) => refreshData({ preferredMonth: e.target.value })}
                    className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    {(analytics?.availableMonths || []).map((m) => (
                      <option key={m} value={m}>{formatShortMonth(m)} ({m})</option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showAllColumns}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setShowAllColumns(next);
                      postAuditEvent("FILTER_CHANGE", `Changed records showAllColumns to "${next ? "on" : "off"}"`, "dashboard").catch(() => {});
                    }}
                  />
                  Show all columns
                </label>
                <span className="text-slate-500">Showing {filteredRecordsRows.length} of {scheduleRows.length} records</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-center text-[11px] font-bold">
                      <th colSpan={showAllColumns ? 8 : 4} className="bg-slate-100 py-1.5 text-slate-700">PART &amp; CUSTOMER INFORMATION</th>
                      <th className="bg-sky-100 py-1.5 text-sky-800">FIRM</th>
                      <th colSpan={2} className="bg-yellow-100 py-1.5 text-yellow-800">TENTATIVE QTY</th>
                      <th colSpan={3} className="bg-slate-100 py-1.5 text-slate-700">PERFORMANCE &amp; STATUS</th>
                    </tr>
                    <tr className="border-b border-slate-200 text-[11px] uppercase text-slate-500 bg-slate-50">
                      {showAllColumns && <th className="py-2 px-2">Sl No</th>}
                      <th className="py-2 px-2">Customer</th>
                      {showAllColumns && <th className="py-2 px-2">Customer Code</th>}
                      <th className="py-2 px-2">Part No.</th>
                      {showAllColumns && <th className="py-2 px-2">Helper</th>}
                      {showAllColumns && <th className="py-2 px-2">Customer Part No</th>}
                      <th className="py-2 px-2">Line</th>
                      <th className="py-2 px-2">Description</th>
                      <th className="py-2 px-2 text-right">{formatShortMonth(m1)}</th>
                      <th className="py-2 px-2 text-right bg-yellow-50 text-yellow-800">{formatShortMonth(m2)}</th>
                      <th className="py-2 px-2 text-right bg-yellow-50 text-yellow-800">{formatShortMonth(m3)}</th>
                      <th className="py-2 px-2 text-right">Actual Dispatch</th>
                      <th className="py-2 px-2 text-right">Backlog</th>
                      <th className="py-2 px-2 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredRecordsRows.map((r) => {
                      const q1 = Number(r.monthlySchedules?.[m1] || 0);
                      const q2 = Number(r.monthlySchedules?.[m2] || 0);
                      const q3 = Number(r.monthlySchedules?.[m3] || 0);
                      const disp = Number(r.monthlyDispatches?.[m1] || 0);
                      return (
                        <tr key={r.id}>
                          {showAllColumns && <td className="py-2 px-2 text-slate-500">{r.serialNo}</td>}
                          <td className="py-2 px-2 font-semibold whitespace-nowrap">{r.customer}</td>
                          {showAllColumns && <td className="py-2 px-2 font-mono text-slate-600">{r.customerCode || "–"}</td>}
                          <td className="py-2 px-2"><span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-mono">{r.partNo}</span></td>
                          {showAllColumns && <td className="py-2 px-2 font-mono text-slate-600">{r.helper || "–"}</td>}
                          {showAllColumns && <td className="py-2 px-2 font-mono text-slate-600">{r.customerPartNo || "–"}</td>}
                          <td className="py-2 px-2 whitespace-nowrap">{r.line || "–"}</td>
                          <td className="py-2 px-2 max-w-[260px] truncate" title={r.productDescription}>{r.productDescription || "–"}</td>
                          <td className="py-2 px-2 text-right">{formatNumber(q1)}</td>
                          <td className="py-2 px-2 text-right bg-yellow-50/50 text-yellow-800">{formatNumber(q2)}</td>
                          <td className="py-2 px-2 text-right bg-yellow-50/50 text-yellow-800">{formatNumber(q3)}</td>
                          <td className="py-2 px-2 text-right">{formatNumber(disp)}</td>
                          <td className="py-2 px-2 text-right font-bold">{formatNumber(q1 - disp)}</td>
                          <td className="py-2 px-2 text-center">
                            <button
                              type="button"
                              title="Delete row"
                              onClick={() => handleDeleteRow(r.id, r.partNo)}
                              className="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-600 hover:bg-red-100"
                            >
                              🗑️
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: UPLOAD SCHEDULE DATA */}
          {activeTab === "upload" && (
            <>
              <div className="ifb-panel space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">Upload Schedule Data</h2>
                    <p className="text-xs text-slate-500">Upload your schedule to view it on the dashboard and in records. Existing saved schedules remain available.</p>
                  </div>
                </div>

                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (f) {
                      setSelectedFile(f);
                      uploadExcel(f);
                    }
                  }}
                  className="cursor-pointer rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-10 text-center hover:border-blue-500 hover:bg-blue-50/40"
                >
                  <div className="text-4xl">📂</div>
                  <h3 className="mt-2 text-base font-bold">Choose an Excel schedule file</h3>
                  <p className="mt-1 text-xs text-slate-500">Drag and drop a filled schedule file here, or browse your computer. Supports .xlsx, .xls, and .csv.</p>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                    className="mt-3 rounded-md bg-[#123b63] px-4 py-2 text-xs font-semibold text-white"
                  >
                    Browse Files on Computer
                  </button>
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFileSelect} className="hidden" />
                  {selectedFile && (
                    <div className="mt-3 inline-block rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
                      Selected: {selectedFile.name}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <label className="font-bold">Schedule snapshot date:</label>
                  <input
                    type="date"
                    value={snapshotDate}
                    onChange={(e) => setSnapshotDate(e.target.value)}
                    className="rounded-md border border-slate-300 px-3 py-1.5"
                  />
                  <span className="text-slate-500">For an archived sheet, choose its plan/revision date. New uploads default to today.</span>
                </div>

                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => uploadExcel()}
                  className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  🚀 {uploading ? "Uploading..." : "Upload & Process Spreadsheet"}
                </button>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
                  <div className="font-bold text-slate-800">Supported Excel columns, including the IFB monthly plan layout</div>
                  <p className="mt-0.5 text-slate-500">The header row is detected below title/revision rows; fields are matched by name:</p>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {SUPPORTED_EXCEL_COLUMNS.map((col) => (
                      <span key={col} className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-700">
                        {col}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="ifb-panel">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold">Imported Excel Files &amp; Snapshots</h3>
                    <p className="text-xs text-slate-500">Manage uploaded schedule workbooks. Download original spreadsheets or delete snapshots.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => refreshData()}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-50"
                  >
                    🔄 Refresh List
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
                      <tr>
                        <th className="py-2 px-2">#</th>
                        <th className="py-2 px-2">File Name</th>
                        <th className="py-2 px-2">Snapshot Date</th>
                        <th className="py-2 px-2">Imported At</th>
                        <th className="py-2 px-2">Records Count</th>
                        <th className="py-2 px-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {snapshots.map((s, idx) => (
                        <tr key={s.snapshotId}>
                          <td className="py-2.5 px-2 text-slate-500">{idx + 1}</td>
                          <td className="py-2.5 px-2 font-bold">📄 {s.filename}</td>
                          <td className="py-2.5 px-2">
                            <span className="rounded bg-slate-100 px-2 py-0.5 font-mono">{s.snapshotDate}</span>
                          </td>
                          <td className="py-2.5 px-2 text-slate-600">
                            {s.uploadedAt ? new Date(s.uploadedAt).toLocaleString("en-IN") : "—"}
                          </td>
                          <td className="py-2.5 px-2">
                            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 font-semibold text-blue-700">
                              {formatNumber(s.rowCount)} rows
                            </span>
                          </td>
                          <td className="py-2.5 px-2 text-right">
                            <div className="inline-flex gap-1.5">
                              <button
                                type="button"
                                title="Open in Analysis"
                                onClick={async () => {
                                  await refreshData({ preferredSource: s.snapshotId, resetCustomer: true });
                                  switchTab("analysis");
                                }}
                                className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50"
                              >
                                📈
                              </button>
                              <button
                                type="button"
                                title="Download original file"
                                onClick={() => downloadSnapshot(s.snapshotId, s.filename).catch((e) => setError(e instanceof Error ? e.message : "Download failed"))}
                                className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50"
                              >
                                📥
                              </button>
                              <button
                                type="button"
                                title="Delete snapshot"
                                onClick={() => handleDeleteSnapshot(s.snapshotId, s.filename)}
                                className="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700 hover:bg-red-100"
                              >
                                🗑️
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* TAB 5: USER MANAGEMENT */}
          {activeTab === "users" && currentUser?.role === "admin" && (
            <div className="ifb-panel space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">User Management</h2>
                  <p className="text-xs text-slate-500">Add or remove portal accounts. Changes are saved to the server&apos;s user store.</p>
                </div>
                <button type="button" onClick={() => loadAdminUsers()} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold">
                  🔄 Refresh Users
                </button>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await createUser({ name: newName, username: newUsername, password: newPassword, role: newRole });
                  } catch (err: unknown) {
                    setError(err instanceof Error ? err.message : "Could not create user.");
                    return;
                  }
                  setNewName(""); setNewUsername(""); setNewPassword(""); setNewRole("planner");
                  await loadAdminUsers();
                }}
                className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-5 items-end text-xs"
              >
                <label className="flex flex-col gap-1 font-semibold">
                  Full Name
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Ravi Kumar" className="rounded border border-slate-300 bg-white px-2.5 py-2" />
                </label>
                <label className="flex flex-col gap-1 font-semibold">
                  Username *
                  <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="e.g. rkumaar" required className="rounded border border-slate-300 bg-white px-2.5 py-2" />
                </label>
                <label className="flex flex-col gap-1 font-semibold">
                  Password *
                  <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min 6 characters" required className="rounded border border-slate-300 bg-white px-2.5 py-2" />
                </label>
                <label className="flex flex-col gap-1 font-semibold">
                  Role
                  <select value={newRole} onChange={(e) => setNewRole(e.target.value as "planner" | "admin")} className="rounded border border-slate-300 bg-white px-2.5 py-2">
                    <option value="planner">Planner</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <button type="submit" className="rounded-md bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-700">
                  + Add User
                </button>
              </form>

              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-[11px] uppercase text-slate-500">
                  <tr>
                    <th className="py-2">#</th>
                    <th className="py-2">Name</th>
                    <th className="py-2">Username</th>
                    <th className="py-2">Role</th>
                    <th className="py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {usersList.map((u, i) => (
                    <tr key={u.id}>
                      <td className="py-2.5">{i + 1}</td>
                      <td className="py-2.5 font-bold">{u.name}</td>
                      <td className="py-2.5 font-mono">{u.username}</td>
                      <td className="py-2.5"><span className="rounded-full bg-blue-50 px-2.5 py-0.5 font-semibold text-blue-700">{u.role}</span></td>
                      <td className="py-2.5 text-right">
                        {u.username === currentUser.username ? (
                          <span className="text-slate-400">Current session</span>
                        ) : (
                          <button type="button" onClick={async () => { try { await deleteUser(u.id); await loadAdminUsers(); } catch (err: unknown) { setError(err instanceof Error ? err.message : "Delete failed."); } }} className="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700">
                            🗑️
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 6: SESSION & ACTIVITY LOGS */}
          {activeTab === "logs" && currentUser?.role === "admin" && (
            <div className="ifb-panel space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">Session &amp; Activity Logs</h2>
                  <p className="text-xs text-slate-500">Audit trail of sign-ins, idle timeouts, schedule updates, exports, and dashboard usage.</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => loadAuditDashboard()} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">
                    🔄 Refresh
                  </button>
                  <button type="button" onClick={exportAuditLogsToCSV} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">
                    📥 Export CSV
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 text-xs">
                <div className="flex gap-1 rounded-md bg-slate-100 p-1 font-semibold">
                  <button
                    type="button"
                    onClick={() => setAuditView("logs")}
                    className={`rounded px-3 py-1 ${auditView === "logs" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500"}`}
                  >
                    Activity Feed <span className="ml-1 rounded-full bg-blue-50 px-1.5 text-blue-700">{auditLogs.length}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuditView("sessions")}
                    className={`rounded px-3 py-1 ${auditView === "sessions" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500"}`}
                  >
                    Sessions <span className="ml-1 rounded-full bg-blue-50 px-1.5 text-blue-700">{auditSessions.length}</span>
                  </button>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
                  ● {activeSessionsCount} active now
                </span>
              </div>

              {auditView === "logs" ? (
                <>
                  {inspectSession && (
                    <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                      <span>
                        Inspecting session for <strong>{inspectSession.name}</strong> ({inspectSession.username}) started{" "}
                        {new Date(inspectSession.signedInAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })}
                      </span>
                      <button
                        type="button"
                        onClick={() => setInspectSession(null)}
                        className="rounded border border-blue-300 bg-white px-2.5 py-0.5 font-semibold text-blue-800 hover:bg-blue-100"
                      >
                        Show all activity
                      </button>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1.5 text-xs font-semibold">
                      {[
                        { key: "all", label: "All" },
                        { key: "change", label: "Changes" },
                        { key: "dashboard", label: "Dashboard" },
                        { key: "session", label: "Sessions" },
                        { key: "export", label: "Exports" },
                        { key: "admin", label: "Admin" },
                      ].map((cat) => (
                        <button
                          key={cat.key}
                          type="button"
                          onClick={() => setAuditCategory(cat.key)}
                          className={`rounded-full px-3 py-1 ${auditCategory === cat.key ? "bg-[#123b63] text-white" : "border border-slate-200 bg-white text-slate-600"}`}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="text"
                      value={auditSearch}
                      onChange={(e) => setAuditSearch(e.target.value)}
                      placeholder="Search user or event..."
                      className="w-56 rounded-md border border-slate-300 px-3 py-1.5 text-xs"
                    />
                  </div>

                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
                        <tr>
                          <th className="py-2 px-3">Time</th>
                          <th className="py-2 px-3">User</th>
                          <th className="py-2 px-3">Category</th>
                          <th className="py-2 px-3">Activity</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {visibleAuditLogs.map((l) => (
                          <tr key={l.id}>
                            <td className="py-2 px-3 text-slate-500 whitespace-nowrap">
                              {l.at ? new Date(l.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) : "—"}
                            </td>
                            <td className="py-2 px-3 font-semibold">
                              {l.username} <span className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] uppercase text-sky-800">{l.role}</span>
                            </td>
                            <td className="py-2 px-3">
                              <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-semibold capitalize text-sky-800">{l.category}</span>
                            </td>
                            <td className="py-2 px-3">{l.summary}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase text-slate-500">
                      <tr>
                        <th className="py-2.5 px-3">User</th>
                        <th className="py-2.5 px-3">Signed In</th>
                        <th className="py-2.5 px-3">Last Active / Ended</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3 text-center">Events</th>
                        <th className="py-2.5 px-3">Client</th>
                        <th className="py-2.5 px-3 text-right">Activity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {auditSessions.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-6 text-center text-slate-500">
                            No tracked sessions yet. Sign out and sign back in to record your first session.
                          </td>
                        </tr>
                      ) : (
                        auditSessions.map((s) => {
                          const stBadge =
                            s.status === "active"
                              ? { text: "Active", cls: "bg-emerald-100 text-emerald-700" }
                              : s.status === "timed_out"
                                ? { text: "Timed Out", cls: "bg-amber-100 text-amber-700" }
                                : { text: "Signed Out", cls: "bg-slate-100 text-slate-600" };
                          return (
                            <tr key={s.id}>
                              <td className="py-2.5 px-3">
                                <div className="font-bold text-slate-900">{s.name}</div>
                                <div className="text-[11px] text-slate-500">
                                  {s.username} · <span className="rounded bg-sky-100 px-1 py-0.5 text-[10px] font-bold uppercase text-sky-800">{s.role}</span>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                                {s.signedInAt ? new Date(s.signedInAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) : "—"}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                                {s.lastActiveAt ? new Date(s.lastActiveAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) : "—"}
                              </td>
                              <td className="py-2.5 px-3">
                                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${stBadge.cls}`}>
                                  {stBadge.text}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-center">
                                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-bold text-slate-700">{s.eventsCount}</span>
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="font-semibold text-slate-800">{s.clientInfo}</div>
                                <div className="font-mono text-[11px] text-slate-400">{s.clientIp || "—"}</div>
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setInspectSession(s);
                                    setAuditView("logs");
                                  }}
                                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold hover:bg-slate-50"
                                >
                                  Inspect →
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}