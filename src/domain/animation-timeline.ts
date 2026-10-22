import catalog from '../config/animation-catalog.json';
import type { RuntimeSnapshot } from './types.js';

export const durationOf = (id: string): number => catalog.find(a => a.id === id)?.durationMs ?? 2000;
export const CLICK_REACTIONS: Record<string, string[]> = {
  lunch: ['20','14','13'], unknown: ['12','15','14'], home: [], sleep: ['11','19'],
  wake: ['16','14'], breakfast: ['20','16','13'], music: ['09','10','18'],
  boxing: ['02','12','15'], wash: ['25-touch']
};
export const ACTIVITY_ANIMATION_HINTS: Record<string, string> = {
  lunch: '21 吃午餐 · 点击：20 / 14 / 13',
  unknown: '05 / 06 / 09 / 10 / 12 / 14 / 15 轮换 · 点击：12 / 15 / 14',
  home: '16 → 07 / 08 → 10:58 送花13 → 10:59 互动03 · 点击仅显示文字',
  sleep: '23 钱与小狸花猫双梦境 · 点击：11 / 19',
  wake: '19 求摸摸 · 点击：16 / 14', breakfast: '22 吃早餐 · 点击：20 / 16 / 13',
  music: '01 听音乐，间或18唱歌 · 点击：09 / 10 / 18',
  boxing: '24 拳击 · 点击：02 / 12 / 15', wash: '25 慵懒眼洗头 · 点击：泡沫遮眼后擦掉'
};
export type AnimationSelection = { id: string; offsetMs: number; reaction: boolean; key: string };
const selection = (id: string, offsetMs: number): AnimationSelection => ({id, offsetMs, reaction: false, key: id});
const wholeCycles = (id: string, minimum: number): number => Math.ceil(minimum / durationOf(id)) * durationOf(id);
function playlist(ids: string[], minimum: number, elapsed: number): AnimationSelection {
  const durations = ids.map(id => wholeCycles(id, minimum));
  let t = elapsed % durations.reduce((s,d) => s+d, 0);
  for (let i=0;i<ids.length;i++) { if (t<durations[i]) return selection(ids[i],t); t-=durations[i]; }
  return selection(ids[0],0);
}
/** Time anchored to the activity, so clicks never restart ambient playlists or dream progress. */
export function ambientAnimation(activity: string, elapsedMs: number): AnimationSelection {
  const t = Math.max(0,elapsedMs);
  switch(activity) {
    case 'lunch': return selection('21',t);
    case 'breakfast': return selection('22',t);
    case 'sleep': return selection('23',t);
    case 'wake': return selection('19',t);
    case 'boxing': return selection('24',t);
    case 'wash': return selection('25',t);
    case 'unknown': return playlist(['05','06','09','10','12','14','15'],240000,t);
    case 'home': {
      const end = (660-270)*60000;
      if(t>=end-60000) return selection('03',t-(end-60000));
      if(t>=end-120000) return selection('13',t-(end-120000));
      const intro=durationOf('16')*2;
      return t<intro ? selection('16',t) : playlist(['07','08'],180000,t-intro);
    }
    case 'music': {
      const music=30000, singing=12000;
      const phase=t%(music+singing);
      return phase<music?selection('01',phase):selection('18',phase-music);
    }
    default: return selection('16',t);
  }
}

/** Pure clock-injected interaction state, separate from GIF loading and pointer gestures. */
export class AnimationTimeline {
  private snapshot: RuntimeSnapshot | null = null;
  private epoch = 0;
  private baseElapsed = 0;
  private serial = 0;
  private cursor = 0;
  private reaction: {id:string; started:number|null; duration:number; serial:number} | null = null;
  constructor(private readonly now:()=>number) {}
  update(s: RuntimeSnapshot): void {
    const previous=this.snapshot;
    const changed=!previous || previous.mode!==s.mode || previous.previewMinute!==s.previewMinute || previous.displayedActivityId!==s.displayedActivityId;
    if(changed) { this.cursor=0; this.reaction=null; }
    if(changed || (s.mode==='realtime' && previous?.displaySecond!==s.displaySecond)) {
      const second=s.displaySecond ?? (s.previewMinute ?? s.displayedSlot.startMinute)*60;
      this.baseElapsed=Math.max(0,(second-s.displayedSlot.startMinute*60)*1000);
      this.epoch=this.now();
    }
    if(s.hidden || previous?.reducedMotion!==s.reducedMotion) this.reaction=null;
    this.snapshot=s;
  }
  private elapsed():number {
    const slot=this.snapshot!.displayedSlot;
    return Math.min((slot.endMinute-slot.startMinute)*60000-1,this.baseElapsed+Math.max(0,this.now()-this.epoch));
  }
  current():AnimationSelection {
    if(!this.snapshot) return selection('16',0);
    const r=this.reaction;
    if(r) {
      const elapsed=r.started===null?0:Math.max(0,this.now()-r.started);
      if(elapsed<r.duration) return {id:r.id,offsetMs:elapsed,reaction:true,key:`reaction-${r.serial}`};
      this.reaction=null;
    }
    return ambientAnimation(this.snapshot.displayedActivityId,this.elapsed());
  }
  click():boolean {
    if(!this.snapshot || this.snapshot.hidden || this.current().reaction) return false;
    const choices=CLICK_REACTIONS[this.snapshot.displayedActivityId] ?? [];
    const ambient=this.current().id;
    for(let i=0;i<choices.length;i++) {
      const id=choices[this.cursor++%choices.length];
      if(id===ambient) continue;
      const duration=this.snapshot.reducedMotion?2000:id==='25-touch'?durationOf(id):wholeCycles(id,2000);
      this.reaction={id,started:null,duration,serial:++this.serial};
      return true;
    }
    return false;
  }
  /** Start reaction lifetime only once its image is ready, not while decoding a large GIF. */
  ready():void { if(this.reaction?.started===null) this.reaction.started=this.now(); }
}
