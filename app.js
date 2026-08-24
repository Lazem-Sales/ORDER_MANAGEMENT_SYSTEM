// ═══════════ FIREBASE CONFIG ═══════════
const firebaseConfig = {
  apiKey: "AIzaSyAyWPs80w3tpvfjFO0-OyxJBJyZyLnlkiE",
  authDomain: "order-management-cef5a.firebaseapp.com",
  projectId: "order-management-cef5a",
  storageBucket: "order-management-cef5a.firebasestorage.app",
  messagingSenderId: "969684877727",
  appId: "1:969684877727:web:ee4be1f8bfdef3b3d93daa"
};
// التطبيق يعمل محلياً فوراً بدون انتظار Firebase (يُحمَّل async في الخلفية).
// متى ما وصل Firebase (بعد ثانية أو حتى بعد دقيقة حسب سرعة الشبكة)، نفعّله تلقائياً.
let db=null;
let fbReady=false;
function tryInitFirebase(){
  if(fbReady) return true;
  if(typeof firebase==='undefined') return false;
  try{
    firebase.initializeApp(firebaseConfig);
    db=firebase.firestore();
    fbReady=true;
    // لو المستخدم داخل بالفعل، فعّل المزامنة الآن
    if(currentUser) subscribeOrders();
    return true;
  }catch(e){console.warn('Firebase init failed:',e);return false;}
}
tryInitFirebase(); // محاولة فورية (قد تنجح إذا كان محفوظاً بذاكرة المتصفح مسبقاً)
let _fbAttempts=0;
const _fbPoll=setInterval(()=>{
  _fbAttempts++;
  if(tryInitFirebase()||_fbAttempts>100) clearInterval(_fbPoll); // يحاول كل 300ms لمدة 30 ثانية كحد أقصى
},300);

// ═══════════ STATE ═══════════
let currentUser = null;
let orders = [];
let cloudOrders = [];
let pendingOrders = [];
try{pendingOrders=JSON.parse(localStorage.getItem('lazem_pending')||'[]');}catch(e){pendingOrders=[];}
function persistPending(){localStorage.setItem('lazem_pending',JSON.stringify(pendingOrders));}
function mergeOrders(){
  // امنع التكرار: لو الطلب المحلي وصل فعلاً للسحابة (نفس localRef)، لا تعرضه مرتين — واحذفه من المعلّقة نهائياً
  const syncedRefs=new Set(cloudOrders.map(o=>o.localRef).filter(Boolean));
  if(pendingOrders.some(p=>syncedRefs.has(p.id))){
    pendingOrders=pendingOrders.filter(p=>!syncedRefs.has(p.id));
    persistPending();
  }
  orders=[...pendingOrders.map(p=>({...p,_pending:true})),...cloudOrders];
}
mergeOrders();
let openOrderId = null;
let currentSvc = null;
let authMode = 'login'; // or 'signup'
let unsubscribeOrders = null;

// ═══════════ BACKGROUND IMAGES ═══════════
function injectBgImages(){
  if(typeof IMG1==='undefined') return;
  document.querySelectorAll('.scene-img').forEach(el=>{el.style.backgroundImage='url('+IMG1+')';});
  const hbg=document.querySelector('.dash-hero-bg');
  if(hbg) hbg.style.backgroundImage='url('+IMG1+')';
}
document.addEventListener('DOMContentLoaded',function(){
  injectBgImages();
  if(typeof LOGO_SRC!=='undefined'){
    ['hdrLogo','loginLogo','heroLogo'].forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.src=LOGO_SRC;
    });
  }
});

// ═══════════ GUEST LOGIN (no account needed) ═══════════

// ═══════════ الوضع النهاري / الليلي ═══════════
function applyTheme(mode){
  const light=mode==='light';
  document.body.classList.toggle('light',light);
  try{localStorage.setItem('lazem_theme',light?'light':'dark');}catch(e){}
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute('content',light?'#EEF3F6':'#000000');
}
function toggleTheme(){
  applyTheme(document.body.classList.contains('light')?'dark':'light');
}
(function initTheme(){
  let saved=null;
  try{saved=localStorage.getItem('lazem_theme');}catch(e){}
  if(!saved&&window.matchMedia){
    saved=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';
  }
  applyTheme(saved||'dark');
})();

function doLogin(){
  const name=document.getElementById('loginNameInput').value.trim();
  if(!name){
    const inp=document.getElementById('loginNameInput');
    inp.classList.add('shake');
    setTimeout(()=>inp.classList.remove('shake'),500);
    return;
  }
  currentUser={uid:'guest_'+name.toLowerCase().replace(/\s+/g,'_'),name:name};
  localStorage.setItem('lazem_guest_name',name);
  document.getElementById('hdrUser').textContent=currentUser.name+' — خروج';
  mergeOrders();
  subscribeOrders();
  showPage('dashboard');
}
function logout(){
  currentUser=null;
  document.getElementById('hdrUser').textContent='تسجيل خروج';
  localStorage.removeItem('lazem_guest_name');
  if(unsubscribeOrders){unsubscribeOrders();unsubscribeOrders=null;}
  orders=[];
  document.getElementById('loginNameInput').value='';
  showPage('login');
}
// Auto-login if name saved
document.addEventListener('DOMContentLoaded',function(){
  const saved=localStorage.getItem('lazem_guest_name');
  if(saved){
    currentUser={uid:'guest_'+saved.toLowerCase().replace(/\s+/g,'_'),name:saved};
    document.getElementById('hdrUser').textContent=currentUser.name+' — خروج';
    subscribeOrders();
    showPage('dashboard');
  }
});

// ═══════════ FIRESTORE ORDERS (realtime) ═══════════
function subscribeOrders(){
  if(!db){mergeOrders();if(document.getElementById('page-dashboard').classList.contains('active'))renderDashboard();return;}
  if(!fbReady||!db){mergeOrders();return;}
  if(unsubscribeOrders) unsubscribeOrders();
  unsubscribeOrders=db.collection('orders').orderBy('createdAt','desc')
    .onSnapshot(snap=>{
      cloudOrders=snap.docs.map(d=>({id:d.id,...d.data()}));
      mergeOrders();
      if(document.getElementById('page-dashboard').classList.contains('active')){
        renderDashboard();
      }
      trySyncPending();
    },err=>{
      console.error('Firestore error:',err);
      showToast('خطأ في الاتصال بقاعدة البيانات');
    });
}

// ═══════════ NAVIGATION ═══════════


// ═══ فيديوهات الخلفية: تشغيل فيديو الصفحة النشطة فقط (توفير موارد) ═══
const _vidTimers={};
let _vidGen=0;
function setBgVideo(page){
  const gen=++_vidGen; // يلغي أي إظهار مؤجل من انتقال سابق
  const vids={login:'vidLogin',dashboard:'vidDashboard',form:'vidForm'};
  Object.entries(vids).forEach(([pg,id])=>{
    const v=document.getElementById(id);
    if(!v)return;
    if(_vidTimers[id]){clearTimeout(_vidTimers[id]);_vidTimers[id]=null;}
    if(pg===page){
      const pr=v.play();
      if(pr&&pr.catch)pr.catch(()=>{});
      const show=()=>{if(gen===_vidGen)v.classList.add('playing');};
      if(typeof requestAnimationFrame==='function')requestAnimationFrame(show);else setTimeout(show,16);
    }else{
      // تلاشَ أولاً ثم أوقف — يمنع القطع المفاجئ أثناء الانتقال
      v.classList.remove('playing');
      _vidTimers[id]=setTimeout(()=>{if(gen===_vidGen){try{v.pause();}catch(e){}}},1000);
    }
  });
}
// طلب جديد: يخرج من وضع التعديل ويصفّر النموذج قبل الفتح
function newOrder(){
  if(typeof editOrderId!=='undefined'&&editOrderId)exitEditState();
  resetForm();
  currentSvc=null;
  document.querySelectorAll('.svc-btn').forEach(b=>b.classList.remove('sel'));
  ['contract','events','projects','training'].forEach(s=>{
    const el=document.getElementById('sec-'+s);if(el)el.classList.remove('show');
  });
  const sc=document.getElementById('sec-client');if(sc)sc.classList.remove('show');
  const sw=document.getElementById('submit-wrap');if(sw)sw.style.display='none';
  updateCodePreview();
  showPage('form');
}
function showPage(page){
  if(page!=='login'&&!currentUser){page='login';}
  document.body.classList.toggle('on-login', page==='login');
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  setBgVideo(page);
  const tab=document.getElementById('tab-'+page);
  if(tab) tab.classList.add('active');
  if(page==='dashboard'){if(editOrderId)exitEditState();renderDashboard();}
  window.scrollTo({top:0,behavior:'smooth'});
}

// ═══════════ SERVICE PICKER ═══════════
function pickSvc(svc,btn){
  currentSvc=svc;
  document.querySelectorAll('.svc-btn').forEach(b=>b.classList.remove('sel'));
  btn.classList.add('sel');
  ['contract','events','projects','training'].forEach(s=>document.getElementById('sec-'+s).classList.remove('show'));
  document.getElementById('sec-client').classList.add('show');
  document.getElementById('sec-'+svc).classList.add('show');
  document.getElementById('submit-wrap').style.display='block';
  updateCodePreview();
  setTimeout(()=>{const s=document.getElementById('sec-client');if(s&&s.scrollIntoView)s.scrollIntoView({behavior:'smooth',block:'start'});},100);
}

function pick1(grp,btn,cls){
  btn.closest('.ch').querySelectorAll('.cb').forEach(b=>b.className='cb');
  btn.className='cb '+cls;
}
function toggleMulti(btn){btn.classList.toggle('sel');updateCodePreview();syncEventSvcCounts();}

// إظهار حقول العدد للفرق الراجلة وعربات القولف عند اختيارها بالفعاليات
let _restoringForm=false;
function syncSvcBlocks(prefix){
  const wrap=document.getElementById(prefix+'-svctype-wrap');if(!wrap)return;
  const sel=[...wrap.querySelectorAll('.cb.multi.sel')].map(b=>b.textContent.trim());
  const map=[
    ['amb',    x=>x.includes('إسعاف'), ['-amb-count','-amb-doctors','-amb-paramedics','-amb-drivers']],
    ['clinic', x=>x.includes('عيادة'), ['-clinic-count','-clinic-doctors','-clinic-nurses','-clinic-paramedics']],
    ['walk',   x=>x.includes('راجلة'), ['-walk-count','-walk-paramedics']],
    ['golf',   x=>x.includes('قولف'),  ['-golf-count','-golf-paramedics','-golf-drivers']]
  ];
  let any=false;
  map.forEach(([key,test,fields])=>{
    const on=sel.some(test);
    if(on)any=true;
    const blk=document.getElementById(prefix+'-blk-'+key);
    if(blk)blk.style.display=on?'block':'none';
    // أثناء استعادة نموذج التعديل لا نمسح القيم (الأزرار لم تُستعَد كلها بعد)
    if(!on&&!_restoringForm)fields.forEach(sfx=>{const i=document.getElementById(prefix+sfx);if(i)i.value='';});
  });
  const box=document.getElementById(prefix+'-svc-blocks');
  if(box)box.style.display=any?'flex':'none';
}
function syncEventSvcCounts(){syncSvcBlocks('e');syncSvcBlocks('p');}
function toggleCity(btn,groupId){
  btn.classList.toggle('sel');
  if(btn.classList.contains('city-other')){
    const otherId=groupId.replace('-cities','')+'-cities-other';
    const inp=document.getElementById(otherId);
    if(inp){inp.style.display=btn.classList.contains('sel')?'block':'none';if(btn.classList.contains('sel'))inp.focus();}
  }
}
function getCities(groupId){
  const el=document.getElementById(groupId);if(!el)return'';
  const selected=[...el.querySelectorAll('.city-cb.sel')].map(b=>b.textContent.trim());
  const otherId=groupId.replace('-cities','')+'-cities-other';
  const inp=document.getElementById(otherId);
  if(inp&&inp.style.display!=='none'&&inp.value.trim()){
    const idx=selected.indexOf('أخرى');if(idx!==-1)selected[idx]=inp.value.trim();else selected.push(inp.value.trim());
  }
  return selected.join('، ');
}



function chkEvAccom(){
  const n=parseInt((document.getElementById('e-dur-num')||{}).value)||0;
  const unit=getSelected('e-dur-unit')||'أيام';
  const d=unit.includes('شهر')||unit.includes('أشهر')?n*30:n; // تحويل الأشهر لأيام لفحص السكن
  const cities=getCities('e-cities');
  const out=cities&&!cities.includes('الرياض');
  document.getElementById('e-accom-wrap').className='cond s2'+(d>14&&out?' show':'');
}
// دورة التوعية بالإسعافات الأولية: حد أقصى 200 متدرب ولا تُقسَّم لجلسات
function isAwarenessOnly(){
  const aware=document.getElementById('crs-aware');
  if(!aware||!aware.checked)return false;
  // تكون توعوية فقط إذا لم تُختَر أي دورة أخرى
  return !['crs-fa','crs-fire','crs-ohs'].some(id=>{
    const el=document.getElementById(id);return el&&el.checked;
  });
}
function chkTrainees(){
  const el=document.getElementById('tr-count');if(!el)return;
  const n=parseInt(el.value)||0;
  const note=document.getElementById('tr-note');
  const lbl=document.getElementById('tr-count-note');
  const awareness=isAwarenessOnly();
  if(lbl)lbl.textContent=awareness?'الحد الأقصى 200 متدرب':'الحد الأقصى 20 لكل جلسة';
  if(!note)return;
  if(awareness){
    if(n>200){note.textContent='الحد الأقصى لدورة التوعية 200 متدرب';note.style.display='block';}
    else note.style.display='none';
  }else{
    if(n>20){note.textContent=`${n} متدرب — يتطلب ${Math.ceil(n/20)} جلسات`;note.style.display='block';}
    else note.style.display='none';
  }
}
function getMultiText(grpId){
  const el=document.getElementById(grpId);if(!el)return'';
  return[...el.querySelectorAll('.cb.multi.sel')].map(b=>b.textContent.trim()).join('، ');
}
function toggleEvTypeOther(show){
  const el=document.getElementById('e-evtype-other');
  if(!el)return;
  el.style.display=show?'block':'none';
  if(!show)el.value='';
  else el.focus();
}
function getSelected(grpId){
  const el=document.getElementById(grpId);if(!el)return'';
  const a=el.querySelector('.cb.t,.cb.g,.cb.r,.cb.a,.cb.n');return a?a.textContent.trim():'';
}
function v(id){const el=document.getElementById(id);return el?el.value.trim():'';}
function nextOrderCode(){
  // عدّاد تصاعدي دائم: لا يعيد استخدام رقم أبداً حتى بعد حذف طلبات
  let max=parseInt(localStorage.getItem('lazem_code_counter')||'0',10)||0;
  orders.forEach(o=>{const n=parseInt(o.code,10);if(!isNaN(n)&&n>max)max=n;});
  const next=max+1;
  localStorage.setItem('lazem_code_counter',String(next));
  return String(next).padStart(4,'0');
}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

// ═══════════ LZM CODE STRUCTURE (per Coding Standard v0.1) ═══════════
// LZM-[Classification]-[Level]-[Client]-[Year]  e.g. LZM-FMC-A-KAP-25
function getSvcTypes(secId){
  const sec=document.getElementById(secId);if(!sec)return[];
  return[...sec.querySelectorAll('.cb.multi.sel')].map(b=>b.textContent.trim());
}
function getProjectSvcTypes(){
  const sec=document.getElementById('sec-projects');if(!sec)return[];
  return[...sec.querySelectorAll('.cb.multi.sel')].map(b=>b.textContent.trim());
}
function getClassCode(){
  if(currentSvc==='contract')return'MT';
  if(currentSvc==='events'){
    const t=getSvcTypes('sec-events');
    const hasClinic=t.some(x=>x.includes('عيادة'));
    const hasAmb=t.some(x=>x.includes('إسعاف'));
    if(hasClinic&&hasAmb)return'CWA';
    if(hasClinic)return'CLI';
    return'FMC';
  }
  if(currentSvc==='training')return'TRG';
  if(currentSvc==='projects'){
    const t=getProjectSvcTypes();
    const hasClinic=t.some(x=>x.includes('عيادة'));
    const hasAmb=t.some(x=>x.includes('إسعاف'));
    if(hasClinic&&hasAmb)return'CWA';
    if(hasClinic)return'CLI';
    return'FMC';
  }
  return'•••';
}
const LEVELS={}; // selected equipment level per prefix: ev/pr/ct

function setLvl(prefix,val,btn){
  LEVELS[prefix]=val;
  document.querySelectorAll('[id^="'+prefix+'-lc-"]').forEach(c=>c.className='level-card');
  btn.className='level-card sel-lvl';
  updateCodePreview();
}

function getLevelCode(){
  if(currentSvc==='events')   return LEVELS['ev']||'NA';
  if(currentSvc==='projects') return LEVELS['pr']||'NA';
  if(currentSvc==='contract') return LEVELS['ct']||'NA';
  if(currentSvc==='training'){
    // Per standard: FA1=توعية, FA2=إسعافات+CPR+AED, FA3=بيئة العمل, FS=حرائق
    if(document.getElementById('crs-aware')&&document.getElementById('crs-aware').checked)return'FA1';
    if(document.getElementById('crs-fa')&&document.getElementById('crs-fa').checked)return'FA2';
    if(document.getElementById('crs-ohs')&&document.getElementById('crs-ohs').checked)return'FA3';
    if(document.getElementById('crs-fire')&&document.getElementById('crs-fire').checked)return'FS';
    return'NA';
  }
  return'NA';
}

function getLevelLabel(code){
  const map={'B':'B — أساسي (BLS)','B+':'B+ — أساسي معزز','A':'A — متقدم (ALS)','A+':'A+ — متقدم شامل','FA1':'FA1 — توعية إسعافات أولية','FA2':'FA2 — إسعافات أولية + CPR + AED','FA3':'FA3 — إسعافات بيئة العمل','FS':'FS — السلامة من الحرائق','FW':'FW — مشرف سلامة','NA':'NA'};
  return map[code]||code;
}

function getYearCode(){
  let d=null;
  if(currentSvc==='events'&&v('e-start'))d=new Date(v('e-start'));
  else if(currentSvc==='projects'&&v('p-start'))d=new Date(v('p-start'));
  if(!d||isNaN(d))d=new Date();
  return String(d.getFullYear()).slice(-2);
}

function buildLzmCode(){
  const cls=currentSvc?getClassCode():'•••';
  const lvl=currentSvc?getLevelCode():'••';
  const cli=v('f-client-code')||'•••';
  const yr=getYearCode();
  return `LZM-${cls}-${lvl}-${cli}-${yr}`;
}

// Sequential suffix per standard: if same client+class+level+year exists → -01/-02...
function finalizeLzmCode(base){
  const dupes=orders.filter(o=>(o.lzmCode||'').startsWith(base));
  if(dupes.length===0)return base;
  return base+'-'+String(dupes.length+1).padStart(2,'0');
}

function updateCodePreview(){
  const el=document.getElementById('codePreviewValue');
  if(el) el.textContent=buildLzmCode();
}

// ═══════════ SAVE ORDER (to Firestore) ═══════════
let _submitting=false;
async function saveOrder(){
  if(_submitting)return; // يمنع الضغط المزدوج/المتكرر من إنشاء طلبين
  const clientName=v('f-client-name');
  if(!clientName){showToast('أدخل اسم العميل');document.getElementById('f-client-name').focus();return;}
  if(!currentSvc){showToast('اختر نوع الخدمة');return;}
  const clientCode=v('f-client-code');
  if(!clientCode||clientCode.length<2){showToast('أدخل رمز العميل (3 أحرف)');document.getElementById('f-client-code').focus();return;}

  // الحقول الإلزامية حسب نوع الخدمة
  if(currentSvc==='events'){
    if(!getSelected('e-evtype')){showToast('اختر نوع الفعالية');const _ev=document.getElementById('e-evtype');if(_ev&&_ev.scrollIntoView)_ev.scrollIntoView({behavior:'smooth',block:'center'});return;}
    if(getSelected('e-evtype')==='أخرى'&&!v('e-evtype-other')){showToast('اكتب نوع الفعالية');document.getElementById('e-evtype-other').focus();return;}
    if(!v('e-hours')){showToast('أدخل عدد الساعات اليومية');document.getElementById('e-hours').focus();return;}
    if(!v('e-dur-num')){showToast('أدخل المدة الزمنية');document.getElementById('e-dur-num').focus();return;}
  }
  if(currentSvc==='projects'){
    if(!v('p-hours')){showToast('أدخل ساعات العمل اليومية');document.getElementById('p-hours').focus();return;}
    if(!v('p-dur-num')){showToast('أدخل المدة الزمنية');document.getElementById('p-dur-num').focus();return;}
  }

  const svcLabels={contract:'عقود النقل',events:'تغطية الفعاليات',projects:'تغطية المشاريع',training:'الدورات التدريبية'};
  let details={};

  if(currentSvc==='contract'){
    details={'مستوى التجهيز':getLevelLabel(LEVELS['ct']||'NA'),'مدة العقد':getSelected('c-dur'),'المدينة':getSelected('c-city'),'اسم الجهة':v('c-company')};
  } else if(currentSvc==='events'){
    details={'مستوى التجهيز':getLevelLabel(LEVELS['ev']||'NA'),'نوع الفعالية':(getSelected('e-evtype')==='أخرى'?(v('e-evtype-other')||'أخرى'):getSelected('e-evtype')),'نوع الخدمة':getSvcTypes('sec-events').join('، '),
      'سيارات الإسعاف':v('e-amb-count'),'أطباء الإسعاف':v('e-amb-doctors'),'مسعفو الإسعاف':v('e-amb-paramedics'),'سائقو الإسعاف':v('e-amb-drivers'),
      'عدد العيادات':v('e-clinic-count'),'أطباء العيادة':v('e-clinic-doctors'),'ممرضو العيادة':v('e-clinic-nurses'),'مسعفو العيادة':v('e-clinic-paramedics'),
      'عدد الفرق الراجلة':v('e-walk-count'),'مسعفو الفرق الراجلة':v('e-walk-paramedics'),
      'عدد عربات القولف':v('e-golf-count'),'مسعفو عربات القولف':v('e-golf-paramedics'),'سائقو عربات القولف':v('e-golf-drivers'),'عدد الحضور':v('e-attendees'),'المدة الزمنية':(v('e-dur-num')?v('e-dur-num')+' '+(getSelected('e-dur-unit')||'أيام'):''),'ساعات يومياً':v('e-hours'),'تاريخ البداية':v('e-start'),'المدن':getCities('e-cities'),'الموقع':v('e-loc'),'السكن':getSelected('e-accom')};
  } else if(currentSvc==='projects'){
    details={'مستوى التجهيز':getLevelLabel(LEVELS['pr']||'NA'),'طبيعة المشروع':getSelected('p-type'),'نوع الأيام':getSelected('p-dtype'),'ساعات العمل اليومية':v('p-hours'),'أيام الأسبوع':v('p-dweek'),'المدة الزمنية':(v('p-dur-num')?v('p-dur-num')+' '+(getSelected('p-dur-unit')||'أشهر'):''),'تاريخ البداية':v('p-start'),'المدن':getCities('p-cities'),'عدد العاملين في المشروع':v('p-workers'),'نوع الخدمة':getProjectSvcTypes().join('، '),
      'سيارات الإسعاف':v('p-amb-count'),'أطباء الإسعاف':v('p-amb-doctors'),'مسعفو الإسعاف':v('p-amb-paramedics'),'سائقو الإسعاف':v('p-amb-drivers'),
      'عدد العيادات':v('p-clinic-count'),'أطباء العيادة':v('p-clinic-doctors'),'ممرضو العيادة':v('p-clinic-nurses'),'مسعفو العيادة':v('p-clinic-paramedics'),
      'عدد الفرق الراجلة':v('p-walk-count'),'مسعفو الفرق الراجلة':v('p-walk-paramedics'),
      'عدد عربات القولف':v('p-golf-count'),'مسعفو عربات القولف':v('p-golf-paramedics'),'سائقو عربات القولف':v('p-golf-drivers'),'السكن والإعاشة':getSelected('p-accom')};
  } else if(currentSvc==='training'){
    const courses=[];
    if(document.getElementById('crs-aware').checked)courses.push('توعية بالإسعافات الأولية (4 ساعات)');
    if(document.getElementById('crs-fa').checked)courses.push('الإسعافات الأولية (7 ساعات)');
    if(document.getElementById('crs-fire').checked)courses.push('السلامة من الحرائق (6 ساعات)');
    if(document.getElementById('crs-ohs').checked)courses.push('الصحة والسلامة المهنية (6 ساعات)');
    const n=parseInt(v('tr-count'))||0;
    const trLoc=getSelected('tr-loc');
    const trCities=trLoc&&trLoc.includes('خارج')?getCities('tr-cities'):'الرياض';
    const awareness=isAwarenessOnly();
    details={'مكان الدورة':trLoc+(trCities&&trLoc.includes('خارج')?' — '+trCities:''),'مقر التدريب':getSelected('tr-venue'),'نوع الاعتماد':getSelected('tr-cert'),'اللغة':getMultiText('tr-lang'),'عدد المتدربين':v('tr-count'),'الدورات المطلوبة':courses.join('، '),'اسم الجهة':v('tr-company')};
    // عدد الجلسات لا ينطبق على دورة التوعية (حد 200 بجلسة واحدة)
    if(!awareness)details['عدد الجلسات']=n>20?Math.ceil(n/20)+' جلسات':'1 جلسة';
  }

  Object.keys(details).forEach(k=>{if(!details[k])delete details[k];});

  _submitting=true;
  const submitBtn=document.querySelector('.submit-btn');
  if(submitBtn){submitBtn.disabled=true;submitBtn.style.opacity='.6';}

  const formState=captureFormState(currentSvc);

  // ═══ وضع التعديل: تحديث الطلب الموجود بدل إنشاء جديد ═══
  if(editOrderId){
    const o=orders.find(x=>x.id===editOrderId);
    if(o){
      const upd={
        clientName,clientCode,
        notes:v('f-client-notes'),
        details,formState,
        svc:currentSvc,svcLabel:svcLabels[currentSvc]
      };
      // إعادة توليد كود LZM إذا تغيرت مكوناته (مع استثناء الطلب نفسه من عدّ التكرار)
      const base=buildLzmCode();
      if(!(o.lzmCode||'').startsWith(base)){
        const dupes=orders.filter(x=>x.id!==editOrderId&&(x.lzmCode||'').startsWith(base));
        upd.lzmCode=dupes.length===0?base:base+'-'+String(dupes.length+1).padStart(2,'0');
      }
      Object.assign(o,upd);
      if(String(o.id).startsWith('LOCAL-')){
        const p=pendingOrders.find(x=>x.id===o.id);
        if(p)Object.assign(p,upd);
        persistPending();
      }else if(db){
        // تحديث فوري محلياً، والمزامنة السحابية بالخلفية بدون انتظار
        const c=cloudOrders.find(x=>x.id===o.id);
        if(c)Object.assign(c,upd);
        db.collection('orders').doc(o.id).update(upd)
          .catch(()=>showToast('حُفظ محلياً — تعذرت المزامنة السحابية'));
      }
      mergeOrders();
      showToast('تم حفظ التعديلات على الطلب #'+(o.code||''));
    }
    exitEditState();
    resetForm();
    showPage('dashboard');
    _submitting=false;
    if(submitBtn){submitBtn.disabled=false;submitBtn.style.opacity='1';}
    return;
  }

  const order={
    id:'LOCAL-'+Date.now(),
    code:nextOrderCode(),
    lzmCode:finalizeLzmCode(buildLzmCode()),
    clientCode:clientCode,
    createdAt:new Date().toISOString(),
    svc:currentSvc,svcLabel:svcLabels[currentSvc],
    clientName,
    notes:v('f-client-notes'),
    details,formState,
    addedBy:currentUser.name,
    addedByUid:currentUser.uid
  };

  // Instant local save — always succeeds
  pendingOrders.unshift(order);
  persistPending();
  mergeOrders();
  showToast('تم حفظ الطلب!');
  resetForm();
  showPage('dashboard');
  _submitting=false;
  if(submitBtn){submitBtn.disabled=false;submitBtn.style.opacity='1';}

  // Background cloud sync (non-blocking)
  trySyncPending();
}

// ═══════════ BACKGROUND SYNC ═══════════
let syncing=false;
async function trySyncPending(){
  if(!fbReady||!db)return;
  if(syncing||!pendingOrders.length)return;
  syncing=true;
  const queue=[...pendingOrders];
  for(const item of queue){
    try{
      const data={...item};
      const localId=data.id;
      delete data.id;
      data.localRef=localId; // مرجع للمطابقة لاحقاً ومنع التكرار
      data.createdAtLocal=data.createdAt;
      data.createdAt=firebase.firestore.FieldValue.serverTimestamp();
      const timeout=new Promise((_,rej)=>setTimeout(()=>rej(new Error('T')),10000));
      await Promise.race([timeout, db.collection('orders').add(data)]);
      pendingOrders=pendingOrders.filter(p=>p.id!==localId);
      persistPending();
    }catch(e){
      break; // stop on first failure, retry later
    }
  }
  mergeOrders();
  if(document.getElementById('page-dashboard').classList.contains('active'))renderDashboard();
  syncing=false;
}
// Retry sync periodically
setInterval(trySyncPending,30000);

function resetForm(){
  currentSvc=null;
  document.querySelectorAll('.svc-btn').forEach(b=>b.classList.remove('sel'));
  ['contract','events','projects','training'].forEach(s=>document.getElementById('sec-'+s).classList.remove('show'));
  document.getElementById('sec-client').classList.remove('show');
  document.getElementById('submit-wrap').style.display='none';
  document.querySelectorAll('.form-section input,.form-section textarea').forEach(el=>el.value='');
  document.querySelectorAll('.cb').forEach(b=>b.className=b.className.includes('multi')?'cb multi':'cb');
  document.querySelectorAll('.city-cb').forEach(b=>b.classList.remove('sel'));
  document.querySelectorAll('input[type=checkbox]').forEach(c=>c.checked=false);
  document.querySelectorAll('.level-card').forEach(c=>c.className='level-card');
  Object.keys(LEVELS).forEach(k=>delete LEVELS[k]);
  const tcw=document.getElementById('tr-city-wrap');if(tcw)tcw.style.display='none';
  const eto=document.getElementById('e-evtype-other');if(eto){eto.value='';eto.style.display='none';}
  document.querySelectorAll('#tr-cities .city-cb').forEach(b=>b.classList.remove('sel'));
  ['e','p'].forEach(px=>[px+'-svc-blocks',px+'-blk-amb',px+'-blk-clinic',px+'-blk-walk',px+'-blk-golf'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';}));
  const tco=document.getElementById('tr-cities-other');if(tco){tco.value='';tco.style.display='none';}
  const tcn=document.getElementById('tr-count-note');if(tcn)tcn.textContent='الحد الأقصى 20 لكل جلسة';
  currentVideoKey=null;
}

// ═══════════ DASHBOARD ═══════════
function renderDashboard(){
  const all=orders.length;
  document.getElementById('st-all').textContent=all;
  document.getElementById('st-events').textContent=orders.filter(o=>o.svc==='events').length;
  document.getElementById('st-projects').textContent=orders.filter(o=>o.svc==='projects').length;
  document.getElementById('st-training').textContent=orders.filter(o=>o.svc==='training').length;
  document.getElementById('hdrCount').textContent='عدد الطلبات '+all;
  const hAll=document.getElementById('hero-all');
  const hEv=document.getElementById('hero-events');
  const hPr=document.getElementById('hero-projects');
  if(hAll)hAll.textContent=all;
  if(hEv)hEv.textContent=orders.filter(o=>o.svc==='events').length;
  if(hPr)hPr.textContent=orders.filter(o=>o.svc==='projects').length;
  renderOrders();
}

function fmtDate(ts,opts){
  if(!ts)return'...';
  const d=ts.toDate?ts.toDate():new Date(ts);
  return d.toLocaleDateString('ar-SA',opts||{day:'2-digit',month:'short',year:'numeric'});
}

const SVC_SVG={
    contract:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    events:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    projects:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    training:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>',
};

function renderOrders(){
  const search=(document.getElementById('searchInput').value||'').toLowerCase();
  const svcFilter=document.getElementById('filterSvc').value;
  let filtered=orders.filter(o=>{
    const m=(o.clientName||'').toLowerCase().includes(search)||(o.addedBy||'').toLowerCase().includes(search)||(o.lzmCode||'').toLowerCase().includes(search)||(o.clientCode||'').toLowerCase().includes(search)||(o.code||'').includes(search);
    return m&&(!svcFilter||o.svc===svcFilter);
  });
  const list=document.getElementById('ordersList');

  if(!filtered.length){
    list.innerHTML=`<div class="empty-state"><p>${orders.length?'لا توجد نتائج مطابقة':'لا يوجد طلبات بعد — اضغط طلب جديد للبدء'}</p></div>`;
    return;
  }
  list.innerHTML=filtered.map(o=>{
    const date=fmtDate(o.createdAt);
    const lv=o.details&&(o.details['مستوى التجهيز']||o.details['مستوى الخدمة']);const level=lv?` · ${lv.split(' — ')[0]}`:'';
    return `<div class="order-card" onclick="openOrder('${o.id}')">
      <div class="order-card-top">
        <div class="order-svc-icon ${o.svc}">${SVC_SVG[o.svc]||''}</div>
        <span class="status-badge">${o._pending?'محلي':'جديد'}</span>
      </div>
      <div class="order-name">${esc(o.clientName)}</div>
      <div class="order-svc-lbl">${o.svcLabel}${level}</div>
      <div class="order-card-footer">
        <span class="order-who">تم بواسطة: ${esc(o.addedBy||'—')}</span>
        <span class="order-num">${o.lzmCode||'#'+(o.code||'')} · ${date}</span>
      </div>
    </div>`;
  }).join('');
}

// ═══════════ ORDER DETAIL ═══════════
function openOrder(id){
  const o=orders.find(x=>x.id===id);if(!o)return;
  openOrderId=id;
  const svcColors={contract:'rgba(94,203,216,.12)',events:'rgba(251,191,36,.1)',projects:'rgba(42,138,159,.12)',training:'rgba(52,211,153,.1)'};
  const icon=document.getElementById('dIcon');
  icon.innerHTML=SVC_SVG[o.svc]||'';icon.style.background=svcColors[o.svc];
  document.getElementById('dName').textContent=o.clientName;
  const date=fmtDate(o.createdAt,{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'});
  document.getElementById('dMeta').textContent=`${o.lzmCode||'#'+(o.code||'')} · ${date}`;
  const dBy=document.getElementById('dBy');
  if(dBy)dBy.textContent=`تم الطلب بواسطة: ${o.addedBy||'—'}`;
  const rows=[['كود المشروع',o.lzmCode||''],['رقم الطلب',`#${o.code||''}`],['اسم العميل',o.clientName],...Object.entries(o.details||{}),['ملاحظات',o.notes||'']].filter(r=>r[1]&&r[1]!=='—'&&r[1]!=='');
  document.getElementById('dRows').innerHTML=rows.map(([l,vv])=>`<div class="detail-row"><span class="dr-label">${esc(l)}</span><span class="dr-val">${esc(vv)}</span></div>`).join('');
  document.getElementById('detailOverlay').classList.add('show');
}
function closeDetail(){document.getElementById('detailOverlay').classList.remove('show');openOrderId=null;}



// ═══════════ EDIT ORDER — يفتح نموذج الطلب الأصلي معبأً ═══════════
let editOrderId=null;
const SVC_BTN_INDEX={contract:0,events:1,projects:2,training:3};

function captureFormState(svc){
  const fs={inputs:{},checks:{},choices:{},multis:{},levels:{...LEVELS}};
  ['f-client-name','f-client-code','f-client-notes'].forEach(id=>{
    const el=document.getElementById(id);if(el)fs.inputs[id]=el.value;
  });
  const sec=document.getElementById('sec-'+svc);
  if(sec){
    sec.querySelectorAll('input[id],select[id],textarea[id]').forEach(el=>{
      if(el.type==='checkbox')fs.checks[el.id]=el.checked;
      else fs.inputs[el.id]=el.value;
    });
    sec.querySelectorAll('.ch[id]').forEach(g=>{
      const sel=getSelected(g.id);
      if(sel)fs.choices[g.id]=sel;
    });
    ['e-svctype-wrap','p-svctype-wrap','tr-lang-wrap'].forEach(wid=>{
      const w=document.getElementById(wid);
      if(w&&sec.contains(w)){
        fs.multis[wid]=[...w.querySelectorAll('.cb.multi.sel')].map(b=>b.textContent.trim());
      }
    });
    // أزرار المدن (متعددة الاختيار)
    fs.cities={};
    sec.querySelectorAll('.cities-wrap[id]').forEach(cw=>{
      fs.cities[cw.id]=[...cw.querySelectorAll('.city-cb.sel')].map(b=>b.textContent.trim());
      const oi=document.getElementById(cw.id+'-other');
      if(oi&&oi.value.trim())fs.inputs[cw.id+'-other']=oi.value;
    });
    // حاويات شرطية ظاهرة (مثل مدن الدورات)
    fs.shown=[...sec.querySelectorAll('[id$="-wrap"]')].filter(x=>x.style.display==='block').map(x=>x.id);
  }
  return fs;
}

function restoreFormState(svc,fs){
  if(!fs)return;
  _restoringForm=true;
  Object.entries(fs.inputs||{}).forEach(([id,val])=>{
    const el=document.getElementById(id);
    if(el){el.value=val;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
  });
  Object.entries(fs.checks||{}).forEach(([id,ck])=>{
    const el=document.getElementById(id);
    if(el){el.checked=ck;el.dispatchEvent(new Event('change',{bubbles:true}));}
  });
  Object.entries(fs.choices||{}).forEach(([gid,txt])=>{
    const g=document.getElementById(gid);if(!g)return;
    const btn=[...g.querySelectorAll('.cb')].find(b=>b.textContent.trim()===txt);
    if(btn)btn.click();
  });
  Object.entries(fs.multis||{}).forEach(([wid,arr])=>{
    const w=document.getElementById(wid);if(!w)return;
    (arr||[]).forEach(txt=>{
      const btn=[...w.querySelectorAll('.cb.multi')].find(b=>b.textContent.trim()===txt&&!b.classList.contains('sel'));
      if(btn)btn.click();
    });
  });
  Object.entries(fs.levels||{}).forEach(([prefix,val])=>{
    const btn=document.getElementById(prefix+'-lc-'+String(val).replace('+','p'));
    if(btn)btn.click();
  });
  // إظهار الحاويات الشرطية أولاً ثم استعادة المدن بداخلها
  (fs.shown||[]).forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='block';});
  syncEventSvcCounts();
  Object.entries(fs.cities||{}).forEach(([cwId,arr])=>{
    const cw=document.getElementById(cwId);if(!cw)return;
    (arr||[]).forEach(txt=>{
      const btn=[...cw.querySelectorAll('.city-cb')].find(b=>b.textContent.trim()===txt&&!b.classList.contains('sel'));
      if(btn)btn.click();
    });
    const oi=document.getElementById(cwId+'-other');
    if(oi&&(fs.inputs||{})[cwId+'-other']){oi.value=fs.inputs[cwId+'-other'];oi.style.display='block';}
  });
  updateCodePreview();
  chkTrainees();
}


// استعادة الخيارات من تفاصيل الطلب (للطلبات المحفوظة قبل ميزة لقطة النموذج)
const DETAIL_TO_INPUT={
  contract:{'اسم الجهة':'c-company'},
  events:{'سيارات الإسعاف':'e-amb-count','أطباء الإسعاف':'e-amb-doctors','مسعفو الإسعاف':'e-amb-paramedics','سائقو الإسعاف':'e-amb-drivers','عدد العيادات':'e-clinic-count','أطباء العيادة':'e-clinic-doctors','ممرضو العيادة':'e-clinic-nurses','مسعفو العيادة':'e-clinic-paramedics','عدد الفرق الراجلة':'e-walk-count','مسعفو الفرق الراجلة':'e-walk-paramedics','عدد عربات القولف':'e-golf-count','مسعفو عربات القولف':'e-golf-paramedics','سائقو عربات القولف':'e-golf-drivers','أطباء':'e-clinic-doctors','مسعفون':'e-amb-paramedics','ممرضون':'e-clinic-nurses','سائقون':'e-amb-drivers','عدد الحضور':'e-attendees','ساعات يومياً':'e-hours','تاريخ البداية':'e-start','الموقع':'e-loc'},
  projects:{'عدد العاملين في المشروع':'p-workers','ساعات العمل اليومية':'p-hours','أيام الأسبوع':'p-dweek','تاريخ البداية':'p-start','سيارات الإسعاف':'p-amb-count','أطباء الإسعاف':'p-amb-doctors','مسعفو الإسعاف':'p-amb-paramedics','سائقو الإسعاف':'p-amb-drivers','عدد العيادات':'p-clinic-count','أطباء العيادة':'p-clinic-doctors','ممرضو العيادة':'p-clinic-nurses','مسعفو العيادة':'p-clinic-paramedics','عدد الفرق الراجلة':'p-walk-count','مسعفو الفرق الراجلة':'p-walk-paramedics','عدد عربات القولف':'p-golf-count','مسعفو عربات القولف':'p-golf-paramedics','سائقو عربات القولف':'p-golf-drivers','أطباء':'p-clinic-doctors','مسعفون':'p-amb-paramedics','ممرضون':'p-clinic-nurses','سائقون':'p-amb-drivers'},
  training:{'عدد المتدربين':'tr-count','اسم الجهة':'tr-company'}
};
function restoreFromDetails(svc,details){
  const sec=document.getElementById('sec-'+svc);if(!sec)return;
  _restoringForm=true;
  // الحقول النصية والرقمية
  const map=DETAIL_TO_INPUT[svc]||{};
  Object.entries(map).forEach(([key,id])=>{
    const el=document.getElementById(id);
    if(el&&details[key]){el.value=details[key];el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
  });
  // أزرار الاختيار: نطابق نص الزر مع أي قيمة موجودة بالتفاصيل
  const vals=Object.values(details).map(x=>String(x));
  sec.querySelectorAll('.ch[id] .cb').forEach(btn=>{
    const t=btn.textContent.trim();
    if(vals.some(v=>v===t||v.startsWith(t+' —')))btn.click();
  });
  // اللغات المتعددة (الدورات)
  if(svc==='training'&&details['اللغة']){
    String(details['اللغة']).split('،').map(s=>s.trim()).filter(Boolean).forEach(lang=>{
      const b=[...document.querySelectorAll('#tr-lang .cb.multi')].find(x=>x.textContent.trim()===lang&&!x.classList.contains('sel'));
      if(b)b.click();
    });
  }
  // الخدمات المتعددة
  const svcTypes=String(details['نوع الخدمة']||'').split('،').map(s=>s.trim()).filter(Boolean);
  sec.querySelectorAll('.cb.multi').forEach(btn=>{
    if(svcTypes.includes(btn.textContent.trim())&&!btn.classList.contains('sel'))btn.click();
  });
  syncEventSvcCounts();
  // المدة الزمنية: تفكيك النص لرقم ووحدة (الفعاليات والمشاريع)
  if(svc==='projects'||svc==='events'){
    const dpx=svc==='projects'?'p':'e';
    const raw=details['المدة الزمنية']||details['عدد الأيام']||'';
    if(raw){
      const m=String(raw).match(/(\d+)\s*(.*)/);
      if(m){
        const numEl=document.getElementById(dpx+'-dur-num');if(numEl)numEl.value=m[1];
        const txt=m[2]||'';
        const unit=(txt.includes('شهر')||txt.includes('أشهر'))?'أشهر':'أيام';
        const b=[...document.querySelectorAll('#'+dpx+'-dur-unit .cb')].find(x=>x.textContent.trim()===unit);
        if(b)b.click();
      }
    }
  }
  // نوع الفعالية: لو قيمة غير مدرجة فهي "أخرى" بنص حر
  if(svc==='events'&&details['نوع الفعالية']){
    const val=String(details['نوع الفعالية']).trim();
    const btns=[...document.querySelectorAll('#e-evtype .cb')];
    const exact=btns.find(b=>b.textContent.trim()===val);
    if(exact){exact.click();}
    else{
      const other=btns.find(b=>b.textContent.trim()==='أخرى');
      if(other){other.click();const inp=document.getElementById('e-evtype-other');if(inp){inp.style.display='block';inp.value=val;}}
    }
  }
  const _px=(svc==='projects')?'p':'e';
  [['سيارات الإسعاف','-amb-count'],['أطباء الإسعاف','-amb-doctors'],['مسعفو الإسعاف','-amb-paramedics'],['سائقو الإسعاف','-amb-drivers'],['عدد العيادات','-clinic-count'],['أطباء العيادة','-clinic-doctors'],['ممرضو العيادة','-clinic-nurses'],['مسعفو العيادة','-clinic-paramedics'],['عدد الفرق الراجلة','-walk-count'],['مسعفو الفرق الراجلة','-walk-paramedics'],['عدد عربات القولف','-golf-count'],['مسعفو عربات القولف','-golf-paramedics'],['سائقو عربات القولف','-golf-drivers'],['أطباء','-clinic-doctors'],['مسعفون','-amb-paramedics'],['ممرضون','-clinic-nurses'],['سائقون','-amb-drivers']].map(([k,s])=>[k,_px+s]).forEach(([k,id])=>{
    const el=document.getElementById(id);if(el&&details[k])el.value=details[k];
  });
  _restoringForm=false;
  // مستوى التجهيز
  const lvlRaw=String(details['مستوى التجهيز']||'');
  const lvl=lvlRaw.split(' — ')[0].trim();
  const prefix={events:'ev',projects:'pr',contract:'ct'}[svc];
  if(prefix&&lvl){const b=document.getElementById(prefix+'-lc-'+lvl.replace('+','p'));if(b)b.click();}
  // مدينة خارج الرياض بالدورات
  if(svc==='training'){
    const loc=String(details['مكان الدورة']||'');
    if(loc.includes('—')){
      const citiesStr=loc.split('—')[1].trim();
      const wrap=document.getElementById('tr-city-wrap');if(wrap)wrap.style.display='block';
      const list=citiesStr.split('،').map(s=>s.trim()).filter(Boolean);
      const known=[...document.querySelectorAll('#tr-cities .city-cb')].map(b=>b.textContent.trim());
      list.forEach(c=>{
        const btn=[...document.querySelectorAll('#tr-cities .city-cb')].find(b=>b.textContent.trim()===c);
        if(btn&&!btn.classList.contains('sel'))btn.click();
        else if(!known.includes(c)){
          const other=[...document.querySelectorAll('#tr-cities .city-cb')].find(b=>b.textContent.trim()==='أخرى');
          if(other&&!other.classList.contains('sel'))other.click();
          const inp=document.getElementById('tr-cities-other');if(inp)inp.value=c;
        }
      });
    }
    const courses=String(details['الدورات المطلوبة']||'');
    [['crs-aware','توعية'],['crs-fa','الإسعافات الأولية (7'],['crs-fire','الحرائق'],['crs-ohs','الصحة والسلامة']].forEach(([id,frag])=>{
      const el=document.getElementById(id);
      if(el){el.checked=courses.includes(frag);el.dispatchEvent(new Event('change',{bubbles:true}));}
    });
  }
  updateCodePreview();
}

function startEditOrder(){
  if(!openOrderId)return;
  const o=orders.find(x=>x.id===openOrderId);if(!o)return;
  closeDetail();
  editOrderId=o.id;
  showPage('form');
  const btn=document.querySelectorAll('.svc-btn')[SVC_BTN_INDEX[o.svc]??0];
  pickSvc(o.svc,btn);
  // تعبئة الحقول الأساسية دائماً
  const nm=document.getElementById('f-client-name');if(nm)nm.value=o.clientName||'';
  // رمز العميل: من الطلب، وإلا نستنتجه من كود LZM (الجزء الرابع) للطلبات القديمة
  let ccVal=o.clientCode||'';
  if(!ccVal&&o.lzmCode){const parts=String(o.lzmCode).split('-');if(parts.length>=4)ccVal=parts[3];}
  const cc=document.getElementById('f-client-code');if(cc)cc.value=ccVal;
  const nt=document.getElementById('f-client-notes');if(nt)nt.value=o.notes||'';
  // استعادة كل الخيارات إن كانت محفوظة
  if(o.formState)restoreFormState(o.svc,o.formState);
  else restoreFromDetails(o.svc,o.details||{});
  updateCodePreview();
  // تغيير نص زر الحفظ
  const sb=document.querySelector('.submit-btn');
  if(sb)sb.textContent='حفظ التعديلات على الطلب #'+(o.code||'');
  showToast('وضع التعديل — عدّل الخيارات ثم احفظ');
}

function exitEditState(){
  editOrderId=null;
  const sb=document.querySelector('.submit-btn');
  if(sb)sb.textContent='حفظ الطلب في السجل';
}

async function deleteOrder(){
  if(!openOrderId)return;
  if(!confirm('هل تريد حذف هذا الطلب نهائياً؟'))return;
  if(openOrderId.startsWith('LOCAL-')){
    pendingOrders=pendingOrders.filter(p=>p.id!==openOrderId);
    persistPending();mergeOrders();
    closeDetail();renderDashboard();
    showToast('تم حذف الطلب');
    return;
  }
  if(!fbReady||!db){showToast('لا اتصال بقاعدة البيانات');return;}
  if(!db){showToast('لا يمكن حذف طلب سحابي بدون اتصال');return;}
  try{
    await db.collection('orders').doc(openOrderId).delete();
    closeDetail();
    showToast('تم حذف الطلب');
  }catch(err){
    showToast('فشل الحذف');
  }
}

function buildOrderText(o){
  const brand=(o.svc==='training')?'لازم للتدريب — Lazem Training':'لازم للخدمات الطبية — Lazem Medical Services';
  let txt=`${brand}\n━━━━━━━━━━━━━━━━\n`;
  txt+=`كود المشروع: ${o.lzmCode||''}\nرقم الطلب: #${o.code||''}\nالعميل: ${o.clientName}\n`;
  txt+=`الخدمة: ${o.svcLabel}\nتم الطلب بواسطة: ${o.addedBy||'—'}\n━━━━━━━━━━━━━━━━\n`;
  Object.entries(o.details||{}).forEach(([k,vv])=>{if(vv)txt+=`${k}: ${vv}\n`;});
  if(o.notes)txt+=`ملاحظات: ${o.notes}\n`;
  txt+=`━━━━━━━━━━━━━━━━\n`;
  return txt;
}
function copyOrder(){if(!openOrderId)return;const o=orders.find(x=>x.id===openOrderId);if(!o)return;navigator.clipboard.writeText(buildOrderText(o)).then(()=>showToast('تم النسخ!')).catch(()=>showToast('تعذّر النسخ'));}
function shareOrder(){if(!openOrderId)return;const o=orders.find(x=>x.id===openOrderId);if(!o)return;const txt=buildOrderText(o);if(navigator.share){navigator.share({title:`طلب #${o.code||''}`,text:txt}).catch(()=>{});}else{window.open('https://wa.me/?text='+encodeURIComponent(txt),'_blank');}}

// ═══ تصدير Excel/CSV ═══
function buildCSV(){
  const base=['رقم الطلب','كود المشروع','رمز العميل','اسم العميل','الخدمة','التاريخ','تم بواسطة','ملاحظات'];
  const detailKeys=[...new Set(orders.flatMap(o=>Object.keys(o.details||{})))];
  const rows=[[...base,...detailKeys]];
  orders.forEach(o=>{
    rows.push([
      o.code||'', o.lzmCode||'', o.clientCode||'', o.clientName||'',
      (o.svcLabel||'').replace(/^\S+\s/,''), fmtDate(o.createdAt),
      o.addedBy||'', o.notes||'',
      ...detailKeys.map(k=>(o.details&&o.details[k])||'')
    ]);
  });
  return '\ufeff'+rows.map(r=>r.map(c=>'"'+String(c).replace(/"/g,'""')+'"').join(',')).join('\r\n');
}
function exportCSV(){
  if(!orders.length){showToast('لا توجد طلبات للتصدير');return;}
  const blob=new Blob([buildCSV()],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='lazem-orders-'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  showToast('تم تصدير '+orders.length+' طلب');
}
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800);}
const _dov=document.getElementById('detailOverlay');
if(_dov)_dov.addEventListener('click',function(e){if(e.target===this)closeDetail();});
['crs-aware','crs-fa','crs-fire','crs-ohs'].forEach(id=>{
  const el=document.getElementById(id);
  if(el){el.addEventListener('change',updateCodePreview);el.addEventListener('change',chkTrainees);}
});
['e-start','p-start'].forEach(id=>{
  const el=document.getElementById(id);
  if(el)el.addEventListener('change',updateCodePreview);
});

// تفعيل فيديو صفحة الدخول فور تحميل السكربت
setBgVideo('login');
