import "server-only";
import path from "node:path";
import {mkdir,readFile,rename,writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {safeVaultPath} from "./vault";

// What the project assistant remembers between chats lives as two Markdown files in the project's
// vault folder, so the owner can read and edit them in Obsidian and deploys never lose them:
//   <project>/ATURAN-ASSISTANT.md  standing rules from the owner ("never add If or Wait nodes")
//   <project>/MEMORI-ASSISTANT.md  decisions, preferences and facts worth carrying into any chat
export type NoteKind="rules"|"memory";
const FILES:Record<NoteKind,string>={rules:"ATURAN-ASSISTANT.md",memory:"MEMORI-ASSISTANT.md"};
const LIMIT:Record<NoteKind,number>={rules:8000,memory:12000};
const HEADER:Record<NoteKind,string>={
  rules:"# Aturan tetap assistant\n\nAturan dari pemilik. Assistant wajib mengikutinya di setiap chat. Boleh diedit di Obsidian.\n\n",
  memory:"# Memori assistant\n\nCatatan yang diingat assistant antar chat. Satu baris per catatan; boleh diedit atau dihapus di Obsidian.\n\n"
};
const target=(folder:string,kind:NoteKind)=>safeVaultPath(`${folder}/${FILES[kind]}`,true);

export async function readNotes(folder:string,kind:NoteKind){
  try{
    const text=await readFile(await target(folder,kind),"utf8").then(t=>t.replace(HEADER[kind],"").trim());
    // The newest memory matters most; rules are read from the top.
    return kind==="memory"?text.slice(-LIMIT.memory):text.slice(0,LIMIT.rules);
  }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return "";throw error;}
}
async function save(folder:string,kind:NoteKind,content:string){
  const file=await target(folder,kind);await mkdir(path.dirname(file),{recursive:true});
  const temporary=file+"."+randomUUID()+".tmp";await writeFile(temporary,content,{flag:"wx"});await rename(temporary,file);
}
const today=()=>new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Jakarta"});
const clean=(text:unknown)=>String(text??"").replace(/\s+/g," ").replace(/^[-*•\s]+/,"").trim().slice(0,400);

// Adds one line. The same note twice is kept once. A full memory forgets its oldest lines; full
// rules refuse, because dropping a rule silently would be worse than asking the owner to tidy.
export async function addNote(folder:string,kind:NoteKind,note:unknown){
  const text=clean(note);if(!text)throw new Error("Catatannya kosong.");
  let body=await readFile(await target(folder,kind),"utf8").catch(error=>{if((error as NodeJS.ErrnoException).code==="ENOENT")return "";throw error;});
  if(!body.trim())body=HEADER[kind];
  const lines=body.split("\n").map(l=>l.replace(/^- (\d{4}-\d{2}-\d{2}): /,"- ").trim().toLowerCase());
  if(lines.includes("- "+text.toLowerCase()))return "Sudah tercatat sebelumnya.";
  if(!body.endsWith("\n"))body+="\n";
  body+=kind==="memory"?`- ${today()}: ${text}\n`:`- ${text}\n`;
  if(body.length>LIMIT[kind]){
    if(kind==="rules")throw new Error("Berkas aturan sudah penuh. Minta pemilik merapikannya di Obsidian.");
    const rows=body.slice(HEADER.memory.length).split("\n").filter(Boolean);
    while(rows.length>1&&(HEADER.memory+rows.join("\n")+"\n").length>LIMIT.memory)rows.shift();
    body=HEADER.memory+rows.join("\n")+"\n";
  }
  await save(folder,kind,body);
  return kind==="memory"?"Disimpan ke memori.":"Disimpan sebagai aturan tetap.";
}
// The assistant tidies its own memory (merge duplicates, drop what is outdated).
export async function replaceMemory(folder:string,content:unknown){
  const text=String(content??"").trim();
  if(!text)throw new Error("Isi memori tidak boleh kosong; hapus catatan satu per satu bila perlu.");
  if(text.length>LIMIT.memory)throw new Error(`Memori maksimal ${LIMIT.memory} karakter.`);
  await save(folder,"memory",(text.startsWith("#")?"":HEADER.memory)+text+"\n");
  return "Memori dirapikan.";
}
// For the Memori panel: one entry per line, and deleting by (part of) the text.
export async function noteLines(folder:string,kind:NoteKind){return (await readNotes(folder,kind)).split("\n").map(l=>l.trim()).filter(l=>l.startsWith("- "));}
export async function removeNote(folder:string,kind:NoteKind,needle:unknown){
  const text=String(needle??"").trim().toLowerCase();if(!text)throw new Error("Tulis bagian catatan yang mau dihapus.");
  const body=await readFile(await target(folder,kind),"utf8").catch(error=>{if((error as NodeJS.ErrnoException).code==="ENOENT")return "";throw error;});
  const lines=body.split("\n"),kept=lines.filter(l=>!(l.startsWith("- ")&&l.toLowerCase().includes(text)));
  if(kept.length===lines.length)return 0;
  await save(folder,kind,kept.join("\n"));return lines.length-kept.length;
}
