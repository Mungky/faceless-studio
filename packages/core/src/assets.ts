import {z} from "zod";

const assetId=z.string().regex(/^[a-zA-Z0-9]{15}$/,"Invalid asset ID");
export const assetTagLimit=12;
export const assetTagLength=40;
export const assetGroupLength=80;
export const noGroup="__none__";

export interface LibraryAsset {id:string;kind:string;episode:string;channel:string;drive_path:string;asset_group:string;tags:string[];created:string;}
export interface AssetFilter {channel?:string;kind?:string;group?:string;tag?:string;search?:string;}
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
export const assetOrganizeSchema=z.object({
  ids:z.array(assetId).min(1).max(200),
  asset_group:groupName.optional(),
  add_tags:tagList.optional(),
  remove_tags:tagList.optional()
}).refine(value=>value.asset_group!==undefined||(value.add_tags?.length||0)>0||(value.remove_tags?.length||0)>0,"Choose a group or at least one tag change");
export const assetUpdateSchema=z.object({selected:z.boolean().optional(),asset_group:groupName.optional(),tags:tagList.optional()}).refine(value=>Object.keys(value).length>0,"Nothing to update");

export function filterAssets(list:readonly LibraryAsset[],filter:AssetFilter):LibraryAsset[]{
  const search=filter.search?.trim().toLowerCase();
  return list.filter(asset=>
    (!filter.channel||asset.channel===filter.channel)&&
    (!filter.kind||asset.kind===filter.kind)&&
    (!filter.group||(filter.group===noGroup?!asset.asset_group:asset.asset_group===filter.group))&&
    (!filter.tag||asset.tags.includes(filter.tag))&&
    (!search||asset.drive_path.toLowerCase().includes(search)||asset.id.toLowerCase().includes(search)||asset.asset_group.toLowerCase().includes(search)||asset.tags.some(tag=>tag.includes(search))));
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
