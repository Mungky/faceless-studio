import "server-only";
import {assetTagLimit,assetOrganizeSchema,assetUpdateSchema,normalizeAssetTags,type Asset} from "@studio/core";
import {db} from "./pocketbase";

export async function updateAsset(id:string,raw:unknown){
  const input=assetUpdateSchema.parse(raw),patch:Record<string,unknown>={};
  if(input.selected!==undefined)patch.selected=input.selected;
  if(input.asset_group!==undefined)patch.asset_group=input.asset_group;
  if(input.tags!==undefined)patch.tags=input.tags;
  return db.update<Asset>("assets",id,patch);
}
export async function organizeAssets(raw:unknown){
  const request=assetOrganizeSchema.parse(raw),remove=request.remove_tags||[],add=request.add_tags||[];
  const assets=await Promise.all(request.ids.map(id=>db.get<Asset>("assets",id)));
  const plans=assets.map(asset=>{
    const kept=(asset.tags||[]).filter(tag=>!remove.includes(tag));
    if(new Set([...kept,...add]).size>assetTagLimit)throw new Error(`An asset can have at most ${assetTagLimit} tags`);
    return {id:asset.id,patch:{tags:normalizeAssetTags([...kept,...add]),...(request.asset_group!==undefined?{asset_group:request.asset_group}:{})}};
  });
  const updated:Asset[]=[];
  for(const plan of plans)updated.push(await db.update<Asset>("assets",plan.id,plan.patch));
  return updated;
}
