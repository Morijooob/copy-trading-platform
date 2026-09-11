/* Deterministic DEMO-ONLY cycle tester. */
window.runDeterministicDemoCycle = async function(){
  const state=window.__CT_DEMO_STATE;
  if(!state||typeof state.executeSignal!=='function') throw new Error('Demo execution state unavailable');
  const symbol=state.symbol||'TESTUSDT', base=Number(state.price||100);
  const steps=[{sig:'BUY',price:base},{sig:'SELL',price:base*1.02},{sig:'BUY',price:base*1.01}];
  if(typeof state.reset==='function') state.reset();
  state.feed('🧪 تست قطعی BUY → SELL → BUY شروع شد');
  for(const step of steps){await new Promise(r=>setTimeout(r,350));state.executeSignal(step.sig,step.price,symbol,{testMode:true});}
  state.feed('🧪 تست قطعی پایان یافت · ۳ سیگنال اجرا شد');
  return {ok:true,orders:state.orders,signalSequence:steps.map(x=>x.sig)};
};