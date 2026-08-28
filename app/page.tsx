"use client";

import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Config = { secretId:string; secretKey:string; bucket:string; region:string; directory:string; customDomain:string };
type UploadItem = { id:string; name:string; size:number; key:string; url:string; preview:string; status:"uploading"|"done"|"error"; progress:number; error?:string };
type CdnResult = { taskId:string; count:number; time:string };
type IconStyle = "minimal"|"clay"|"gradient"|"pixel";
type IconModel = "cogview-3-flash"|"cogView-4-250304";
type DoubaoModel = "doubao-seedream-5-0-260128"|"doubao-seedream-4-5-251128";
type ImageProvider = "zhipu"|"doubao";
type GenerationType = "icon"|"background"|"free";

const EMPTY: Config = { secretId:"", secretKey:"", bucket:"", region:"ap-guangzhou", directory:"images/{yyyy}/{MM}", customDomain:"" };
const REGIONS = [["ap-guangzhou","广州"],["ap-shanghai","上海"],["ap-beijing","北京"],["ap-chengdu","成都"],["ap-chongqing","重庆"],["ap-nanjing","南京"],["ap-hongkong","中国香港"],["ap-singapore","新加坡"],["na-siliconvalley","硅谷"]];
const ICON_STYLE_PROMPTS:Record<IconStyle,string>={minimal:"minimal flat vector icon, bold simple geometric shapes, clean edges, balanced negative space",clay:"soft 3D clay icon, rounded forms, subtle studio lighting, polished friendly appearance",gradient:"modern technology icon, vibrant gradient colors, luminous depth, clean premium finish",pixel:"crisp pixel art icon, intentional limited color palette, sharp grid-aligned edges"};

function bytes(n:number) { return n < 1024 ? `${n} B` : n < 1048576 ? `${(n/1024).toFixed(1)} KB` : `${(n/1048576).toFixed(1)} MB`; }
function directory(template:string) { const d=new Date(); return template.replaceAll("{yyyy}",`${d.getFullYear()}`).replaceAll("{MM}",`${d.getMonth()+1}`.padStart(2,"0")).replaceAll("{dd}",`${d.getDate()}`.padStart(2,"0")).replace(/^\/+|\/+$/g,""); }
function objectKey(file:File, dir:string) { const ext=file.name.includes(".") ? `.${file.name.split(".").pop()}` : ""; const stem=file.name.replace(/\.[^/.]+$/,"").replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g,"-").slice(0,40)||"image"; const prefix=directory(dir); return `${prefix?`${prefix}/`:""}${stem}-${Date.now()}-${Math.random().toString(36).slice(2,7)}${ext}`; }
function publicUrl(c:Config,key:string) { const host=`${c.bucket}.cos.${c.region}.myqcloud.com`; const custom=c.customDomain.trim(); if(!custom) return `https://${host}/${encodeURI(key)}`; if(custom.includes("{key}")) return custom.replaceAll("{key}",encodeURI(key)).replaceAll("{bucket}",c.bucket).replaceAll("{region}",c.region).replaceAll("{cosHost}",host); return `${custom.replace(/\/$/,"")}/${encodeURI(key)}`; }

export function Toolbox({activeTool}:{activeTool:"home"|"upload"|"cdn"|"icon"}) {
  const [config,setConfig]=useState<Config>(EMPTY), [draft,setDraft]=useState<Config>(EMPTY);
  const [items,setItems]=useState<UploadItem[]>([]), [settings,setSettings]=useState(false), [dragging,setDragging]=useState(false);
  const [aboutOpen,setAboutOpen]=useState(false);
  const [copied,setCopied]=useState(""), [toast,setToast]=useState(""); const input=useRef<HTMLInputElement>(null);
  const [cdnSecretId,setCdnSecretId]=useState(""), [cdnSecretKey,setCdnSecretKey]=useState(""), [cdnUrls,setCdnUrls]=useState("");
  const [cdnMode,setCdnMode]=useState<"url"|"path">("url"), [flushType,setFlushType]=useState<"flush"|"delete">("flush");
  const [cdnLoading,setCdnLoading]=useState(false), [cdnError,setCdnError]=useState(""), [cdnResult,setCdnResult]=useState<CdnResult|null>(null);
  const [imageProvider,setImageProvider]=useState<ImageProvider>("zhipu"), [zhipuKey,setZhipuKey]=useState(""), [doubaoKey,setDoubaoKey]=useState("");
  const [iconPrompt,setIconPrompt]=useState(""), [generationType,setGenerationType]=useState<GenerationType>("icon"), [iconStyle,setIconStyle]=useState<IconStyle>("minimal"), [iconBackground,setIconBackground]=useState<"transparent"|"opaque">("transparent");
  const [iconModel,setIconModel]=useState<IconModel>("cogview-3-flash"), [doubaoModel,setDoubaoModel]=useState<DoubaoModel>("doubao-seedream-5-0-260128"), [iconLoading,setIconLoading]=useState(false), [iconError,setIconError]=useState(""), [iconImage,setIconImage]=useState("");
  const ready=Boolean(config.secretId&&config.secretKey&&config.bucket&&config.region);

  useEffect(()=>{ const saved=localStorage.getItem("toolbox-cos-config"); if(saved){try{const v={...EMPTY,...JSON.parse(saved)};setConfig(v);setDraft(v)}catch{/* 配置损坏时保持未配置状态，仍可浏览工具集 */}} },[]);
  useEffect(()=>{const saved=localStorage.getItem("toolbox-cdn-credentials");if(saved){try{const value=JSON.parse(saved);setCdnSecretId(value.secretId||"");setCdnSecretKey(value.secretKey||"")}catch{/* 忽略无效本地配置 */}}},[]);
  useEffect(()=>{setZhipuKey(localStorage.getItem("toolbox-zhipu-key")||"");setDoubaoKey(localStorage.getItem("toolbox-doubao-key")||"")},[]);
  useEffect(()=>{ const paste=(e:ClipboardEvent)=>{if(activeTool!=="upload")return;const fs=Array.from(e.clipboardData?.files||[]).filter(f=>f.type.startsWith("image/"));if(fs.length) void upload(fs)};window.addEventListener("paste",paste);return()=>window.removeEventListener("paste",paste);});
  function flash(s:string){setToast(s);window.setTimeout(()=>setToast(""),2200)}
  function save(){setConfig(draft);localStorage.setItem("toolbox-cos-config",JSON.stringify(draft));setSettings(false);flash("配置已保存在当前浏览器")}
  async function upload(files:File[]){
    const images=files.filter(f=>f.type.startsWith("image/")); if(!images.length)return flash("请选择图片文件"); if(!ready){setSettings(true);return flash("请先完成 COS 配置")}
    const COS=(await import("cos-js-sdk-v5")).default; const cos=new COS({SecretId:config.secretId,SecretKey:config.secretKey});
    for(const file of images){const id=crypto.randomUUID(), key=objectKey(file,config.directory), preview=URL.createObjectURL(file);setItems(v=>[{id,name:file.name,size:file.size,key,url:"",preview,status:"uploading",progress:0},...v]);
      try{await new Promise<void>((resolve,reject)=>cos.uploadFile({Bucket:config.bucket,Region:config.region,Key:key,Body:file,SliceSize:5242880,onProgress:p=>setItems(v=>v.map(x=>x.id===id?{...x,progress:Math.round(p.percent*100)}:x))},e=>e?reject(e):resolve())); setItems(v=>v.map(x=>x.id===id?{...x,status:"done",progress:100,url:publicUrl(config,key)}:x));}
      catch(e){const error=e instanceof Error?e.message:"上传失败，请检查配置与存储桶跨域规则";setItems(v=>v.map(x=>x.id===id?{...x,status:"error",error}:x));}
    }
  }
  async function copy(item:UploadItem){await navigator.clipboard.writeText(item.url);setCopied(item.id);window.setTimeout(()=>setCopied(""),1600)}
  function pick(e:ChangeEvent<HTMLInputElement>){void upload(Array.from(e.target.files||[]));e.target.value=""}
  function drop(e:DragEvent<HTMLDivElement>){e.preventDefault();setDragging(false);void upload(Array.from(e.dataTransfer.files))}
  const parsedUrls=cdnUrls.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
  const cdnLimit=cdnMode==="url"?1000:500;
  const invalidUrls=parsedUrls.filter(value=>{try{const url=new URL(value);return url.protocol!=="http:"&&url.protocol!=="https:"}catch{return true}});
  async function purgeCdn(){
    setCdnError("");setCdnResult(null);
    if(!cdnSecretId||!cdnSecretKey)return setCdnError("请填写 SecretId 和 SecretKey");
    if(!parsedUrls.length)return setCdnError("请至少填写一个需要刷新的 URL");
    if(invalidUrls.length)return setCdnError(`有 ${invalidUrls.length} 个 URL 格式不正确`);
    if(parsedUrls.length>cdnLimit)return setCdnError(`单次最多提交 ${cdnLimit} 个${cdnMode==="url"?" URL":"目录"}`);
    setCdnLoading(true);
    try{const response=await fetch("/api/cdn/purge",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({secretId:cdnSecretId,secretKey:cdnSecretKey,values:parsedUrls,mode:cdnMode,flushType})});const data=await response.json();if(!response.ok)throw new Error(data.error||"刷新请求失败");setCdnResult({taskId:data.taskId||"已提交",count:parsedUrls.length,time:new Date().toLocaleString("zh-CN")});}
    catch(error){setCdnError(error instanceof Error?error.message:"刷新请求失败")}
    finally{setCdnLoading(false)}
  }
  async function clearSiteCache(){
    if(!window.confirm("确定清空本网站保存的配置和操作记录吗？\n不会删除腾讯云上的文件或 CDN 缓存。"))return;
    items.forEach(item=>URL.revokeObjectURL(item.preview));
    localStorage.removeItem("toolbox-cos-config");
    localStorage.removeItem("toolbox-cdn-credentials");
    localStorage.removeItem("toolbox-zhipu-key");
    localStorage.removeItem("toolbox-doubao-key");
    localStorage.removeItem("toolbox-openai-key");
    if("caches" in window){const names=await caches.keys();await Promise.all(names.map(name=>caches.delete(name)))}
    setConfig(EMPTY);setDraft(EMPTY);setItems([]);setCdnSecretId("");setCdnSecretKey("");setCdnUrls("");setCdnError("");setCdnResult(null);setZhipuKey("");setDoubaoKey("");setIconPrompt("");setIconImage("");setIconError("");setCopied("");
    flash("本地缓存已清空");
  }
  async function generateIcon(){
    setIconError("");
    const apiKey=imageProvider==="zhipu"?zhipuKey:doubaoKey;
    if(!apiKey)return setIconError(`请填写${imageProvider==="zhipu"?"智谱":"火山方舟"} API Key`);
    if(!iconPrompt.trim())return setIconError("请描述你想生成的 Icon");
    setIconLoading(true);
    try{
      const background=iconBackground==="transparent"?"isolated on a transparent-looking clean background, no shadows outside the icon":"on a simple solid-color background";
      const prompt=generationType==="icon"
        ?`请生成一个专业的正方形应用 Icon。主体：${iconPrompt.trim()}。风格：${ICON_STYLE_PROMPTS[iconStyle]}。${background}。主体居中，四周留出充足安全边距，只出现一个清晰主体，不要样机、设备边框、外围场景、水印或文字（除非描述中明确要求），缩小到 64x64 像素后仍然容易识别。`
        :generationType==="background"
          ?`请生成一张正方形抽象背景图。画面描述：${iconPrompt.trim()}。画面铺满整个画布，构图自然、过渡柔和，不要出现人物、动物、物品等明确主体，不要文字、图标、边框或水印，适合作为网页或应用背景。`
          :iconPrompt.trim();
      let response:Response|null=null;let data:{data?:Array<{url?:string;b64_json?:string}>;error?:{message?:string;code?:string}}={};
      const endpoint=imageProvider==="zhipu"?"https://open.bigmodel.cn/api/paas/v4/images/generations":"https://ark.cn-beijing.volces.com/api/v3/images/generations";
      const body=imageProvider==="zhipu"
        ?{model:iconModel,prompt,size:"1024x1024",watermark_enabled:false}
        :{model:doubaoModel,prompt,size:"2048x2048",response_format:"b64_json",watermark:false,sequential_image_generation:"disabled"};
      for(let attempt=0;attempt<3;attempt++){response=await fetch(endpoint,{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify(body)});data=await response.json();if(response.ok||(response.status!==429&&response.status<500))break;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,700*(attempt+1)))}
      if(!response?.ok)throw new Error(data.error?.message||data.error?.code||`${imageProvider==="zhipu"?"智谱":"豆包"}图像接口请求失败`);const result=data.data?.[0];const image=result?.b64_json?`data:image/png;base64,${result.b64_json}`:result?.url;if(!image)throw new Error(`${imageProvider==="zhipu"?"智谱":"豆包"}未返回图片`);setIconImage(image)
    }
    catch(error){setIconError(error instanceof Error?error.message:"Icon 生成失败")}
    finally{setIconLoading(false)}
  }
  function downloadIcon(){if(!iconImage)return;const link=document.createElement("a");link.href=iconImage;link.download=`icon-${Date.now()}.png`;link.click()}

  return <main className="app-shell">
    <header className="topbar"><div className="topbar-inner"><Link className="brand" href="/">工具集</Link><div className="header-links"><button onClick={()=>setAboutOpen(true)}>关于</button><button className="clear-cache" onClick={clearSiteCache}>清空缓存</button></div></div></header>
    <div className="workspace">
      {activeTool==="home"?<section className="content home-content"><div className="tool-list"><Link className="tool-card" href="/upload"><span className="tool-card-icon">↥</span><div><h2>图片上传</h2><p>上传图片到腾讯云 COS，支持拖拽、粘贴与自定义访问链接。</p><small>腾讯云 COS</small></div><b>进入 →</b></Link><Link className="tool-card" href="/cdn"><span className="tool-card-icon">↻</span><div><h2>CDN 刷新</h2><p>批量刷新腾讯云 CDN 的 URL 或目录缓存。</p><small>腾讯云 CDN</small></div><b>进入 →</b></Link><Link className="tool-card" href="/ai-image"><span className="tool-card-icon">✦</span><div><h2>AI 图片生成</h2><p>使用 CogView 或 Seedream 生成应用图标、抽象背景与其他图片。</p><small>智谱 · 豆包</small></div><b>进入 →</b></Link></div></section>:activeTool==="upload"?<section className="content"><div className="intro"><div><h1>图片上传</h1><p>上传图片到腾讯云 COS，并复制访问链接。</p></div><div className="intro-actions"><button className="back-home" onClick={()=>{setDraft(config);setSettings(true)}}>存储设置</button><Link className="back-home" href="/">← 返回工具集</Link></div></div>
        <div className={`dropzone ${dragging?"dragging":""}`} onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={drop} onClick={e=>e.currentTarget.focus()} tabIndex={0} aria-label="图片粘贴和拖拽区域"><input ref={input} type="file" accept="image/*" multiple onChange={pick}/><h2>{dragging?"松开即可上传":"拖拽或粘贴图片"}</h2><p>也可以从本地选择图片</p><button className="pick-button" type="button" onClick={()=>input.current?.click()}>选择图片</button></div>
        <div className="section-heading"><div><h2>最近上传</h2>{items.length>0&&<span>{items.length} 个文件</span>}</div>{items.length>0&&<button onClick={()=>setItems([])}>清空记录</button>}</div>
        {items.length===0?<div className="empty-state"><p>暂无上传记录</p></div>:<div className="upload-list">{items.map(item=><article className="upload-row" key={item.id}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={item.preview} alt=""/><div className="file-info"><b>{item.name}</b><span>{bytes(item.size)} · {item.key}</span>{item.status==="uploading"&&<div className="progress"><i style={{width:`${item.progress}%`}}/></div>}{item.status==="error"&&<em>{item.error}</em>}</div><span className={`status-pill ${item.status}`}>{item.status==="done"?"上传成功":item.status==="error"?"上传失败":`${item.progress}%`}</span>{item.status==="done"&&<div className="copy-actions"><button onClick={()=>copy(item)}>{copied===item.id?"已复制":"复制链接"}</button></div>}</article>)}</div>}
      </section>:activeTool==="cdn"?<section className="content"><div className="intro"><div><h1>CDN 刷新</h1><p>批量刷新腾讯云 CDN 节点上的 URL 缓存。</p></div><div className="intro-actions"><Link className="back-home" href="/">← 返回工具集</Link></div></div>
        <div className="cdn-grid"><section className="cdn-card"><div className="card-head"><div><h2>认证信息</h2><p>保存在当前浏览器，仅在提交刷新请求时使用。</p></div><button className="forget-key" onClick={()=>{setCdnSecretId("");setCdnSecretKey("");localStorage.removeItem("toolbox-cdn-credentials")}}>清除认证</button></div><div className="cdn-fields"><label><span>SecretId</span><input autoComplete="off" placeholder="AKID..." value={cdnSecretId} onChange={e=>{const value=e.target.value.trim();setCdnSecretId(value);localStorage.setItem("toolbox-cdn-credentials",JSON.stringify({secretId:value,secretKey:cdnSecretKey}))}}/></label><label><span>SecretKey</span><input type="password" autoComplete="new-password" placeholder="请输入 SecretKey" value={cdnSecretKey} onChange={e=>{const value=e.target.value.trim();setCdnSecretKey(value);localStorage.setItem("toolbox-cdn-credentials",JSON.stringify({secretId:cdnSecretId,secretKey:value}))}}/></label></div></section>
          <section className="cdn-card urls-card"><div className="mode-tabs"><button className={cdnMode==="url"?"active":""} onClick={()=>{setCdnMode("url");setCdnResult(null);setCdnError("")}}>URL 刷新</button><button className={cdnMode==="path"?"active":""} onClick={()=>{setCdnMode("path");setCdnResult(null);setCdnError("")}}>目录刷新</button></div>{cdnMode==="path"&&<div className="flush-options"><span>刷新方式</span><label><input type="radio" checked={flushType==="flush"} onChange={()=>setFlushType("flush")}/><b>刷新变更资源</b></label><label><input type="radio" checked={flushType==="delete"} onChange={()=>setFlushType("delete")}/><b>刷新全部资源</b></label></div>}<div className="card-head url-head"><div><h2>{cdnMode==="url"?"刷新 URL":"刷新目录"}</h2><p>每行一个完整地址，单次最多 {cdnLimit} 条。</p></div><span className={invalidUrls.length?"count invalid":"count"}>{parsedUrls.length} / {cdnLimit}</span></div><textarea placeholder={cdnMode==="url"?"https://cdn.example.com/assets/app.js\nhttps://cdn.example.com/images/logo.png":"https://cdn.example.com/assets/\nhttps://cdn.example.com/images/"} value={cdnUrls} onChange={e=>setCdnUrls(e.target.value)}/>{cdnError&&<div className="cdn-message error">{cdnError}</div>}{cdnResult&&<div className="cdn-message success"><b>刷新任务已提交</b><span>任务 ID：{cdnResult.taskId} · {cdnResult.count} 个{cdnMode==="url"?" URL":"目录"} · {cdnResult.time}</span></div>}<div className="cdn-actions"><button className="clear-urls" onClick={()=>{setCdnUrls("");setCdnError("");setCdnResult(null)}} disabled={!cdnUrls}>清空</button><button className="purge-button" onClick={purgeCdn} disabled={cdnLoading||!parsedUrls.length}>{cdnLoading?"正在提交…":"提交刷新"}</button></div></section></div>
      </section>:<section className="content"><div className="intro"><div><h1>AI 图片生成器</h1><p>使用 CogView 或 Seedream 生成应用图标、抽象背景和其他图片。</p></div><div className="intro-actions"><Link className="back-home" href="/">← 返回工具集</Link></div></div><div className="icon-layout"><section className="cdn-card icon-form"><div className="card-head"><div><h2>{imageProvider==="zhipu"?"智谱认证":"火山方舟认证"}</h2><p>API Key 保存在当前浏览器。</p></div><button className="forget-key" onClick={()=>{if(imageProvider==="zhipu"){setZhipuKey("");localStorage.removeItem("toolbox-zhipu-key")}else{setDoubaoKey("");localStorage.removeItem("toolbox-doubao-key")}}}>清除认证</button></div><label className="wide-field"><span>{imageProvider==="zhipu"?"智谱 API Key":"火山方舟 API Key"}</span><input type="password" autoComplete="new-password" placeholder={imageProvider==="zhipu"?"请输入智谱 API Key":"请输入火山方舟 API Key"} value={imageProvider==="zhipu"?zhipuKey:doubaoKey} onChange={e=>{const value=e.target.value.trim();if(imageProvider==="zhipu"){setZhipuKey(value);localStorage.setItem("toolbox-zhipu-key",value)}else{setDoubaoKey(value);localStorage.setItem("toolbox-doubao-key",value)}}}/></label><label className="wide-field prompt-field"><span>{generationType==="icon"?"描述你的 Icon":generationType==="background"?"描述背景的颜色与质感":"描述你想生成的图片"}</span><textarea placeholder={generationType==="icon"?"例如：一只戴着黄色安全帽的橙色小猫，简洁的软件应用图标":generationType==="background"?"例如：浅青蓝与薄荷绿交融的柔和流体渐变，云雾质感，低饱和度":"直接输入完整的图片描述"} value={iconPrompt} onChange={e=>setIconPrompt(e.target.value)}/></label><div className="icon-options"><label><span>服务商</span><select value={imageProvider} onChange={e=>{setImageProvider(e.target.value as ImageProvider);setIconError("");setIconImage("")}}><option value="zhipu">智谱 CogView</option><option value="doubao">豆包 Seedream</option></select></label><label><span>生成类型</span><select value={generationType} onChange={e=>{setGenerationType(e.target.value as GenerationType);setIconError("")}}><option value="icon">应用 Icon</option><option value="background">抽象背景</option><option value="free">自由生成</option></select></label>{generationType==="icon"&&<><label><span>风格</span><select value={iconStyle} onChange={e=>setIconStyle(e.target.value as IconStyle)}><option value="minimal">极简扁平</option><option value="clay">3D 黏土</option><option value="gradient">渐变科技</option><option value="pixel">像素艺术</option></select></label><label><span>背景</span><select value={iconBackground} onChange={e=>setIconBackground(e.target.value as "transparent"|"opaque")}><option value="transparent">透明感背景</option><option value="opaque">纯色背景</option></select></label></>}<label><span>模型</span>{imageProvider==="zhipu"?<select value={iconModel} onChange={e=>setIconModel(e.target.value as IconModel)}><option value="cogview-3-flash">免费 · CogView-3 Flash</option><option value="cogView-4-250304">高质量 · CogView-4</option></select>:<select value={doubaoModel} onChange={e=>setDoubaoModel(e.target.value as DoubaoModel)}><option value="doubao-seedream-5-0-260128">Seedream 5.0 Lite</option><option value="doubao-seedream-4-5-251128">Seedream 4.5</option></select>}</label></div>{iconError&&<div className="cdn-message error">{iconError}</div>}<button className="generate-button" onClick={generateIcon} disabled={iconLoading||!iconPrompt.trim()}>{iconLoading?"AI 正在绘制…":generationType==="icon"?"生成 Icon":"生成图片"}</button></section><section className="icon-preview">{iconImage?<><img src={iconImage} alt="AI 生成结果"/><button onClick={downloadIcon}>下载 PNG</button></>:<div><span>✦</span><b>生成结果将在这里显示</b><p>{generationType==="icon"?"建议使用明确的主体、颜色和风格描述。":generationType==="background"?"建议描述配色、渐变方向、光感和质感。":"描述越具体，生成结果越可控。"}</p></div>}</section></div></section>}
    </div>
    {settings&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSettings(false)}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="modal-head"><div><p className="eyebrow">TENCENT CLOUD COS</p><h2 id="settings-title">连接你的云存储</h2><span>填入腾讯云 COS 信息后即可开始上传</span></div><button className="close" aria-label="关闭" onClick={()=>setSettings(false)}>×</button></div><div className="security-tip"><span>⌁</span><p><b>安全提示</b><br/>配置仅保存在当前浏览器。建议使用仅具有指定目录读写权限的子账号密钥，并为存储桶配置允许 PUT 的跨域规则。</p></div><div className="form-grid">
      <label><span>SecretId</span><input autoComplete="off" placeholder="AKID..." value={draft.secretId} onChange={e=>setDraft({...draft,secretId:e.target.value.trim()})}/></label><label><span>SecretKey</span><input type="password" autoComplete="new-password" placeholder="请输入 SecretKey" value={draft.secretKey} onChange={e=>setDraft({...draft,secretKey:e.target.value.trim()})}/></label><label><span>存储桶 Bucket</span><input placeholder="example-1250000000" value={draft.bucket} onChange={e=>setDraft({...draft,bucket:e.target.value.trim()})}/></label><label><span>所属地域 Region</span><select value={draft.region} onChange={e=>setDraft({...draft,region:e.target.value})}>{REGIONS.map(([v,l])=><option key={v} value={v}>{l} · {v}</option>)}</select></label><label><span>上传目录</span><input placeholder="images/{yyyy}/{MM}" value={draft.directory} onChange={e=>setDraft({...draft,directory:e.target.value})}/><small>支持日期变量：{`{yyyy}`}、{`{MM}`}、{`{dd}`}</small></label><label><span>自定义访问链接 <em>可选</em></span><input placeholder="https://img.example.com/{key}" value={draft.customDomain} onChange={e=>setDraft({...draft,customDomain:e.target.value})}/><small>可用变量：{`{key}`}、{`{bucket}`}、{`{region}`}、{`{cosHost}`}</small></label></div><div className="modal-actions"><button className="save" disabled={!draft.secretId||!draft.secretKey||!draft.bucket||!draft.region} onClick={save}>保存配置并开始使用</button><button className="clear" onClick={()=>setDraft(EMPTY)}>清空</button></div></section></div>}
    {aboutOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setAboutOpen(false)}}><section className="modal about-modal" role="dialog" aria-modal="true" aria-labelledby="about-title"><div className="modal-head"><div><h2 id="about-title">关于工具集</h2><span>为日常工作而生的小工具</span></div><button className="close" aria-label="关闭" onClick={()=>setAboutOpen(false)}>×</button></div><div className="about-copy"><p>本站源于我在日常工作中遇到的实际需求，用来收纳一些简单、直接、能够提高效率的小工具。</p><p>本站不会建立用户账户，也不会收集、分析或出售你的个人信息。云服务配置、认证信息和操作记录仅保存在当前浏览器中，你可以随时通过右上角的“清空缓存”删除。</p><p>图片上传与 AI 绘图由浏览器直接请求对应云服务；CDN 刷新凭证仅随当次请求使用。本站不会将认证信息写入数据库或留作其他用途。</p></div><button className="about-close" onClick={()=>setAboutOpen(false)}>知道了</button></section></div>}
    {toast&&<div className="toast">✓ {toast}</div>}
  </main>
}

export default function Home(){return <Toolbox activeTool="home"/>}
