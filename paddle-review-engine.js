/* JohnKew Pickleball -- shared Written Paddle Review engine.
   ============================================================
   Hosted once here, loaded by every per-paddle Squarespace Code Block via:
     <script src="https://johnkewpickleball-dev.github.io/paddle-database/paddle-review-engine.js"></script>
   Reuses the exact chart-generator logic from paddle-comparison-lab.html
   (radarSVG, bulletSVG, surfaceSVG, feelCol, gaugeSVG) against the same live
   Google Sheets. Each Squarespace page calls JKPaddleReview.init({...}) with
   just its own paddle key + review text -- see any "* - Squarespace Code
   Block.html" file in the Videos folders for a real example of that call.

   Editing this file updates every published review page at once (after a
   git push) -- it's the one piece of this workflow that still goes through
   GitHub. Ongoing edits to review TEXT never need to touch this file or git
   at all; that happens entirely in each page's own Code Block in Squarespace.
*/
window.JKPaddleReview = (function(){
  'use strict';


  /* ================= data sources (same sheets the live site reads) ================= */
  var CSV_URL='https://docs.google.com/spreadsheets/d/e/2PACX-1vSxXXe0qvh94nPoU20S7OSp8yw9tHF4f4VpfNH_fneBhKSSOxvvrQ9lPGwgcNa_OS9OuWTZzaDyZWiZ/pub?gid=575894669&single=true&output=csv';
  var FEEL_CSV='https://docs.google.com/spreadsheets/d/1QEAK3G59VBq4uYIh73fqc59fbdbZiqo-8uIfrf4qACI/gviz/tq?tqx=out:csv';
  var SURFACE_CSV='https://docs.google.com/spreadsheets/d/1yUySVb0Vex9qWq5pxspFy9eJoa1OEfWzVl-x-sCKBkw/gviz/tq?tqx=out:csv';
  var PHOTO_BASE='https://johnkewpickleball-dev.github.io/paddle-database/images/';
  var AUTHOR_PHOTO=PHOTO_BASE+'john-kew-author.png';
  var REVIEW_IMG_BASE='https://johnkewpickleball-dev.github.io/paddle-database/images/written-reviews/';
  var LAB_URL='https://www.johnkewpickleball.com/paddle-comparison-lab';
  var COMPARE_ICON_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3c2.2 0 4 1.8 4 4v5a4 4 0 0 1-4 4 4 4 0 0 1-4-4V7c0-2.2 1.8-4 4-4Z"></path><path d="M7 16v5"></path><path d="M17 3c2.2 0 4 1.8 4 4v5a4 4 0 0 1-4 4 4 4 0 0 1-4-4V7c0-2.2 1.8-4 4-4Z"></path><path d="M17 16v5"></path></svg>';
  var PHOTO_URLS={};
  var XRAY_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11.2" fill="#facc15" stroke="#0f172a" stroke-width="1.1"/><path d="M12,9.4 L16.08,3.64 A9.3,9.3 0 0 1 7.92,3.64 Z" fill="#0f172a"/><path d="M9.75,13.3 L2.72,12.65 A9.3,9.3 0 0 1 6.8,19.71 Z" fill="#0f172a"/><path d="M14.25,13.3 L17.2,19.71 A9.3,9.3 0 0 1 21.28,12.65 Z" fill="#0f172a"/><circle cx="12" cy="12" r="2.1" fill="#0f172a"/></svg>';

  function copyCode(btn, code){
    var orig = btn.getAttribute('data-orig');
    if(orig==null){ orig = btn.textContent; btn.setAttribute('data-orig', orig); }
    function done(ok){
      btn.textContent = ok ? 'Copied!' : 'Copy failed';
      setTimeout(function(){ btn.textContent = btn.getAttribute('data-orig'); }, 1800);
    }
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(code).then(function(){done(true);}, function(){done(false);});
    } else { done(false); }
  }

  function toggleXray(){
    var inner=document.getElementById('prPhotoFlip');
    var badge=document.getElementById('prXrayBadge');
    if(!inner) return;
    var on=inner.classList.toggle('flipped');
    if(badge){ badge.classList.toggle('active', on); }
  }

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  // [[IMAGE: url]] or [[IMAGE: url | caption]] anywhere inside a prose field becomes an inline
  // figure. Applied uniformly to every prose field at render time, so it works the same way
  // whether the text came from an inline review:{} object or a review Doc.
  function renderImageMarkers(html){
    if(!html) return html;
    return String(html).replace(/\[\[\s*IMAGE:\s*([^|\]]+?)\s*(?:\|\s*([^\]]+?)\s*)?\]\]/gi, function(m, url, cap){
      url = url.trim();
      return '<figure class="pr-inline-img"><img src="'+esc(url)+'" alt="'+esc(cap||'')+'" loading="lazy">'
        + (cap ? ('<figcaption>'+esc(cap)+'</figcaption>') : '') + '</figure>';
    });
  }
  // Turns a prose field into one <p> per paragraph instead of one giant block. A field with no
  // blank-line breaks in it (single-paragraph inline review:{} text, e.g.) still renders as a
  // single <p>, so this is a no-op for older content -- only fields that actually contain a
  // paragraph break (\n\n, from a Doc's blank lines or a manually-inserted one in inline text)
  // get split. Each paragraph runs through renderImageMarkers independently.
  function proseHtml(text){
    if(!text) return '';
    return String(text).split(/\n{2,}/).map(function(p){ return p.trim(); }).filter(Boolean)
      .map(function(p){ return '<p>'+renderImageMarkers(p)+'</p>'; }).join('');
  }
  // Full-review video block: paste any standard YouTube URL, thumbnail + link are derived.
  function ytVideoId(url){
    if(!url) return null;
    var m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/i);
    return m ? m[1] : null;
  }
  function fmt(v,d){return v==null?'—':Number(v).toFixed(d==null?1:d);}
  function fmtInt(v){return v==null?'—':Math.round(v).toLocaleString();}
  function money(v){return v==null?'—':'$'+Number(v).toFixed(2);}
  function photoSlug(p){ return (p.company+'-'+p.paddle).toLowerCase().replace(/\+/g,'-plus').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,''); }
  function hostedURL(p){ return PHOTO_BASE + photoSlug(p) + '.png'; }
  function hostedURLJpg(p){ return PHOTO_BASE + photoSlug(p) + '.jpg'; }
  function photoCandidates(p){ var c=[]; if(PHOTO_URLS[p.key]) c.push(PHOTO_URLS[p.key]); else { c.push(hostedURL(p)); c.push(hostedURLJpg(p)); } return c; }

  /* ================= column mapping + row parsing (verbatim from comparison lab) ================= */
  var M = {
    company:['company','brand'], paddle:['paddle','model','name'],
    shape:['shape'], build:['build','buildgeneration','generation'],
    process:['manufacturingprocess','process','manufacturing'],
    spinCategory:['spincategory','spinrating'], spinDurTier:['spindurabilitytier','spindurability','durabilitytier'],
    cert:['certificationstatus','certification','cert'], condition:['condition'], dateEntered:['dateentered','dateadded','entrydate','added'],
    warranty:['warranty'], surfaceTexture:['surfacetexture','texture'],
    surfaceLayup:['surfacelayup','layup'], coreType:['coretype','core'],
    thickness:['corethicknessmm','corethickness','thickness'],
    spinRPM:['spinrpm','rpm'], serveSpeed:['servespeedmphpower','servespeed','servemph'],
    punchVolley:['punchvolleyspeedmphpop','punchvolley','volley'],
    firepower:['firepower'], swingResist:['handspeedindex0100','handspeedindex','swingresistance0100','swingresistance','swingresist'],
    kewcor:['kewcor'],
    length:['lengthin','length'], width:['widthin','width'], handleLength:['handlelengthin','handlelength'],
    weight:['staticweightoz','staticweight','weight'], swingWeight:['swingweight'],
    twistWeight:['twistweight'], balance:['balancepointcm','balancepoint','balance'],
    price:['retailprice','price'], discountedPrice:['discountedprice','saleprice'],
    discount:['discount'], discountCode:['discountcode','code'], link:['linktopurchase','link','url'],
    spinScaled:['spinscaledzscore','spinscaled'], powerScaled:['powerscaledzscore','powerscaled'],
    popScaled:['popscaledzscore','popscaled'], swingScaled:['swingscaledzscore','swingscaled'],
    twistScaled:['twistscaledzscore','twistscaled'], balanceScaled:['balancescaledzscore','balancescaled'],
    spinZ:['spinzscore'], powerZ:['powerzscore'], popZ:['popzscore'],
    swingZ:['swingweightzscore'], twistZ:['twistweightzscore'], balanceZ:['balancepointzscore']
  };
  var TEXT={company:1,paddle:1,shape:1,build:1,process:1,spinCategory:1,spinDurTier:1,cert:1,condition:1,warranty:1,surfaceTexture:1,surfaceLayup:1,coreType:1,discountCode:1,link:1,dateEntered:1};
  function norm(h){return String(h).toLowerCase().replace(/[^a-z0-9]/g,'');}
  function num(v){ if(v==null) return null; var x=String(v).replace(/[^0-9.\-]/g,''); if(x===''||x==='-'||x==='.') return null; var n=parseFloat(x); return isNaN(n)?null:n; }
  function buildColMap(headers){
    var nh=headers.map(norm), map={}, used={};
    nh.forEach(function(n,i){ if(used[i])return; for(var f in M){ if(map[f]!=null)continue; if(M[f].indexOf(n)>-1){map[f]=i;used[i]=1;break;} } });
    nh.forEach(function(n,i){ if(used[i])return; for(var f in M){ if(map[f]!=null)continue; if(M[f].some(function(a){return n.indexOf(a)===0||a.indexOf(n)===0;})){map[f]=i;used[i]=1;break;} } });
    return map;
  }
  function parseRows(rows){
    var head=rows[0], map=buildColMap(head);
    var g=function(row,f){ return map[f]!=null ? (row[map[f]]||'').trim() : ''; };
    return rows.slice(1).map(function(row){
      var o={};
      for(var f in M){ var raw=g(row,f); o[f]= TEXT[f]? raw : num(raw); o[f+'_raw']=raw; }
      o.discountRaw=g(row,'discount');
      o.discountType=/%/.test(o.discountRaw)?'pct':(/[\$\d]/.test(o.discountRaw)?'usd':null);
      o.key=o.company+'||'+o.paddle;
      return o;
    }).filter(function(p){return p.company && p.paddle;});
  }
  function pricing(p){
    var price=p.price, isSelkirk=!!(p.company && p.company.toLowerCase().indexOf('selkirk')>-1);
    if(isSelkirk){ var g=price?(price>300?40:price>200?30:price>100?20:price>50?10:0):0;
      return {isSelkirk:true,finalPrice:price,savedAmt:0,giftCard:g,hasDiscount:!!(p.discountCode&&g>0),label:g>0?('Receive $'+g+' digital gift card'):''}; }
    if(!price) return {isSelkirk:false,finalPrice:price,savedAmt:0,giftCard:0,hasDiscount:false,label:''};
    var finalPrice=price,saved=0,label='';
    var dp=p.discountedPrice;
    if(dp!=null && dp>0 && dp<price-0.005){ finalPrice=dp; saved=price-dp; label='Save '+money(saved); }
    else { var d=p.discount, t=p.discountType||(d!=null&&d<1?'pct':'usd');
      if(d!=null&&d>0){ if(t==='pct'){var f=d<1?d:d/100; saved=price*f; finalPrice=price-saved; label=Math.round(f*100)+'% off';}
        else { saved=d; finalPrice=price-saved; label='Save '+money(saved); } } }
    if(saved<0.005){finalPrice=price;saved=0;label='';}
    return {isSelkirk:false,finalPrice:finalPrice,savedAmt:saved,giftCard:0,hasDiscount:!!(p.discountCode&&saved>0.005),label:label};
  }
  function spinBadge(c){return c?'<span class="badge badge-spin-'+esc(c)+'" title="Spin Category">'+esc(c)+' Spin</span>':'';}
  function certBadge(c){ if(!c||c==='None')return ''; var s=''; if(c.indexOf('Dual')>-1)s='Dual Cert'; else if(c.indexOf('USAP')>-1)s='USAP'; else if(c.indexOf('UPA-A')>-1)s='UPA-A'; else return ''; return '<span class="badge badge-cert" title="Certification Status">'+s+'</span>'; }
  function durTierBadge(p){ var t=(p.spinDurTier||'').trim(); if(!t) return ''; var m=t.match(/[1-4]/); var cls=m?('badge-tier-'+m[0]):''; var label=m?('Spin Tier '+m[0]):esc(t); return '<span class="badge badge-tier '+cls+'">'+label+'</span>'; }

  /* ================= radar (verbatim) ================= */
  var AX=[
    {key:'twistScaled', label:'Twist Weight', ang:0},
    {key:'spinScaled',  label:'Spin',         ang:60},
    {key:'powerScaled', label:'Power',        ang:120},
    {key:'popScaled',   label:'Pop',          ang:180},
    {key:'swingScaled', label:'Swing Weight', ang:240},
    {key:'balanceScaled',label:'Balance Point',ang:300}
  ];
  var RW=320, RH=300, RCX=160, RCY=150, RR=92;
  function pt(ang,rad){ var a=ang*Math.PI/180; return [RCX+rad*Math.cos(a), RCY-rad*Math.sin(a)]; }
  function radarSVG(p){
    var lines='', labels='', target=[];
    [[0,180],[60,240],[120,300]].forEach(function(pr){
      var a=pt(pr[0],RR), b=pt(pr[1],RR);
      lines+='<line class="ax-line" x1="'+a[0].toFixed(1)+'" y1="'+a[1].toFixed(1)+'" x2="'+b[0].toFixed(1)+'" y2="'+b[1].toFixed(1)+'"/>';
    });
    AX.forEach(function(ax){
      var v=Math.max(0,Math.min(100, p[ax.key]==null?0:p[ax.key]));
      var tp=pt(ax.ang, RR*v/100); target.push(tp[0].toFixed(1)+','+tp[1].toFixed(1));
      var lp=pt(ax.ang, RR+16), c=Math.cos(ax.ang*Math.PI/180);
      var anchor = c>0.3?'start':(c<-0.3?'end':'middle');
      var words=ax.label.split(' '), ty=lp[1];
      if(words.length>1){
        labels+='<text class="ax-label" x="'+lp[0].toFixed(1)+'" y="'+(ty-6).toFixed(1)+'" text-anchor="'+anchor+'">'
              + esc(words[0])+'</text><text class="ax-label" x="'+lp[0].toFixed(1)+'" y="'+(ty+8).toFixed(1)+'" text-anchor="'+anchor+'">'+esc(words.slice(1).join(' '))+'</text>';
      } else {
        labels+='<text class="ax-label" x="'+lp[0].toFixed(1)+'" y="'+(ty+4).toFixed(1)+'" text-anchor="'+anchor+'">'+esc(ax.label)+'</text>';
      }
    });
    return '<svg viewBox="0 0 '+RW+' '+RH+'" preserveAspectRatio="xMidYMid meet" class="pcl-radar">'
      + lines + '<polygon class="radar-fill" points="'+target.join(' ')+'"></polygon>' + labels + '</svg>';
  }
  function radarLegend(p){
    return AX.map(function(ax){var v=p[ax.key];return ax.label+' <b>'+(v==null?'—':Math.round(v))+'</b>';}).join(' · ');
  }

  /* ================= bullet chart (verbatim, static — no scroll animation needed here) ================= */
  var BULLET=[
    {label:'Power',        key:'powerZ',   lo:-2.51, hi:2.03},
    {label:'Pop',          key:'popZ',     lo:-3.01, hi:1.87},
    {label:'Spin',         key:'spinZ',    lo:-3.64, hi:1.65},
    {label:'Twist Weight', key:'twistZ',   lo:-3.56, hi:2.62},
    {label:'Swing Weight', key:'swingZ',   lo:-3.39, hi:3.50},
    {label:'Balance Pt.',  key:'balanceZ', lo:-3.21, hi:3.54}
  ];
  var BMIN=-4, BMAX=4, BX0=92, BX1=292, BTOP=26, BROW=34, BBARH=16;
  function bx(v){ if(v<BMIN)v=BMIN; if(v>BMAX)v=BMAX; return BX0+(v-BMIN)/(BMAX-BMIN)*(BX1-BX0); }
  function bulletSVG(p){
    var grid='', rows='', labels='', v;
    for(v=BMIN; v<=BMAX; v++){ var gx=bx(v).toFixed(1);
      grid+='<line x1="'+gx+'" y1="16" x2="'+gx+'" y2="210" stroke="'+(v===0?'#cbd5e1':'#edf1f6')+'" stroke-width="1"/>';
      labels+='<text x="'+gx+'" y="226" text-anchor="middle" font-size="9" fill="#94a3b8">'+v+'</text>';
    }
    BULLET.forEach(function(m,i){
      var cy=BTOP+i*BROW, yt=cy-BBARH/2, seg=(m.hi-m.lo)/3;
      var xlo=bx(m.lo), xa=bx(m.lo+seg), xb=bx(m.lo+2*seg), xhi=bx(m.hi);
      rows+='<rect x="'+xlo.toFixed(1)+'" y="'+yt+'" width="'+(xa-xlo).toFixed(1)+'" height="'+BBARH+'" fill="#2d9cdb" rx="'+(BBARH/2)+'"/>'
        + '<rect x="'+xa.toFixed(1)+'" y="'+yt+'" width="'+(xb-xa).toFixed(1)+'" height="'+BBARH+'" fill="#27ae60"/>'
        + '<rect x="'+xb.toFixed(1)+'" y="'+yt+'" width="'+(xhi-xb).toFixed(1)+'" height="'+BBARH+'" fill="#eb5757" rx="'+(BBARH/2)+'"/>';
      labels+='<text x="86" y="'+(cy+4)+'" text-anchor="end" font-size="11" font-weight="600" fill="#0d1f2d">'+esc(m.label)+'</text>';
      var z=p[m.key];
      if(z!=null && !isNaN(z)){
        var dx=bx(z), s=5.5;
        rows+='<g transform="translate('+dx.toFixed(1)+','+cy+')">'
          + '<polygon points="0,'+(-s)+' '+s+',0 0,'+s+' '+(-s)+',0" fill="#0d1f2d" stroke="#fff" stroke-width="1.2"/>'
          + '<text x="0" y="'+(-s-3)+'" text-anchor="middle" font-size="9.5" font-weight="700" fill="#0d1f2d" stroke="#fff" stroke-width="2.6" paint-order="stroke">'+(Math.round(z*100)/100).toFixed(2)+'</text>'
          + '</g>';
      }
    });
    var axis='<line x1="'+BX0+'" y1="214" x2="'+BX1+'" y2="214" stroke="#cbd5e1" stroke-width="1"/>';
    var leg='<g font-size="10" fill="#0d1f2d">'
      + '<rect x="64" y="248" width="12" height="12" rx="2" fill="#2d9cdb"/><text x="80" y="258">Low</text>'
      + '<rect x="120" y="248" width="12" height="12" rx="2" fill="#27ae60"/><text x="136" y="258">Medium</text>'
      + '<rect x="196" y="248" width="12" height="12" rx="2" fill="#eb5757"/><text x="212" y="258">High</text>'
      + '</g>';
    return '<svg viewBox="0 0 300 288" preserveAspectRatio="xMidYMid meet" font-family="\'DM Sans\',sans-serif">'+grid+rows+labels+axis+leg+'</svg>';
  }

  /* ================= KewCOR gauge (verbatim, single gauge) ================= */
  function gClamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
  function gFrac(v,min,max){ return gClamp((v-min)/(max-min),0,1); }
  function gAngle(frac){ return 180-180*frac; }
  function gPolar(cx,cy,r,angDeg){ var rad=angDeg*Math.PI/180; return [cx+r*Math.cos(rad), cy-r*Math.sin(rad)]; }
  function gBandPath(cx,cy,rO,rI,fracA,fracB){
    var aA=gAngle(fracA), aB=gAngle(fracB);
    var oA=gPolar(cx,cy,rO,aA), oB=gPolar(cx,cy,rO,aB);
    var iB=gPolar(cx,cy,rI,aB), iA=gPolar(cx,cy,rI,aA);
    var large=(aA-aB)>180?1:0;
    return 'M'+oA[0].toFixed(2)+' '+oA[1].toFixed(2)
      +' A'+rO+' '+rO+' 0 '+large+' 1 '+oB[0].toFixed(2)+' '+oB[1].toFixed(2)
      +' L'+iB[0].toFixed(2)+' '+iB[1].toFixed(2)
      +' A'+rI+' '+rI+' 0 '+large+' 0 '+iA[0].toFixed(2)+' '+iA[1].toFixed(2)+' Z';
  }
  var KEWCOR_BANDS=[{a:0.340,b:0.370,cls:'blue'},{a:0.370,b:0.400,cls:'teal'},{a:0.400,b:0.447,cls:'orange'},{a:0.447,b:0.470,cls:'red'}];
  var GCOLOR={blue:'#2563eb',teal:'#0d9488',orange:'#d97706',red:'#dc2626'};
  function kewcorCat(v){ if(v==null) return null; if(v<0.370) return {label:'Control',cls:'blue'}; if(v<0.400) return {label:'All-Court',cls:'teal'}; if(v<0.447) return {label:'Power',cls:'orange'}; return {label:'Beyond Spec',cls:'red'}; }
  function gaugeSVG(value,min,max,bands,cat,decimals){
    var cx=100,cy=100,rO=88,rI=63;
    var minLbl='<text class="gtick" x="'+(cx-rO+2)+'" y="'+(cy+15)+'" text-anchor="start">'+min.toFixed(decimals)+'</text>';
    var maxLbl='<text class="gtick" x="'+(cx+rO-2)+'" y="'+(cy+15)+'" text-anchor="end">'+max.toFixed(decimals)+'</text>';
    if(value==null){
      var grayBands=bands.map(function(bd){ return '<path fill="var(--border)" d="'+gBandPath(cx,cy,rO,rI,gFrac(bd.a,min,max),gFrac(bd.b,min,max))+'"/>'; }).join('');
      return '<svg class="pcl-gauge-svg" viewBox="0 0 200 158" preserveAspectRatio="xMidYMid meet">'+grayBands+minLbl+maxLbl+'<text x="100" y="132" text-anchor="middle" font-size="11" fill="var(--muted)">Not available</text></svg>';
    }
    var bandsSVG=bands.map(function(bd){ return '<path class="gband-'+bd.cls+'" d="'+gBandPath(cx,cy,rO,rI,gFrac(bd.a,min,max),gFrac(bd.b,min,max))+'"/>'; }).join('');
    var clamped=gClamp(value,min,max), frac=gFrac(clamped,min,max), needleLen=rO-8;
    var needle='<g transform="rotate('+ (180*frac) +' '+cx+' '+cy+')"><polygon class="gneedle" points="'+cx+','+(cy-4)+' '+(cx-needleLen)+','+cy+' '+cx+','+(cy+4)+'"/></g>';
    var hub='<circle class="ghub" cx="'+cx+'" cy="'+cy+'" r="7"/>';
    var valueTxt='<text class="gnum" x="'+cx+'" y="'+(cy+38)+'" text-anchor="middle" fill="'+(cat?GCOLOR[cat.cls]:'var(--text)')+'">'+value.toFixed(decimals)+'</text>';
    var catTxt=cat?'<text class="gcat" x="'+cx+'" y="'+(cy+53)+'" text-anchor="middle" fill="'+GCOLOR[cat.cls]+'">'+esc(cat.label)+'</text>':'';
    return '<svg class="pcl-gauge-svg" viewBox="0 0 200 158" preserveAspectRatio="xMidYMid meet">'+bandsSVG+needle+hub+minLbl+maxLbl+valueTxt+catTxt+'</svg>';
  }

  /* ================= KewCOR surface curve (verbatim) ================= */
  var SURFACE_MAP={};
  var SURFACE_OVERRIDE={};
  var SURFACE_EXCLUDE={'Vatic Pro||V-Sol Pro Bloom':1};
  var S_ALI={addias:'adidas',aiero:'aireo',babalot:'babolat',falcolos:'facolos',packle:'pakle',franlkin:'franklin'};
  var S_SYN={wb:'widebody',el:'elongated',elong:'elongated',hyb:'hybrid',std:'standard',blak:'black',paris:'pariss'};
  var S_GEN={pro:1,power:1,'new':1,solid:1,foam:1,full:1,paddle:1,co:1,company:1,pickleball:1,the:1,of:1,and:1,b:1,w:1,c:1,t:1,s:1,v:1,x:1,e:1,'16':1,'14':1,'13':1,'15':1,'18':1,'19':1,'10':1};
  function sAlias(s){ s=String(s).toLowerCase(); for(var a in S_ALI) s=s.split(a).join(S_ALI[a]); return s; }
  function sToks(s){ s=sAlias(s).replace(/\d+(\.\d+)?\s*mm/g,'').replace(/\+/g,' plus ').replace(/[^a-z0-9 ]/g,' '); return s.split(/\s+/).filter(Boolean).map(function(w){return S_SYN[w]||w;}); }
  function sBrand(c){ return sAlias(c).replace(/[^a-z0-9]/g,''); }
  function sTh(s){ var m=sAlias(s).match(/(\d+(?:\.\d+)?)\s*mm/); return m?parseFloat(m[1]):null; }
  function parseSurfaceRows(rows){
    var head=rows[0], ir=rows.slice(1), out=[]; if(!head) return out;
    for(var c=1;c<head.length;c++){ var nm=(head[c]||'').trim(); if(!nm) continue; var pts=[];
      for(var r=0;r<ir.length;r++){ var lab=(ir[r][0]||'').trim(); var m=lab.match(/(\d+)/); if(!m) continue; var v=(ir[r][c]||'').trim(); if(v===''){continue;} var fl=parseFloat(v); if(!isNaN(fl)) pts.push([+m[1],Math.round(fl*10000)/10000]); }
      if(pts.length) out.push({name:nm,pts:pts}); }
    return out;
  }
  function buildSurfaceMap(curves, PADDLES_LOCAL, targetOnly){
    var byName={}; curves.forEach(function(cu){ byName[cu.name]=cu.pts; });
    var surfP=curves.map(function(cu){ var st={}; sToks(cu.name).forEach(function(w){st[w]=1;}); return {set:st,th:sTh(cu.name),pts:cu.pts}; });
    var map={};
    PADDLES_LOCAL.forEach(function(p){
      if(targetOnly && p.key!==targetOnly) return;
      if(SURFACE_EXCLUDE[p.key]) return;
      var ov=SURFACE_OVERRIDE[p.key]; if(ov && byName[ov]){ map[p.key]=byName[ov]; return; }
      var b=sBrand(p.company), dbt={}; sToks(p.company+' '+p.paddle).forEach(function(w){dbt[w]=1;});
      var dbcore=Object.keys(dbt).filter(function(w){return !S_GEN[w];});
      var dbth=(p.thickness!=null&&p.thickness!=='')?parseFloat(p.thickness):null;
      var best=null,bs=0;
      surfP.forEach(function(sp){
        var sj=Object.keys(sp.set).join('');
        if(sj.indexOf(b)<0 && (b.length<6 || sj.indexOf(b.slice(0,6))<0)) return;
        var shcore=Object.keys(sp.set).filter(function(w){return !S_GEN[w];});
        if(!dbcore.some(function(w){return sp.set[w];})) return;
        var dbSub=dbcore.every(function(w){return sp.set[w];}), shSub=shcore.every(function(w){return dbt[w];});
        if(!dbSub && !shSub) return;
        var uni={}; Object.keys(dbt).forEach(function(w){uni[w]=1;}); Object.keys(sp.set).forEach(function(w){uni[w]=1;});
        var inter=Object.keys(dbt).filter(function(w){return sp.set[w];}).length;
        var sc=inter/Object.keys(uni).length + ((dbcore.length===shcore.length&&dbSub&&shSub)?0.1:0);
        if(dbth && sp.th!=null) sc += (Math.abs(dbth-sp.th)<0.3?0.1:-0.15);
        if(sc>bs){ bs=sc; best=sp.pts; }
      });
      if(best && bs>=0.62) map[p.key]=best;
    });
    return map;
  }
  function yWindow(vals){
    var mn=Math.min.apply(null,vals), mx=Math.max.apply(null,vals), lo, hi;
    if(mx-mn <= 0.07){ var c=(mn+mx)/2; lo=Math.floor((c-0.035)*100)/100; hi=lo+0.07; }
    else { lo=Math.floor(mn*100)/100; hi=Math.ceil(mx*100)/100; }
    if(mn<lo) lo=Math.floor(mn*100)/100;
    if(mx>hi) hi=Math.ceil(mx*100)/100;
    return [lo,hi];
  }
  function smoothPath(pts){
    if(!pts.length) return '';
    if(pts.length<3) return 'M'+pts.map(function(p){return p[0].toFixed(1)+' '+p[1].toFixed(1);}).join(' L');
    var d='M'+pts[0][0].toFixed(1)+' '+pts[0][1].toFixed(1);
    for(var i=0;i<pts.length-1;i++){
      var p0=pts[i-1]||pts[i], p1=pts[i], p2=pts[i+1], p3=pts[i+2]||p2;
      var c1x=p1[0]+(p2[0]-p0[0])/6, c1y=p1[1]+(p2[1]-p0[1])/6;
      var c2x=p2[0]-(p3[0]-p1[0])/6, c2y=p2[1]-(p3[1]-p1[1])/6;
      d+=' C'+c1x.toFixed(1)+' '+c1y.toFixed(1)+' '+c2x.toFixed(1)+' '+c2y.toFixed(1)+' '+p2[0].toFixed(1)+' '+p2[1].toFixed(1);
    }
    return d;
  }
  function surfaceSVG(p){
    var data=SURFACE_MAP[p.key]; if(!data||!data.length) return null;
    var inches=data.map(function(d){return d[0];}), vals=data.map(function(d){return d[1];});
    var win=yWindow(vals), lo=win[0], hi=win[1];
    var PX0=50, PX1=282, PY0=22, PY1=176, minI=Math.min.apply(null,inches), maxI=Math.max.apply(null,inches);
    function xS(i){ return maxI===minI ? (PX0+PX1)/2 : PX0+(i-minI)/(maxI-minI)*(PX1-PX0); }
    function yS(v){ return PY1-(v-lo)/(hi-lo)*(PY1-PY0); }
    var axis='<line class="kc-axis" x1="'+PX0+'" y1="'+PY1+'" x2="'+PX1+'" y2="'+PY1+'"/>';
    var step=(hi-lo)<=0.075?0.01:0.02, yl='';
    for(var t=lo; t<=hi+1e-9; t+=step){ var tv=Math.round(t*1000)/1000;
      yl+='<text class="kc-ylab" x="'+(PX0-5)+'" y="'+(yS(tv)+3).toFixed(1)+'" text-anchor="end">'+tv.toFixed(3)+'</text>'; }
    var drops='', vlab='', xl='', sp=[];
    data.forEach(function(d){
      var x=xS(d[0]), y=yS(d[1]);
      sp.push([x,y]);
      drops+='<line class="kc-drop" x1="'+x.toFixed(1)+'" y1="'+y.toFixed(1)+'" x2="'+x.toFixed(1)+'" y2="'+PY1+'"/>';
      vlab+='<text class="kc-val" x="'+x.toFixed(1)+'" y="'+(y-7).toFixed(1)+'" text-anchor="middle">'+d[1].toFixed(3)+'</text>';
      xl+='<text class="kc-xlab" x="'+x.toFixed(1)+'" y="'+(PY1+13)+'" text-anchor="middle">'+d[0]+' in</text>';
    });
    var line='<path class="kc-line" d="'+smoothPath(sp)+'"/>';
    var titles='<text class="kc-axtitle" transform="translate(11,'+((PY0+PY1)/2).toFixed(0)+') rotate(-90)" text-anchor="middle">KewCOR</text>'
      + '<text class="kc-axtitle" x="'+((PX0+PX1)/2).toFixed(0)+'" y="206" text-anchor="middle">Inches from top of paddle</text>'
      + '<text class="kc-title" x="'+((PX0+PX1)/2).toFixed(0)+'" y="13" text-anchor="middle">'+esc(p.company+' '+p.paddle)+'</text>';
    return '<svg class="kc-svg" viewBox="0 0 300 212" preserveAspectRatio="xMidYMid meet">'+axis+yl+drops+line+vlab+xl+titles+'</svg>';
  }

  /* ================= feel map (verbatim) ================= */
  var FEEL=[];
  var FEEL_QUAD={A:'Stiff + Dense',B:'Stiff + Hollow',C:'Soft + Dense',D:'Soft + Hollow'};
  function feelTicks(){ var s=''; for(var i=-5;i<=5;i++){ if(i===0||Math.abs(i)===5) continue; var px=50+(i/5)*40, py=50-(i/5)*40; s+='<line class="pclf-tick" x1="'+px+'" y1="48.4" x2="'+px+'" y2="51.6"/><line class="pclf-tick" x1="48.4" y1="'+py+'" x2="51.6" y2="'+py+'"/>'; } return s; }
  var FEEL_SVG='<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">'
    +'<rect class="pclf-box" x="10" y="10" width="80" height="80" rx="4"/>'
    +'<rect class="pclf-grid-soft" x="23.33" y="23.33" width="53.34" height="53.34" rx="2.5"/>'
    +'<rect class="pclf-grid-soft" x="36.67" y="36.67" width="26.66" height="26.66" rx="1.5"/>'
    +'<line class="pclf-axis" x1="10" y1="50" x2="90" y2="50"/>'
    +'<line class="pclf-axis" x1="50" y1="10" x2="50" y2="90"/>'+feelTicks()
    +'<circle class="pclf-center" cx="50" cy="50" r="1.1"/></svg>';
  function feelClamp(v,a,b){return v<a?a:v>b?b:v;}
  function feelNorm(h){return String(h).toLowerCase().replace(/[^a-z0-9]/g,'');}
  function feelBool(v){ var s=String(v==null?'':v).trim().toLowerCase(); return !(s==='false'||s==='0'||s==='no'||s==='off'); }
  function feelThickCount(PADDLES_LOCAL){
    var g={}; PADDLES_LOCAL.forEach(function(p){ var k=(p.company+'||'+p.paddle).toLowerCase().trim();
      var n=parseFloat(p.thickness); if(!g[k])g[k]={}; if(!isNaN(n))g[k][n]=1; });
    var o={}; for(var k in g) o[k]=Object.keys(g[k]).length; return o;
  }
  function feelNameOf(p, PADDLES_LOCAL){
    var k=(p.company+'||'+p.paddle).toLowerCase().trim(), c=feelThickCount(PADDLES_LOCAL);
    if(c[k]>1){ var x=parseFloat(p.thickness); if(!isNaN(x)) return p.paddle+' '+String(x)+'mm'; }
    return p.paddle;
  }
  function feelEntryFor(p, PADDLES_LOCAL){
    var want=(p.company+'||'+feelNameOf(p, PADDLES_LOCAL)).toLowerCase().trim();
    for(var i=0;i<FEEL.length;i++){ var f=FEEL[i]; if((f.company+'||'+f.paddle).toLowerCase().trim()===want) return f; }
    return null;
  }
  function feelColMarkup(p, PADDLES_LOCAL){
    var f=feelEntryFor(p, PADDLES_LOCAL);
    var marker = f
      ? '<div class="pclf-dot" style="left:'+(50+(f.x/5)*40)+'%;top:'+(50-(f.y/5)*40)+'%" title="'+esc(p.paddle)+' ('+f.x.toFixed(2)+', '+f.y.toFixed(2)+')"><span class="pt"></span></div>'
      : '<div class="pclf-empty">Not placed on the feel map yet.</div>';
    return '<div class="pclf-frame">'
      +'<span class="pclf-edge t">STIFF</span><span class="pclf-edge b">SOFT</span>'
      +'<span class="pclf-edge l">DENSE</span><span class="pclf-edge r">HOLLOW</span>'
      +'<div class="pclf-map">'+FEEL_SVG
      +'<div class="pclf-quad a">A</div><div class="pclf-quad b">B</div><div class="pclf-quad c">C</div><div class="pclf-quad d">D</div>'
      +'<div class="pclf-markers">'+marker+'</div></div>'
      +'</div>';
  }

  /* ================= similar paddles (similarity score + spin durability match) =============
     A per-metric similarity score is a plain min/max ratio expressed as a percentage (e.g.
     reviewed=100, candidate=90 -> 90%). That only produces a sane number for metrics that are
     always >0 on a shared scale, which is true of every metric used here: the four *Scaled
     fields and Firepower/Hand-Speed-Index are already 0-100 scaled scores (not raw +/- Z-scores,
     which a min/max ratio would mangle), KewCOR and every physical dimension/weight field are
     plain positive measurements. Dimensions and Weight/Balance are each an average of 4 sub-
     metrics rolled into one number -- individual sub-scores are intentionally not exposed, per
     spec. Overall score is the average of all 8 top-level metrics (with Dimensions and
     Weight/Balance each counting once, already averaged). A candidate needs at least 5 of the 8
     metrics present to be considered at all, so a paddle missing most of its data can't luck
     into a high score off one or two fields. Spin Durability Tier is categorical (Tier 1-4, or
     blank) so it gets a separate exact-match Yes/No box instead of a percentage. */
  var SIM_DIMENSION_KEYS=['length','width','thickness','handleLength'];
  var SIM_WEIGHT_KEYS=['weight','swingWeight','twistWeight','balance'];
  function simRatio(a,b){
    if(a==null||b==null||isNaN(a)||isNaN(b)||a<=0||b<=0) return null;
    return (Math.min(a,b)/Math.max(a,b))*100;
  }
  function simAvg(p,q,keys){
    var vals=keys.map(function(k){return simRatio(p[k],q[k]);}).filter(function(v){return v!=null;});
    return vals.length ? vals.reduce(function(a,b){return a+b;},0)/vals.length : null;
  }
  function paddleSimilarity(p,q){
    var m={
      spin:simRatio(p.spinScaled,q.spinScaled),
      dimensions:simAvg(p,q,SIM_DIMENSION_KEYS),
      weightBalance:simAvg(p,q,SIM_WEIGHT_KEYS),
      handSpeed:simRatio(p.swingResist,q.swingResist),
      power:simRatio(p.powerScaled,q.powerScaled),
      pop:simRatio(p.popScaled,q.popScaled),
      firepower:simRatio(p.firepower,q.firepower),
      kewcor:simRatio(p.kewcor,q.kewcor)
    };
    var order=['spin','dimensions','weightBalance','handSpeed','power','pop','firepower','kewcor'];
    var vals=order.map(function(k){return m[k];}).filter(function(v){return v!=null;});
    if(vals.length<5) return null;
    return {overall:vals.reduce(function(a,b){return a+b;},0)/vals.length, metrics:m, order:order};
  }
  function findSimilarPaddles(p,PADDLES_LOCAL,n){
    var scored=[];
    PADDLES_LOCAL.forEach(function(q){
      if(q.key===p.key) return;
      var s=paddleSimilarity(p,q);
      if(s) scored.push({paddle:q,sim:s});
    });
    scored.sort(function(a,b){return b.sim.overall-a.sim.overall;});
    return scored.slice(0,n||4);
  }
  var SIM_METRIC_LABELS={spin:'Spin',dimensions:'Dimensions',weightBalance:'Weight / Balance',handSpeed:'Hand Speed',power:'Power',pop:'Pop',firepower:'Firepower',kewcor:'KewCOR'};
  function simMetricRow(key,val){
    return '<div class="pr-simmetric"><span class="pr-simmetric-label">'+esc(SIM_METRIC_LABELS[key])+'</span>'
      +'<span class="pr-simmetric-val">'+(val==null?'—':Math.round(val)+'%')+'</span></div>';
  }
  function comparisonLabUrl(target,q){
    return LAB_URL + '?p1=' + encodeURIComponent(target.company+'||'+target.paddle)
      + '&p2=' + encodeURIComponent(q.company+'||'+q.paddle);
  }
  function similarPaddleCard(target,cand){
    var q=cand.paddle, s=cand.sim;
    var qImg=photoCandidates(q)[0], tImg=photoCandidates(target)[0];
    var tTier=(target.spinDurTier||'').trim(), qTier=(q.spinDurTier||'').trim();
    var knownTiers=!!(tTier&&qTier), tierMatch=knownTiers&&tTier.toLowerCase()===qTier.toLowerCase();
    var matchHtml = !knownTiers ? '<span class="pr-match-unknown">Not enough data</span>'
      : (tierMatch ? '<span class="pr-match-yes">&#10003; Yes</span>' : '<span class="pr-match-no">&#10005; No</span>');
    var compareUrl = comparisonLabUrl(target,q);
    return '<div class="pr-simcard">'
      +'<div class="pr-simcard-head">'
        +'<img class="pr-simcard-photo" src="'+esc(qImg)+'" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">'
        +'<div class="pr-simcard-idbox"><div class="pr-simcard-name">'+esc(q.company)+' '+esc(q.paddle)+'</div>'
        +'<div class="pr-simcard-score">'+Math.round(s.overall)+'% similar</div></div>'
        +'<a class="pr-compare-cta" href="'+esc(compareUrl)+'" target="_blank" rel="noopener noreferrer" title="Compare '+esc(target.company+' '+target.paddle)+' vs '+esc(q.company+' '+q.paddle)+' in the Paddle Comparison Lab">'
          +'<span class="pr-compare-icon">'+COMPARE_ICON_SVG+'</span>'
          +'<span class="pr-compare-label">Compare This Paddle</span>'
        +'</a>'
      +'</div>'
      +'<div class="pr-simcard-metrics">'+s.order.map(function(k){return simMetricRow(k,s.metrics[k]);}).join('')+'</div>'
      +'<div class="pr-simcard-dur">'
        +'<div class="pr-simcard-dur-label">Spin Durability Tier</div>'
        +'<div class="pr-simcard-dur-row">'
          +'<div class="pr-simcard-dur-p"><img src="'+esc(tImg)+'" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'"><span>'+esc(tTier||'—')+'</span></div>'
          +'<div class="pr-simcard-dur-p"><img src="'+esc(qImg)+'" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'"><span>'+esc(qTier||'—')+'</span></div>'
        +'</div>'
        +'<div class="pr-simcard-dur-match">Spin Durability Match? '+matchHtml+'</div>'
      +'</div>'
      +'</div>';
  }
  function similarPaddlesHtml(p,PADDLES_LOCAL){
    var top=findSimilarPaddles(p,PADDLES_LOCAL,4);
    if(!top.length) return '<div style="color:var(--muted);font-size:13px;padding:6px 2px">Not enough data in the database yet to compute similar paddles.</div>';
    return '<div class="pr-simgrid">'+top.map(function(c){return similarPaddleCard(p,c);}).join('')+'</div>';
  }

  /* ================= review text from a Google Doc (alternative to inline opts.review) =====
     Convention: one Google Doc per paddle, shared "Anyone with the link can view". Section
     names below (case-insensitive, must be on their own line) split the doc into fields. Inside
     a prose section, a blank line marks a paragraph break, and that break is preserved onto the
     page as a separate <p> (via proseHtml()) -- so a section written as several paragraphs in
     the Doc renders as several paragraphs, not one flattened block. Quick Take / Who It's For / Who It's NOT For treat every
     non-empty line under the heading as one bullet. Most other sections are joined into one
     prose block. A paragraph starting with "MFR CLAIM:" becomes the manufacturer-claim callout
     box. A "[[IMAGE: url]]" or "[[IMAGE: url | caption]]" marker anywhere in a prose section
     becomes an inline image -- useful for b-roll stills in a Full Review's Construction/
     On-Court/Mods sections; John uploads the image somewhere he controls (easiest: drop it into
     a Squarespace image block, right-click it once published, "Copy Image Address") and pastes
     that URL into the marker. IMPORTANT: this must be typed marker text, not an actual image
     object inserted/pasted into the Doc -- Google's plain-text export (what this pipeline reads)
     silently drops real embedded images, leaving nothing behind for the marker text to replace.
     Any text before the first recognized section header (e.g. an opening "[[IMAGE: ...]]" on
     its own at the very top of the Doc) is captured as an optional lead image/note rendered
     above Quick Take, no header needed for that one.

     Two categories, distinguished purely by whether VIDEO is filled in (no separate flag to
     keep in sync):
       - Executive Summary: everything except VIDEO / ON-COURT IMPRESSIONS / MODS. Used for a
         paddle with no video yet -- this is today's format, unchanged.
       - Full Review: adds VIDEO (a YouTube link -- thumbnail + "watch" card render
         automatically), ON-COURT IMPRESSIONS, and optionally MODS. Graduating a paddle from
         Executive Summary to Full Review is just adding these three sections to its existing
         Doc once the video is live; nothing else needs to change.

       QUICK TAKE
       (one bullet per line)

       VIDEO
       (one line: the YouTube URL -- Full Review only, omit entirely for an Executive Summary)

       CONSTRUCTION & BUILD
       (prose; a line starting "MFR CLAIM:" becomes the callout box)

       KEWCOR
       SPIN DURABILITY
       FEEL MAP
       (prose each)

       ON-COURT IMPRESSIONS
       MODS
       (prose each -- Full Review only; omit both for an Executive Summary, or omit just MODS
       if the paddle wasn't modded)

       WHO IT'S FOR
       WHO IT'S NOT FOR
       (one bullet per line each)

       FINAL THOUGHTS
       DISCLOSURE
       (prose each)
  */
  var DOC_SECTIONS = [
    {key:'quickTake',          match:/^quick take$/i,                         list:true},
    {key:'videoUrl',           match:/^video$/i,                              single:true},
    {key:'constructionNote',   match:/^construction( ?&? ?build)?$/i,          list:false},
    {key:'kewcorNote',         match:/^kewcor$/i,                             list:false},
    {key:'spinDurabilityNote', match:/^spin durability$/i,                    list:false},
    {key:'feelNote',           match:/^feel( map)?$/i,                        list:false},
    {key:'onCourtNote',        match:/^on-?court impressions$/i,              list:false},
    {key:'modsNote',           match:/^mods?$/i,                              list:false},
    {key:'whoFor',             match:/^who(?:'s| is)?\s*it'?s?\s*for$/i,       list:true},
    {key:'whoNotFor',          match:/^who(?:'s| is)?\s*it'?s?\s*not\s*for$/i, list:true},
    {key:'verdict',            match:/^final thoughts$/i,                     list:false},
    {key:'disclosure',         match:/^disclosure$/i,                         list:false}
  ];
  function parseReviewDoc(text){
    var lines = String(text||'').replace(/\r\n?/g,'\n').split('\n');
    var out = {quickTake:[], whoFor:[], whoNotFor:[]};
    // Anything before the first recognized section header (e.g. an opening [[IMAGE: ...]]
    // marker) is captured as heroNote and rendered above Quick Take -- lets a review open
    // with a lead photo without needing its own section header.
    var current = {key:'heroNote', list:false}, buf = [];
    function flush(){
      if(!current){ buf=[]; return; }
      if(current.single){
        var firstLine = buf.map(function(l){return l.trim();}).filter(Boolean)[0];
        out[current.key] = firstLine || '';
      } else if(current.list){
        out[current.key] = buf.map(function(l){return l.trim();}).filter(Boolean);
      } else {
        // Blank lines inside a section mark paragraph breaks -- checked independently so a
        // "MFR CLAIM:" paragraph anywhere in the section (not just the first line) still
        // gets converted to the callout box, matching how it's used in the existing reviews.
        var paras=[], para=[];
        buf.forEach(function(l){
          if(l.trim()===''){ if(para.length){ paras.push(para.join(' ').trim()); para=[]; } }
          else para.push(l.trim());
        });
        if(para.length) paras.push(para.join(' ').trim());
        // Joined with a paragraph-break marker (\n\n), not a plain space -- proseHtml() at
        // render time splits on this to produce one <p> per paragraph instead of flattening
        // an entire multi-paragraph section (e.g. On-Court Impressions) into one wall of text.
        out[current.key] = paras.map(function(pText){
          var m = pText.match(/^MFR CLAIM:\s*(.*)$/i);
          return m
            ? ('<span class="pr-mfr"><b>From manufacturer — not independently verified</b>'+m[1]+'</span>')
            : pText;
        }).join('\n\n');
      }
      buf=[];
    }
    lines.forEach(function(raw){
      var line = raw.replace(/ /g,' '); // Docs sometimes exports non-breaking spaces
      var trimmed = line.trim();
      var matched = null;
      for(var i=0;i<DOC_SECTIONS.length;i++){ if(DOC_SECTIONS[i].match.test(trimmed)){ matched=DOC_SECTIONS[i]; break; } }
      if(matched){ flush(); current=matched; buf=[]; }
      else if(current){ buf.push(line); }
    });
    flush();
    return out;
  }
  function loadReviewDoc(docId, cb){
    var url = 'https://docs.google.com/document/d/'+encodeURIComponent(docId)+'/export?format=txt';
    fetch(url).then(function(r){ if(!r.ok) throw new Error('doc fetch failed: '+r.status); return r.text(); })
      .then(function(txt){ cb(parseReviewDoc(txt)); })
      .catch(function(err){ if(window.console) console.error('JKPaddleReview: could not load review doc ('+docId+')', err); cb(null); });
  }

  function loadFeel(url,fb,cb){
    Papa.parse(url,{download:true,skipEmptyLines:true,complete:function(res){
      var rows=res.data||[]; if(rows.length<1){ if(fb) return loadFeel(fb,null,cb); return; }
      var head=rows[0].map(feelNorm), ci={};
      ['company','paddle','x','y','on'].forEach(function(k){ci[k]=head.indexOf(k);});
      if(ci.company<0||ci.paddle<0){ if(fb) return loadFeel(fb,null,cb); return; }
      var out=[];
      for(var i=1;i<rows.length;i++){ var r=rows[i]; if(!r) continue;
        var c=r[ci.company], p=r[ci.paddle]; if(!c||!p) continue;
        out.push({company:String(c).trim(),paddle:String(p).trim(),
                  x:feelClamp(parseFloat(r[ci.x])||0,-5,5),
                  y:feelClamp(parseFloat(r[ci.y])||0,-5,5),
                  on:ci.on>-1?feelBool(r[ci.on]):true});
      }
      FEEL=out; if(cb) cb();
    },error:function(){ if(fb) loadFeel(fb,null,cb); }});
  }

  var SKELETON_HTML = `<div class="pr-page">
<div class="pr-status" id="prStatus">Loading paddle data…</div>

<div class="pr-wrap" id="prApp" hidden>

  <div class="pr-hero">
    <div class="pr-photo" id="prPhoto"></div>
    <div class="pr-head-main">
      <div class="pr-brand" id="prBrand"></div>
      <div class="pr-name" id="prName"></div>
      <div class="pr-byline"><img class="pr-author-pic" src="${AUTHOR_PHOTO}" alt="John Kew" onerror="this.style.display='none'">By John Kew</div>
      <div class="pr-badges" id="prBadges"></div>
      <div class="pr-price-row" id="prPriceRow"></div>
      <a class="pr-buy" id="prBuyBtn" href="#" target="_blank" rel="noopener noreferrer">Buy Now →</a>
    </div>
  </div>

  <div id="prHero" hidden></div>

  <div class="pr-h2">Quick Take</div>
  <div class="pr-card"><ul class="pr-quicktake" id="prQuickTake"></ul></div>

  <div id="prVideoBlock" hidden></div>

  <div class="pr-h2">Specs</div>
  <div class="pr-card"><div class="pr-spec-grid" id="prSpecGrid"></div></div>
  <div class="pr-prose" id="prSpecNote" style="margin-top:12px"></div>

  <div class="pr-h2">Construction &amp; Build</div>
  <div class="pr-card pr-prose" id="prConstruction"></div>

  <div class="pr-h2">Performance Metrics</div>
  <p class="pr-sub">Z-scores compared against hundreds of paddles in the database. Scaled chart is 0 (center) to 100 (edge); raw chart shows actual standard-deviation distance from the dataset mean.</p>
  <div class="pr-card">
    <div class="pr-charts">
      <div><div class="pr-cap">Scaled (Radar)</div><div id="prRadar"></div><div class="pr-legend" id="prRadarLegend"></div></div>
      <div><div class="pr-cap">Raw Z-Scores</div><div id="prBullet"></div></div>
    </div>
  </div>
  <div class="pr-prose" id="prMetricsNote" style="margin-top:12px"></div>

  <div class="pr-h2">KewCOR</div>
  <p class="pr-sub">KewCOR is a controlled firepower metric — how efficiently the paddle transfers energy back into the ball, measured with a ball cannon.</p>
  <div class="pr-card">
    <div class="pr-charts">
      <div><div class="pr-cap">KewCOR Score</div><div id="prGauge"></div><div class="pr-gauge-legend" id="prGaugeLegend"></div></div>
      <div><div class="pr-cap">Across-the-Face Curve</div><div id="prSurface"></div></div>
    </div>
  </div>
  <div class="pr-prose" id="prKewcorNote" style="margin-top:12px"></div>

  <div class="pr-h2">Spin Durability</div>
  <div class="pr-card">
    <div id="prDurBadge" style="margin-bottom:10px"></div>
    <div class="pr-prose" id="prDurNote"></div>
  </div>

  <div class="pr-h2">Feel Map</div>
  <p class="pr-sub">Subjective feel — dense ↔ hollow (x-axis), stiff ↔ soft (y-axis).</p>
  <div class="pr-card">
    <div id="prFeel"></div>
  </div>
  <div class="pr-prose" id="prFeelNote" style="margin-top:12px"></div>

  <div class="pr-h2">Similar Paddles</div>
  <p class="pr-sub">The 4 paddles in the database with the closest overall performance profile, scored across spin, dimensions, weight/balance, hand speed, power, pop, firepower, and KewCOR.</p>
  <div class="pr-card" id="prSimilar"></div>

  <div id="prOnCourtSection" hidden>
    <div class="pr-h2">On-Court Impressions</div>
    <div class="pr-card pr-prose" id="prOnCourt"></div>
  </div>

  <div id="prModsSection" hidden>
    <div class="pr-h2">Mods</div>
    <div class="pr-card pr-prose" id="prMods"></div>
  </div>

  <div class="pr-h2">Who It's For / Who It's Not</div>
  <div class="pr-card">
    <div class="pr-forgrid">
      <div class="pr-for"><h3>Who it's for</h3><ul id="prWhoFor"></ul></div>
      <div class="pr-notfor"><h3>Who it's NOT for</h3><ul id="prWhoNotFor"></ul></div>
    </div>
  </div>

  <div class="pr-h2">Final Thoughts</div>
  <div class="pr-card pr-prose" id="prVerdict"></div>

  <div id="prBuySection" hidden>
    <div class="pr-h2">Where to Buy</div>
    <div class="pr-card pr-buybox" id="prBuyBoxBottom"></div>
  </div>

  <div class="pr-disclosure" id="prDisclosure"></div>

</div>
</div>

<svg width="0" height="0" style="position:absolute"><defs>
  <radialGradient id="prRadarGrad" cx="50%" cy="50%" r="62%">
    <stop offset="0%" stop-color="#ff2d6f"/><stop offset="52%" stop-color="#cc1f86"/><stop offset="100%" stop-color="#6d28d9"/>
  </radialGradient>
</defs></svg>

<script id="prJsonLd" type="application/ld+json"></script>`;

  function init(opts){
    opts = opts || {};
    var rootId = opts.rootId || 'pr-root';
    var root = document.getElementById(rootId);
    if(!root){ if(window.console) console.error('JKPaddleReview.init: no element with id="'+rootId+'" found on this page.'); return; }
    root.innerHTML = SKELETON_HTML;

    var DEFAULT_KEY = opts.defaultKey || '';
    var REVIEWS = {};
    if(DEFAULT_KEY && opts.review) REVIEWS[DEFAULT_KEY] = opts.review;

    var qs=new URLSearchParams(location.search);
    var wantKey=qs.get('paddle');
    var wantSlug=qs.get('slug');

    function findPaddle(PADDLES_LOCAL){
      if(wantKey){
        var k=wantKey.toLowerCase();
        var m=PADDLES_LOCAL.find(function(p){return p.key.toLowerCase()===k;});
        if(m) return m;
      }
      if(wantSlug){
        var m2=PADDLES_LOCAL.find(function(p){return photoSlug(p)===wantSlug;});
        if(m2) return m2;
      }
      if(!wantKey && !wantSlug){
        return PADDLES_LOCAL.find(function(p){return p.key.toLowerCase()===DEFAULT_KEY.toLowerCase();});
      }
      return null;
    }

    function renderSpecRow(label,val){ return '<tr><td>'+esc(label)+'</td><td>'+val+'</td></tr>'; }

    function render(p, PADDLES_LOCAL){
      var R = REVIEWS[p.key] || {};
      var pr = pricing(p);

      // Page <title> and SEO description are set once in Squarespace's own page settings
      // for this page -- not overwritten here, so there's a single source of truth.
      var desc = (R.quickTake && R.quickTake[0]) ? R.quickTake[0] : ('Independent lab-tested review of the '+p.company+' '+p.paddle+'.');
      var canonicalUrl = location.href.split('?')[0];

      // photo (flip card: front = product photo, back = x-ray, matching the Comparison Lab pattern)
      var cands=photoCandidates(p);
      var xraySrc = PHOTO_BASE + photoSlug(p) + '-x-ray.png';
      document.getElementById('prPhoto').innerHTML =
        '<div class="pcl-photo-flip-inner" id="prPhotoFlip">'
        + '<div class="pcl-photo-face pcl-photo-face-front"><img src="'+esc(cands[0])+'" data-fb="'+esc(JSON.stringify(cands.slice(1)))+'" alt="'+esc(p.company+' '+p.paddle)+'" '
          + 'onerror="var fb=JSON.parse(this.getAttribute(\'data-fb\')||\'[]\'); if(fb.length){this.setAttribute(\'data-fb\',JSON.stringify(fb.slice(1)));this.src=fb[0];} else {this.parentNode.innerHTML=\'<div class=&quot;ph-txt&quot;>Paddle image coming soon</div>\';}"></div>'
        + '<div class="pcl-photo-face pcl-photo-face-back"><img src="'+esc(xraySrc)+'" alt="" onload="var b=document.getElementById(\'prXrayBadge\'); if(b) b.style.display=\'flex\';" onerror="this.style.display=\'none\'"></div>'
        + '</div>'
        + '<button class="xray-badge" id="prXrayBadge" type="button" style="display:none" onclick="JKPaddleReview.toggleXray()">'+XRAY_ICON_SVG+'<span>X-Ray</span></button>';

      document.getElementById('prBrand').textContent = p.company;
      document.getElementById('prName').textContent = p.paddle + ' Paddle Review';
      // Full Review vs Executive Summary is not a flag anyone sets -- it's derived from whether
      // a video has been added yet, so the label can never drift out of sync with what's
      // actually on the page. Graduating a paddle later (adding VIDEO/ON-COURT/MODS content)
      // flips this automatically.
      var ytId = ytVideoId(R.videoUrl);
      document.getElementById('prBadges').innerHTML = [
        ytId ? '<span class="badge badge-reviewtype-full">Full Review</span>' : '<span class="badge badge-reviewtype-summary">Executive Summary</span>',
        p.shape?'<span class="badge badge-shape">'+esc(p.shape)+'</span>':'',
        p.build?'<span class="badge badge-build">'+esc(p.build)+'</span>':'',
        spinBadge(p.spinCategory), certBadge(p.cert), durTierBadge(p)
      ].join('');

      var priceMain = pr.isSelkirk? money(p.price) : money(pr.finalPrice);
      var strike = (!pr.isSelkirk && pr.savedAmt>0.005) ? '<span class="pr-strike">'+money(p.price)+'</span>' : '';
      document.getElementById('prPriceRow').innerHTML = '<span class="pr-price">'+priceMain+'</span>'+strike
        + (p.discountCode?('<span class="pr-code">'+esc(p.discountCode)+'</span>'
          + '<button type="button" class="pr-copy-btn" onclick="JKPaddleReview.copyCode(this,\''+esc(p.discountCode).replace(/'/g,"&#39;")+'\')">Copy code</button>'):'');
      var buyBtn=document.getElementById('prBuyBtn');
      if(p.link && /^https?:/i.test(p.link)){ buyBtn.href=p.link; } else { buyBtn.style.display='none'; }

      // hero (optional lead image/note before Quick Take)
      var heroEl = document.getElementById('prHero');
      if(R.heroNote){ heroEl.innerHTML = proseHtml(R.heroNote); heroEl.hidden = false; }
      else { heroEl.hidden = true; heroEl.innerHTML = ''; }

      // quick take
      document.getElementById('prQuickTake').innerHTML = (R.quickTake||['Quick-take bullets not yet written for this paddle.']).map(function(t){return '<li>'+t+'</li>';}).join('');

      // video block (full reviews only -- hidden entirely until a video URL is present)
      var videoBlockEl = document.getElementById('prVideoBlock');
      if(ytId){
        var watchUrl = 'https://www.youtube.com/watch?v='+ytId;
        videoBlockEl.innerHTML =
          '<a class="pr-video-card" href="'+esc(watchUrl)+'" target="_blank" rel="noopener noreferrer">'
          + '<div class="pr-video-thumb"><img src="https://img.youtube.com/vi/'+ytId+'/maxresdefault.jpg" alt="" '
          + 'onerror="this.onerror=null;this.src=\'https://img.youtube.com/vi/'+ytId+'/hqdefault.jpg\';"><span class="pr-video-play">&#9654;</span></div>'
          + '<div class="pr-video-label">Watch the full video review on YouTube →</div>'
          + '</a>';
        videoBlockEl.hidden = false;
      } else {
        videoBlockEl.hidden = true;
        videoBlockEl.innerHTML = '';
      }

      // specs
      var specsLeft = [
        renderSpecRow('Shape', esc(p.shape||'—')),
        renderSpecRow('Build', esc(p.build||'—')),
        renderSpecRow('Length × Width', (p.length?fmt(p.length,2):'—')+' × '+(p.width?fmt(p.width,2):'—')+' in'),
        renderSpecRow('Handle Length', p.handleLength?fmt(p.handleLength,2)+' in':'—'),
        renderSpecRow('Core Thickness', p.thickness?fmt(p.thickness,1)+' mm':'—')
      ].join('');
      var specsRight = [
        renderSpecRow('Static Weight', p.weight?fmt(p.weight,1)+' oz':'—'),
        renderSpecRow('Swing Weight', p.swingWeight?fmt(p.swingWeight,0):'—'),
        renderSpecRow('Twist Weight', p.twistWeight?fmt(p.twistWeight,2):'—'),
        renderSpecRow('Balance Point', p.balance?fmt(p.balance,1)+' cm':'—'),
        renderSpecRow('Certification', esc(p.cert||'—')),
        renderSpecRow('Warranty', esc(p.warranty||'—'))
      ].join('');
      document.getElementById('prSpecGrid').innerHTML = '<table class="pr-spec-table">'+specsLeft+'</table><table class="pr-spec-table">'+specsRight+'</table>';
      document.getElementById('prSpecNote').innerHTML = R.specNote ? '<p>'+R.specNote+'</p>' : '';

      // construction
      var constructionParts=[];
      if(p.coreType) constructionParts.push('Core: '+esc(p.coreType)+'.');
      if(p.surfaceLayup) constructionParts.push('Surface layup: '+esc(p.surfaceLayup)+'.');
      if(p.surfaceTexture) constructionParts.push('Surface texture: '+esc(p.surfaceTexture)+'.');
      // constructionNote renders as plain prose by default -- it is NOT assumed to be a
      // manufacturer claim. The "From manufacturer -- not independently verified" callout only
      // appears where the text explicitly opts in with an inline <span class="pr-mfr"> (written
      // directly, or via the "MFR CLAIM:" line in a review Doc). Auto-wrapping the whole note
      // used to be the default here, which incorrectly flagged independently-verified writing
      // (e.g. John's own x-ray/testing analysis) as an unverified manufacturer claim.
      var constructionHtml = '<p>'+(constructionParts.join(' ')||'Construction details not yet in the database for this paddle.')+'</p>';
      if(R.constructionNote) constructionHtml += proseHtml(R.constructionNote);
      document.getElementById('prConstruction').innerHTML = constructionHtml;

      // performance metrics
      document.getElementById('prRadar').innerHTML = radarSVG(p);
      document.getElementById('prRadarLegend').innerHTML = radarLegend(p);
      document.getElementById('prBullet').innerHTML = bulletSVG(p);
      document.getElementById('prMetricsNote').innerHTML = R.metricsNote ? '<p>'+R.metricsNote+'</p>' : '';

      // kewcor
      var kcCat=kewcorCat(p.kewcor);
      document.getElementById('prGauge').innerHTML = gaugeSVG(p.kewcor,0.340,0.470,KEWCOR_BANDS,kcCat,3);
      document.getElementById('prGaugeLegend').innerHTML = '<span><i style="background:#2563eb"></i>Control</span><span><i style="background:#0d9488"></i>All-Court</span><span><i style="background:#d97706"></i>Power</span><span><i style="background:#dc2626"></i>Beyond Spec</span>';
      document.getElementById('prKewcorNote').innerHTML = R.kewcorNote ? proseHtml(R.kewcorNote) : '<p>Surface curve loading…</p>';
      refreshSurfaceChart(p);

      // spin durability
      document.getElementById('prDurBadge').innerHTML = durTierBadge(p) || '<span style="color:var(--muted);font-size:13px">Not yet tested.</span>';
      document.getElementById('prDurNote').innerHTML = R.spinDurabilityNote ? proseHtml(R.spinDurabilityNote) : '';

      // feel map
      refreshFeelChart(p, PADDLES_LOCAL);
      document.getElementById('prFeelNote').innerHTML = R.feelNote ? proseHtml(R.feelNote) : '';

      // similar paddles (data-driven, shown on both Executive Summary and Full Review)
      document.getElementById('prSimilar').innerHTML = similarPaddlesHtml(p, PADDLES_LOCAL);

      // on-court impressions + mods (full reviews only -- hidden until content exists)
      var onCourtSection = document.getElementById('prOnCourtSection');
      if(R.onCourtNote){ document.getElementById('prOnCourt').innerHTML = proseHtml(R.onCourtNote); onCourtSection.hidden = false; }
      else { onCourtSection.hidden = true; }
      var modsSection = document.getElementById('prModsSection');
      if(R.modsNote){ document.getElementById('prMods').innerHTML = proseHtml(R.modsNote); modsSection.hidden = false; }
      else { modsSection.hidden = true; }

      // who for / not for
      document.getElementById('prWhoFor').innerHTML = (R.whoFor||[]).map(function(t){return '<li>'+t+'</li>';}).join('') || '<li style="color:var(--muted)">Not yet written.</li>';
      document.getElementById('prWhoNotFor').innerHTML = (R.whoNotFor||[]).map(function(t){return '<li>'+t+'</li>';}).join('') || '<li style="color:var(--muted)">Not yet written.</li>';

      // verdict
      document.getElementById('prVerdict').innerHTML = R.verdict ? proseHtml(R.verdict) : '<p>Full write-up not yet drafted for this paddle.</p>';

      // bottom purchase CTA -- repeats the header's price/discount/buy-link data (same `pr`,
      // `priceMain`, `strike` computed above) so a reader who scrolls straight to the verdict
      // still sees pricing without scrolling back up. Whole section hides if there's no link.
      var buySection = document.getElementById('prBuySection'), buyBoxBottom = document.getElementById('prBuyBoxBottom');
      if(buySection && buyBoxBottom){
        if(p.link && /^https?:/i.test(p.link)){
          buyBoxBottom.innerHTML = '<div class="pr-price-row">'
            + '<span class="pr-price">'+priceMain+'</span>'+strike
            + (p.discountCode?('<span class="pr-code">'+esc(p.discountCode)+'</span>'
              + '<button type="button" class="pr-copy-btn" onclick="JKPaddleReview.copyCode(this,\''+esc(p.discountCode).replace(/'/g,"&#39;")+'\')">Copy code</button>'):'')
            + '</div>'
            + '<a class="pr-buy" href="'+esc(p.link)+'" target="_blank" rel="noopener noreferrer">Buy Now →</a>';
          buySection.hidden = false;
        } else {
          buySection.hidden = true;
          buyBoxBottom.innerHTML = '';
        }
      }

      // disclosure
      document.getElementById('prDisclosure').textContent = R.disclosure || 'Independent testing. See johnkewpickleball.com for full disclosure policy.';

      // JSON-LD (Product + Review; no star rating included — nothing here should read as
      // a fabricated numeric score. Add reviewRating later only if a real rating scale exists.)
      var ld = {
        "@context":"https://schema.org",
        "@type":"Product",
        "name": p.company+' '+p.paddle,
        "brand": {"@type":"Brand","name": p.company},
        "image": cands[0],
        "description": desc,
        "offers": p.price ? {"@type":"Offer","price": String(pr.isSelkirk?p.price:pr.finalPrice),"priceCurrency":"USD","url": p.link||canonicalUrl} : undefined,
        "review": {
          "@type":"Review",
          "author": {"@type":"Person","name":"John Kew"},
          "publisher": {"@type":"Organization","name":"JohnKew Pickleball"},
          "reviewBody": (R.verdict||desc).replace(/<[^>]+>/g,'')
        }
      };
      document.getElementById('prJsonLd').textContent = JSON.stringify(ld);

      document.getElementById('prStatus').hidden=true;
      document.getElementById('prApp').hidden=false;
    }

    function refreshSurfaceChart(p){
      var host=document.getElementById('prSurface');
      var svg=surfaceSVG(p);
      host.innerHTML = svg ? '<div class="pcl-surf">'+svg+'</div>' : '<div style="color:var(--muted);font-size:12.5px;text-align:center;padding:30px 10px">No centerline surface data for this paddle yet.</div>';
    }
    function refreshFeelChart(p, PADDLES_LOCAL){
      document.getElementById('prFeel').innerHTML = feelColMarkup(p, PADDLES_LOCAL);
    }

    /* ================= load ================= */
    function load(){
      Papa.parse(CSV_URL,{download:true,skipEmptyLines:true,complete:function(res){
        if(!res.data || res.data.length<3){ document.getElementById('prStatus').textContent='Could not load paddle data.'; return; }
        var PADDLES=parseRows(res.data);
        var p=findPaddle(PADDLES);
        if(!p){ document.getElementById('prStatus').innerHTML='Paddle not found. Check the <code>?paddle=Company||Paddle</code> link, or <a href="https://johnkewpickleball.com/paddle-database">browse the full database</a>.'; return; }
        render(p, PADDLES);

        // live surface curve (fuzzy-matched, same logic as the comparison lab)
        Papa.parse(SURFACE_CSV,{download:true,skipEmptyLines:true,complete:function(sres){
          if(sres.data && sres.data.length>1){
            try{
              var live=buildSurfaceMap(parseSurfaceRows(sres.data), PADDLES, p.key);
              for(var k in live) SURFACE_MAP[k]=live[k];
              refreshSurfaceChart(p);
            }catch(e){}
          }
        },error:function(){}});

        // live feel map
        loadFeel(FEEL_CSV, null, function(){ refreshFeelChart(p, PADDLES); });
      },error:function(){ document.getElementById('prStatus').textContent='Could not load paddle data. Please refresh.'; }});
    }
    function startLoad(){ if(window.Papa) load(); else window.addEventListener('load', load); }

    if(DEFAULT_KEY && opts.reviewDocId && !opts.review){
      // Review text lives in a Google Doc (Anyone with the link can view) instead of being
      // pasted inline -- fetch + parse it before rendering. Falls back to "not yet written"
      // placeholders (handled already inside render()) if the fetch fails for any reason.
      loadReviewDoc(opts.reviewDocId, function(parsed){
        if(parsed) REVIEWS[DEFAULT_KEY] = parsed;
        startLoad();
      });
    } else {
      startLoad();
    }
  }

  return { init: init, copyCode: copyCode, toggleXray: toggleXray, parseReviewDoc: parseReviewDoc };
})();
