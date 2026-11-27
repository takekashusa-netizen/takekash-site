// Every 6 hours: snapshot the owner's YouTube channels from the free public feed (Admin Hub → Stats).
import { getStore } from "@netlify/blobs";
import A from "../../lib/analytics.cjs";
export default async () => { console.log("[analytics-run]", JSON.stringify(await A.snapshot(getStore("analytics")))); };
export const config = { schedule: "11 */6 * * *" };
