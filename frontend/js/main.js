var $=function(s){return document.querySelector(s)},app=$('#app'),S={theme:'system',sync:false,lang:'vi',lay:{mods:'rows',plugins:'rows',datapacks:'rows',shaders:'rows',resourcepacks:'grid',modpacks:'rows'}},timer,P=null;window.PAGE=document.body.getAttribute('data-page')||window.PAGE;
try{var z=JSON.parse(localStorage.getItem('mdm'));if(z)S=Object.assign(S,z)}catch(e){}

function R(c){return c.map(function(x,i,a){var h=20/a.length;return'<rect y="'+i*h+'" width="30" height="'+h+'" fill="'+x+'"/>'}).join('')}
function V(c){return c.map(function(x,i){return'<rect x="'+i*10+'" width="10" height="20" fill="'+x+'"/>'}).join('')}
function F(c){var b='';
if(c==='vi')b='<rect width="30" height="20" fill="#da251d"/><path fill="#ff0" d="M15 4.5l1.76 5.4h5.68l-4.6 3.34 1.76 5.4L15 15.3l-4.6 3.34 1.76-5.4-4.6-3.34h5.68z"/>';
else if(c==='en'){b='<rect width="30" height="20" fill="#fff"/>';for(var i=0;i<13;i+=2)b+='<rect y="'+i*1.538+'" width="30" height="1.538" fill="#b22234"/>';b+='<rect width="12" height="10.77" fill="#3c3b6e"/>';for(var y=0;y<3;y++)for(var x=0;x<4;x++)b+='<circle cx="'+(1.8+x*2.8)+'" cy="'+(1.9+y*3.4)+'" r=".6" fill="#fff"/>'}
else if(c==='de-CH'||c==='ch')b='<rect width="30" height="20" fill="#d52b1e"/><path fill="#fff" d="M12.5 4h5v4h4v4h-4v4h-5v-4h-4V8h4z"/>';
else if(c==='de')b=R(['#000','#d00','#ffce00']);
else if(c==='es-419')b=V(['#006847','#fff','#ce1126'])+'<circle cx="15" cy="10" r="2.6" fill="#8a5a2b"/>';
else if(c==='es')b=R(['#c60b1e'])+'<rect y="5" width="30" height="10" fill="#ffc400"/>';
else if(c==='fr')b=V(['#0055a4','#fff','#ef4135']);
else if(c==='hu')b=R(['#cd2a3e','#fff','#436f4d']);
else if(c==='it')b=V(['#009246','#fff','#ce2b37']);
else if(c==='nl')b=R(['#ae1c28','#fff','#21468b']);
else if(c==='pl')b=R(['#fff','#dc143c']);
else if(c==='zh-CN')b='<rect width="30" height="20" fill="#de2910"/><path fill="#ffde00" d="m8 3 1.2 3.6H13L10 8.8l1.1 3.7L8 10.2l-3.1 2.3L6 8.8 3 6.6h3.8z"/>';
else if(c==='ja')b='<rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="5" fill="#bc002d"/>';
return'<svg class="fl" viewBox="0 0 30 20" aria-hidden="true">'+b+'</svg>'}
function cur(){return P||S.lang}
function bar(){var e=$('#ub'),d=P&&P!==S.lang&&location.hash==='#/settings/language';
if(!d){if(e)e.remove();return}
if(!e){e=document.createElement('div');e.id='ub';e.setAttribute('role','alertdialog');e.setAttribute('aria-live','polite');
e.innerHTML='<span class="um">Bạn có những thay đổi chưa được lưu</span><button class="ur" id="urs"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>Đặt lại</button><button class="us btn p" id="usv"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>Lưu</button>';
document.body.appendChild(e);
$('#urs').onclick=function(){P=null;settings('language')};
$('#usv').onclick=function(){S.lang=P;P=null;save();L.set(S.lang);settings('language')}}
L.apply(e)}
function save(){try{localStorage.setItem('mdm',JSON.stringify(S))}catch(e){}}
function theme(){var t=S.theme==='system'?(matchMedia('(prefers-color-scheme:light)').matches?'light':'dark'):S.theme;document.documentElement.dataset.theme=t}
var TH=[['system','Đồng bộ với hệ thống','#16181c','#27292e','#42444a','#9aa'],['light','Sáng','#ebebeb','#fff','#ddd','#222'],['dark','Tối','#0d1419','#1a2630','#33485a','#9fb2c0'],['oled','OLED','#000','#101013','#25262b','#9fb2c0']];
var PR=[['Mods','mods'],['Plugin','plugins'],['Gói dữ liệu','datapacks'],['Shader','shaders'],['Gói tài nguyên','resourcepacks'],['Modpack','modpacks']];
var LG=[['vi','','Ti\u1ebfng Vi\u1ec7t','Vietnamese','100'],['en','','English (United States)','','100'],['es-419','','Espa\u00f1ol (Latinoam\u00e9rica)','Spanish (Latin America)','100'],['zh-CN','','\u7b80\u4f53\u4e2d\u6587','Simplified Chinese','100'],['ja','','\u65e5\u672c\u8a9e','Japanese','100']];
var PJ=[['Lumen Lights','Ánh sáng 3D cho các khối phát sáng','#2fc6df'],['Cubic Storage','Hệ thống kho đồ theo tủ hồ sơ','#7a63d6'],['Deepwood','Rừng sâu với sinh vật mới','#3f9a5c'],['Skyline Shader','Shader bầu trời chân thực','#d6803f']];
 function home(){var l=S.lay.mods,u=A.user();app.innerHTML='<section class="hero">'+(u?'<div class="hi">Chào mừng trở lại, <b>'+A.esc(u.displayName||u.username)+'</b> <span class="handle">@'+A.esc(u.username)+'</span></div>':'')+'<img alt="Logo Modium" src="'+$('.brand img').src+'"><h1>Nơi dành cho<span class="rot"><ul id="w"><li>mod</li><li>gói tài nguyên</li><li>gói dữ liệu</li><li>shader</li><li>modpack</li><li>plugin</li><li>máy chủ</li></ul></span>MiniWorld</h1><p>Khám phá, chơi và chia sẻ nội dung MiniWorld trên nền tảng được xây dựng cho cộng đồng.</p><div class="cta"><a class="btn p" href="#/mods">Khám phá các tài nguyên</a>'+(u?'<a class="btn" href="#/dashboard">Đến bảng điều khiển</a>':'<a class="btn" href="#/signup">Đăng ký</a>')+'</div></section>'+(u?'<h2>Truy cập nhanh</h2><div class="qa"><a href="#/user"><b>Hồ sơ</b><small>Xem thông tin tài khoản của bạn</small></a><a href="#/dashboard"><b>Bảng điều khiển</b><small>Theo dõi hoạt động của bạn</small></a><a href="#/settings"><b>Cài đặt</b><small>Tùy chỉnh giao diện và ngôn ngữ</small></a></div>':'')+'<h2>Dự án nổi bật</h2><div class="plist '+(l==='grid'?'grid':'')+'">'+PJ.map(function(p){return'<div class="pc"><div class="pi" style="background:'+p[2]+'">'+p[0][0]+'</div><div><b>'+p[0]+'</b><small>'+p[1]+'</small></div></div>'}).join('')+'</div>';
var u=$('#w'),n=6,i=0;clearInterval(timer);L.apply(app);if(!matchMedia('(prefers-reduced-motion:reduce)').matches)timer=setInterval(function(){if(!u.isConnected)return clearInterval(timer);i++;u.style.transition='transform .6s cubic-bezier(.7,0,.2,1)';u.style.transform='translateY(-'+i*u.children[0].offsetHeight+'px)';if(i===n)setTimeout(function(){u.style.transition='none';u.style.transform='none';i=0},650)},2200)}
function settings(tab){clearInterval(timer);var b;
var isAcc=['profile','security'].indexOf(tab)>-1&&A.user();
if(isAcc){b='<div id="acc"></div>'}else if(tab==='language'){b='<h2>Ngôn ngữ</h2><div class="warn">Đổi ngôn ngữ có thể khiến một số nội dung hiển thị bằng tiếng Anh nếu chưa có bản dịch.</div><p>Chọn ngôn ngữ ưa thích cho trang web.</p><input class="srch" id="q" type="search" placeholder="Tìm ngôn ngữ..." aria-label="Tìm ngôn ngữ"><h3>Ngôn ngữ tiêu chuẩn</h3><div id="ll"></div>';}
else{b='<h2>Giao diện</h2><p>Chọn chủ đề màu ưa thích của bạn.</p><div class="themes" role="radiogroup">'+TH.map(function(t){return'<button class="opt'+(S.theme===t[0]?' on':'')+'" role="radio" aria-checked="'+(S.theme===t[0])+'" data-th="'+t[0]+'"><div class="pv" style="background:'+t[2]+';--c2:'+t[3]+';--c3:'+t[4]+';--c4:'+t[5]+'"><i></i></div><div class="ol"><span class="rd"></span>'+t[1]+'</div></button>'}).join('')+'</div><div class="row"><div><h3>Đồng bộ chủ đề trên các thiết bị</h3><p style="margin:0">Dùng chủ đề này ở mọi nơi bạn đăng nhập. Tắt để giữ chủ đề riêng trên thiết bị này.</p></div><button class="tg" role="switch" aria-checked="'+S.sync+'" aria-label="Đồng bộ chủ đề" id="sy"></button></div><div class="row"><div><h2 style="font-size:1.3rem">Bố cục danh sách dự án</h2><p style="margin:0">Chọn bố cục cho từng trang hiển thị danh sách dự án.</p></div></div>'+PR.map(function(p){return'<h3>Trang '+p[0]+'</h3><div class="lay">'+['rows','grid'].map(function(k){return'<button class="opt'+(S.lay[p[1]]===k?' on':'')+'" role="radio" aria-checked="'+(S.lay[p[1]]===k)+'" data-pg="'+p[1]+'" data-k="'+k+'"><div class="pv">'+(k==='rows'?'<div class="rows"><i></i><i></i><i></i><i></i></div>':'<div class="gr"><i></i><i></i><i></i><i></i></div>')+'</div><div class="ol"><span class="rd"></span>'+(k==='rows'?'Hàng':'Lưới')+'</div></button>'}).join('')+'</div>'}).join('')}
app.innerHTML='<h1 style="font-size:2.2rem;margin:20px 0">Cài đặt</h1><div class="sg"><div class="card side"><div class="lb">HIỂN THỊ</div><button data-t="" class="'+(!isAcc&&tab!=='language'?'on':'')+'">Giao diện</button><button data-t="language" class="'+(tab==='language'?'on':'')+'">Ngôn ngữ</button>'+A.sideAcc(tab)+'</div><div class="card">'+b+'</div></div>';
app.querySelectorAll('.side button').forEach(function(x){x.onclick=function(){location.hash='#/settings'+(x.dataset.t?'/'+x.dataset.t:'')}});
if(tab==='language'){var q=$('#q');function r(){var v=q.value.toLowerCase();$('#ll').innerHTML=LG.filter(function(g){return(g[2]+g[3]).toLowerCase().indexOf(v)>-1}).map(function(g){return'<button class="lg'+(cur()===g[0]?' on':'')+'" data-l="'+g[0]+'">'+F(g[0])+''+g[2]+' <small>'+g[3]+'</small><em>'+g[4]+'%</em><span class="ck">'+(cur()===g[0]?'✓':'')+'</span></button>'}).join('');$('#ll').querySelectorAll('.lg').forEach(function(x){x.onclick=function(){P=x.dataset.l;r();bar()}})}q.oninput=r;r()}
else if(!isAcc){app.querySelectorAll('[data-th]').forEach(function(x){x.onclick=function(){S.theme=x.dataset.th;save();theme();settings()}});app.querySelectorAll('[data-pg]').forEach(function(x){x.onclick=function(){S.lay[x.dataset.pg]=x.dataset.k;save();settings()}});$('#sy').onclick=function(){S.sync=!S.sync;save();settings()}}
if(isAcc)A.acc(tab);bar();L.apply(app)}
function route(){var h=location.hash,u,mo=$('#mo');if(mo)mo.remove();P=null;clearInterval(timer);theme();A.header();u=A.user();
 if(h==='#/reset-password'||new URLSearchParams(location.search).get('flow')==='reset-password'){A.resetPasswordPage();return}
 if(window.PAGE){if(h.indexOf('#/project/')===0){$('#ddb').classList.add('on');A.project(decodeURIComponent(h.slice(10))).then(function(){L.apply(document.body)});return}if(h.indexOf('#/user/')===0){$('#ddb').classList.add('on');A.profile(decodeURIComponent(h.slice(7)));L.apply(document.body);return}BR.page(window.PAGE);$('#ddb').classList.add('on');L.apply(document.body);return}
if(h==='#/resourcepacks'||h==='#/modpacks'){location.replace(h.slice(2)+'.html');return}
  if(h==='#/signin'||h==='#/signup'){if(u){location.replace('#/');return}A.auth(h==='#/signup'?'up':'in')}
else if(h==='#/dashboard'||h==='#/user'){if(!u){A.next=h;location.replace('#/signin');return}h==='#/user'?A.profile():A.dash()}
else if(h==='#/new'){if(!u){A.next=h;location.replace('#/signin');return}A.dash();A.newProject()}
else if(h.indexOf('#/project/')===0)A.project(decodeURIComponent(h.slice(10)))
else if(h.indexOf('#/user/')===0)A.profile(decodeURIComponent(h.slice(7)))
else if(BR.type(h))BR.page(BR.type(h));
else if(h.indexOf('#/settings')===0)settings(h.split('/')[2]);else home();$('#ddb').classList.toggle('on',!!BR.type(h));bar();L.apply(document.body);scrollTo(0,0)}
var dd=$('#dd'),db=$('#ddb');db.onclick=function(e){e.stopPropagation();var o=dd.classList.toggle('open');db.setAttribute('aria-expanded',o)};
function cl(){dd.classList.remove('open');db.setAttribute('aria-expanded','false')}
document.addEventListener('click',cl);addEventListener('keydown',function(e){if(e.key==='Escape')cl()});addEventListener('hashchange',cl);
addEventListener('hashchange',route);matchMedia('(prefers-color-scheme:light)').onchange=theme;L.set(S.lang);
if(API.init){app.innerHTML='<div class="card empty"><h2>'+L.t('Đang kết nối đến Modium…')+'</h2></div>';API.init().then(route).catch(function(){app.innerHTML='<div class="card empty"><h2>'+L.t('Không thể kết nối đến dịch vụ Modium.')+'</h2><p>'+L.t('Hãy kiểm tra cấu hình Supabase và thử lại.')+'</p><button class="btn p" id="retry-api">'+L.t('Thử lại')+'</button></div>';var b=$('#retry-api');if(b)b.onclick=function(){location.reload()}})}else route();
