"use client";
import { DomainAgentsWorkspace } from "./DomainAgentsWorkspace";
import type { Assessment } from "@/server/modules/domain-agents/contracts";
import { useState, useEffect } from "react";
import type { Locale } from "@/lib/i18n";
import type {
  orchestrationCatalog,
  runDetail,
} from "@/server/modules/orchestration/orchestration.service";
import {
  api,
  Card,
  Label,
  button,
  field,
  secondary,
  cash,
  formData,
  str,
  minor,
} from "./Phase4Shared";
type Catalog = ReturnType<typeof orchestrationCatalog>;
type Detail = ReturnType<typeof runDetail>;
export function OrchestrationWorkspace({
  locale,
  permissions,
  userId,
}: {
  locale: Locale;
  permissions: string[];
  userId: string;
}) {
  const rtl = locale === "ur",
    tr = (en: string, ur: string) => (rtl ? ur : en),
    admin = permissions.includes("admin:manage");
  const [data, setData] = useState<Catalog | null>(null),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [agentId, setAgentId] = useState(""),
    [steps, setSteps] = useState(
      '[\n  {"tool":"portfolio.units","input":{"limit":10}}\n]',
    );
  useEffect(() => {
    let active = true;
    setBusy(true);
    api<Catalog>("agents")
      .then((c) => {
        if (active) {
          setData(c);
          setAgentId(
            (id) =>
              id ||
              c.agents.find((a) => a.slug === "insights-knowledge-agent")?.id ||
              c.agents[0]?.id ||
              "",
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let active = true;
    api<Detail>(`agents?id=${encodeURIComponent(selected)}`)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [selected, refresh]);
  async function act(action: string, input: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ id?: string; status?: string }>(
        "agents",
        "POST",
        { action, ...input },
      );
      if (action === "start" && result.id) setSelected(result.id);
      setMessage(
        `${tr("Saved", "محفوظ")}${result.status ? ` · ${result.status}` : ""}`,
      );
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  const current = data?.agents.find((a) => a.id === agentId),
    tools =
      data?.tools.filter((t) => current?.allowedTools.includes(t.name)) || [];
  const code = (value: unknown) => (
    <pre
      className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100"
      dir="ltr"
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
  return (
    <div data-testid="orchestration-workspace" className="min-w-0 space-y-5">
      <h1 className="text-2xl font-bold">
        {tr("Agent orchestration", "ایجنٹ آرکیسٹریشن")}
      </h1>
      <p className="text-sm text-slate-600">
        {tr(
          "Local domain agents and structured plans · Source-backed recommendations · Independent approval for writes · No LLM calls or external payments.",
          "مقامی شعبہ وار ایجنٹ اور ساختی منصوبے · ذرائع پر مبنی تجاویز · تبدیلی کے لیے الگ منظوری · بیرونی ماڈل یا ادائیگیاں نہیں۔",
        )}
      </p>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-800">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-emerald-800">
          {message}
        </p>
      )}
      <button
        className={secondary}
        disabled={busy}
        onClick={() => setRefresh((n) => n + 1)}
      >
        {tr("Refresh queue", "قطار تازہ کریں")}
      </button>
      {!data ? (
        <p>{tr("Loading…", "لوڈ ہو رہا ہے…")}</p>
      ) : (
        <>
          <div
            className={`rounded-lg p-4 ${data.settings.enabled ? "bg-emerald-50" : "bg-red-50"}`}
          >
            <strong>
              {data.settings.enabled
                ? tr("Engine enabled", "نظام فعال")
                : tr(
                    "Organization kill switch ACTIVE",
                    "تنظیم کا ہنگامی بندش سوئچ فعال",
                  )}
            </strong>
            <p>
              {tr("Daily tool limit", "روزانہ ٹول حد")}:{" "}
              {Number(data.settings.daily_tool_limit)} ·{" "}
              {tr("Step limit", "مرحلہ حد")}: {Number(data.settings.max_steps)}{" "}
              · {tr("Daily provider budget", "روزانہ فراہم کنندہ بجٹ")}:{" "}
              {cash(Number(data.settings.daily_cost_budget_minor))}
            </p>
          </div>
          <DomainAgentsWorkspace
            canPropose={(tool) =>
              detail?.createdBy === userId &&
              !!data.tools.find(
                (t) => t.name === tool && permissions.includes(t.permission),
              )
            }
            locale={locale}
            permissions={permissions}
            refresh={refresh}
            runId={selected}
            assessment={
              (detail?.calls.find(
                (c) => c.tool.startsWith("domain.") && c.status === "executed",
              )?.output as Assessment) || null
            }
            onRun={(id) => {
              setSelected(id);
              setRefresh((n) => n + 1);
            }}
          />
          {permissions.includes("agents:run") && (
            <Card
              title={tr("Submit a structured plan", "ساختی منصوبہ جمع کریں")}
            >
              <form
                aria-label="Agent plan"
                className="grid min-w-0 gap-3 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = formData(e);
                  try {
                    void act("start", {
                      agentId,
                      goal: str(f, "goal"),
                      requestKey: str(f, "requestKey"),
                      maxCostMinor: minor(f, "maxCost"),
                      steps: JSON.parse(steps),
                    });
                  } catch {
                    setError("Steps must be valid JSON.");
                  }
                }}
              >
                <Label name={tr("Agent", "ایجنٹ")}>
                  <select
                    className={field}
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                  >
                    {data.agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.autonomy}
                        {a.enabled ? "" : " · disabled"}
                      </option>
                    ))}
                  </select>
                </Label>
                <Label name="Unique request key">
                  <input
                    name="requestKey"
                    className={field}
                    required
                    defaultValue={`plan-${Date.now()}`}
                  />
                </Label>
                <Label name={tr("Goal / human context", "مقصد / انسانی سیاق")}>
                  <input
                    name="goal"
                    className={field}
                    required
                    minLength={3}
                    maxLength={2000}
                    placeholder="Review portfolio safely"
                  />
                </Label>
                <Label name="Maximum provider cost (PKR; local adapter costs zero)">
                  <input
                    name="maxCost"
                    className={field}
                    type="number"
                    min="0"
                    max="10000"
                    step="0.01"
                    defaultValue="0"
                    required
                  />
                </Label>
                <div className="sm:col-span-2">
                  <Label
                    name={tr(
                      "Ordered steps (JSON; max 20)",
                      "ترتیب وار مراحل (جے ایس او این، زیادہ سے زیادہ ۲۰)",
                    )}
                  >
                    <textarea
                      className={`${field} font-mono`}
                      rows={8}
                      dir="ltr"
                      value={steps}
                      onChange={(e) => setSteps(e.target.value)}
                      required
                    />
                  </Label>
                </div>
                <button
                  className={button}
                  disabled={busy || !data.settings.enabled}
                >
                  {tr("Queue plan", "منصوبہ قطار میں ڈالیں")}
                </button>
                <p className="text-sm">
                  {tr(
                    "Writes always pause for independent approval; creators cannot self-approve. Goals and tool outputs never execute as instructions.",
                    "تحریری کارروائی ہمیشہ آزاد منظوری کے لیے رکتی ہے؛ بنانے والا خود منظوری نہیں دے سکتا۔ مقصد اور نتائج ہدایات بن کر نہیں چلتے۔",
                  )}
                </p>
              </form>
              <details>
                <summary className="cursor-pointer font-semibold">
                  {tr(
                    "Registered tools available to this agent",
                    "اس ایجنٹ کے دستیاب رجسٹرڈ ٹول",
                  )}
                </summary>
                <div className="grid min-w-0 gap-3 mt-3">
                  {tools.map((t) => (
                    <div key={t.name} className="min-w-0 rounded-lg border p-3">
                      <strong>
                        {t.name} v{t.version}
                      </strong>
                      <p className="text-sm">
                        {t.description} · {t.permission} ·{" "}
                        {t.requiresApproval ? "APPROVAL REQUIRED" : "Read-only"}
                      </p>
                      {code(t.example)}
                      <button
                        className={secondary}
                        onClick={() =>
                          setSteps(
                            JSON.stringify(
                              [{ tool: t.name, input: t.example }],
                              null,
                              2,
                            ),
                          )
                        }
                      >
                        {tr("Use this tool input", "یہ ٹول ان پٹ استعمال کریں")}
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            </Card>
          )}
          <Card title={tr("Runs (latest 100)", "رنز (تازہ ۱۰۰)")}>
            <p className="text-sm">
              {tr(
                "Admins see organization runs; others see only their own. Worker advances one step per sweep, or use Advance below.",
                "منتظم تنظیم کے رنز دیکھتے ہیں؛ دوسرے صرف اپنے۔ ورکر ہر بار ایک مرحلہ چلاتا ہے یا نیچے کا بٹن استعمال کریں۔",
              )}
            </p>
            <div className="grid min-w-0 gap-2">
              {data.runs.map((r) => (
                <button
                  key={r.id}
                  className={`${selected === r.id ? "border-emerald-600 bg-emerald-50" : "border-slate-200"} min-w-0 rounded-lg border p-3 text-start`}
                  onClick={() => setSelected(r.id)}
                >
                  <strong className="break-words">{r.goal}</strong>
                  <p className="text-sm break-words">
                    {r.agentName} · {r.status} · {r.nextStep} steps ·{" "}
                    {cash(r.costMinor)} / {r.tokensUsed} tokens
                  </p>
                  {r.error && (
                    <p className="text-sm text-red-700 break-words">
                      {r.error}
                    </p>
                  )}
                </button>
              ))}
            </div>
            {!data.runs.length && <p>No runs yet.</p>}
          </Card>
          {detail && (
            <Card title={tr("Selected run trace", "منتخب رن کا ریکارڈ")}>
              <p>
                {detail.status} · {detail.output}
              </p>
              <p className="text-sm">{detail.summary}</p>
              <div className="flex flex-wrap gap-2">
                {permissions.includes("agents:run") && (
                  <>
                    <button
                      className={button}
                      disabled={busy || detail.status !== "queued"}
                      onClick={() => void act("advance", { id: detail.id })}
                    >
                      {tr("Advance one step", "ایک مرحلہ چلائیں")}
                    </button>
                    <button
                      className={secondary}
                      disabled={
                        busy ||
                        !["queued", "waiting_approval"].includes(detail.status)
                      }
                      onClick={() =>
                        void act("cancel", {
                          id: detail.id,
                          reason:
                            "Cancelled by operator from orchestration workspace",
                        })
                      }
                    >
                      {tr("Cancel run", "رن منسوخ کریں")}
                    </button>
                  </>
                )}
              </div>
              {detail.calls.map((c) => (
                <details
                  key={c.id}
                  className="min-w-0 rounded-lg border p-3"
                  open={c.status === "pending"}
                >
                  <summary className="break-words">
                    Step {c.stepIndex + 1} · {c.tool} · {c.status} ·{" "}
                    {c.durationMs} ms
                  </summary>
                  <p className="text-xs break-all">
                    Intent SHA-256: {c.digest}
                  </p>
                  {code({ input: c.input, output: c.output })}
                </details>
              ))}
            </Card>
          )}
          {permissions.includes("agents:approve") && (
            <Card
              title={tr("Independent approval queue", "آزاد منظوری کی قطار")}
            >
              <p className="text-sm">
                {tr(
                  "Review the exact payload and evidence before approving. Approval does not execute the write; execution rechecks permissions and kill switches.",
                  "منظوری سے پہلے درست ان پٹ اور ثبوت دیکھیں۔ منظوری خود کارروائی نہیں کرتی؛ اجرای وقت اجازت اور بندش سوئچ دوبارہ چیک ہوتے ہیں۔",
                )}
              </p>
              {data.approvals.map((a) => (
                <details
                  key={a.id}
                  className="min-w-0 border rounded-lg p-3"
                  open={a.status === "pending"}
                >
                  <summary>
                    {a.tool} · {a.status} ·{" "}
                    {a.createdBy === userId
                      ? "Your own request (cannot approve)"
                      : "Independent request"}
                  </summary>
                  {code(a.payload)}
                  {a.reviewNote && <p>{a.reviewNote}</p>}
                  {a.status === "pending" && a.createdBy !== userId && (
                    <form
                      aria-label={`Review ${a.id}`}
                      className="mt-3 grid gap-3 sm:grid-cols-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = formData(e);
                        void act("review", {
                          id: a.id,
                          decision: str(f, "decision"),
                          reason: str(f, "reason"),
                        });
                      }}
                    >
                      <Label name="Decision">
                        <select className={field} name="decision">
                          <option value="approve">Approve</option>
                          <option value="reject">Reject</option>
                        </select>
                      </Label>
                      <Label name="Review reason / evidence">
                        <input
                          className={field}
                          name="reason"
                          minLength={3}
                          required
                        />
                      </Label>
                      <button className={button} disabled={busy}>
                        Submit review
                      </button>
                    </form>
                  )}
                </details>
              ))}
            </Card>
          )}
          {admin && (
            <>
              <Card
                title={tr(
                  "Organization controls & kill switch",
                  "تنظیم کے کنٹرول اور بندش سوئچ",
                )}
              >
                <form
                  aria-label="Engine controls"
                  className="grid gap-3 sm:grid-cols-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = formData(e);
                    void act("engine", {
                      enabled: str(f, "enabled") === "true",
                      dailyCostBudgetMinor: minor(f, "cost"),
                      dailyToolLimit: Number(str(f, "limit")),
                      maxSteps: Number(str(f, "steps")),
                    });
                  }}
                >
                  <Label name="Engine state">
                    <select
                      name="enabled"
                      className={field}
                      defaultValue={String(!!data.settings.enabled)}
                      key={String(data.settings.enabled)}
                    >
                      <option value="true">Enabled</option>
                      <option value="false">
                        KILL — stop queued and waiting runs
                      </option>
                    </select>
                  </Label>
                  <Label name="Daily provider budget (PKR)">
                    <input
                      className={field}
                      name="cost"
                      type="number"
                      min="0"
                      max="10000"
                      step="0.01"
                      defaultValue={
                        Number(data.settings.daily_cost_budget_minor) / 100
                      }
                    />
                  </Label>
                  <Label name="Daily tool limit">
                    <input
                      className={field}
                      name="limit"
                      type="number"
                      min="0"
                      max="1000"
                      defaultValue={Number(data.settings.daily_tool_limit)}
                    />
                  </Label>
                  <Label name="Maximum steps per run">
                    <input
                      className={field}
                      name="steps"
                      type="number"
                      min="1"
                      max="20"
                      defaultValue={Number(data.settings.max_steps)}
                    />
                  </Label>
                  <button className={button} disabled={busy}>
                    Save engine controls
                  </button>
                </form>
              </Card>
              <Card title={tr("Per-agent controls", "ہر ایجنٹ کے کنٹرول")}>
                {data.agents.map((a) => (
                  <details
                    key={`${a.id}-${refresh}`}
                    className="rounded-lg border p-3"
                  >
                    <summary>
                      {a.name} · {a.enabled ? "enabled" : "disabled"} ·{" "}
                      {a.autonomy}
                    </summary>
                    <form
                      aria-label={`Configure ${a.slug}`}
                      className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = formData(e);
                        void act("agent", {
                          id: a.id,
                          enabled: str(f, "enabled") === "true",
                          autonomy: str(f, "autonomy"),
                          costBudgetMinor: minor(f, "budget"),
                          allowedTools: f.getAll("tools").map(String),
                        });
                      }}
                    >
                      <Label name="Agent state">
                        <select
                          className={field}
                          name="enabled"
                          defaultValue={String(a.enabled)}
                        >
                          <option value="true">Enabled</option>
                          <option value="false">KILL agent runs</option>
                        </select>
                      </Label>
                      <Label name="Autonomy">
                        <select
                          name="autonomy"
                          className={field}
                          defaultValue={a.autonomy}
                        >
                          <option value="suggest_only">
                            Read-only / suggest only
                          </option>
                          <option value="act_with_approval">
                            Act with independent approval
                          </option>
                        </select>
                      </Label>
                      <Label name="Daily agent provider budget (PKR)">
                        <input
                          name="budget"
                          className={field}
                          type="number"
                          min="0"
                          max="10000"
                          step="0.01"
                          defaultValue={a.costBudgetMinor / 100}
                        />
                      </Label>
                      <Label name="Allowed registered tools (multi-select)">
                        <select
                          className={field}
                          name="tools"
                          multiple
                          size={6}
                          defaultValue={a.allowedTools}
                        >
                          {data.tools.map((t) => (
                            <option key={t.name}>{t.name}</option>
                          ))}
                        </select>
                      </Label>
                      <button disabled={busy} className={button}>
                        Save agent controls
                      </button>
                    </form>
                  </details>
                ))}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
