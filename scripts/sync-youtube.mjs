import { XMLParser } from 'fast-xml-parser';

const env = {
  supabaseUrl: required('SUPABASE_URL'),
  serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  youtubeApiKey: required('YOUTUBE_API_KEY'),
  channelId: required('YOUTUBE_CHANNEL_ID'),
  streamerId: process.env.STREAMER_ID || 'yano-kuromu',
  streamerName: process.env.STREAMER_NAME || '夜乃くろむ'
};
function required(k){if(!process.env[k])throw new Error(`${k} が未設定です`);return process.env[k]}
const parser=new XMLParser({removeNSPrefix:true});
const iso=v=>{if(!v)return null;const d=new Date(v);return Number.isNaN(d.getTime())?null:d.toISOString()};
const hms=v=>{const m=String(v||'').match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);if(!m)return '';return [m?.[1]||0,m?.[2]||0,m?.[3]||0].map(x=>String(x).padStart(2,'0')).join(':')};

async function rss(){
  const r=await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${env.channelId}`,{headers:{'User-Agent':'STAC/1.0'}});
  if(!r.ok)throw new Error(`RSS ${r.status}`);
  const x=parser.parse(await r.text());
  const e=x.feed?.entry;const a=Array.isArray(e)?e:(e?[e]:[]);
  return a.slice(0,5).map(v=>({videoId:v.videoId,title:v.title||'',publishedAt:iso(v.published),updatedAt:iso(v.updated),description:v.group?.description||''})).filter(v=>v.videoId);
}
async function dbGet(ids){
  if(!ids.length)return [];
  const u=new URL(`${env.supabaseUrl}/rest/v1/videos`);
  u.searchParams.set('select','video_id,status,source_updated_at');
  u.searchParams.set('video_id',`in.(${ids.join(',')})`);
  const r=await fetch(u,{headers:{apikey:env.serviceRoleKey,Authorization:`Bearer ${env.serviceRoleKey}`}});
  if(!r.ok)throw new Error(`Supabase GET ${r.status}: ${await r.text()}`);
  return r.json();
}
async function yt(ids){
  if(!ids.length)return [];
  const u=new URL('https://www.googleapis.com/youtube/v3/videos');
  u.searchParams.set('part','snippet,contentDetails,liveStreamingDetails');
  u.searchParams.set('id',ids.join(','));
  u.searchParams.set('key',env.youtubeApiKey);
  const r=await fetch(u);if(!r.ok)throw new Error(`YouTube API ${r.status}: ${await r.text()}`);
  return (await r.json()).items||[];
}
function status(i){
  const b=i.snippet?.liveBroadcastContent||'none',l=i.liveStreamingDetails;
  if(b==='live')return 'live';if(b==='upcoming')return 'upcoming';if(l)return l.actualEndTime?'archive':'canceled';return 'video';
}
function row(i,r){
  const s=status(i),t=i.snippet?.thumbnails||{},l=i.liveStreamingDetails||{};
  return {video_id:i.id,streamer_id:env.streamerId,streamer_name:env.streamerName,status:s,title:i.snippet?.title||r.title||'',description:i.snippet?.description||r.description||'',published_at:iso(i.snippet?.publishedAt||r.publishedAt),scheduled_start_at:iso(l.scheduledStartTime),actual_start_at:['live','archive'].includes(s)?iso(l.actualStartTime):null,duration:hms(i.contentDetails?.duration),thumbnail:t.maxres?.url||t.standard?.url||t.high?.url||t.medium?.url||t.default?.url||'',url:`https://www.youtube.com/watch?v=${i.id}`,source:'youtube',source_updated_at:r.updatedAt,updated_at:new Date().toISOString()}
}
async function upsert(rows){
  if(!rows.length)return;
  const r=await fetch(`${env.supabaseUrl}/rest/v1/videos?on_conflict=video_id`,{method:'POST',headers:{apikey:env.serviceRoleKey,Authorization:`Bearer ${env.serviceRoleKey}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(rows)});
  if(!r.ok)throw new Error(`Supabase UPSERT ${r.status}: ${await r.text()}`);
}
async function main(){
  const feed=await rss();if(!feed.length)return console.log('RSSにデータなし');
  const old=await dbGet(feed.map(x=>x.videoId));const map=new Map(old.map(x=>[x.video_id,x]));
  const candidates=feed.filter(x=>{const o=map.get(x.videoId);return !o||o.status==='upcoming'||o.status==='live'||o.source_updated_at!==x.updatedAt});
  const items=await yt(candidates.map(x=>x.videoId));const im=new Map(items.map(x=>[x.id,x]));
  const rows=candidates.map(x=>im.has(x.videoId)?row(im.get(x.videoId),x):null).filter(Boolean);
  await upsert(rows);
  console.log(`RSS=${feed.length} API=${candidates.length} 保存=${rows.length}`);
}
main().catch(e=>{console.error(e);process.exitCode=1});
