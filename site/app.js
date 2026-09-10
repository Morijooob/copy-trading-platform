const MAX_FOLLOWERS=2;
const masters=[
  {id:1,name:'Atlas Demo',return:'+12.4%',risk:'کم',followers:0,queue:0,desc:'استراتژی آزمایشی با ریسک محدود و مناسب تست اولیه.'},
  {id:2,name:'Momentum Demo',return:'+8.7%',risk:'متوسط',followers:0,queue:0,desc:'مستر آزمایشی برای بررسی رفتار در بازار پرنوسان.'},
  {id:3,name:'Steady Demo',return:'+5.2%',risk:'کم',followers:0,queue:0,desc:'تمرکز بر ثبات و تعداد معاملات کمتر.'}
];
const joined=new Set();
const queued=new Set();
const DEMO_KEY='ct_demo_account_v5';
const SESSION_KEY='ct_demo_session_v1';
let demoAccount=null;
let authMode='login';
const mastersEl=document.querySelector('#masters');
const authModal=document.querySelector('#authModal');
const authError=document.querySelector('#authError');
const toast=document.querySelector('#toast');
let toastTimer=null;

function fa(n){return String(n).replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[d]);}
function showToast(message){
  clearTimeout(toastTimer);
  toast.textContent=message;
  toast.classList.add('show');
  toastTimer=setTimeout(()=>toast.classList.remove('show'),3200);
}
function setAuthError(message=''){authError.textContent=message;authError.classList.toggle('show',Boolean(message));}
async function hashPassword(password){
  const data=new TextEncoder().encode(password);
  const digest=await crypto.subtle.digest('SHA-256',data);
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function loadDemoAccount(){
  try{
    const raw=localStorage.getItem(DEMO_KEY);
    if(!raw)return null;
    const parsed=JSON.parse(raw);
    return parsed&&typeof parsed.username==='string'&&typeof parsed.email==='string'&&typeof parsed.passwordHash==='string'?parsed:null;
  }catch(_){
    try{localStorage.removeItem(DEMO_KEY);}catch(__){}
    return null;
  }
}
function saveDemoAccount(account){
  try{localStorage.setItem(DEMO_KEY,JSON.stringify(account));return true;}catch(_){return false;}}
function getSessionUsername(){try{return sessionStorage.getItem(SESSION_KEY)||'';}catch(_){return '';}}
function setSession(username){try{sessionStorage.setItem(SESSION_KEY,username);return true;}catch(_){return false;}}
function clearSession(){try{sessionStorage.removeItem(SESSION_KEY);}catch(_){} }
function restoreSession(){
  const account=loadDemoAccount();
  const username=getSessionUsername();
  return account&&username===account.username?account:null;
}
function renderAccount(){
  const card=document.querySelector('#userCard');
  const profile=document.querySelector('#profileMenu');
  const authButton=document.querySelector('#authBtn');
  if(demoAccount){
    card.classList.remove('hidden');
    profile.classList.remove('hidden');
    authButton.classList.add('hidden');
    document.querySelector('#userName').textContent=demoAccount.username;
    document.querySelector('#topUserName').textContent=demoAccount.username;
    document.querySelector('#userState').textContent='حساب دمو فعال است · بدون پول واقعی';
    document.querySelector('#topAvatar').setAttribute('title',demoAccount.username);
    document.querySelector('#userAvatar').setAttribute('title',demoAccount.username);
  }else{
    card.classList.add('hidden');
    profile.classList.add('hidden');
    authButton.classList.remove('hidden');
    authButton.textContent='ثبت‌نام / ورود دمو';
  }
}
function setAuthMode(mode){
  authMode=mode;
  const login=mode==='login';
  document.querySelector('#loginTab').classList.toggle('active',login);
  document.querySelector('#registerTab').classList.toggle('active',!login);
  document.querySelector('#authTitle').textContent=login?'ورود به حساب دمو':'ثبت‌نام حساب دمو';
  document.querySelector('#authDescription').textContent=login?'اگر قبلاً حساب دمو ساخته‌اید، نام کاربری و رمزتان را وارد کنید.':'نام کاربری، ایمیل و رمز عبور خود را برای ساخت حساب دمو وارد کنید.';
  document.querySelector('#email').classList.toggle('hidden',login);
  document.querySelector('#passwordConfirm').classList.toggle('hidden',login);
  document.querySelector('#password').setAttribute('autocomplete',login?'current-password':'new-password');
  document.querySelector('#authSubmit').textContent=login?'ورود به حساب دمو':'ساخت حساب دمو';
  setAuthError('');
}
function openAuth(mode='login'){setAuthMode(mode);authModal.classList.remove('hidden');setTimeout(()=>document.querySelector('#username').focus(),0);}
function closeAuth(){authModal.classList.add('hidden');setAuthError('');}
function setDemoActive(){
  document.querySelector('#exchange').textContent='Demo Exchange · مجازی';
  document.querySelector('#mode').textContent='دمو فعال';
  document.querySelector('#mode').classList.add('demo');
}
function enterDemo(){
  setDemoActive();
  showToast('نسخه دمو فعال شد؛ هیچ سفارش واقعی ارسال نمی‌شود.');
  document.querySelector('#masters').scrollIntoView({behavior:'smooth',block:'start'});
}
function render(){
  mastersEl.innerHTML='';
  masters.forEach(m=>{
    const full=m.followers>=MAX_FOLLOWERS;
    const alreadyJoined=joined.has(m.id);
    const alreadyQueued=queued.has(m.id);
    const el=document.createElement('article');
    el.className='master card';
    let label='شروع کپی دمو';
    if(full) label='ورود به صف انتظار';
    if(alreadyJoined) label='کپی دمو فعال است';
    if(alreadyQueued) label='در صف انتظار هستید';
    el.innerHTML=`<span class="eyebrow">DEMO MASTER</span><h3>${m.name}</h3><p>${m.desc}</p><div class="metrics"><span>بازده ${m.return}</span><span>ریسک ${m.risk}</span></div><div class="capacity">فعال: ${fa(m.followers)}/${fa(MAX_FOLLOWERS)} · صف: ${fa(m.queue)}</div><button ${alreadyJoined||alreadyQueued?'disabled':''}>${label}</button>`;
    const button=el.querySelector('button');
    if(!alreadyJoined&&!alreadyQueued) button.onclick=()=>follow(m.id);
    mastersEl.appendChild(el);
  });
  document.querySelector('#queueBadge').textContent=`صف کل: ${fa(masters.reduce((n,m)=>n+m.queue,0))}`;
  renderAccount();
}
function follow(id){
  if(!demoAccount){openAuth('login');return;}
  const m=masters.find(x=>x.id===id);
  if(!m||joined.has(id)||queued.has(id))return;
  if(m.followers<MAX_FOLLOWERS){m.followers++;joined.add(id);setDemoActive();showToast(`کپی دمو برای ${m.name} فعال شد. هیچ سفارش واقعی ارسال نمی‌شود.`);}
  else{m.queue++;queued.add(id);setDemoActive();showToast(`ظرفیت ${m.name} پر است؛ شما در صف انتظار شماره ${fa(m.queue)} قرار گرفتید.`);}
  render();
}

document.querySelector('#demoBtn').onclick=enterDemo;
document.querySelector('#authBtn').onclick=()=>openAuth('login');
document.querySelector('#heroAuthBtn').onclick=()=>openAuth('register');
document.querySelector('#closeAuth').onclick=closeAuth;
document.querySelector('#loginTab').onclick=()=>setAuthMode('login');
document.querySelector('#registerTab').onclick=()=>setAuthMode('register');
authModal.onclick=e=>{if(e.target===authModal)closeAuth();};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!authModal.classList.contains('hidden'))closeAuth();});
authModal.querySelector('#authSubmit').onclick=async()=>{
  const username=document.querySelector('#username').value.trim();
  const email=document.querySelector('#email').value.trim().toLowerCase();
  const password=document.querySelector('#password').value;
  const confirm=document.querySelector('#passwordConfirm').value;
  setAuthError('');
  if(username.length<3){setAuthError('نام کاربری باید حداقل ۳ کاراکتر باشد.');return;}
  if(authMode==='register'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){setAuthError('یک ایمیل معتبر وارد کنید.');return;}
  if(password.length<4){setAuthError('رمز عبور باید حداقل ۴ کاراکتر باشد.');return;}
  if(authMode==='register'){
    if(password!==confirm){setAuthError('تکرار رمز عبور با رمز اصلی یکسان نیست.');return;}
    if(loadDemoAccount()){setAuthError('این مرورگر از قبل یک حساب دمو دارد. از بخش ورود استفاده کنید.');return;}
    const account={username,email,passwordHash:await hashPassword(password),emailVerified:false};
    if(!saveDemoAccount(account)){setAuthError('ذخیره حساب دمو در این مرورگر ممکن نیست.');return;}
    if(!setSession(username)){setAuthError('ساخت نشست دمو در این مرورگر ممکن نیست.');return;}
    demoAccount=account;
    closeAuth();
    enterDemo();
    showToast(`حساب دمو برای ${username} ساخته شد. ایمیل ثبت شد؛ تأیید واقعی ایمیل بعد از راه‌اندازی Backend انجام می‌شود.`);
    render();
    return;
  }
  const account=loadDemoAccount();
  if(!account){setAuthError('حساب دمو پیدا نشد. ابتدا ثبت‌نام کنید.');return;}
  const passwordHash=await hashPassword(password);
  if(account.username!==username||account.passwordHash!==passwordHash){setAuthError('نام کاربری یا رمز عبور اشتباه است.');return;}
  if(!setSession(username)){setAuthError('ورود دمو در این مرورگر ممکن نیست.');return;}
  demoAccount=account;
  closeAuth();
  enterDemo();
  showToast(`خوش آمدید ${username}؛ حساب دمو فعال شد.`);
  render();
};
function logout(){
  demoAccount=null;clearSession();joined.clear();queued.clear();masters.forEach(m=>{m.followers=0;m.queue=0;});
  document.querySelector('#exchange').textContent='Demo Exchange · مجازی';
  document.querySelector('#mode').textContent='دمو خاموش';
  render();showToast('از حساب دمو خارج شدید؛ برای ورود دوباره رمز عبور لازم است.');
}
document.querySelector('#logoutBtn').onclick=logout;
document.querySelector('#topLogoutBtn').onclick=logout;

demoAccount=restoreSession();
if(demoAccount)setDemoActive();
render();
