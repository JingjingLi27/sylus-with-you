import {describe,it,expect} from 'vitest';
import {AnimationTimeline,ambientAnimation,durationOf,CLICK_REACTIONS} from '../src/domain/animation-timeline.js';
import {buildSnapshot,INITIAL_COORDINATOR_STATE} from '../src/domain/state.js';
import {VISUAL_ASSETS} from '../src/domain/assets.js';
import config from '../src/config/schedule.json';
import type {ScheduleSlot} from '../src/domain/types.js';
const slots=config.slots as ScheduleSlot[];
function fixture(minute:number){let now=0;const t=new AnimationTimeline(()=>now);let rev=0;const snapshot=(m:number,hidden=false,reducedMotion=false)=>buildSnapshot({...INITIAL_COORDINATOR_STATE,mode:'preview',previewMinute:m,hidden,reducedMotion},new Date(2026,9,21,12),slots,++rev);t.update(snapshot(minute));return {t,snapshot,advance:(ms:number)=>{now+=ms;}};}
describe('approved ambient timeline',()=>{
 it.each([['lunch','21'],['breakfast','22'],['sleep','23'],['wake','19'],['boxing','24'],['wash','25']])('%s uses %s',(activity,id)=>expect(ambientAnimation(activity,0).id).toBe(id));
 it('home opens with two waves then alternates at complete-loop boundaries',()=>{
  const intro=durationOf('16')*2, middle=Math.ceil(180000/durationOf('07'))*durationOf('07');
  expect(ambientAnimation('home',intro-1).id).toBe('16');
  expect(ambientAnimation('home',intro).id).toBe('07');
  expect(ambientAnimation('home',intro+middle).id).toBe('08');
 });
 it('home final two minutes: flowers then interaction, with exact boundaries',()=>{
  const ending=(660-270)*60000;
  expect(['07','08']).toContain(ambientAnimation('home',ending-120001).id);
  expect(ambientAnimation('home',ending-120000).id).toBe('13');
  expect(ambientAnimation('home',ending-60001).id).toBe('13');
  expect(ambientAnimation('home',ending-60000).id).toBe('03');
 });
 it('unknown playlist includes all seven approved assets, never 03 or 17',()=>{
  const seen=new Set(Array.from({length:9000},(_,s)=>ambientAnimation('unknown',s*1000).id));
  expect([...seen].sort()).toEqual(['05','06','09','10','12','14','15']);
 });
 it('music alternates 30 seconds listening with 12 seconds singing',()=>{
  expect(ambientAnimation('music',29999).id).toBe('01');
  expect(ambientAnimation('music',30000).id).toBe('18');
  expect(ambientAnimation('music',42000).id).toBe('01');
 });
 it('all reaction IDs have packaged resources',()=>{
  for(const ids of Object.values(CLICK_REACTIONS))for(const id of ids)expect(VISUAL_ASSETS['a'+id]?.file).toBeTruthy();
 });
});
describe('click interaction lifecycle',()=>{
 it('home never reacts, including closing sequence',()=>{
  for(const minute of [270,500,658,659]){const {t}=fixture(minute);expect(t.click()).toBe(false);expect(t.current().reaction).toBe(false);}
 });
 it('cycles lunch reactions, rejects repeat clicks, and waits for decode readiness',()=>{
  const {t,advance}=fixture(0);expect(t.click()).toBe(true);expect(t.current().id).toBe('20');
  advance(10000);expect(t.current().reaction).toBe(true);expect(t.click()).toBe(false);
  t.ready();advance(1999);expect(t.current().id).toBe('20');advance(1);expect(t.current().id).toBe('21');
  expect(t.click()).toBe(true);expect(t.current().id).toBe('14');
 });
 it('restores ambient phase after sleep reaction, not dream frame zero',()=>{
  const {t,advance}=fixture(660);advance(5000);t.click();t.ready();advance(3700);
  expect(t.current()).toMatchObject({id:'23',offsetMs:8700,reaction:false});
 });
 it('clears reaction on activity change, preview exit, and hide',()=>{
  const {t,snapshot}=fixture(0);t.click();t.update(snapshot(660));expect(t.current().id).toBe('23');
  t.click();t.update({...snapshot(660),mode:'realtime',previewMinute:null});expect(t.current().reaction).toBe(false);
  t.click();t.update({...snapshot(660,true),mode:'realtime',previewMinute:null});expect(t.click()).toBe(false);
 });
 it('reduced motion reacts with a static two-second lifetime',()=>{
  const {t,snapshot,advance}=fixture(1260);t.update(snapshot(1260,false,true));t.click();t.ready();advance(1999);expect(t.current().reaction).toBe(true);advance(1);expect(t.current().id).toBe('24');
 });
 it('wash click uses just the 1.3 second foam accident, then returns to normal phase',()=>{
  const {t,advance}=fixture(1380);advance(5000);t.click();expect(t.current().id).toBe('25-touch');t.ready();advance(1300);expect(t.current()).toMatchObject({id:'25',offsetMs:6300,reaction:false});
 });
 it('preview stays in selected slot; normal same-slot snapshots do not reset reactions',()=>{
  const {t,snapshot,advance}=fixture(659);advance(120000);expect(t.current().id).toBe('03');
  t.update(snapshot(0));t.click();t.ready();advance(500);t.update(snapshot(0));expect(t.current()).toMatchObject({id:'20',offsetMs:500});
 });
 it('ignores same-as-ambient random-slot reactions',()=>{
  // Seek the beginning of asset12 in the playlist.
  let elapsed=0;for(const id of ['05','06','09','10'])elapsed+=Math.ceil(240000/durationOf(id))*durationOf(id);
  const f=fixture(120);f.advance(elapsed);expect(f.t.current().id).toBe('12');f.t.click();expect(f.t.current().id).toBe('15');
 });
});
