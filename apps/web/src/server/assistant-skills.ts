import "server-only";
import path from "node:path";
import {mkdir,readdir,readFile,rename,rm,writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {safeVaultPath} from "./vault";

// Skills are short how-to notes the assistant can open when a task matches. Only the name and a
// one-line description sit in its prompt; the full text is read on demand, so the prompt stays small
// however many skills exist. They live as Markdown in the vault (editable in Obsidian, kept across
// deploys): <project>/Assistant Skills/<name>.md for one project, Assistant Skills/<name>.md for all.
export type Skill={name:string;description:string;scope:"bawaan"|"global"|"project"};
const DIR="Assistant Skills",SLUG=/^[a-z0-9][a-z0-9-]{1,59}$/,MAX_CONTENT=6000;

// Built in with the app, so they improve with deploys. A project or global skill of the same name wins.
const BUILTIN:(Skill&{content:string})[]=[
  {name:"ubah-prompt-dari-playbook",scope:"bawaan",description:"Mengadaptasi prompt node dari dokumen playbook channel (mis. dari Arthur ke Not Yet).",content:`1. Baca dokumen lampiran sampai habis. Kalau ada catatan "[…dipotong", katakan bagian mana yang tidak terbaca dan minta lampiran ulang.
2. get_workflow, lalu daftar node yang memuat prompt: chainLlm (parameter text) dan node Set yang berisi instruksi.
3. Petakan setiap tahap di playbook ke SATU node yang sudah ada. Jangan menambah node.
4. Tulis ulang prompt tiap node dengan istilah channel baru (nama channel, bahasa, durasi, gaya, narator, format keluaran) dan buang sisa channel lama. Untuk satu nilai saja pakai set_node_param.
5. Ubah satu node per aksi (modify_n8n_node.prompt atau set_node_param).
6. Setelah selesai, cocokkan "Perubahan nyata" dari server dengan daftar tahap dan laporkan node mana yang berubah dan mana yang tidak.
7. Cari sisa nama channel lama di semua node (path berkas, nama file, caption). Laporkan; jangan ubah tanpa diminta.`},
  {name:"pulihkan-workflow",scope:"bawaan",description:"Mengembalikan workflow yang rusak atau tertimpa tanpa membangun ulang dari resep.",content:`JANGAN memakai rebuild_from_recipe untuk memulihkan: itu menimpa seluruh isi workflow.
1. undo_last_change mengembalikan satu langkah (ulangi bila perlu), atau minta pemilik menekan "Urungkan giliran ini".
2. Kalau cadangan chat habis: list_executions, lalu restore_from_execution {execution_id}. n8n menyimpan salinan workflow di tiap eksekusi. Pilih eksekusi terakhir yang berhasil sebelum kerusakan. Aksi ini menunggu tombol Izinkan.
3. Setelah pulih, bandingkan dengan laporan "Perubahan nyata" dan sebutkan apa yang hilang (perubahan sesudah eksekusi itu).`},
  {name:"diagnosa-eksekusi-gagal",scope:"bawaan",description:"Mencari penyebab eksekusi n8n yang gagal, kosong, atau berhenti di tengah.",content:`1. list_executions, ambil id terbaru. 2. get_execution: lihat node terakhir, pesan error, dan output tiap node.
3. Penyebab umum: credential kosong atau salah; path berkas di luar /vault; node baca berkas kosong karena mount atau izin; expression merujuk node yang tidak berjalan; model mengembalikan jawaban kosong.
4. Perbaiki SATU penyebab, uji dengan execute_n8n_workflow, baca eksekusi baru. Jangan mengaktifkan workflow hanya untuk menguji tanpa izin pemilik: aktivasi menyalakan jadwal.`},
  {name:"edit-aman",scope:"bawaan",description:"Prinsip mengubah workflow tanpa merusak dan tanpa mengklaim hasil yang tidak terjadi.",content:`Satu permintaan = perubahan sekecil mungkin. Pakai set_node_param untuk satu nilai. Tunggu hasil dari server sebelum menyatakan selesai; kalau "Perubahan nyata" kosong, katakan tidak ada yang berubah. Jangan menulis hasil aksi sendiri. Aksi besar menunggu tombol Izinkan; jangan meminta pemilik mengetik "iya". Untuk mengembalikan, pakai undo_last_change.`}
];

function meta(text:string,fallback:string){
  const front=/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text),field=(key:string)=>new RegExp(`^${key}:\\s*(.+)$`,"mi").exec(front?.[1]||"")?.[1]?.trim();
  const body=front?text.slice(front[0].length):text;
  return {name:field("name")||fallback,description:(field("description")||body.split("\n").find(l=>l.trim()&&!l.startsWith("#"))||"").trim().slice(0,200),body:body.trim()};
}
async function readDir(relative:string,scope:"global"|"project"){
  let names:string[];try{names=await readdir(await safeVaultPath(relative,true));}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return [];throw error;}
  const out:(Skill&{content:string})[]=[];
  for(const file of names.filter(n=>n.endsWith(".md")).slice(0,60)){
    const slug=file.slice(0,-3);if(!SLUG.test(slug))continue;
    try{const m=meta(await readFile(await safeVaultPath(`${relative}/${file}`),"utf8"),slug);out.push({name:slug,description:m.description,scope,content:m.body});}catch{/* unreadable skill: skip it */}
  }
  return out;
}
// Later scopes win: a project skill replaces a global one, which replaces a built-in one of the same name.
async function all(folder:string){
  const byName=new Map<string,Skill&{content:string}>();
  for(const skill of [...BUILTIN,...await readDir(DIR,"global"),...await readDir(`${folder}/${DIR}`,"project")])byName.set(skill.name,skill);
  return [...byName.values()];
}
export async function listSkills(folder:string):Promise<Skill[]>{return (await all(folder)).map(({name,description,scope})=>({name,description,scope}));}
export async function readSkill(folder:string,name:unknown){
  const found=(await all(folder)).find(s=>s.name===String(name||"").trim().toLowerCase());
  if(!found)throw new Error(`Skill "${name}" tidak ada. Pakai list_skills untuk melihat yang tersedia.`);
  return found;
}
export async function saveSkill(folder:string,input:{name?:unknown;description?:unknown;content?:unknown;scope?:unknown}){
  const name=String(input.name||"").trim().toLowerCase().replace(/\s+/g,"-"),description=String(input.description||"").replace(/\s+/g," ").trim().slice(0,200),content=String(input.content||"").trim();
  if(!SLUG.test(name))throw new Error("Nama skill: huruf kecil, angka, dan tanda hubung (2–60 karakter), mis. \"ubah-prompt-dari-playbook\".");
  if(!description)throw new Error("Skill butuh deskripsi satu kalimat: kapan skill ini dipakai.");
  if(content.length<20)throw new Error("Isi skill terlalu pendek untuk berguna.");
  if(content.length>MAX_CONTENT)throw new Error(`Isi skill maksimal ${MAX_CONTENT} karakter; pecah menjadi beberapa skill.`);
  const scope=input.scope==="global"?"global":"project",relative=scope==="global"?`${DIR}/${name}.md`:`${folder}/${DIR}/${name}.md`;
  const target=await safeVaultPath(relative,true);await mkdir(path.dirname(target),{recursive:true});
  const temporary=target+"."+randomUUID()+".tmp";await writeFile(temporary,`---\nname: ${name}\ndescription: ${description}\n---\n${content}\n`,{flag:"wx"});await rename(temporary,target);
  return `Skill "${name}" disimpan (${scope==="global"?"semua project":"project ini"}).`;
}
export async function deleteSkill(folder:string,name:string,scope:"global"|"project"){
  if(!SLUG.test(name))throw new Error("Nama skill tidak valid.");
  await rm(await safeVaultPath(scope==="global"?`${DIR}/${name}.md`:`${folder}/${DIR}/${name}.md`,true),{force:true});
}
