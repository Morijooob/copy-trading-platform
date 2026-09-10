const MAX_FOLLOWERS=2;
const masters=[
  {id:1,name:'Atlas Demo',return:'+12.4%',risk:'کم',followers:0,queue:0,desc:'استراتژی آزمایشی با ریسک محدود و مناسب تست اولیه.'},
  {id:2,name:'Momentum Demo',return:'+8.7%',risk:'متوسط',followers:0,queue:0,desc:'مستر آزمایشی برای بررسی رفتار در بازار پرنوسان.'},
  {id:3,name:'Steady Demo',return:'+5.2%',risk:'کم',followers:0,queue:0,desc:'تمرکز بر ثبات و تعداد معاملات کمتر.'}
];
const joined=new Set();
const queued=new Set();
const mastersEl=document.querySelector('#masters');
function render(){
  mastersEl.innerHTML='';
  masters.forEach(m=>{
    const full=m.followers>=MAX_FOLLOWERS;
    const alreadyJoined=joined.has(m.id);
    const alreadyQueued=queued.has(m.id);
    const el=document.createElement('article');
    el.className='master card';
    let label=full?'ورود به صف انتظار':'شروع کپی دمو';
    if(alreadyJoined) label='کپی دمو فعال است';
    if(alreadyQueued) label='در صف انتظار هستید';
    el.innerHTML=`<span class="eyebrow">DEMO MASTER</span><h3>${m.name}</h3><p>${m.desc}</p><div class="metrics"><span>بازده ${m.return}</span><span>ریسک ${m.risk}</span></div><div class="capacity">فعال: ${m.followers}/${MAX_FOLLOWERS} · صف: ${m.queue}</div><button ${alreadyJoined||alreadyQueued?'disabled':''}>${label}</button>`;
    const button=el.querySelector('button');
    if(!alreadyJoined&&!alreadyQueued) button.onclick=()=>follow(m.id);
    mastersEl.appendChild(el);
  });
  document.querySelector('#queueBadge').textContent=`صف کل: ${masters.reduce((n,m)=>n+m.queue,0)}`;
}
function follow(id){
  const m=masters.find(x=>x.id===id);
  if(!m||joined.has(id)||queued.has(id)) return;
  if(m.followers<MAX_FOLLOWERS){
    m.followers++;
    joined.add(id);
    document.querySelector('#exchange').textContent='Demo Exchange';
    document.querySelector('#mode').textContent='دمو فعال';
    alert(`کپی دمو برای ${m.name} فعال شد.`);
  }else{
    m.queue++;
    queued.add(id);
    alert(`ظرفیت ${m.name} پر است؛ شما در صف انتظار شماره ${m.queue} قرار گرفتید.`);
  }
  render();
}
document.querySelector('#demoBtn').onclick=()=>{
  document.querySelector('#exchange').textContent='Demo Exchange';
  document.querySelector('#mode').textContent='دمو فعال';
  alert('محیط دمو فعال شد؛ هیچ سفارش واقعی ارسال نمی‌شود.');
};
render();
