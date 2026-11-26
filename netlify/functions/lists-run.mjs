// Scheduled every 15 minutes: sends every sequence step that's due (TakeKash Lists).
import { getStore } from "@netlify/blobs";
import access from "../../lib/seo/access.cjs";
import lists from "../../lib/lists.cjs";

export default async () => {
  await access.ensureSigningSecret(getStore("keys"));
  const r = await lists.runDue(getStore("mail"), process.env);
  if (r.sent || r.errors) console.log("lists-run", JSON.stringify(r));
};

export const config = { schedule: "*/15 * * * *" };
