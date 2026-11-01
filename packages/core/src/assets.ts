import {z} from "zod";

const assetId=z.string().regex(/^[a-zA-Z0-9]{15}$/,"Invalid asset ID");
export const assetTagLimit=12;
export const assetTagLength=40;
export const assetGroupLength=80;
export const noGroup="__none__";

export const assetProjectLength=120;
export interface LibraryAsset {id:string;kind:string;episode:string;channel:string;drive_path:string;asset_group:string;tags:string[];created:string;project?:string;title?:string;deleted?:boolean;}
export interface AssetFilter {channel?:string;kind?:string;kinds?:readonly string[];project?:string;group?:string;tag?:string;search?:string;trash?:boolean;}
// Sidebar media types, Google Flow style; each covers one or more stored asset kinds.
export const assetCategories=[
  {id:"image",label:"Gambar",kinds:["image","thumb"]},
  {id:"video",label:"Video",kinds:["video","render"]},
  {id:"vo",label:"VO",kinds:["vo"]},
  {id:"music",label:"Musik",kinds:["music","bgm"]},
  {id:"sfx",label:"SFX",kinds:["sfx"]}] as const;
export const assetTitle=(asset:Pick<LibraryAsset,"title"|"drive_path">)=>asset.title?.trim()||asset.drive_path.split("/").pop()?.replace(/\.[^.]+$/,"")||"Tanpa judul";
export type AssetGrouping="group"|"channel"|"episode"|"kind"|"none";
export interface AssetBucket {key:string;label:string;items:LibraryAsset[];}

export function normalizeAssetTags(input:readonly string[]):string[]{
  const tags:string[]=[];
  for(const raw of input){
    const tag=raw.trim().toLowerCase();
    if(!tag)continue;
    if(tag.length>assetTagLength)throw new Error(`Each tag must be at most ${assetTagLength} characters`);
    if(!tags.includes(tag))tags.push(tag);
  }
  return tags.slice(0,assetTagLimit);
}
const tagList=z.array(z.string()).max(60).transform(normalizeAssetTags);
const groupName=z.string().trim().max(assetGroupLength);
const projectName=z.string().trim().max(assetProjectLength);
export const assetOrganizeSchema=z.object({
  ids:z.array(assetId).min(1).max(200),
  project:projectName.optional(),
  asset_group:groupName.optional(),
  add_tags:tagList.optional(),
  remove_tags:tagList.optional(),
  deleted:z.boolean().optional()
}).refine(value=>value.project!==undefined||value.asset_group!==undefined||value.deleted!==undefined||(value.add_tags?.length||0)>0||(value.remove_tags?.length||0)>0,"Choose a group or at least one tag change");
export const assetUpdateSchema=z.object({selected:z.boolean().optional(),project:projectName.optional(),title:z.string().trim().max(200).optional(),asset_group:groupName.optional(),tags:tagList.optional(),deleted:z.boolean().optional()}).refine(value=>Object.keys(value).length>0,"Nothing to update");

export function filterAssets(list:readonly LibraryAsset[],filter:AssetFilter):LibraryAsset[]{
  const search=filter.search?.trim().toLowerCase();
  return list.filter(asset=>
    !!asset.deleted===!!filter.trash&&
    (filter.project===undefined||(asset.project||"")===filter.project)&&
    (!filter.kinds||filter.kinds.includes(asset.kind))&&
    (!filter.channel||asset.channel===filter.channel)&&
    (!filter.kind||asset.kind===filter.kind)&&
    (!filter.group||(filter.group===noGroup?!asset.asset_group:asset.asset_group===filter.group))&&
    (!filter.tag||asset.tags.includes(filter.tag))&&
    (!search||assetTitle(asset).toLowerCase().includes(search)||asset.drive_path.toLowerCase().includes(search)||asset.id.toLowerCase().includes(search)||asset.asset_group.toLowerCase().includes(search)||asset.tags.some(tag=>tag.includes(search))));
}

const newestFirst=(a:LibraryAsset,b:LibraryAsset)=>b.created.localeCompare(a.created)||a.id.localeCompare(b.id);
export function groupAssets(list:readonly LibraryAsset[],by:AssetGrouping,label:(by:AssetGrouping,key:string)=>string=(_by,key)=>key):AssetBucket[]{
  const sorted=[...list].sort(newestFirst);
  if(by==="none")return [{key:"all",label:"Semua asset",items:sorted}];
  const keyOf=(asset:LibraryAsset)=>by==="group"?asset.asset_group:by==="channel"?asset.channel:by==="episode"?asset.episode:asset.kind;
  const buckets=new Map<string,LibraryAsset[]>();
  for(const asset of sorted){const key=keyOf(asset);buckets.set(key,[...(buckets.get(key)||[]),asset]);}
  const entries=[...buckets.entries()].map(([key,items])=>({key,label:key?label(by,key):by==="group"?"Tanpa grup":"Tanpa label",items}));
  return entries.sort((a,b)=>(a.key===""?1:0)-(b.key===""?1:0)||a.label.localeCompare(b.label));
}
