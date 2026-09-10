const MAX_FOLLOWERS=2;
const masters=[
  {id:1,name:'Atlas Demo',return:'+12.4%',risk:'کم',followers:0,queue:0,desc:'استراتژی آزمایشی با ریسک محدود و مناسب تست اولیه.'},
  {id:2,name:'Momentum Demo',return:'+8.7%',risk:'متوسط',followers:0,queue:0,desc:'مستر آزمایشی برای بررسی رفتار در بازار پرنوسان.'},
  {id:3,name:'Steady Demo',return:'+5.2%',risk:'کم',followers:0,queue:0,desc:'تمرکز بر ثبات و تعداد معاملات کمتر.'}
];
const joined=new Set();
const queued=new Set();
const DEMO_KEY='ct_demo_account_v3';
let demoAccount=null;
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
function loadDemoAccount(){
  try{
    const raw=localStorage.getItem(DEMO_KEY);
    if(!raw)return null;
    const parsed=JSON.parse(raw);
    return parsed&&typeof parsed.username==='string'?parsed:null;
  }catch(_){
    try{localStorage.removeItem(DEMO_KEY);}catch(__){}
    return null;
  }
}
function saveDemoAccount(account){
  try{localStorage.setItem(DEMO_KEY,JSON.stringify(account));return true;}catch(_){return false;}
}
function renderAccount(){
  const card=document.querySelector('#userCard');
  if(demoAccount){
    card.classList.remove('hidden');
    document.querySelector('#userName').textContent=demoAccount.username;
    document.querySelector('#userState').textContent='حساب دمو فعال است · بدون پول واقعی';
    document.querySelector('#authBtn').textContent='حساب دمو';
  }else{
    card.classList.add('hidden');
    document.querySelector('#authBtn').textContent='ثبت‌نام / ورود دمو';
  }
}
function openAuth(){
  setAuthError('');
  authModal.classList.remove('hidden');
  setTimeout(()=>document.querySelector('#username').focus(),0);
}
function closeAuth(){authModal.classList.add('hidden');setAuthError('');}
function setDemoActive(){
  document.querySelector('#exchange').textContent='Demo Exchange';
  document.querySelector('#mode').textContent='دمو فعال';
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
  if(!demoAccount){openAuth();return;}
  const m=masters.find(x=>x.id===id);
  if(!m||joined.has(id)||queued.has(id))return;
  if(m.followers<MAX_FOLLOWERS){
    m.followers++;
    joined.add(id);
    setDemoActive();
    showToast(`کپی دمو برای ${m.name} فعال شد. هیچ سفارش واقعی ارسال نمی‌شود.`);
  }else{
    m.queue++;
    queued.add(id);
    setDemoActive();
    showToast(`ظرفیت ${m.name} پر است؛ شما در صف انتظار شماره ${fa(m.queue)} قرار گرفتید.`);
  }
  render();
}

document.querySelector('#demoBtn').onclick=()=>{
  if(!demoAccount){openAuth();return;}
  setDemoActive();
  showToast('محیط دمو فعال شد. حالا یک مستر آزمایشی را انتخاب کنید.');
};
document.querySelector('#authBtn').onclick=openAuth;
document.querySelector('#heroAuthBtn').onclick=openAuth;
document.querySelector('#closeAuth').onclick=closeAuth;
authModal.onclick=e=>{if(e.target===authModal)closeAuth();};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!authModal.classList.contains('hidden'))closeAuth();});
document.querySelector('#authSubmit').onclick=()=>{
  const username=document.querySelector('#username').value.trim();
  const password=document.querySelector('#password').value;
  setAuthError('');
  if(username.length<3){setAuthError('نام کاربری باید حداقل ۳ کاراکتر باشد.');return;}
  if(password.length<4){setAuthError('رمز دمو باید حداقل ۴ کاراکتر باشد.');return;}
  const account={username};
  if(!saveDemoAccount(account)){setAuthError('ذخیره حساب دمو در این مرورگر ممکن نیست. حالت خصوصی/فضای ذخیره‌سازی مرورگر را بررسی کنید.');return;}
  demoAccount=account;
  closeAuth();
  setDemoActive();
  showToast(`خوش آمدید ${username}؛ حساب دمو آماده است.`);
  render();
};
document.querySelector('#logoutBtn').onclick=()=>{
  demoAccount=null;
  try{localStorage.removeItem(DEMO_KEY);}catch(_){ }
  joined.clear();
  queued.clear();
  masters.forEach(m=>{m.followers=0;m.queue=0;});
  document.querySelector('#exchange').textContent='متصل نیست';
  document.querySelector('#mode').textContent='دمو خاموش';
  render();
  showToast('از حساب دمو خارج شدید.');
};

demoAccount=loadDemoAccount();
render();
