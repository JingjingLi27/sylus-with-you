import catalog from '../config/animation-catalog.json';
// Approved numbered animation registry; generated GIFs keep their provenance.
export type ReviewStatus =
  /** 已选用的原始或用户确认的定制动画。 */
  | 'real'
  /** 尚未确认的候选素材（兼容旧清单）。 */
  | 'candidate'
  /** 程序生成的开发占位：基础角色 + 正确活动名 + 轻量道具，待补正式原画。 */
  | 'placeholder';

export type AssetSourceKind = 'gif' | 'generated';

export type VisualAsset = {
  visualId: string;
  /** 人类可读说明，用于设置界面素材状态区。 */
  label: string;
  reviewStatus: ReviewStatus;
  kind: AssetSourceKind;
  /**
   * 真实 GIF 的运行期相对路径（相对 assets/runtime），占位素材为 null。
   * 真实 GIF 由构建步骤复制到 runtime，并保留原始帧时长与 disposal。
   */
  file: string | null;
  /** 关联原始来源，便于追溯；占位素材为 null。 */
  sourceId: string | null;
  /**
   * 占位视觉的临时基础画面：使用现有合适人形 GIF 的代表帧（相对 assets/runtime），
   * 叠加正确活动名与少量小道具。非占位素材为 null。
   * 这样用户大多数时间看到的是已有秦彻形象，而不是通用剪影；正式动作仍标“待补”。
   */
  placeholderBaseFile: string | null;
  /** 显示用的中文说明，标注待补情况。 */
  note: string;
};

export const VISUAL_ASSETS: Record<string, VisualAsset> = Object.fromEntries(catalog.map(a => ['a'+a.id, {
 visualId:'a'+a.id, label:a.id+' · '+a.label, reviewStatus:'real' as const, kind:'gif' as const,
 file:a.file, sourceId:a.origin+':'+a.id, placeholderBaseFile:null,
 note:a.origin==='original'?'已选用的原始动画。':'用户已确认的定制动画。'
}]));

/** 兜底视觉：素材损坏或缺失时退回基础待机角色，同时显示正确状态文字。 */
export const FALLBACK_VISUAL_ID = 'a16';

export function resolveVisual(visualId: string): VisualAsset {
  return VISUAL_ASSETS[visualId] ?? VISUAL_ASSETS[FALLBACK_VISUAL_ID];
}

/** 列出全部视觉素材，供设置界面素材状态区展示。 */
export function listVisualAssets(): VisualAsset[] {
  return Object.values(VISUAL_ASSETS).filter(a=>a.visualId!=='a25-touch');
}

/** 是否所有需要正式验收的姿态都已具备真实原画。包括用户确认的定制动画。 */
export function allPosesHaveRealArt(): boolean {
  return Object.values(VISUAL_ASSETS).every((a) => a.reviewStatus === 'real');
}
