import "server-only";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rename, realpath, access, copyFile, readdir, stat, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { segment, recordId, type Beat, parseStoryboard, serializeStoryboard, z } from "@studio/core";

export const documentNames = ["riset.md", "script.md", "storyboard.md", "upload-pack.md"] as const;
export type DocumentName = typeof documentNames[number];
export function vaultRoot() {
  const custom = process.env.RESTARD_STUDIO_ROOT || process.env.VAULT_ROOT;
  if (custom) return path.resolve(/* turbopackIgnore: true */ custom);
  if (process.platform !== "win32") {
    if (existsSync("/mnt/hdd/Restard Studio")) return "/mnt/hdd/Restard Studio";
    if (existsSync("/mnt/hdd")) return "/mnt/hdd/Restard Studio";
  }
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), "projects");
}
export async function safeVaultPath(relative: string, allowMissing = false) {
  const rootDir = vaultRoot();
  try { await mkdir(rootDir, { recursive: true }); } catch {}
  const root = await realpath(/* turbopackIgnore: true */ rootDir);
  const parts = relative.split("/"); for (const part of parts) segment.parse(part);
  const target = path.resolve(root, ...parts);
  if (!target.startsWith(root + path.sep) && target !== root) throw new Error("Path is outside Restard Studio storage");
  let nearest = target;
  while (true) {
    try { const resolved = await realpath(nearest); if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error("Vault symlink escapes its root"); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !allowMissing || nearest === root) throw error; nearest = path.dirname(nearest); }
  }
  return target;
}
export async function readDocument(folder: string, name: DocumentName) {
  try { return await readFile(await safeVaultPath(`${folder}/${name}`, true), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return ""; throw error; }
}
export async function writeDocument(folder: string, name: DocumentName, content: string) {
  if (Buffer.byteLength(content) > 1_000_000) throw new Error("Document exceeds 1 MB");
  if (name === "storyboard.md") parseStoryboard(content);
  const target = await safeVaultPath(`${folder}/${name}`, true);
  await mkdir(path.dirname(target), { recursive: true });
  await safeVaultPath(folder);
  try {
    await access(target);
    const history = await safeVaultPath(`${folder}/.studio-history`, true); await mkdir(history, { recursive: true });
    await copyFile(target, path.join(history, `${Date.now()}-${randomUUID().slice(0, 8)}-${name}`));
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const temporary = target + "." + randomUUID() + ".tmp";
  await writeFile(temporary, content, { flag: "wx" }); await rename(temporary, target);
}
// Custom workflow stages keep their own Markdown result per node, beside the canonical documents.
const nodeFile=(folder:string,node:string)=>`${folder}/nodes/${z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/).parse(node)}.md`;
export async function readNodeOutput(folder:string,node:string){try{return await readFile(await safeVaultPath(nodeFile(folder,node),true),"utf8");}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return "";throw error;}}
export async function writeNodeOutput(folder:string,node:string,content:string){
  if(Buffer.byteLength(content)>1_000_000)throw new Error("Document exceeds 1 MB");
  const target=await safeVaultPath(nodeFile(folder,node),true);await mkdir(path.dirname(target),{recursive:true});await safeVaultPath(folder);
  const temporary=target+"."+randomUUID()+".tmp";await writeFile(temporary,content,{flag:"wx"});await rename(temporary,target);
}
export async function readPlaybook(relative: string) { return readFile(await safeVaultPath(relative), "utf8"); }
export async function documentHistory(folder:string,name:DocumentName){
  const root=await safeVaultPath(folder+"/.studio-history",true);let names:string[];try{names=await readdir(root);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw error;}
  const suffix="-"+name;const rows=await Promise.all(names.filter(n=>/^\d{13}-[a-f0-9]{8}-/.test(n)&&n.endsWith(suffix)).sort().reverse().slice(0,100).map(async id=>{const file=await safeVaultPath(folder+"/.studio-history/"+id);const info=await stat(file);return {id,created:new Date(Number(id.slice(0,13))).toISOString(),bytes:info.size};}));return rows;
}
export async function historicalDocument(folder:string,name:DocumentName,id:string){if(!/^\d{13}-[a-f0-9]{8}-/.test(id)||!id.endsWith("-"+name)||!documentNames.includes(name))throw new Error("Invalid document revision");return readFile(await safeVaultPath(folder+"/.studio-history/"+segment.parse(id)),"utf8");}
export async function readBeats(folder: string) { return parseStoryboard(await readDocument(folder, "storyboard.md")); }
export async function readStoryboardState(folder: string, savedContent?: string) {
  const content = savedContent ?? await readDocument(folder, "storyboard.md");
  try { return { beats: parseStoryboard(content), error: null }; }
  catch (error) {
    const message = error instanceof z.ZodError ? error.issues.some(issue => issue.path.includes("seconds")) ? "Each beat needs a duration between 0.1 and 600 seconds." : "Check the beat numbers, text and duration in each row." : (error as Error).message;
    return { beats: [] as Beat[], error: `Storyboard needs repair. ${message} The original Markdown is preserved.` };
  }
}
export async function writeBeats(folder: string, beats: Beat[]) { await writeDocument(folder, "storyboard.md", serializeStoryboard(beats)); }
export async function writeStoryboardDraft(folder: string, quoteId: string, content: string) {
  recordId.parse(quoteId);
  const relative = `${folder}/.studio-drafts/${quoteId}-${randomUUID()}.md`;
  const target = await safeVaultPath(relative, true);
  await mkdir(path.dirname(target), { recursive: true });
  await safeVaultPath(`${folder}/.studio-drafts`);
  await writeFile(target, content, { flag: "wx" });
  return relative;
}
export async function saveBackup(folder: string, label: string, data: unknown) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-"), slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "cadangan";
  const relative = `${folder}/Workflow Backup/${stamp}-${randomUUID().slice(0, 4)}-${slug}.json`, file = await safeVaultPath(relative, true);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(data, null, 1), { flag: "wx" });
  await rename(temporary, file);
  const names = (await readdir(path.dirname(file))).filter(n => n.endsWith(".json")).sort();
  for (const old of names.slice(0, -20)) await rm(path.join(path.dirname(file), old), { force: true });
  return relative;
}
