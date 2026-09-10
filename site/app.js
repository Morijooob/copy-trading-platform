const MAX_FOLLOWERS=2;
const masters=[
  {id:1,name:'Atlas Demo',return:'+12.4%',risk:'کم',followers:0,queue:0,desc:'استراتژی آزمایشی با ریسک محدود و مناسب تست اولیه.'},
  {id:2,name:'Momentum Demo',return:'+8.7%',risk:'متوسط',followers:0,queue:0,desc:'مستر آزمایشی برای بررسی رفتار در بازار پرنوسان.'},
  {id:3,name:'Steady Demo',return:'+5.2%',risk:'کم',followers:0,queue:0,desc:'تمرکز بر ثبات و تعداد معاملات کمتر.'}
];
const joined=new Set();
const queued=new Set();
let demoAccount=JSON.parse(localStorage.getItem('ct_demo_account')||'null');
const mastersEl=document.querySelector('#masters');
const authModal=document.querySelector('#authModal');
function fa(n){return String(n).replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[d]);}
function renderAccount(){
  const card=document.querySelector('#userCard');
  if(demoAccount){card.classList.remove('hidden');document.querySelector('#userName').textContent=demoAccount.username;document.querySelector('#userState').textContent='حساب دمو فعال است';document.querySelector('#authBtn').textContent='حساب من';}
  else{card.classList.add('hidden');document.querySelector('#authBtn').textContent='ورود / ثبت‌نام';}
}
function openAuth(){authModal.classList.remove('hidden');document.querySelector('#username').focus();}
function closeAuth(){authModal.classList.add('hidden');}
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
  if(!m||joined.has(id)||queued.has(id)) return;
  if(m.followers<MAX_FOLLOWERS){
    m.followers++;
    joined.add(id);
    document.querySelector('#exchange').textContent='Demo Exchange';
    document.querySelector('#mode').textContent='دمو فعال';
    alert(`کپی دمو برای ${m.name} فعال شد. هیچ سفارش واقعی ارسال نمی‌شود.`);
  }else{
    m.queue++;
    queued.add(id);
    alert(`ظرفیت ${m.name} پر است؛ شما در صف انتظار شماره ${fa(m.queue)} قرار گرفتید.`);
  }
  render();
}
document.querySelector('#demoBtn').onclick=()=>{
  if(!demoAccount){openAuth();return;}
  document.querySelector('#exchange').textContent='Demo Exchange';
  document.querySelector('#mode').textContent='دمو فعال';
  alert('محیط دمو فعال شد؛ هیچ سفارش واقعی ارسال نمی‌شود. حالا می‌توانید یک مستر را انتخاب کنید.');
};
document.querySelector('#authBtn').onclick=openAuth;
document.querySelector('#heroAuthBtn').onclick=openAuth;
document.querySelector('#closeAuth').onclick=closeAuth;
document.querySelector('#authModal').onclick=e=>{if(e.target===authModal)closeAuth();};
document.querySelector('#authSubmit').onclick=()=>{
  const username=document.querySelector('#username').value.trim();
  const password=document.querySelector('#password').value;
  if(username.length<3||password.length<4){alert('نام کاربری حداقل ۳ و رمز عبور حداقل ۴ کاراکتر باشد.');return;}
  demoAccount={username};
  localStorage.setItem('ct_demo_account',JSON.stringify(demoAccount));
  closeAuth();
  document.querySelector('#exchange').textContent='Demo Exchange';
  document.querySelector('#mode').textContent='دمو فعال';
  alert(`خوش آمدید ${username}؛ حساب دمو شما ساخته شد.`);
  render();
};
document.querySelector('#logoutBtn').onclick=()=>{
  demoAccount=null;localStorage.removeItem('ct_demo_account');
  joined.clear();queued.clear();masters.forEach(m=>{m.followers=0;m.queue=0;});
  document.querySelector('#exchange').textContent='متصل نیست';
  document.querySelector('#mode').textContent='دمو';
  render();
};
render();
