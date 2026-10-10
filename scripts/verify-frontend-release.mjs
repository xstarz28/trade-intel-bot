#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const LEGACY = ['freebuff.com','freebuff.app','secured by freebuff','vly.ai','vly-toolbar','VLY_APP_NAME','VLY_CONVEX_AUTH_ISSUER','send_otp','email-otp','emailOtp','Sign in with email','One-time code'];
const MAX_JAVASCRIPT_ASSETS = 100;

function args(argv){ const o={dist:'dist',url:null,commit:null,branch:null}; for(let i=0;i<argv.length;i++){const a=argv[i]; if(a==='--dist')o.dist=argv[++i]; else if(a.startsWith('--dist='))o.dist=a.slice(7); else if(a==='--url')o.url=argv[++i]; else if(a.startsWith('--url='))o.url=a.slice(6); else if(a==='--expect-commit')o.commit=argv[++i]; else if(a.startsWith('--expect-commit='))o.commit=a.slice(16); else if(a==='--expect-branch')o.branch=argv[++i]; else if(a.startsWith('--expect-branch='))o.branch=a.slice(16);} return o; }
function allFiles(dir,base=dir){const out=[]; for(const e of readdirSync(dir,{withFileTypes:true})){const p=join(dir,e.name); if(e.isDirectory())out.push(...allFiles(p,base)); else if(e.isFile())out.push(p.slice(base.length+1));} return out;}
function legacyHits(text){const low=text.toLowerCase(); return LEGACY.filter(x=>low.includes(x.toLowerCase()));}
function evaluate(text,expected){const checks=[]; const add=(name,ok,detail)=>checks.push({name,ok,detail}); let info=null; try{info=JSON.parse(text.buildInfo)}catch{} add('build-info.json valid',!!info,info?'valid':'missing/invalid'); add('commit matches',!expected.commit||String(info?.commit||'').toLowerCase()===String(expected.commit).toLowerCase(),String(info?.commit||'(none)')); add('branch matches',!expected.branch||String(info?.branch||'')===expected.branch,String(info?.branch||'(none)')); add('XSTARZG brand',text.all.includes('XSTARZG'),'XSTARZG marker'); add('Google auth surface',text.all.includes('Continue with Google'),'Google marker'); add('guest auth surface',text.all.includes('Continue without an account'),'guest marker'); const hits=legacyHits(text.all); add('legacy platform/OTP surface absent',hits.length===0,hits.join(', ')||'none'); add('logo present',text.logoExists,'logo.svg'); return {ok:checks.every(x=>x.ok),checks};}
async function fetchText(url){const r=await fetch(url,{redirect:'follow'}); return {r,text:await r.text(),url:r.url||url};}

// Vite keeps lazy route components in separate chunks. Follow same-origin JS
// references so the published check examines the same code as the local build.
function javascriptReferences(text, sourceUrl, siteOrigin) {
  const found = new Set();
  const pattern = /["']((?:https?:\/\/|\/|\.{1,2}\/)[^"']*?\.js(?:\?[^"']*)?)["']/gi;
  for (const match of text.matchAll(pattern)) {
    try {
      const candidate = new URL(match[1], sourceUrl);
      if (candidate.origin !== siteOrigin || !['http:', 'https:'].includes(candidate.protocol)) continue;
      candidate.hash = '';
      found.add(candidate.href);
    } catch {}
  }
  return found;
}

async function fetchJavascriptGraph(initialUrls, siteUrl) {
  const siteOrigin = new URL(siteUrl).origin;
  const pending = [...new Set(initialUrls)];
  const discovered = new Set(pending);
  const assets = [];

  while (pending.length > 0 && assets.length < MAX_JAVASCRIPT_ASSETS) {
    const url = pending.shift();
    let asset;
    try {
      const response = await fetchText(url);
      asset = { url, ok: response.r.ok, text: response.text, status: response.r.status, finalUrl: response.url };
    } catch (error) {
      asset = { url, ok: false, text: '', status: String(error), finalUrl: url };
    }
    assets.push(asset);

    if (!asset.ok) continue;
    for (const referencedUrl of javascriptReferences(asset.text, asset.finalUrl, siteOrigin)) {
      if (discovered.has(referencedUrl)) continue;
      discovered.add(referencedUrl);
      pending.push(referencedUrl);
    }
  }

  return { assets, complete: pending.length === 0, discoveredCount: discovered.size };
}

async function main(){
  const a=args(process.argv.slice(2));
  if(!a.url){
    const d=resolve(a.dist),index=join(d,'index.html'),bi=join(d,'build-info.json');
    if(!existsSync(index)||!existsSync(bi))throw new Error('release artifact missing dist/index.html or dist/build-info.json');
    const indexText=readFileSync(index,'utf8'); let all=indexText;
    for(const f of allFiles(d)){if(/\.(js|css|html|json|svg|txt)$/i.test(f)){try{all+='\n'+readFileSync(join(d,f),'utf8')}catch{}}}
    const result=evaluate({index:indexText,buildInfo:readFileSync(bi,'utf8'),all,logoExists:existsSync(join(d,'logo.svg'))},{commit:a.commit,branch:a.branch});
    console.log(JSON.stringify(result,null,2)); if(!result.ok)process.exit(1); return;
  }

  const got=await fetchText(a.url);
  if(!got.r.ok)throw new Error('published URL returned HTTP '+got.r.status);
  const scriptUrls=[...got.text.matchAll(/<script[^>]+src=[\"']([^\"']+)[\"']/gi)].map(m=>new URL(m[1],got.url).href);
  const styleUrls=[...got.text.matchAll(/<link[^>]+href=[\"']([^\"']+\.css(?:\?[^\"']*)?)[\"']/gi)].map(m=>new URL(m[1],got.url).href);
  const uniqueScriptUrls=[...new Set(scriptUrls)];
  const uniqueStyleUrls=[...new Set(styleUrls)];
  const javascript=await fetchJavascriptGraph(uniqueScriptUrls,got.url);
  const styles=[];
  for(const url of uniqueStyleUrls){
    try{const x=await fetchText(url);styles.push({url,ok:x.r.ok,text:x.text,status:x.r.status});}
    catch(error){styles.push({url,ok:false,text:'',status:String(error)});}
  }
  const buildInfo=await fetchText(new URL('/build-info.json',got.url).href);
  const logo=await fetchText(new URL('/logo.svg',got.url).href);
  const loadedJavaScript=javascript.assets.filter(x=>x.ok).length;
  const loadedCss=styles.filter(x=>x.ok).length;
  const all=got.text+'\n'+javascript.assets.filter(x=>x.ok).map(x=>x.text).join('\n')+'\n'+styles.filter(x=>x.ok).map(x=>x.text).join('\n');
  const evaluated=evaluate({buildInfo:buildInfo.r.ok?buildInfo.text:'',all,logoExists:logo.r.ok && /<svg\b/i.test(logo.text)},{commit:a.commit,branch:a.branch});
  const checks=[
    {name:'published HTTP 200',ok:got.r.ok,detail:String(got.r.status)},
    {name:'published JavaScript asset graph loaded',ok:uniqueScriptUrls.length>0 && javascript.complete && javascript.assets.length===javascript.discoveredCount && javascript.assets.every(x=>x.ok),detail:loadedJavaScript+'/'+javascript.discoveredCount+' JavaScript asset(s)'+(javascript.complete?'':' (discovery limit reached)')},
    {name:'published CSS assets loaded',ok:uniqueStyleUrls.length>0 && loadedCss===uniqueStyleUrls.length,detail:loadedCss+'/'+uniqueStyleUrls.length},
    {name:'published build-info.json fetched',ok:buildInfo.r.ok,detail:String(buildInfo.r.status)},
    ...evaluated.checks
  ];
  const result={ok:checks.every(x=>x.ok),checks};
  console.log(JSON.stringify(result,null,2)); if(!result.ok)process.exit(1);
}
main().catch(e=>{console.error('verify frontend release:',e.message);process.exit(2);});
