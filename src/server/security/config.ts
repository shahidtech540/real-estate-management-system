export const productionDeployment = () =>
  process.env.REMS_DEPLOYMENT === "production";
export function validateDeployment() {
  if (!productionDeployment()) return;
  const a = process.env.JWT_ACCESS_SECRET || "",
    r = process.env.JWT_REFRESH_SECRET || "";
  if ((process.env.FRAME_ANCESTORS || "").split(/\s+/).includes("*"))
    throw new Error("Production cannot allow wildcard framing.");
  if (
    a.length < 32 ||
    r.length < 32 ||
    a === r ||
    /rems-|change-in|example/i.test(a + r)
  )
    throw new Error(
      "Production requires distinct strong JWT secrets (32+ characters).",
    );
  if (!process.env.SQLITE_DB_PATH)
    throw new Error(
      "Production requires an explicit persistent SQLITE_DB_PATH.",
    );
}
