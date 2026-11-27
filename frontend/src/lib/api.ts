export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "http://localhost:8000";

export const AUTH_TOKEN_KEY = "ifb_auth_token";
export const AUTH_USER_KEY = "ifb_auth_user";

export type PortalUserInfo = {
  id: string;
  username: string;
  name: string;
  role: string;
};

export type AuditLogItem = {
  id: number;
  username: string;
  role: string;
  action: string;
  category: string;
  summary: string;
  at: string;
};

export type AuditSessionItem = {
  id: string;
  username: string;
  name: string;
  role: string;
  signedInAt: string;
  lastActiveAt: string;
  status: "active" | "signed_out" | "timed_out" | string;
  eventsCount: number;
  clientInfo: string;
  clientIp: string;
};

export type ScheduleRowItem = {
  id: number;
  snapshotId: string;
  serialNo: string;
  customer: string;
  customerGroup: string;
  customerCode: string;
  partNo: string;
  helper: string;
  customerPartNo: string;
  line: string;
  productDescription: string;
  monthlySchedules: Record<string, number>;
  monthlyCommitments: Record<string, number>;
  monthlyDispatches: Record<string, number>;
};

export type SnapshotItem = {
  snapshotId: string;
  filename: string;
  source: string;
  snapshotDate: string;
  uploadedAt?: string;
  rowCount: number;
};

export type TrendPoint = {
  month: string;
  label: string;
  demand: number;
  commitment: number;
  dispatched: number;
  fillRate: number | null;
  hasData: boolean;
};

export type PartComparisonRow = {
  partNo: string;
  customer: string;
  line: string;
  demand: number;
  commitment: number;
  dispatched: number;
  diff: number;
  achievementRate: number | null;
  next1Demand: number;
  next2Demand: number;
  prevDemand: number;
};

export type CustomerSummaryRow = {
  customer: string;
  commitment: number;
  dispatched: number;
  fillRate: number | null;
};

export type AnalyticsResponse = {
  selectedMonth: string;
  selectedMonthLabel: string;
  availableMonths: string[];
  customers: string[];
  targetPercent: number;
  summary: {
    totalDemand: number;
    totalCommitment: number;
    totalDispatched: number;
    fulfillmentRate: number | null;
    grossShortfall: number;
    grossSurplus: number;
    partsShortfall: number;
    partsOnTarget: number;
    partsScheduled: number;
  };
  monthlyTrend: TrendPoint[];
  partRows: PartComparisonRow[];
  byCustomer: CustomerSummaryRow[];
};

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const extraHeaders =
    init?.headers && !(init.headers instanceof Headers)
      ? (init.headers as Record<string, string>)
      : {};

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      ...authHeaders(),
      ...extraHeaders,
    },
  });

  if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
    const body = await res.json().catch(() => null);
    const detail = typeof body?.detail === "string" ? body.detail : "";
    const isTimeout = /inactivity|timed out/i.test(detail);
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    window.location.href = isTimeout ? "/login?reason=timeout" : "/login";
    throw new Error(detail || "Session expired");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const d = body?.detail;
    const text = typeof d === "string" ? d : Array.isArray(d) ? d.map((x: { msg?: string }) => x.msg).join("; ") : body?.message || "";
    throw new Error(text || `Request failed (${res.status})`);
  }

  return res.json() as Promise<T>;
}

export async function loginUser(username: string, password: string): Promise<{ token: string; user: PortalUserInfo }> {
  const data = await apiFetch<{ token: string; user: PortalUserInfo }>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (typeof window !== "undefined" && data.token) {
    localStorage.setItem(AUTH_TOKEN_KEY, data.token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
  }
  return data;
}

export async function logoutUser(reason: "manual" | "timeout" = "manual"): Promise<void> {
  try {
    if (getStoredToken()) {
      await apiFetch(`/api/auth/logout?reason=${encodeURIComponent(reason)}`, { method: "POST" });
    }
  } catch {
    // Clear local session even if request fails
  } finally {
    if (typeof window !== "undefined") {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(AUTH_USER_KEY);
    }
  }
}

export async function pingSession(): Promise<void> {
  if (!getStoredToken()) return;
  await apiFetch("/api/auth/ping", { method: "POST" });
}

export async function fetchCurrentUser(): Promise<PortalUserInfo | null> {
  if (!getStoredToken()) return null;
  const data = await apiFetch<{ user: PortalUserInfo }>("/api/auth/me");
  return data.user;
}

export async function fetchUsers(): Promise<PortalUserInfo[]> {
  const data = await apiFetch<{ users: PortalUserInfo[] }>("/api/users");
  return data.users || [];
}

export async function createUser(payload: {
  username: string;
  password: string;
  name?: string;
  role?: "admin" | "planner";
}): Promise<PortalUserInfo> {
  const data = await apiFetch<{ user: PortalUserInfo }>("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return data.user;
}

export async function deleteUser(userId: string): Promise<void> {
  await apiFetch(`/api/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
}

export async function fetchAuditLogs(limit = 100): Promise<AuditLogItem[]> {
  const data = await apiFetch<{ logs: AuditLogItem[] }>(`/api/audit/logs?limit=${limit}`);
  return data.logs || [];
}

export async function fetchAuditSessions(
  limit = 100
): Promise<{ sessions: AuditSessionItem[]; activeCount: number }> {
  const data = await apiFetch<{ sessions: AuditSessionItem[]; activeCount: number }>(
    `/api/audit/sessions?limit=${limit}`
  );
  return { sessions: data.sessions || [], activeCount: data.activeCount || 0 };
}

export async function fetchScheduleRows(snapshotId = "__ALL__"): Promise<ScheduleRowItem[]> {
  const qs = new URLSearchParams({ snapshotId: snapshotId || "__ALL__" });
  const data = await apiFetch<{ count: number; rows: ScheduleRowItem[] }>(
    `/api/schedules/rows?${qs.toString()}`
  );
  return data.rows || [];
}

export async function deleteScheduleRow(rowId: number): Promise<void> {
  await apiFetch(`/api/schedules/rows/${rowId}`, { method: "DELETE" });
}

export async function postAuditEvent(action: string, summary: string, category = "dashboard"): Promise<void> {
  if (!getStoredToken()) return;
  await apiFetch("/api/audit/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, summary, category }),
  });
}

export async function fetchSnapshots(): Promise<SnapshotItem[]> {
  return apiFetch<SnapshotItem[]>("/api/schedules/snapshots");
}

export async function fetchAnalytics(params: {
  snapshotId: string;
  customer: string;
  month?: string;
  target: number;
}): Promise<AnalyticsResponse> {
  const qs = new URLSearchParams({
    snapshotId: params.snapshotId || "__ALL__",
    customer: params.customer || "ALL",
    target: String(params.target),
  });
  if (params.month) qs.set("month", params.month);
  return apiFetch<AnalyticsResponse>(`/api/schedules/analytics?${qs.toString()}`);
}

export async function uploadScheduleWorkbook(
  file: File,
  snapshotDate?: string
): Promise<{ snapshotId: string; filename: string; snapshotDate: string; rowCount: number }> {
  const formData = new FormData();
  formData.append("file", file);
  if (snapshotDate) {
    formData.append("snapshot_date", snapshotDate);
  }
  const res = await fetch(`${API_BASE_URL}/api/schedules/upload`, {
    method: "POST",
    headers: { ...authHeaders() },
    body: formData,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.detail || errBody.message || "Upload failed");
  }
  return res.json();
}

export async function deleteScheduleSnapshot(snapshotId: string): Promise<void> {
  await apiFetch(`/api/schedules/snapshots/${encodeURIComponent(snapshotId)}`, {
    method: "DELETE",
  });
}

export async function downloadSnapshot(snapshotId: string, filename: string): Promise<void> {
  const res = await fetch(
    `${API_BASE_URL}/api/schedules/snapshots/${encodeURIComponent(snapshotId)}/download`,
    { headers: { ...authHeaders() } }
  );
  if (!res.ok) throw new Error("Download failed");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}