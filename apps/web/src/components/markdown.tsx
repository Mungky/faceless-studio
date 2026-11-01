import {Fragment,type ReactNode} from "react";

// A small, safe Markdown view for model output: headings, lists, tables, quotes, code and inline
// emphasis/links. It builds React elements only, never HTML strings.
function inline(text:string,key=""):ReactNode[]{
  const out:ReactNode[]=[];const pattern=/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;let last=0,i=0;
  for(const match of text.matchAll(pattern)){
    if(match.index>last)out.push(text.slice(last,match.index));const token=match[0],k=key+"-"+i++;
    if(token.startsWith("**"))out.push(<strong key={k}>{token.slice(2,-2)}</strong>);
    else if(token.startsWith("`"))out.push(<code key={k}>{token.slice(1,-1)}</code>);
    else if(token.startsWith("[")){const [,label,href]=/^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)!;out.push(<a key={k} href={href} target="_blank" rel="noreferrer">{label}</a>);}
    else out.push(<em key={k}>{token.slice(1,-1)}</em>);
    last=match.index+token.length;
  }
  if(last<text.length)out.push(text.slice(last));return out;
}
const cells=(row:string)=>row.trim().replace(/^\|/,"").replace(/\|$/,"").split("|").map(c=>c.trim().replace(/<br\s*\/?>/gi,"\n"));

export function Markdown({text,className=""}:{text:string;className?:string}){
  const lines=text.replace(/\r/g,"").split("\n"),blocks:ReactNode[]=[];let i=0;
  while(i<lines.length){
    const line=lines[i],key="b"+i;
    if(!line.trim()){i++;continue;}
    if(/^```/.test(line)){const body:string[]=[];i++;while(i<lines.length&&!/^```/.test(lines[i]))body.push(lines[i++]);i++;blocks.push(<pre key={key}><code>{body.join("\n")}</code></pre>);continue;}
    const heading=/^(#{1,4})\s+(.*)$/.exec(line);
    if(heading){const level=Math.min(heading[1].length+2,6);const Tag=`h${level}` as "h3";blocks.push(<Tag key={key}>{inline(heading[2],key)}</Tag>);i++;continue;}
    if(/^\s*\|/.test(line)&&i+1<lines.length&&/^\s*\|?\s*:?-{2,}/.test(lines[i+1])){
      const head=cells(line);i+=2;const rows:string[][]=[];while(i<lines.length&&/^\s*\|/.test(lines[i]))rows.push(cells(lines[i++]));
      blocks.push(<div key={key} className="md-table"><table><thead><tr>{head.map((c,j)=><th key={j}>{inline(c,key+j)}</th>)}</tr></thead><tbody>{rows.map((r,ri)=><tr key={ri}>{head.map((_,j)=><td key={j}>{(r[j]||"").split("\n").map((part,pi)=><Fragment key={pi}>{pi>0&&<br/>}{inline(part,key+ri+j+pi)}</Fragment>)}</td>)}</tr>)}</tbody></table></div>);continue;}
    if(/^\s*([-*•]|\d+[.)])\s+/.test(line)){
      const ordered=/^\s*\d/.test(line),items:string[]=[];while(i<lines.length&&/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]))items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/,""));
      const List=ordered?"ol":"ul";blocks.push(<List key={key}>{items.map((item,j)=><li key={j}>{inline(item,key+j)}</li>)}</List>);continue;}
    if(/^>\s?/.test(line)){const body:string[]=[];while(i<lines.length&&/^>\s?/.test(lines[i]))body.push(lines[i++].replace(/^>\s?/,""));blocks.push(<blockquote key={key}>{inline(body.join(" "),key)}</blockquote>);continue;}
    const paragraph:string[]=[];while(i<lines.length&&lines[i].trim()&&!/^(#{1,4}\s|```|\s*\||\s*([-*•]|\d+[.)])\s|>)/.test(lines[i]))paragraph.push(lines[i++]);
    if(!paragraph.length)paragraph.push(lines[i++]);
    blocks.push(<p key={key}>{paragraph.map((part,j)=><Fragment key={j}>{j>0&&<br/>}{inline(part,key+j)}</Fragment>)}</p>);
  }
  return <div className={"md "+className}>{blocks}</div>;
}
