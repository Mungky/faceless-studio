import {NextRequest,NextResponse} from "next/server";
import {authenticate,checkOrigin} from "../../../server/auth";
export const runtime="nodejs";
async function retired(request:NextRequest){
  try{if(request.method!=="GET")checkOrigin(request);if(!await authenticate(request))return NextResponse.json({error:"Sign in to Faceless Studio."},{status:401});}
  catch{return NextResponse.json({error:"Request is not authorized."},{status:403});}
  return NextResponse.json({error:"This legacy pipeline has been retired. Use Channel and Studio for verified reports and production."},{status:410});
}
export {retired as GET,retired as POST,retired as PUT,retired as PATCH,retired as DELETE};
