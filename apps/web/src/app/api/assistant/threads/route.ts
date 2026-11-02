import {NextRequest,NextResponse} from "next/server";
import {authenticate} from "../../../../server/auth";
import {createThread,deleteThread,getThread,listThreads,renameThread,sendMessage,stopThread} from "../../../../server/assistant";

export const runtime="nodejs";

// One endpoint for the project assistant's chats: list, create, read, send, stop, rename, delete.
// Sending only starts the run on the server and returns at once; the page reads progress with "get".
export async function POST(request:NextRequest){
  try{
    if(!await authenticate(request))return NextResponse.json({error:"Unauthorized"},{status:401});
    const body=await request.json();
    const channel=String(body.channelId||""),id=String(body.threadId||"");
    switch(body.op){
      case "list":return NextResponse.json({threads:await listThreads(channel)});
      case "create":return NextResponse.json(await createThread(channel,body.title),{status:201});
      case "get":return NextResponse.json(await getThread(channel,id));
      case "send":return NextResponse.json(await sendMessage(channel,id,{content:body.content,attachments:Array.isArray(body.attachments)?body.attachments:[]}));
      case "stop":return NextResponse.json(await stopThread(channel,id));
      case "rename":return NextResponse.json(await renameThread(channel,id,String(body.title||"")));
      case "delete":return NextResponse.json(await deleteThread(channel,id));
      default:return NextResponse.json({error:"Operasi tidak dikenal."},{status:400});
    }
  }catch(error){return NextResponse.json({error:(error as Error).message},{status:500});}
}
