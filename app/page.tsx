import { NetworkDashboard, type Snapshot } from "./network-dashboard";
import { redirect } from "next/navigation";
import { getHomeScopeSession, isCloudAuthenticationRequired } from "./lib/auth";

export const dynamic = "force-dynamic";

async function getInitialSnapshot(): Promise<Snapshot | null> {
  const collectorUrl = (process.env.HOMESCOPE_COLLECTOR_URL || "http://127.0.0.1:4318").replace(/\/+$/, "");
  const token = process.env.HOMESCOPE_COLLECTOR_TOKEN || "";
  try {
    const response = await fetch(`${collectorUrl}/api/snapshot`, {
      cache: "no-store",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    return await response.json() as Snapshot;
  } catch {
    return null;
  }
}

export default async function Home() {
  const session = await getHomeScopeSession();
  if (!session) redirect("/login");
  const initialSnapshot = await getInitialSnapshot();
  const authRequired = isCloudAuthenticationRequired();
  const cloudMode = process.env.VERCEL === "1" || process.env.HOMESCOPE_CLOUD_MODE === "true";
  return (
    <NetworkDashboard
      cloudMode={cloudMode}
      authRequired={authRequired}
      userEmail={session.email}
      initialSnapshot={initialSnapshot}
    />
  );
}
