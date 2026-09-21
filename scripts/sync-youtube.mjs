import {XMLParser} from "fast-xml-parser";
const U=process.env.SUPABASE_URL,K=process.env.SUPABASE_SERVICE_ROLE_KEY,Y=process.env.YOUTUBE_API_KEY;
if(!U||!K||!Y)throw Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / YOUTUBE_API_KEY");
const H={apikey:K,Authorization:`Bearer ${K}`},R=U+"/rest/v1";
async function db(path,opt={}){let r=await fetch(R+path,{...opt,headers:{...H,...(opt.headers||{})}}),t=await r.text();if(!r.ok)throw Error(`Supabase ${r.status}: ${t}`);return t?JSON.parse(t):null}
async function rss(id){let r=await fetch("https://www.youtube.com/feeds/videos.xml?channel_id="+encodeURIComponent(id));if(!r.ok)throw Error("RSS "+r.status);return new XMLParser({ignoreAttributes:false,attributeNamePrefix:"@_"}).parse(await r.text())?.feed?.entry||[]}
function arr(x){return Array.isArray(x)?x:[x].filter(Boolean)}
async function details(ids){let out=new Map();for(let i=0;i<ids.length;i+=50){let u=new URL("https://www.googleapis.com/youtube/v3/videos");u.searchParams.set("part","snippet,contentDetails,liveStreamingDetails");u.searchParams.set("id",ids.slice(i,i+50).join(","));u.searchParams.set("key",Y);let r=await fetch(u),d=await r.json();if(!r.ok)throw Error(JSON.stringify(d));for(let x of d.items||[])out.set(x.id,x)}return out}
function status(v){let l=v.liveStreamingDetails||{};if(l.actualStartTime&&!l.actualEndTime)return"live";if(l.scheduledStartTime&&!l.actualStartTime&&!l.actualEndTime)return"upcoming";if(l.actualEndTime)return"archive";return"video"}
function dur(x){let m=(x||"").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);return m?Number(m[1]||0)*3600+Number(m[2]||0)*60+Number(m[3]||0):null}
let ss=await db("/streamers?select=id,name,channel_id,thumbnail&enabled=eq.true");console.log("STAC YouTube Sync streamers:",ss.length);
let raw=[];for(let s of ss){try{let es=arr(await rss(s.channel_id));console.log(s.name,s.channel_id,"RSS",es.length);for(let e of es)raw.push({s,e})}catch(e){console.error(s.name,e.message)}}
let ids=[...new Set(raw.map(x=>x.e["yt:videoId"]).filter(Boolean))],vm=await details(ids),rows=[];
for(let {s,e} of raw){let id=e["yt:videoId"],v=vm.get(id);if(!v)continue;let l=v.liveStreamingDetails||{},q=v.snippet||{},st=status(v);rows.push({video_id:id,streamer_id:s.id,streamer_name:s.name,status:st,title:q.title||e.title,description:q.description||null,published_at:q.publishedAt||e.published||null,scheduled_at:l.scheduledStartTime||null,actual_start_at:l.actualStartTime||null,actual_end_at:l.actualEndTime||null,duration:dur(v.contentDetails?.duration),thumbnail:q.thumbnails?.maxres?.url||q.thumbnails?.high?.url||e["media:group"]?.["media:thumbnail"]?.["@_url"]||s.thumbnail,url:"https://www.youtube.com/watch?v="+id});if(st==="live"||st==="upcoming")console.log("LIVE/UPCOMING",s.name,s.channel_id,st,id,q.title)}
if(rows.length){let r=await fetch(R+"/videos?on_conflict=video_id",{method:"POST",headers:{...H,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)});if(!r.ok)throw Error(await r.text())}
console.log("videos upserted:",rows.length);
