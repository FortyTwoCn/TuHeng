import type { ConstructionAnimationDocument } from '@tuheng/contracts';
import { ConstructionAuthor } from './ConstructionAuthor';
import type { ConstructionSpeed, useConstructionPlayback } from './construction-playback';

export type ConstructionFileActions = {
  importAnimation: () => void;
  animation: () => void;
  animationSchema: () => void;
};

export function AnimationNarrationModule({
  animation,
  authored,
  mode,
  switchMode,
  playback,
  files,
  readOnly,
  selected,
  save,
  generate,
  reset,
}: {
  animation: ConstructionAnimationDocument;
  authored: boolean;
  mode: 'play' | 'author';
  switchMode: (mode: 'play' | 'author') => void;
  playback: ReturnType<typeof useConstructionPlayback>;
  files: ConstructionFileActions;
  readOnly: boolean;
  selected: string[];
  save: (value: ConstructionAnimationDocument) => void;
  generate: () => ConstructionAnimationDocument;
  reset: () => void;
}) {
  const { index, step, playing, speed, guides, jump, togglePlay, changeSpeed, setGuides } =
    playback;
  const phase = animation.phases.find(({ id }) => id === step.phaseId);
  return (
    <aside className="geo-teaching-pane geo-animation-pane" aria-label="分步动画面板">
      <div className="geo-teaching-tabs" role="group" aria-label="动画模式">
        <button type="button" aria-pressed={mode === 'play'} onClick={() => switchMode('play')}>
          步骤讲解
        </button>
        {!readOnly && (
          <button
            type="button"
            aria-pressed={mode === 'author'}
            onClick={() => switchMode('author')}
          >
            编排步骤
          </button>
        )}
      </div>
      {mode === 'author' && !readOnly ? (
        <ConstructionAuthor
          key={JSON.stringify(animation)}
          initial={animation}
          selected={selected}
          save={save}
          reset={reset}
          generate={generate}
          hasSaved={authored}
        />
      ) : (
        <>
          <div className="geo-construction-copy" aria-live="polite">
            <div className="geo-construction-progress">
              {phase && <span className="geo-construction-stage">{phase.title}</span>}
              <span className="geo-construction-count">
                {String(index + 1).padStart(2, '0')} /{' '}
                {String(animation.steps.length).padStart(2, '0')}
              </span>
            </div>
            <progress
              className="geo-construction-progress-track"
              aria-label="作图步骤进度"
              value={index + 1}
              max={animation.steps.length}
            />
            <h3>{step.title}</h3>
            <p className="geo-construction-narration">{step.narration}</p>
          </div>
          <div className="geo-construction-playback" role="group" aria-label="步骤播放">
            <button type="button" disabled={!index} onClick={() => jump(index - 1)}>
              上一步
            </button>
            <button type="button" className="geo-teaching-primary" onClick={togglePlay}>
              {playing ? '暂停' : '自动播放'}
            </button>
            <button
              type="button"
              disabled={index === animation.steps.length - 1}
              onClick={() => jump(index + 1)}
            >
              下一步
            </button>
          </div>
          <label className="geo-construction-select">
            选择作图步骤
            <select
              value={index}
              title={step.title}
              onChange={(event) => jump(Number(event.target.value))}
            >
              {animation.steps.map((item, i) => (
                <option key={item.id} value={i}>
                  第 {i + 1} 步 · {item.title}
                </option>
              ))}
            </select>
          </label>
          <div className="geo-construction-settings">
            <label className="geo-construction-speed">
              播放速度
              <select
                value={speed}
                onChange={(event) => changeSpeed(event.target.value as ConstructionSpeed)}
              >
                <option value="slow">慢速</option>
                <option value="normal">中速</option>
                <option value="fast">快速</option>
              </select>
            </label>
            <button type="button" aria-pressed={guides} onClick={() => setGuides(!guides)}>
              作图线
            </button>
          </div>
          <button type="button" className="geo-construction-replay" onClick={() => jump(index)}>
            重新播放本步动画
          </button>
        </>
      )}
      <details className="geo-animation-files">
        <summary>动画 JSON</summary>
        <div className="geo-teaching-controls">
          <button type="button" disabled={readOnly} onClick={files.importAnimation}>
            导入动画 JSON
          </button>
          <button type="button" onClick={files.animation}>
            导出动画 JSON
          </button>
          <button type="button" onClick={files.animationSchema}>
            下载动画 JSON Schema
          </button>
        </div>
      </details>
    </aside>
  );
}
