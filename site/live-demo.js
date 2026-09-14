(() => {
  'use strict';

  const CONFIG = Object.freeze({ feeRate: 0.001, allocationPct: 0.95, minScore: 70, takeProfitPct: 0.004, stopLossPct: 0.006, maxHoldCycles: 12, cooldownCycles: 2 });
  const PRODUCTS = Object.freeze({ BTC: 'BTC-USD', ETH: 'ETH-USD', SOL: 'SOL-USD' });
  const API = 'https://api.exchange.coinbase.com/products';

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number.isFinite(Number(n)) ? Number(n).toFixed(4) : '—';

  function signalFromRows(rows) {
    if (!Array.isArray(rows)) return null;
    const closed = rows.slice(0, -1);
    const closes = closed.map(r => Number(r && r[4])).filter(Number.isFinite);
    if (closes.length < 20) return null;
    const latest = closes[closes.length - 1];
    const baseline = closes[closes.length - 20];
    if (!(baseline > 0)) return null;
    const signal = latest >= baseline ? 'BUY' : 'SELL';
    const momentumPoints = Math.min(60, Math.abs((latest - baseline) / baseline) * 8000);
    const volumes = closed.map(r => Number(r && r[5])).filter(Number.isFinite);
    const avg = volumes.length ? volumes.reduce((a,b) => a+b,0) / volumes.length : 0;
    const recent = volumes.slice(-10);
    const recentAvg = recent.length ? recent.reduce((a,b) => a+b,0) / recent.length : 0;
    const ratio = avg > 0 ? recentAvg / avg : 1;
    const volumePoints = Math.min(20, Math.max(0, 10 + (ratio - 1) * 20));
    const score = Math.round(Math.min(100, 20 + momentumPoints + volumePoints));
    const price = Number(rows[rows.length - 1] && rows[rows.length - 1][4]);
    return price > 0 ? { price, signal, score } : null;
  }

  class Engine {
    constructor(capital) { this.capital = Math.max(1, Number(capital) || 100); this.reset(this.capital); }
    reset(capital = this.capital) { this.capital = Math.max(1, Number(capital) || 100); this.cash=this.capital; this.position=null; this.realized=0; this.unrealizedValue=0; this.fees=0; this.orders=0; this.cycleCount=0; this.cooldown=0; this.lastPrices={}; this.lastSignals={}; this.events=[]; this.diagnostic={reason:'هنوز داده‌ای دریافت نشده است', candidate:null}; }
    emit(type,payload={}) { const e={type,cycle:this.cycleCount,...payload}; this.events.push(e); return e; }
    open(symbol,side,price) { if(this.position||!(price>0))return null; const allocation=this.cash*CONFIG.allocationPct; const fee=allocation*CONFIG.feeRate; const notional=allocation-fee; const qty=notional/price; if(!(qty>0))return null; this.cash-=allocation; this.fees+=fee; this.orders++; this.position={symbol,side,qty,entry:price,margin:notional,holdCycles:0}; return this.emit('OPEN',{symbol,side,price,fee,qty}); }
    unrealized() { if(!this.position)return 0; const p=this.lastPrices[this.position.symbol]; if(!(p>0))return 0; return this.position.side==='LONG'?this.position.qty*(p-this.position.entry):this.position.qty*(this.position.entry-p); }
    close(reason) { if(!this.position)return null; const p=this.position, price=this.lastPrices[p.symbol]; if(!(price>0))return null; const pnl=this.unrealized(), fee=p.qty*price*CONFIG.feeRate, result=pnl-fee; this.cash+=p.margin+pnl-fee; this.realized+=result; this.fees+=fee; this.orders++; this.position=null; this.cooldown=Math.max(0,Math.ceil(CONFIG.cooldownCycles)); return this.emit('CLOSE',{symbol:p.symbol,side:p.side,price,reason,result,fee}); }
    process(markets) {
      this.cycleCount++; const signals={}, prices={};
      Object.entries(markets).forEach(([symbol,rows])=>{const s=signalFromRows(rows); if(s){signals[symbol]=s;prices[symbol]=s.price;}});
      this.lastPrices={...this.lastPrices,...prices}; this.lastSignals=signals;
      const candidates=Object.entries(signals).sort((a,b)=>b[1].score-a[1].score);
      const candidate=candidates[0]?{symbol:candidates[0][0],...candidates[0][1]}:null;
      const ranked=candidates.filter(([,s])=>s.score>=CONFIG.minScore);
      const best=ranked[0]?{symbol:ranked[0][0],...ranked[0][1]}:null;
      let reason='شرایط ورود تأیید نشده است';
      if(!candidate) reason='داده کافی برای محاسبه سیگنال وجود ندارد';
      else if(candidate.score<CONFIG.minScore) reason=`امتیاز کاندیدا ${candidate.score} است؛ حداقل ورود ${CONFIG.minScore} است`;
      else reason=`شرایط ورود تأیید شد: ${candidate.signal==='BUY'?'LONG':'SHORT'} با امتیاز ${candidate.score}`;
      if(this.position) reason=`پوزیشن ${this.position.side} باز است؛ اقدام موتور: HOLD و مدیریت ریسک`;
      else if(!this.position&&this.cooldown>0) reason=`دوره خنک‌سازی فعال است؛ ${this.cooldown} چرخه باقی مانده`;
      this.diagnostic={reason,candidate};
      let closed=false;
      if(this.position){ this.position.holdCycles++; const s=signals[this.position.symbol], entry=this.position.entry, price=this.lastPrices[this.position.symbol]; const move=this.position.side==='LONG'?(price-entry)/entry:(entry-price)/entry; let closeReason=null; if(move>=CONFIG.takeProfitPct)closeReason='take-profit'; else if(move<=-CONFIG.stopLossPct)closeReason='stop-loss'; else if(this.position.holdCycles>=CONFIG.maxHoldCycles)closeReason='max-hold'; else if(s&&((this.position.side==='LONG'&&s.signal==='SELL')||(this.position.side==='SHORT'&&s.signal==='BUY')))closeReason='reverse-signal'; if(closeReason)closed=!!this.close(closeReason); }
      if(closed)return this.snapshot(best);
      if(!this.position&&this.cooldown>0)this.cooldown--; else if(!this.position&&best)this.open(best.symbol,best.signal==='BUY'?'LONG':'SHORT',best.price); else if(this.position&&best)this.emit('HOLD',{symbol:this.position.symbol,side:this.position.side,price:this.lastPrices[this.position.symbol],bestSymbol:best.symbol,bestSignal:best.signal});
      return this.snapshot(best);
    }
    snapshot(best=null){const unrealized=this.unrealized(),equity=this.position?this.cash+this.position.margin+unrealized:this.cash;return {equity,realized:this.realized,unrealized,totalPnl:this.realized+unrealized,fees:this.fees,orders:this.orders,cycleCount:this.cycleCount,position:this.position,lastPrices:{...this.lastPrices},best,candidate:this.diagnostic.candidate,reason:this.diagnostic.reason};}
  }

  const engine = new Engine(100); let running=false, timer=null, lastError=null, lastUpdate=null;

  function render(s){
    $('status').textContent=running?'بازار واقعی فعال — فقط Dry-Run':'متوقف است';
    $('equity').textContent=fmt(s.equity); $('unrealized').textContent=fmt(s.unrealized); $('realized').textContent=fmt(s.realized); $('fees').textContent=fmt(s.fees); $('total').textContent=fmt(s.totalPnl); $('orders').textContent=s.orders; $('cycles').textContent=s.cycleCount; $('position').textContent=s.position?`${s.position.side} · ${s.position.symbol}`:'FLAT';
    $('signal').textContent=s.position?(s.position.side==='LONG'?'LONG فعال':'SHORT فعال'):(s.best?(s.best.signal==='BUY'?'LONG':'SHORT'):'NO TRADE');
    $('score').textContent=s.best?s.best.score:(s.candidate?s.candidate.score:'—'); $('symbol').textContent=s.position?s.position.symbol:(s.best?s.best.symbol:(s.candidate?s.candidate.symbol:'—')); $('candidate').textContent=s.candidate?`${s.candidate.symbol} · ${s.candidate.signal==='BUY'?'LONG':'SHORT'} · ${s.candidate.score}/100`:'—'; $('reason').textContent=s.reason||'—'; $('btc').textContent=fmt(s.lastPrices.BTC); $('eth').textContent=fmt(s.lastPrices.ETH); $('sol').textContent=fmt(s.lastPrices.SOL); $('updated').textContent=lastUpdate?new Date(lastUpdate).toLocaleTimeString('fa-IR'):'—';
    $('message').innerHTML=lastError?`<span class="bad">داده بازار دریافت نشد: ${lastError} — موتور در این حالت معامله نمی‌کند.</span>`:'<span class="ok">داده بازار واقعی دریافت شد؛ اجرای سفارش واقعی کاملاً خاموش است.</span>';
    const ev=engine.events.slice(-12).reverse(); $('events').innerHTML=ev.length?ev.map(e=>`<div class="box">${e.type} · ${e.symbol||''} ${e.side||''} · ${e.reason||''} ${e.price?fmt(e.price):''} ${e.result!=null?'· P/L '+fmt(e.result):''}</div>`).join(''):'هنوز رویدادی ثبت نشده است.';
  }

  async function fetchCandles(product){
    const res=await fetch(`${API}/${encodeURIComponent(product)}/candles?granularity=60`,{headers:{Accept:'application/json'},cache:'no-store'});
    if(!res.ok)throw new Error(`LIVE_FEED_HTTP_${res.status}`);
    const data=await res.json(); if(!Array.isArray(data))throw new Error('LIVE_FEED_INVALID_DATA');
    const rows=data.map(c=>[Number(c[0])*1000,Number(c[3]),Number(c[2]),Number(c[1]),Number(c[4]),Number(c[5])]).filter(r=>r.every(Number.isFinite)).sort((a,b)=>a[0]-b[0]);
    if(rows.length<21)throw new Error('LIVE_FEED_INSUFFICIENT_CANDLES'); return rows;
  }

  async function tick(){
    try{const markets={}; for(const [s,p] of Object.entries(PRODUCTS))markets[s]=await fetchCandles(p); const snap=engine.process(markets); lastError=null; lastUpdate=new Date().toISOString(); render(snap);}
    catch(e){lastError=e instanceof Error?e.message:String(e);render(engine.snapshot());}
  }

  $('start').addEventListener('click',()=>{if(running)return; running=true; render(engine.snapshot()); tick(); timer=setInterval(tick,20000);});
  $('tick').addEventListener('click',()=>{tick();});
  $('stop').addEventListener('click',()=>{running=false;if(timer)clearInterval(timer);timer=null;render(engine.snapshot());});
  $('reset').addEventListener('click',()=>{running=false;if(timer)clearInterval(timer);timer=null;engine.reset(100);lastError=null;lastUpdate=null;$('message').textContent='دمو بازنشانی شد.';render(engine.snapshot());});
  render(engine.snapshot());
})();
