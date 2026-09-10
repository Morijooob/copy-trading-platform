import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const APP_VERSION='v14';
const MAX_FOLLOWERS=2;
const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const masters=[
  {id:1,name:'Atlas Demo',return:'+12.4%',risk:'کم',followers:0,queue:0,desc:'استراتژی آزمایشی با ریسک محدود و مناسب تست اولیه.'},
  {id:2,name:'Momentum Demo',return:'+8.7%',risk:'متوسط',followers:0,queue:0,desc:'مستر آزمایشی برای بررسی رفتار در بازار پرنوسان.'},
  {id:3,name:'Steady Demo',return:'+5.2%',risk:'کم',followers:0,queue:0,desc:'تمرکز بر ثبات و تعداد معاملات کمتر.'}
];
const joined=new Set(),queued=new Set();
let demoAccount=null,authMode='login',toastTimer=null;
const $=s=>document.querySelector(s);
const mastersEl=$('#masters'),authModal=$('#authModal'),authError=$('#authError'),toast=$('#toast');
function fa(n){return String(n).replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[d]);}
function showToast(message){clearTimeout(toastTimer);toast.textContent=message;toast.classList.add('show');toastTimer=setTimeout(()=>toast.classList.remove('show'),3200);}
function setAuthError(message=''){authError.textContent=message;authError.classList.toggle('show',!!message);}
function userName(user){return user?.user_metadata?.display_name||user?.user_metadata?.username||user?.email?.split('@')[0]||'کاربر';}
function renderAccount(){const card=$('#userCard'),profile=$('#profileMenu'),auth=$('#authBtn');if(demoAccount){card.classList.remove('hidden');profile.classList.remove('hidden');auth.classList.add('hidden');const name=userName(demoAccount);$('#userName').textContent=name;$('#topUserName').textContent=name;$('#userState').textContent=demoAccount.email_confirmed_at?'حساب تأییدشده · محیط دمو':'حساب ساخته شد · در انتظار تأیید ایمیل';}else{card.classList.add('hidden');profile.classList.add('hidden');auth.classList.remove('hidden');auth.textContent='ثبت‌نام / ورود';}}
function setAuthMode(mode){authMode=mode;const login=mode==='login';$('#loginTab').classList.toggle('active',login);$('#registerTab').classList.toggle('active',!login);$('#authTitle').textContent=login?'ورود به حساب':'ثبت‌نام حساب';$('#authDescription').textContent=login?'ایمیل و رمز عبور خود را وارد کنید.':'نام نمایشی، ایمیل و رمز عبور خود را وارد کنید.';$('#username').classList.toggle('hidden',login);$('#passwordConfirm').classList.toggle('hidden',login);$('#password').setAttribute('autocomplete',login?'current-password':'new-password');$('#authSubmit').textContent=login?'ورود':'ساخت حساب';setAuthError('');}
function openAuth(mode='login'){setAuthMode(mode);authModal.classList.remove('hidden');setTimeout(()=>$('#email').focus(),0);}
function closeAuth(){authModal.classList.add('hidden');setAuthError('');}
function setDemoActive(){$('#exchange').textContent='Demo Exchange · مجازی';$('#mode').textContent='دمو فعال';$('#mode').classList.add('demo');$('#real').textContent='قفل';}
function goToMasters(){window.location.hash='masters';$('#masters').scrollIntoView({behavior:'smooth',block:'start'});}
function enterDemo(){setDemoActive();render();goToMasters();if(!demoAccount){showToast('دمو فعال شد. برای ورود به محیط دمو، حساب بسازید یا وارد شوید.');setTimeout(()=>openAuth('register'),250);return;}showToast(`دمو برای ${userName(demoAccount)} فعال است؛ یک مستر را انتخاب کنید.`);}
function openDemoDashboard(m){try{sessionStorage.setItem('ct_selected_master',JSON.stringify({id:m.id,name:m.name,return:m.return,risk:m.risk}));}catch(e){}window.location.href='./demo-v2.html';}
function render(){mastersEl.innerHTML='';let totalActive=0,totalQueue=0;masters.forEach(m=>{const full=m.followers>=MAX_FOLLOWERS,j=joined.has(m.id),q=queued.has(m.id);totalActive+=m.followers;totalQueue+=m.queue;const el=document.createElement('article');el.className='master card';el.tabIndex=0;let label='شروع کپی دمو';if(full)label='ورود به صف انتظار';if(j)label='کپی دمو فعال است';if(q)label='در صف انتظار هستید';el.innerHTML=`<span class="eyebrow">DEMO MASTER</span><h3>${m.name}</h3><p>${m.desc}</p><div class="metrics"><span>بازده ${m.return}</span><span>ریسک ${m.risk}</span></div><div class="capacity"><span>فعال: ${fa(m.followers)} از ${fa(MAX_FOLLOWERS)}</span><span>در صف: ${fa(m.queue)}</span></div><button type="button" ${j||q?'disabled':''}>${label}</button>`;const b=el.querySelector('button');const activate=()=>{if(!j&&!q)follow(m.id);};el.addEventListener('click',activate);el.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target===el){e.preventDefault();activate();}});b.addEventListener('click',e=>{e.stopPropagation();activate();});mastersEl.appendChild(el);});$('#activeBadge').textContent=`فعال: ${fa(totalActive)}`;$('#queueBadge').textContent=`در صف: ${fa(totalQueue)}`;renderAccount();}
function follow(id){if(!demoAccount){openAuth('register');return;}const m=masters.find(x=>x.id===id);if(!m||joined.has(id)||queued.has(id))return;if(m.followers<MAX_FOLLOWERS){m.followers++;joined.add(id);setDemoActive();render();openDemoDashboard(m);return;}m.queue++;queued.add(id);setDemoActive();showToast(`ظرفیت ${m.name} پر است؛ شما در صف انتظار شماره ${fa(m.queue)} قرار گرفتید.`);render();}
$('#demoBtn').onclick=enterDemo;$('#authBtn').onclick=()=>openAuth('login');$('#heroAuthBtn').onclick=()=>openAuth('register');$('#closeAuth').onclick=closeAuth;$('#loginTab').onclick=()=>setAuthMode('login');$('#registerTab').onclick=()=>setAuthMode('register');authModal.onclick=e=>{if(e.target===authModal)closeAuth();};document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!authModal.classList.contains('hidden'))closeAuth();});
$('#authSubmit').onclick=async()=>{const displayName=$('#username').value.trim(),email=$('#email').value.trim().toLowerCase(),password=$('#password').value,confirm=$('#passwordConfirm').value;setAuthError('');if(authMode==='register'&&displayName.length<2){setAuthError('نام نمایشی باید حداقل ۲ کاراکتر باشد.');return;}if(!/^\S+@\S+\.\S+$/.test(email)){setAuthError('یک ایمیل معتبر وارد کنید.');return;}if(password.length<8){setAuthError('رمز عبور باید حداقل ۸ کاراکتر باشد.');return;}if(authMode==='register'&&password!==confirm){setAuthError('تکرار رمز عبور با رمز اصلی یکسان نیست.');return;}
  const button=$('#authSubmit');button.disabled=true;button.textContent=authMode==='login'?'در حال ورود…':'در حال ساخت حساب…';
  try{
    if(authMode==='register'){
      const {data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name:displayName}}});
      if(error)throw error;
      if(data.session){demoAccount=data.user;closeAuth();setDemoActive();render();showToast(`حساب ${displayName} ساخته شد و وارد شدید.`);goToMasters();}
      else{closeAuth();showToast('حساب ساخته شد. لینک تأیید به ایمیل شما ارسال شد؛ بعد از تأیید وارد شوید.');setAuthMode('login');setTimeout(()=>openAuth('login'),400);}
    }else{
      const {data,error}=await supabase.auth.signInWithPassword({email,password});
      if(error)throw error;
      demoAccount=data.user;closeAuth();setDemoActive();render();showToast(`خوش آمدید ${userName(data.user)}؛ محیط دمو فعال شد.`);goToMasters();
    }
  }catch(error){setAuthError(error?.message||'عملیات احراز هویت انجام نشد.');}
  finally{button.disabled=false;button.textContent=authMode==='login'?'ورود':'ساخت حساب';}
};
async function logout(){await supabase.auth.signOut();demoAccount=null;joined.clear();queued.clear();masters.forEach(m=>{m.followers=0;m.queue=0;});$('#mode').textContent='دمو خاموش';render();showToast('از حساب خارج شدید.');}
$('#logoutBtn').onclick=logout;$('#topLogoutBtn').onclick=logout;
(async()=>{const {data}=await supabase.auth.getUser();demoAccount=data.user||null;if(demoAccount)setDemoActive();render();supabase.auth.onAuthStateChange((_event,session)=>{demoAccount=session?.user||null;if(demoAccount)setDemoActive();render();});})();
